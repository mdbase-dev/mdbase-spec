import assert from "node:assert/strict";
import { test } from "node:test";
import {
  InMemoryInteropBridge,
  inlineSchema
} from "@callumalpass/mdbase-interop";
import {
  admitWorkflow,
  preflightWorkflow,
  validateRuntimeRecord
} from "../dist/index.js";

const EVENT_CONTRACT = {
  kind: "mdbase.contract",
  contract_type: "event",
  id: "example.task.changed",
  version: "1.2.0",
  data_schema: inlineSchema({
    type: "object",
    required: ["id"],
    properties: { id: { type: "string" } },
    additionalProperties: false
  })
};
const ACTION_CONTRACT = {
  kind: "mdbase.contract",
  contract_type: "action",
  id: "example.task.complete",
  version: "2.1.0",
  input_schema: inlineSchema({
    type: "object",
    required: ["id"],
    properties: { id: { type: "string" } },
    additionalProperties: false
  }),
  output_schema: inlineSchema({
    type: "object",
    required: ["completed"],
    properties: { completed: { type: "boolean" } },
    additionalProperties: false
  }),
  behavior: { idempotency: "required", cancellation: "cooperative" }
};

const workflow = {
  type: "runtime_workflow",
  id: "example.complete-on-change",
  version: "1.0.0",
  name: "Complete changed tasks",
  enabled: true,
  requires: { capabilities: ["task.write"] },
  triggers: [{
    id: "changed",
    event: { id: EVENT_CONTRACT.id, version: "^1.0.0" }
  }],
  steps: [{
    id: "complete",
    action: { id: ACTION_CONTRACT.id, version: "^2.0.0" },
    requires: { capabilities: ["task.write"] },
    input: { id: { $expr: "event.data.id" } }
  }]
};

const policy = {
  type: "runtime_policy",
  id: "local",
  version: "1.0.0",
  enabled: true,
  grants: [{ capability: "task.write", mode: "allow" }]
};

test("standard workflow records validate as ordinary records", () => {
  const result = validateRuntimeRecord(workflow);
  assert.equal(result.valid, true);
  assert.equal(result.schema, "mdbase.runtime.workflow");
  assert.deepEqual(result.diagnostics, []);
});

test("old parallel runtime contracts are rejected clearly", () => {
  const result = validateRuntimeRecord({
    type: "action",
    id: "legacy.action",
    version: 1,
    schemas: { dialect: "json-schema-2020-12", input: {} }
  });
  assert.equal(result.valid, false);
  assert.equal(result.diagnostics[0].code, "runtime_record_type_unknown");
});

test("preflight resolves ranges and requires explicit provider selection", async () => {
  const bridge = new InMemoryInteropBridge({ authorize: () => true });
  const source = bridge.connect(identity("source"));
  const firstProvider = bridge.connect(identity("first"));
  const secondProvider = bridge.connect(identity("second"));
  await source.registerEventSource({
    declaration_id: "events",
    contracts: [{ contract: EVENT_CONTRACT }]
  });
  await firstProvider.registerActionProvider({
    declaration_id: "actions",
    handlers: [handler("first")]
  });
  await secondProvider.registerActionProvider({
    declaration_id: "actions",
    handlers: [handler("second")]
  });

  const ambiguous = await preflightWorkflow(workflow, bridge.describe(), policy);
  assert.equal(ambiguous.valid, false);
  assert.equal(ambiguous.diagnostics.some(({ code }) => code === "ambiguous_provider"), true);

  const selected = await preflightWorkflow(workflow, bridge.describe(), {
    ...policy,
    provider_selections: [{
      contract: { id: ACTION_CONTRACT.id, version: "^2.0.0" },
      selector: { implementation: "first" }
    }]
  });
  assert.equal(selected.valid, true);
  assert.equal(selected.plan.steps[0].contract.version, "2.1.0");
  assert.equal(selected.plan.steps[0].provider.implementation, "first");
  assert.match(selected.plan.workflow_revision, /^sha256:[0-9a-f]{64}$/u);
  await bridge.dispose();
});

test("admission pins the exact event source, contracts, and action provider", async () => {
  const bridge = new InMemoryInteropBridge({ authorize: () => true });
  const source = bridge.connect(identity("source"));
  const provider = bridge.connect(identity("provider"));
  await source.registerEventSource({
    declaration_id: "events",
    contracts: [{ contract: EVENT_CONTRACT }]
  });
  await provider.registerActionProvider({
    declaration_id: "actions",
    handlers: [handler("complete")]
  });
  const published = await source.publishEvent({
    contract: { id: EVENT_CONTRACT.id, version: EVENT_CONTRACT.version },
    data: { id: "task-1" }
  });
  const result = await admitWorkflow({
    workflow,
    trigger_id: "changed",
    event: published.event,
    bridge: bridge.describe(),
    policy
  });
  assert.equal(result.valid, true);
  assert.equal(result.plan.profile_version, "0.2");
  assert.equal(result.plan.event.contract.digest, published.event.mdbasecontractdigest);
  assert.equal(result.plan.event.source.implementation, "source");
  assert.equal(result.plan.steps[0].provider.implementation, "provider");
  assert.match(result.plan.steps[0].provider_declaration_digest, /^sha256:[0-9a-f]{64}$/u);
  await bridge.dispose();
});

test("contract conformance never grants capability authority", async () => {
  const bridge = new InMemoryInteropBridge({ authorize: () => true });
  const source = bridge.connect(identity("source"));
  const provider = bridge.connect(identity("provider"));
  await source.registerEventSource({
    declaration_id: "events",
    contracts: [{ contract: EVENT_CONTRACT }]
  });
  await provider.registerActionProvider({
    declaration_id: "actions",
    handlers: [handler("complete")]
  });
  const denied = await preflightWorkflow(workflow, bridge.describe(), {
    ...policy,
    grants: []
  });
  assert.equal(denied.valid, false);
  assert.equal(denied.diagnostics.some(({ code }) => code === "capability_denied"), true);
  await bridge.dispose();
});

function identity(implementation) {
  return {
    application: "test",
    implementation,
    version: "1.0.0",
    instance_id: implementation
  };
}

function handler(handler_id) {
  return {
    handler_id,
    contract: ACTION_CONTRACT,
    idempotency: { mode: "request" },
    cancellation: "cooperative",
    handler: async ({ id }) => ({ completed: id.length > 0 })
  };
}
