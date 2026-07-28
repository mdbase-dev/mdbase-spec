import assert from "node:assert/strict";
import test from "node:test";
import {
  InMemoryInteropBridge,
  inlineSchema
} from "@callumalpass/mdbase-interop";
import { executeRuntimeEvent } from "../dist/index.js";

test("executes an admitted workflow through shared interoperability envelopes", async () => {
  const bridge = new InMemoryInteropBridge({ authorize: () => true });
  const source = bridge.connect(identity("source"));
  const provider = bridge.connect(identity("provider"));
  const executor = bridge.connect(identity("executor"));
  const eventContract = eventArtifact();
  const actionContract = actionArtifact();
  await source.registerEventSource({
    declaration_id: "events",
    contracts: [{ contract: eventContract }]
  });
  await provider.registerActionProvider({
    declaration_id: "actions",
    handlers: [{
      handler_id: "complete",
      contract: actionContract,
      idempotency: { mode: "request" },
      handler: async ({ id }) => ({ id, completed: true })
    }]
  });
  const { event } = await source.publishEvent({
    contract: { id: eventContract.id, version: eventContract.version },
    data: { id: "task-1" }
  });
  const execution = await executeRuntimeEvent({
    workflow: workflow(eventContract.id, actionContract.id),
    trigger_id: "changed",
    event,
    bridge: bridge.describe(),
    client: executor,
    policy: policy()
  });
  assert.equal(execution.valid, true);
  assert.equal(execution.status, "succeeded");
  assert.deepEqual(execution.steps[0].input, { id: "task-1" });
  assert.deepEqual(execution.steps[0].output, { id: "task-1", completed: true });
  assert.equal(execution.steps[0].outcome.kind, "mdbase.action.outcome");
  await bridge.dispose();
});

function workflow(event, action) {
  return {
    type: "runtime_workflow",
    id: "example.workflow",
    version: "1.0.0",
    name: "Example",
    enabled: true,
    requires: { capabilities: ["task.write"] },
    triggers: [{ id: "changed", event: { id: event, version: "^1.0.0" } }],
    steps: [{
      id: "complete",
      action: { id: action, version: "^1.0.0" },
      requires: { capabilities: ["task.write"] },
      input: { id: { $expr: "event.data.id" } }
    }]
  };
}

function policy() {
  return {
    type: "runtime_policy",
    id: "local",
    version: "1.0.0",
    enabled: true,
    grants: [{ capability: "task.write", mode: "allow" }]
  };
}

function eventArtifact() {
  return {
    kind: "mdbase.contract",
    contract_type: "event",
    id: "example.task.changed",
    version: "1.0.0",
    data_schema: inlineSchema({
      type: "object",
      required: ["id"],
      properties: { id: { type: "string" } },
      additionalProperties: false
    })
  };
}

function actionArtifact() {
  return {
    kind: "mdbase.contract",
    contract_type: "action",
    id: "example.task.complete",
    version: "1.0.0",
    input_schema: inlineSchema({
      type: "object",
      required: ["id"],
      properties: { id: { type: "string" } },
      additionalProperties: false
    }),
    output_schema: inlineSchema({
      type: "object",
      required: ["id", "completed"],
      properties: {
        id: { type: "string" },
        completed: { type: "boolean" }
      },
      additionalProperties: false
    }),
    behavior: { idempotency: "required", cancellation: "cooperative" }
  };
}

function identity(implementation) {
  return {
    application: "test",
    implementation,
    version: "1.0.0",
    instance_id: implementation
  };
}
