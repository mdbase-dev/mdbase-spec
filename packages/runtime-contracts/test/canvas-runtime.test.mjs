import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { RuntimeContractValidator, loadRuntimeContracts, materializeContractRecord } from "../dist/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../../..");
const exampleRoot = resolve(repoRoot, "examples/v0.3/canvas-runtime");

test("loads and preflights the canvas runtime example", async () => {
  const result = await loadRuntimeContracts(exampleRoot);
  const runtimePackage = result.contracts;

  assert.deepEqual(runtimePackage.diagnostics, []);
  assert.equal(runtimePackage.typeFiles.length, 12);
  assert.equal(runtimePackage.providers.length, 2);
  assert.equal(runtimePackage.actions.length, 1);
  assert.equal(runtimePackage.events.length, 2);
  assert.equal(runtimePackage.capabilities.length, 1);
  assert.equal(runtimePackage.workflows.length, 1);
  assert.equal(runtimePackage.runs.length, 0);
  assert.equal(runtimePackage.checkpoints.length, 0);
  assert.equal(runtimePackage.timers.length, 0);
  assert.equal(runtimePackage.runtimeDiagnostics.length, 0);

  const registry = result.registry;
  assert.equal(registry.actions.has("mdbase.record.patch"), true);
  assert.equal(registry.providerContracts.has("mdbase"), true);
  assert.equal(registry.providerContracts.has("canvas-bases"), true);
  assert.equal(registry.events.has("canvas.drop"), true);
  assert.equal(registry.events.has("mdbase.record.modified"), true);
  assert.equal(registry.capabilities.has("mdbase.record.write"), true);
  assert.equal(registry.workflows.has("canvas.zone.set-status"), true);
  assert.equal(registry.capabilityIds.has("mdbase.record.write"), true);

  assert.equal(result.preflight.valid, true);
  assert.deepEqual(result.preflight.diagnostics, []);
  assert.equal(result.valid, true);
  assert.deepEqual(result.diagnostics, []);
  assert.deepEqual([...registry.providers].sort(), ["canvas-bases", "mdbase"]);
});

test("validates event envelopes and evaluated action inputs", async () => {
  const validator = await RuntimeContractValidator.create();
  const registry = validator.composeRegistry(await validator.loadContracts(exampleRoot));
  const eventEnvelope = JSON.parse(
    await readFile(resolve(exampleRoot, "runtime-events/sample-canvas-drop-event.json"), "utf8")
  );

  assert.equal(validator.validateEventEnvelope(registry, eventEnvelope).valid, true);
  assert.equal(
    validator.validateEventEnvelope(registry, {
      ...eventEnvelope,
      contract_version: 2
    }).diagnostics.some((diagnostic) => diagnostic.code === "runtime_contract_version_mismatch"),
    true
  );
  assert.equal(
    validator.validateEventEnvelope(registry, {
      ...eventEnvelope,
      source: {
        ...eventEnvelope.source,
        provider: "other-provider"
      }
    }).diagnostics.some((diagnostic) => diagnostic.code === "event_provider_mismatch"),
    true
  );
  assert.equal(
    validator.validateActionInput(registry, "mdbase.record.patch", {
      path: "tasks/card-001.md",
      patch: {
        status: "doing"
      }
    }).valid,
    true
  );
});

test("authorizes effectful actions only through the selected policy", async () => {
  const loaded = await loadRuntimeContracts(exampleRoot);
  const validator = await RuntimeContractValidator.create();
  const context = {
    actor: { id: "local-user", kind: "user" },
    origin: { workflow: "canvas.zone.set-status" },
    run_id: "run_01",
    invocation_id: "inv_01",
    attempt: 1,
    correlation_id: "corr_01",
    causation_id: "evt_01",
    executor: "obsidian"
  };

  assert.equal(validator.authorizeAction(loaded.registry, "mdbase.record.patch", context).valid, true);
  const unselected = validator.composeRegistry(loaded.contracts);
  assert.equal(
    validator.authorizeAction(unselected, "mdbase.record.patch", context).diagnostics[0]?.code,
    "policy_not_selected"
  );
});

test("coalesces identical contracts and rejects conflicting copies", async () => {
  const validator = await RuntimeContractValidator.create();
  const loaded = await validator.loadContracts(exampleRoot);
  const action = loaded.actions[0]?.frontmatter;
  assert.ok(action);

  const coalesced = validator.composeRegistry(loaded, [{ ...action }]);
  assert.equal(coalesced.diagnostics.some((diagnostic) => diagnostic.code === "runtime_contract_conflict"), false);

  const conflicted = validator.composeRegistry(loaded, [{ ...action, version: 2 }]);
  assert.equal(conflicted.diagnostics.some((diagnostic) => diagnostic.code === "runtime_contract_conflict"), true);
});

test("checks provider requirements against provider implementation versions", async () => {
  const validator = await RuntimeContractValidator.create();
  const loaded = await validator.loadContracts(exampleRoot);
  const workflow = loaded.workflows[0]?.frontmatter;
  assert.ok(workflow);
  const registry = validator.composeRegistry(loaded, [], "local.canvas-runtime.policy");

  assert.equal(
    validator.resolveWorkflowContracts(registry, {
      ...workflow,
      requires: { providers: [{ id: "canvas-bases", version: ">=1.0.0" }] }
    }).diagnostics.some((diagnostic) => diagnostic.code === "provider_version_mismatch"),
    true
  );
});

test("materializes a contract as markdown", async () => {
  const validator = await RuntimeContractValidator.create();
  const registry = validator.composeRegistry(await validator.loadContracts(exampleRoot));
  const action = registry.actions.get("mdbase.record.patch");
  assert.ok(action);

  const markdown = materializeContractRecord(action);
  assert.match(markdown, /^---\n/);
  assert.match(markdown, /id: mdbase\.record\.patch/);
  assert.match(markdown, /# Patch record frontmatter/);
});

test("rejects malformed type-file sections", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "mdbase-v1-invalid-"));
  try {
    await mkdir(resolve(root, "_types"), { recursive: true });
    await writeFile(
      resolve(root, "_types/bad-lifecycle.md"),
      `---
kind: mdbase.type
name: bad_lifecycle
schema:
  dialect: json-schema-2020-12
  value:
    type: object
lifecycle:
  on_create:
    set:
      id:
        now: true
        uuid: true
---
`,
      "utf8"
    );
    await writeFile(
      resolve(root, "_types/bad-link-selector.md"),
      `---
kind: mdbase.type
name: bad_link_selector
schema:
  dialect: json-schema-2020-12
  value:
    type: object
collection:
  links:
    "blockedBy[].[].uid":
      target_type: task
---
`,
      "utf8"
    );
    await writeFile(
      resolve(root, "_types/typo-section.md"),
      `---
kind: mdbase.type
name: typo_section
schema:
  dialect: json-schema-2020-12
  value:
    type: object
collecton:
  read_defaults:
    status: open
---
`,
      "utf8"
    );

    const validator = await RuntimeContractValidator.create();
    const runtimePackage = await validator.loadContracts(root);
    const diagnostics = runtimePackage.diagnostics;

    assert.equal(diagnostics.some((diagnostic) => diagnostic.path === "_types/bad-lifecycle.md"), true);
    assert.equal(diagnostics.some((diagnostic) => diagnostic.path === "_types/bad-link-selector.md"), true);
    assert.equal(diagnostics.some((diagnostic) => diagnostic.path === "_types/typo-section.md"), true);
    assert.equal(diagnostics.some((diagnostic) => diagnostic.code === "schema_unevaluated_properties"), true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("rejects malformed runtime contracts and embedded schemas", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "mdbase-v1-invalid-runtime-"));
  try {
    await mkdir(resolve(root, "actions"), { recursive: true });
    await writeFile(
      resolve(root, "actions/bad.md"),
      `---
type: action
id: bad.action
version: 1
provider: mdbase
name: Bad action
typoed: true
schemas:
  dialect: json-schema-2020-12
  input:
    type: strung
---
`,
      "utf8"
    );

    const validator = await RuntimeContractValidator.create();
    const runtimePackage = await validator.loadContracts(root);
    const diagnostics = runtimePackage.diagnostics;

    assert.equal(diagnostics.some((diagnostic) => diagnostic.code === "schema_additional_properties"), true);
    assert.equal(diagnostics.some((diagnostic) => diagnostic.code === "invalid_embedded_schema"), true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("loads materialized runtime state records outside the executable registry", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "mdbase-v1-runtime-state-"));
  try {
    await mkdir(resolve(root, "runs"), { recursive: true });
    await mkdir(resolve(root, "checkpoints"), { recursive: true });
    await mkdir(resolve(root, "timers"), { recursive: true });
    await mkdir(resolve(root, "diagnostics"), { recursive: true });
    await writeFile(
      resolve(root, "runs/run_01.md"),
      `---
type: runtime_run
id: run_01
workflow: canvas.zone.set-status
workflow_version: 1
workflow_revision: sha256:7e4b0b28
registry_revision: sha256:70e5581c
policy_revision: sha256:4d322612
trigger: drop-on-status-zone
event_id: evt_01
event_type: canvas.drop
executor: obsidian
idempotency_key: canvas.zone.set-status:evt_01:drop
status: succeeded
created_at: "2026-06-15T08:00:00Z"
started_at: "2026-06-15T08:00:00Z"
updated_at: "2026-06-15T08:00:01Z"
finished_at: "2026-06-15T08:00:01Z"
steps:
  - id: patch
    action: mdbase.record.patch
    action_version: 1
    invocation_id: inv_01
    attempt: 1
    status: succeeded
---
`,
      "utf8"
    );
    await writeFile(
      resolve(root, "checkpoints/checkpoint_01.md"),
      `---
type: runtime_checkpoint
id: checkpoint_01
workflow: canvas.zone.set-status
run: run_01
status: completed
updated_at: "2026-06-15T08:00:01Z"
state:
  current_step: patch
---
`,
      "utf8"
    );
    await writeFile(
      resolve(root, "diagnostics/diag_01.md"),
      `---
type: runtime_diagnostic
id: diag_01
severity: warning
code: runtime.warning
message: Example warning
created_at: "2026-06-15T08:00:01Z"
workflow: canvas.zone.set-status
---
`,
      "utf8"
    );
    await writeFile(
      resolve(root, "timers/timer_01.md"),
      `---
type: runtime_timer
id: timer_01
generation: 1
status: scheduled
fire_at: "2026-06-15T09:00:00Z"
event:
  type: timer.fired
  contract_version: 1
  payload:
    subject: task_01
missed_run_policy: fire_once
created_at: "2026-06-15T08:00:00Z"
updated_at: "2026-06-15T08:00:00Z"
---
`,
      "utf8"
    );

    const result = await loadRuntimeContracts(root);

    assert.equal(result.contracts.diagnostics.length, 0);
    assert.equal(result.contracts.runs.length, 1);
    assert.equal(result.contracts.checkpoints.length, 1);
    assert.equal(result.contracts.timers.length, 1);
    assert.equal(result.contracts.runtimeDiagnostics.length, 1);
    assert.equal(result.registry.workflows.size, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("preflights provider requirements and workflow-local step IDs", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "mdbase-v1-provider-preflight-"));
  try {
    await mkdir(resolve(root, "actions"), { recursive: true });
    await mkdir(resolve(root, "events"), { recursive: true });
    await mkdir(resolve(root, "workflows"), { recursive: true });
    await writeFile(
      resolve(root, "events/drop.md"),
      `---
type: event
id: canvas.drop
version: 1
provider: canvas-bases
name: Drop
schemas:
  dialect: json-schema-2020-12
  payload:
    type: object
---
`,
      "utf8"
    );
    await writeFile(
      resolve(root, "actions/patch.md"),
      `---
type: action
id: mdbase.record.patch
version: 1
provider: mdbase
name: Patch
schemas:
  dialect: json-schema-2020-12
  input:
    type: object
  output: null
---
`,
      "utf8"
    );
    await writeFile(
      resolve(root, "workflows/bad.md"),
      `---
type: workflow
id: bad.workflow
version: 1
name: Bad workflow
enabled: true
requires:
  providers:
    - missing.provider
triggers:
  - id: drop
    event: canvas.drop
steps:
  - id: patch
    action: mdbase.record.patch
  - id: patch
    action: mdbase.record.patch
---
`,
      "utf8"
    );

    const validator = await RuntimeContractValidator.create();
    const registry = validator.composeRegistry(await validator.loadContracts(root));
    const preflight = validator.preflightWorkflows(registry);

    assert.equal(preflight.valid, false);
    assert.equal(preflight.diagnostics.some((diagnostic) => diagnostic.code === "unresolved_provider"), true);
    assert.equal(preflight.diagnostics.some((diagnostic) => diagnostic.code === "duplicate_step"), true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("does not require materialized capability records", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "mdbase-v03-implicit-capability-"));
  try {
    await mkdir(resolve(root, "actions"), { recursive: true });
    await mkdir(resolve(root, "events"), { recursive: true });
    await mkdir(resolve(root, "policies"), { recursive: true });
    await mkdir(resolve(root, "workflows"), { recursive: true });
    await writeFile(
      resolve(root, "events/drop.md"),
      `---
type: event
id: canvas.drop
version: 1
provider: canvas-bases
name: Drop
schemas:
  dialect: json-schema-2020-12
  payload:
    type: object
---
`,
      "utf8"
    );
    await writeFile(
      resolve(root, "actions/patch.md"),
      `---
type: action
id: mdbase.record.patch
version: 1
provider: mdbase
name: Patch
requires:
  capabilities:
    - mdbase.record.write
schemas:
  dialect: json-schema-2020-12
  input:
    type: object
  output: null
effects:
  - mdbase.record.write
---
`,
      "utf8"
    );
    await writeFile(
      resolve(root, "workflows/good.md"),
      `---
type: workflow
id: good.workflow
version: 1
name: Good workflow
enabled: true
requires:
  capabilities:
    - mdbase.record.write
triggers:
  - id: drop
    event: canvas.drop
steps:
  - id: patch
    action: mdbase.record.patch
---
`,
      "utf8"
    );
    await writeFile(
      resolve(root, "policies/local.md"),
      `---
type: runtime_policy
id: local.policy
version: 1
name: Local policy
capabilities:
  mdbase.record.write:
    mode: allow
---
`,
      "utf8"
    );

    const result = await loadRuntimeContracts(root, { selectedPolicyPath: "policies/local.md" });
    const { registry, preflight } = result;

    assert.equal(registry.capabilities.size, 0);
    assert.equal(registry.capabilityIds.has("mdbase.record.write"), true);
    assert.equal(preflight.valid, true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("runtime policy can deny a required capability", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "mdbase-v03-denied-capability-"));
  try {
    await mkdir(resolve(root, "actions"), { recursive: true });
    await mkdir(resolve(root, "events"), { recursive: true });
    await mkdir(resolve(root, "policies"), { recursive: true });
    await mkdir(resolve(root, "workflows"), { recursive: true });
    await writeFile(
      resolve(root, "events/drop.md"),
      `---
type: event
id: canvas.drop
version: 1
provider: canvas-bases
name: Drop
schemas:
  dialect: json-schema-2020-12
  payload:
    type: object
---
`,
      "utf8"
    );
    await writeFile(
      resolve(root, "actions/patch.md"),
      `---
type: action
id: mdbase.record.patch
version: 1
provider: mdbase
name: Patch
schemas:
  dialect: json-schema-2020-12
  input:
    type: object
  output: null
effects:
  - mdbase.record.write
---
`,
      "utf8"
    );
    await writeFile(
      resolve(root, "workflows/denied.md"),
      `---
type: workflow
id: denied.workflow
version: 1
name: Denied workflow
enabled: true
requires:
  capabilities:
    - mdbase.record.write
triggers:
  - id: drop
    event: canvas.drop
steps:
  - id: patch
    action: mdbase.record.patch
---
`,
      "utf8"
    );
    await writeFile(
      resolve(root, "policies/local.md"),
      `---
type: runtime_policy
id: local.policy
version: 1
name: Local policy
capabilities:
  mdbase.record.write:
    mode: deny
---
`,
      "utf8"
    );

    const result = await loadRuntimeContracts(root, { selectedPolicyPath: "policies/local.md" });

    assert.equal(result.valid, false);
    assert.equal(result.diagnostics.some((diagnostic) => diagnostic.code === "capability_denied"), true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("single executor workflows require executor policy", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "mdbase-v03-missing-executor-"));
  try {
    await mkdir(resolve(root, "actions"), { recursive: true });
    await mkdir(resolve(root, "events"), { recursive: true });
    await mkdir(resolve(root, "workflows"), { recursive: true });
    await writeFile(
      resolve(root, "events/drop.md"),
      `---
type: event
id: canvas.drop
version: 1
provider: canvas-bases
name: Drop
schemas:
  dialect: json-schema-2020-12
  payload:
    type: object
---
`,
      "utf8"
    );
    await writeFile(
      resolve(root, "actions/patch.md"),
      `---
type: action
id: mdbase.record.patch
version: 1
provider: mdbase
name: Patch
schemas:
  dialect: json-schema-2020-12
  input:
    type: object
  output: null
---
`,
      "utf8"
    );
    await writeFile(
      resolve(root, "workflows/single.md"),
      `---
type: workflow
id: single.workflow
version: 1
name: Single executor workflow
enabled: true
triggers:
  - id: drop
    event: canvas.drop
steps:
  - id: patch
    action: mdbase.record.patch
run:
  execution:
    mode: single_executor
---
`,
      "utf8"
    );

    const result = await loadRuntimeContracts(root);

    assert.equal(result.valid, false);
    assert.equal(result.diagnostics.some((diagnostic) => diagnostic.code === "executor_not_selected"), true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
