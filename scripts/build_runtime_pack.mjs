import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packRoot = resolve(repoRoot, "standard-packs/mdbase-runtime/0.2.0");

const identifier = { type: "string", pattern: "^[A-Za-z][A-Za-z0-9._:-]*$" };
const semanticVersion = {
  type: "string",
  pattern:
    "^(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)\\.(?:0|[1-9][0-9]*)(?:-[0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*)?(?:\\+[0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*)?$",
};
const digest = { type: "string", pattern: "^sha256:[0-9a-f]{64}$" };
const dateTime = { type: "string", format: "date-time" };
const jsonValue = {};
const expression = {
  type: "object",
  required: ["$expr"],
  properties: { $expr: { type: "string", minLength: 1 } },
  additionalProperties: false,
};

function strictObject(required, properties, extras = {}) {
  return {
    type: "object",
    required,
    properties,
    patternProperties: { "^x-[A-Za-z0-9._:-]+$": true },
    additionalProperties: false,
    ...extras,
  };
}

function contractRequirement() {
  return strictObject(["id", "version"], {
    id: identifier,
    version: { type: "string", minLength: 1 },
    digest,
  });
}

function exactContractReference() {
  return strictObject(["id", "version", "digest"], {
    id: identifier,
    version: semanticVersion,
    digest,
  });
}

function identity() {
  return strictObject(["application", "implementation", "version"], {
    application: identifier,
    implementation: identifier,
    version: semanticVersion,
    instance_id: { type: "string", minLength: 1 },
  });
}

function providerSelector() {
  return strictObject([], {
    application: identifier,
    implementation: identifier,
    instance_id: { type: "string", minLength: 1 },
  }, { minProperties: 1 });
}

function recordSchema(title, required, properties, defs = {}) {
  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    title,
    ...strictObject(required, properties),
    $defs: {
      identifier,
      semanticVersion,
      digest,
      dateTime,
      contractRequirement: contractRequirement(),
      exactContractReference: exactContractReference(),
      identity: identity(),
      providerSelector: providerSelector(),
      expression,
      ...defs,
    },
  };
}

const runtimeRecords = [
  {
    slug: "workflow",
    id: "mdbase.runtime.workflow",
    type: "runtime_workflow",
    title: "Durable workflow",
    description: "A portable workflow whose event and action references are resolved and pinned at admission.",
    schema: recordSchema(
      "mdbase durable runtime workflow",
      ["type", "id", "version", "name", "enabled", "triggers", "steps"],
      {
        type: { const: "runtime_workflow" },
        id: identifier,
        version: semanticVersion,
        name: { type: "string", minLength: 1 },
        description: { type: "string" },
        enabled: { type: "boolean" },
        requires: { $ref: "#/$defs/requires" },
        vars: { type: "object", additionalProperties: jsonValue },
        triggers: {
          type: "array",
          minItems: 1,
          items: { $ref: "#/$defs/trigger" },
        },
        steps: {
          type: "array",
          minItems: 1,
          items: { $ref: "#/$defs/step" },
        },
        run: { $ref: "#/$defs/runPolicy" },
      },
      {
        requires: strictObject([], {
          capabilities: {
            type: "array",
            uniqueItems: true,
            items: identifier,
          },
        }),
        trigger: strictObject(["id", "event"], {
          id: identifier,
          event: { $ref: "#/$defs/contractRequirement" },
          if: expression,
          debounce: { $ref: "#/$defs/duration" },
          minimum_interval: { $ref: "#/$defs/duration" },
        }),
        step: strictObject(["id", "action"], {
          id: identifier,
          name: { type: "string" },
          action: { $ref: "#/$defs/contractRequirement" },
          provider: { $ref: "#/$defs/providerSelector" },
          requires: { $ref: "#/$defs/requires" },
          if: expression,
          input: { type: "object", additionalProperties: jsonValue },
          for_each: strictObject(["items"], {
            items: jsonValue,
            as: { type: "string", pattern: "^[A-Za-z_][A-Za-z0-9_]*$" },
          }),
        }),
        duration: {
          type: "string",
          pattern: "^(0|[1-9][0-9]*)(ms|s|m|h|d)$",
        },
        runPolicy: strictObject([], {
          idempotency: strictObject(["key"], { key: jsonValue }),
          concurrency: strictObject(["policy"], {
            group: jsonValue,
            policy: { enum: ["skip", "queue", "replace", "allow"] },
          }),
          limits: strictObject([], {
            timeout: { $ref: "#/$defs/duration" },
            max_items: { type: "integer", minimum: 1 },
          }),
          on_error: { enum: ["stop", "continue"] },
        }),
      },
    ),
  },
  {
    slug: "policy",
    id: "mdbase.runtime.policy",
    type: "runtime_policy",
    title: "Runtime policy",
    description: "Local authorization, executor, limit, and provider-selection policy.",
    schema: recordSchema(
      "mdbase durable runtime policy",
      ["type", "id", "version", "enabled", "grants"],
      {
        type: { const: "runtime_policy" },
        id: identifier,
        version: semanticVersion,
        name: { type: "string", minLength: 1 },
        enabled: { type: "boolean" },
        executors: strictObject([], {
          default: identifier,
          workflows: { type: "object", additionalProperties: identifier },
        }),
        provider_selections: {
          type: "array",
          items: strictObject(["contract", "selector"], {
            contract: { $ref: "#/$defs/contractRequirement" },
            selector: { $ref: "#/$defs/providerSelector" },
          }),
        },
        grants: {
          type: "array",
          items: strictObject(["capability", "mode"], {
            capability: identifier,
            mode: { enum: ["allow", "deny"] },
            actions: { type: "array", uniqueItems: true, items: { $ref: "#/$defs/contractRequirement" } },
            providers: { type: "array", uniqueItems: true, items: { $ref: "#/$defs/providerSelector" } },
            max_calls_per_run: { type: "integer", minimum: 1 },
            max_records_per_run: { type: "integer", minimum: 1 },
          }),
        },
      },
    ),
  },
  {
    slug: "provider-registration",
    id: "mdbase.runtime.provider-registration",
    type: "runtime_provider_registration",
    title: "Provider registration evidence",
    description: "An optional audit snapshot of a verified interoperability declaration; it never activates code.",
    schema: recordSchema(
      "mdbase runtime provider registration evidence",
      ["type", "id", "declaration_kind", "declaration", "verified_at", "active"],
      {
        type: { const: "runtime_provider_registration" },
        id: identifier,
        declaration_kind: { enum: ["event_source", "action_provider"] },
        declaration: { type: "object" },
        verified_at: dateTime,
        active: { type: "boolean" },
      },
    ),
  },
  {
    slug: "capability-grant",
    id: "mdbase.runtime.capability-grant",
    type: "runtime_capability_grant",
    title: "Capability grant evidence",
    description: "A materialized authorization grant scoped independently from contract conformance.",
    schema: recordSchema(
      "mdbase runtime capability grant",
      ["type", "id", "capability", "principal", "mode", "granted_at"],
      {
        type: { const: "runtime_capability_grant" },
        id: identifier,
        capability: identifier,
        principal: { $ref: "#/$defs/identity" },
        mode: { enum: ["allow", "deny"] },
        actions: { type: "array", uniqueItems: true, items: { $ref: "#/$defs/contractRequirement" } },
        providers: { type: "array", uniqueItems: true, items: { $ref: "#/$defs/providerSelector" } },
        granted_at: dateTime,
        expires_at: dateTime,
      },
    ),
  },
  {
    slug: "run",
    id: "mdbase.runtime.run",
    type: "runtime_run",
    title: "Durable run",
    description: "The durable state and immutable admitted plan for one workflow execution.",
    schema: recordSchema(
      "mdbase durable runtime run",
      [
        "type",
        "id",
        "workflow_id",
        "workflow_version",
        "workflow_revision",
        "event_id",
        "event_contract",
        "admitted_plan",
        "status",
        "created_at",
        "updated_at",
      ],
      {
        type: { const: "runtime_run" },
        id: identifier,
        workflow_id: identifier,
        workflow_version: semanticVersion,
        workflow_revision: digest,
        event_id: { type: "string", minLength: 1 },
        event_contract: { $ref: "#/$defs/exactContractReference" },
        event_source: { $ref: "#/$defs/identity" },
        admitted_plan: { $ref: "#/$defs/admittedPlan" },
        policy_id: identifier,
        policy_revision: digest,
        trigger_id: identifier,
        event_cursor: { type: "integer", minimum: 1 },
        executor: identifier,
        idempotency_key: { type: "string" },
        concurrency_group: { type: "string" },
        status: { enum: ["queued", "running", "waiting", "succeeded", "failed", "cancelled", "indeterminate"] },
        created_at: dateTime,
        updated_at: dateTime,
        started_at: dateTime,
        finished_at: dateTime,
        lease: { $ref: "#/$defs/lease" },
      },
      {
        admittedPlan: strictObject(["profile_version", "workflow_revision", "event", "steps"], {
          profile_version: { const: "0.2" },
          workflow_revision: digest,
          event: strictObject(["contract", "source"], {
            contract: { $ref: "#/$defs/exactContractReference" },
            source: { $ref: "#/$defs/identity" },
            source_declaration_digest: digest,
          }),
          steps: {
            type: "array",
            items: strictObject(["id", "contract", "provider", "provider_declaration_digest", "handler_id"], {
              id: identifier,
              contract: { $ref: "#/$defs/exactContractReference" },
              provider: { $ref: "#/$defs/identity" },
              provider_declaration_digest: digest,
              handler_id: identifier,
            }),
          },
        }),
        lease: strictObject(["owner", "token", "expires_at"], {
          owner: identifier,
          token: { type: "string", minLength: 1 },
          expires_at: dateTime,
        }),
      },
    ),
  },
  {
    slug: "action-attempt",
    id: "mdbase.runtime.action-attempt",
    type: "runtime_action_attempt",
    title: "Durable action attempt",
    description: "Durable invocation intent and outcome evidence using the shared interoperability envelope.",
    schema: recordSchema(
      "mdbase durable runtime action attempt",
      [
        "type",
        "id",
        "run_id",
        "step_id",
        "request_id",
        "invocation_id",
        "attempt_id",
        "contract",
        "provider",
        "provider_declaration_digest",
        "status",
        "created_at",
        "updated_at",
      ],
      {
        type: { const: "runtime_action_attempt" },
        id: identifier,
        run_id: identifier,
        step_id: identifier,
        request_id: { type: "string", minLength: 1 },
        invocation_id: { type: "string", minLength: 1 },
        attempt_id: { type: "string", minLength: 1 },
        contract: { $ref: "#/$defs/exactContractReference" },
        provider: { $ref: "#/$defs/identity" },
        provider_declaration_digest: digest,
        handler_id: identifier,
        idempotency_key: { type: "string" },
        status: { enum: ["admitted", "dispatching", "succeeded", "rejected", "failed", "cancelled", "indeterminate"] },
        request: { type: "object" },
        invocation: { type: "object" },
        outcome: { type: "object" },
        created_at: dateTime,
        updated_at: dateTime,
        completed_at: dateTime,
      },
    ),
  },
  {
    slug: "checkpoint",
    id: "mdbase.runtime.checkpoint",
    type: "runtime_checkpoint",
    title: "Runtime checkpoint",
    description: "A durable, lease-safe workflow continuation.",
    schema: recordSchema(
      "mdbase durable runtime checkpoint",
      ["type", "id", "run_id", "generation", "status", "state", "updated_at"],
      {
        type: { const: "runtime_checkpoint" },
        id: identifier,
        run_id: identifier,
        generation: { type: "integer", minimum: 1 },
        status: { enum: ["open", "waiting", "ready", "completed", "failed", "cancelled"] },
        state: { type: "object" },
        updated_at: dateTime,
      },
    ),
  },
  {
    slug: "timer",
    id: "mdbase.runtime.timer",
    type: "runtime_timer",
    title: "Runtime timer",
    description: "A generation-safe one-shot timer that publishes through the interoperability profile.",
    schema: recordSchema(
      "mdbase durable runtime timer",
      ["type", "id", "generation", "status", "fire_at", "event", "created_at", "updated_at"],
      {
        type: { const: "runtime_timer" },
        id: identifier,
        generation: { type: "integer", minimum: 1 },
        status: { enum: ["scheduled", "firing", "fired", "cancelled"] },
        fire_at: dateTime,
        event: strictObject(["contract", "data"], {
          contract: { $ref: "#/$defs/contractRequirement" },
          subject: { type: "string" },
          correlation_id: { type: "string" },
          causation_id: { type: "string" },
          data: jsonValue,
        }),
        missed_run_policy: { const: "fire_once" },
        created_at: dateTime,
        updated_at: dateTime,
        fired_at: dateTime,
      },
    ),
  },
  {
    slug: "diagnostic",
    id: "mdbase.runtime.diagnostic",
    type: "runtime_diagnostic",
    title: "Runtime diagnostic",
    description: "A machine-readable durable runtime diagnostic.",
    schema: recordSchema(
      "mdbase durable runtime diagnostic",
      ["type", "id", "severity", "code", "message", "created_at"],
      {
        type: { const: "runtime_diagnostic" },
        id: identifier,
        severity: { enum: ["info", "warning", "error"] },
        code: identifier,
        message: { type: "string", minLength: 1 },
        run_id: identifier,
        attempt_id: identifier,
        path: { type: "string" },
        details: jsonValue,
        created_at: dateTime,
      },
    ),
  },
  {
    slug: "dead-letter",
    id: "mdbase.runtime.dead-letter",
    type: "runtime_dead_letter",
    title: "Runtime dead letter",
    description: "Retained event or action evidence that cannot be processed safely.",
    schema: recordSchema(
      "mdbase durable runtime dead letter",
      ["type", "id", "reason", "status", "evidence", "created_at"],
      {
        type: { const: "runtime_dead_letter" },
        id: identifier,
        reason: identifier,
        status: { enum: ["unresolved", "acknowledged", "requeued"] },
        evidence_kind: { enum: ["event", "action_request", "action_outcome"] },
        evidence: { type: "object" },
        created_at: dateTime,
        acknowledged_at: dateTime,
      },
    ),
  },
];

const portableContracts = [
  {
    slug: "record-created",
    id: "mdbase.record.created",
    contractType: "event",
    name: "Record created",
    description: "Published after a record is created and derived collection state is consistent.",
    schemaField: "data_schema",
    schema: recordSchema(
      "mdbase record-created event data",
      ["path", "after", "changed_fields", "revision", "types"],
      {
        path: { type: "string", minLength: 1 },
        after: { type: "object" },
        changed_fields: {
          type: "array",
          uniqueItems: true,
          items: { type: "string" },
        },
        revision: { type: "string", minLength: 1 },
        types: { type: "array", uniqueItems: true, items: identifier },
      },
    ),
  },
  {
    slug: "record-modified",
    id: "mdbase.record.modified",
    contractType: "event",
    name: "Record modified",
    description: "Published after a record is modified and derived collection state is consistent.",
    schemaField: "data_schema",
    schema: recordSchema(
      "mdbase record-modified event data",
      [
        "path",
        "before",
        "after",
        "changed_fields",
        "previous_revision",
        "revision",
        "previous_types",
        "types",
      ],
      {
        path: { type: "string", minLength: 1 },
        before: { type: "object" },
        after: { type: "object" },
        changed_fields: {
          type: "array",
          uniqueItems: true,
          items: { type: "string" },
        },
        previous_revision: { type: "string", minLength: 1 },
        revision: { type: "string", minLength: 1 },
        previous_types: { type: "array", uniqueItems: true, items: identifier },
        types: { type: "array", uniqueItems: true, items: identifier },
      },
    ),
  },
  {
    slug: "record-deleted",
    id: "mdbase.record.deleted",
    contractType: "event",
    name: "Record deleted",
    description: "Published after a record is deleted and derived collection state is consistent.",
    schemaField: "data_schema",
    schema: recordSchema(
      "mdbase record-deleted event data",
      ["path", "before", "previous_revision", "types"],
      {
        path: { type: "string", minLength: 1 },
        before: { type: "object" },
        previous_revision: { type: "string", minLength: 1 },
        types: { type: "array", uniqueItems: true, items: identifier },
      },
    ),
  },
  {
    slug: "record-renamed",
    id: "mdbase.record.renamed",
    contractType: "event",
    name: "Record renamed",
    description: "Published after a record is renamed and derived collection state is consistent.",
    schemaField: "data_schema",
    schema: recordSchema(
      "mdbase record-renamed event data",
      [
        "from",
        "to",
        "before",
        "after",
        "previous_revision",
        "revision",
        "previous_types",
        "types",
      ],
      {
        from: { type: "string", minLength: 1 },
        to: { type: "string", minLength: 1 },
        before: { type: "object" },
        after: { type: "object" },
        previous_revision: { type: "string", minLength: 1 },
        revision: { type: "string", minLength: 1 },
        previous_types: { type: "array", uniqueItems: true, items: identifier },
        types: { type: "array", uniqueItems: true, items: identifier },
      },
    ),
  },
  {
    slug: "timer-fired",
    id: "mdbase.runtime.timer.fired",
    contractType: "event",
    name: "Runtime timer fired",
    description:
      "Published with scheduling evidence and opaque application data when the current generation of a durable timer fires.",
    schemaField: "data_schema",
    schema: recordSchema(
      "mdbase runtime timer-fired event data",
      ["timer_id", "generation", "scheduled_for", "fired_at", "late_by_ms", "data"],
      {
        timer_id: identifier,
        generation: { type: "integer", minimum: 1 },
        scheduled_for: dateTime,
        fired_at: dateTime,
        late_by_ms: { type: "integer", minimum: 0 },
        data: {
          description: "Opaque application data supplied when the timer was scheduled.",
        },
      },
    ),
  },
  {
    slug: "run-cancel",
    id: "mdbase.runtime.run.cancel",
    contractType: "action",
    name: "Cancel durable runtime run",
    description: "Request cooperative cancellation of one durable runtime run.",
    schemaField: "input_schema",
    schema: recordSchema(
      "mdbase runtime run-cancel action input",
      ["run_id"],
      {
        run_id: identifier,
        reason: { type: "string" },
      },
    ),
    outputSchema: recordSchema(
      "mdbase runtime run-cancel action output",
      ["run_id", "status"],
      {
        run_id: identifier,
        status: { enum: ["cancellation_requested", "already_terminal"] },
      },
    ),
    behavior: {
      idempotency: "required",
      cancellation: "none",
    },
  },
];

await rm(packRoot, { recursive: true, force: true });

const resources = [];
for (const definition of runtimeRecords) {
  const schemaRelative = `schemas/${definition.id}/1.0.0.schema.json`;
  const contractRelative = `_contracts/${definition.id}/1.0.0.md`;
  const typeRelative = `_types/${definition.slug}.md`;
  definition.schema.$id = `https://mdbase.dev/schemas/runtime/v0.2/${definition.id}/1.0.0.schema.json`;
  await output(schemaRelative, `${JSON.stringify(definition.schema, null, 2)}\n`);
  await output(contractRelative, recordContractMarkdown(definition, schemaRelative));
  await output(typeRelative, typeMarkdown(definition, schemaRelative));
  resources.push(
    resource("schema", schemaRelative, schemaRelative),
    resource("contract", contractRelative, contractRelative),
    resource("type", typeRelative, typeRelative),
  );
}

for (const definition of portableContracts) {
  const schemaRelative = `schemas/${definition.id}/1.0.0.schema.json`;
  const contractRelative = `_contracts/${definition.id}/1.0.0.md`;
  definition.schema.$id = `https://mdbase.dev/schemas/runtime/v0.2/${definition.id}/1.0.0.schema.json`;
  await output(schemaRelative, `${JSON.stringify(definition.schema, null, 2)}\n`);
  if (definition.outputSchema) {
    definition.outputSchema.$id =
      `https://mdbase.dev/schemas/runtime/v0.2/${definition.id}/1.0.0.output.schema.json`;
    const outputRelative = `schemas/${definition.id}/1.0.0.output.schema.json`;
    await output(outputRelative, `${JSON.stringify(definition.outputSchema, null, 2)}\n`);
    resources.push(resource("schema", outputRelative, outputRelative));
  }
  await output(contractRelative, portableContractMarkdown(definition, schemaRelative));
  resources.push(
    resource("schema", schemaRelative, schemaRelative),
    resource("contract", contractRelative, contractRelative),
  );
}

for (const item of resources) {
  item.digest = `sha256:${createHash("sha256")
    .update(await readFile(resolve(packRoot, item.source)))
    .digest("hex")}`;
}
await output("mdbase-pack.yaml", packManifest(resources));

function resource(kind, source, target) {
  return { kind, source, target };
}

async function output(relativePath, contents) {
  const target = resolve(packRoot, relativePath);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, contents, "utf8");
}

function recordContractMarkdown(definition, schemaRelative) {
  return `---
kind: mdbase.contract
contract_type: record
id: ${definition.id}
version: 1.0.0
name: ${definition.title}
description: ${definition.description}
record_schema:
  dialect: json-schema-2020-12
  ref: ../../${schemaRelative}
---

# ${definition.title}

${definition.description}

This artifact is passive. Installing it or a type that implements it grants no
authority to execute workflows or invoke providers.
`;
}

function typeMarkdown(definition, schemaRelative) {
  const fields = Object.keys(definition.schema.properties)
    .map((field) => `      ${field}: ${field}`)
    .join("\n");
  return `---
kind: mdbase.type
name: ${definition.type}
version: 1
description: Canonical Markdown implementation of ${definition.id}.
match:
  where:
    type: ${definition.type}
schema:
  dialect: json-schema-2020-12
  ref: ../${schemaRelative}
implements:
  - contract: ${definition.id}
    version: 1.0.0
    fields:
${fields}
---

# ${definition.title}

This canonical type makes \`${definition.type}\` records discoverable through
the ordinary mdbase record-contract registry.
`;
}

function portableContractMarkdown(definition, schemaRelative) {
  const output = definition.outputSchema
    ? `output_schema:
  dialect: json-schema-2020-12
  ref: ../../schemas/${definition.id}/1.0.0.output.schema.json
`
    : "";
  const behavior = definition.behavior
    ? `behavior:
  idempotency: ${definition.behavior.idempotency}
  cancellation: ${definition.behavior.cancellation}
`
    : "";
  return `---
kind: mdbase.contract
contract_type: ${definition.contractType}
id: ${definition.id}
version: 1.0.0
name: ${definition.name}
description: ${definition.description}
${definition.schemaField}:
  dialect: json-schema-2020-12
  ref: ../../${schemaRelative}
${output}${behavior}---

# ${definition.name}

This built-in is an ordinary, inspectable contract artifact. Runtime exchange
uses the mdbase interoperability profile unchanged.
`;
}

function packManifest(items) {
  const lines = [
    "kind: mdbase.type-pack",
    "id: mdbase.runtime.standard",
    "version: 0.2.0",
    "name: mdbase durable runtime standard library",
    "description: Runtime record implementations and inspectable built-in event/action contracts.",
    "resources:",
  ];
  for (const item of items) {
    lines.push(
      `  - kind: ${item.kind}`,
      "    mode: managed",
      `    source: ${item.source}`,
      `    target: ${item.target}`,
      `    digest: ${item.digest}`,
    );
  }
  return `${lines.join("\n")}\n`;
}
