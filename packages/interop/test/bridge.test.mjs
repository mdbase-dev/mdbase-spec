import assert from "node:assert/strict";
import test from "node:test";
import {
  ActionHandlerError,
  InMemoryInteropBridge,
  InteropError,
  contractDigest
} from "../dist/index.js";

const completedEvent = {
  kind: "mdbase.contract",
  contract_type: "event",
  id: "tasknotes.task.completed",
  version: "1.0.0",
  data_schema: schema({
    type: "object",
    required: ["task_id", "completed_at"],
    additionalProperties: false,
    properties: {
      task_id: { type: "string", minLength: 1 },
      completed_at: { type: "string", format: "date-time" }
    }
  })
};

const createCardAction = {
  kind: "mdbase.contract",
  contract_type: "action",
  id: "canvas.card.create",
  version: "1.0.0",
  input_schema: schema({
    type: "object",
    required: ["canvas", "title"],
    additionalProperties: false,
    properties: {
      canvas: { type: "string", minLength: 1 },
      title: { type: "string", minLength: 1 }
    }
  }),
  output_schema: schema({
    type: "object",
    required: ["card_id"],
    additionalProperties: false,
    properties: { card_id: { type: "string", minLength: 1 } }
  }),
  behavior: {
    idempotency: "optional",
    cancellation: "cooperative"
  }
};

test("CloudEvents multicast to every compatible consumer and suppress redelivery", async () => {
  const bridge = testBridge();
  const source = bridge.connect(identity("tasknotes"));
  const first = bridge.connect(identity("consumer-one"));
  const second = bridge.connect(identity("consumer-two"));
  await source.registerEventSource({
    declaration_id: "tasknotes.events",
    contracts: [{ contract: completedEvent, requirement: { id: completedEvent.id, version: "^1.0.0" } }]
  });
  const deliveries = [];
  await first.subscribeEvents(
    { contract: { id: completedEvent.id, version: ">=1.0.0 <2.0.0" } },
    (event) => deliveries.push(["first", event])
  );
  await second.subscribeEvents(
    { contract: { id: completedEvent.id, version: "^1.0.0" } },
    (event) => deliveries.push(["second", event])
  );

  const input = {
    id: "evt_01",
    contract: { id: completedEvent.id, version: "1.0.0" },
    time: "2026-07-28T01:30:00.000Z",
    subject: "urn:mdbase:record:vault:task-123",
    correlation_id: "flow_01",
    causation_id: "req_01",
    data: {
      task_id: "task-123",
      completed_at: "2026-07-28T01:30:00.000Z"
    }
  };
  const published = await source.publishEvent(input);

  assert.equal(published.deliveries, 2);
  assert.equal(published.duplicate, false);
  assert.deepEqual(deliveries.map(([name]) => name), ["first", "second"]);
  assert.equal(published.event.specversion, "1.0");
  assert.equal(published.event.type, completedEvent.id);
  assert.equal(published.event.correlationid, "flow_01");
  assert.equal(published.event.causationid, "req_01");
  assert.match(published.event.dataschema, /^urn:mdbase:contract:/);
  assert.equal(published.event.mdbasecontractdigest, await contractDigest(completedEvent));

  const duplicate = await source.publishEvent(input);
  assert.equal(duplicate.duplicate, true);
  assert.equal(duplicate.deliveries, 0);
  assert.equal(deliveries.length, 2);
  await bridge.dispose();
});

test("event data and contract conflicts fail closed", async () => {
  const bridge = testBridge();
  const source = bridge.connect(identity("tasknotes"));
  await source.registerEventSource({
    declaration_id: "tasknotes.events",
    contracts: [{ contract: completedEvent }]
  });
  await assert.rejects(
    source.publishEvent({
      contract: { id: completedEvent.id, version: completedEvent.version },
      data: { task_id: "missing-completed-at" }
    }),
    errorWithCode("invalid_event_data")
  );

  const conflicting = structuredClone(completedEvent);
  conflicting.data_schema.value.properties.task_id.minLength = 10;
  const other = bridge.connect(identity("other-source"));
  await assert.rejects(
    other.registerEventSource({
      declaration_id: "other.events",
      contracts: [{ contract: conflicting }]
    }),
    errorWithCode("contract_digest_conflict")
  );
  await bridge.dispose();
});

test("action admission pins exact contract and one explicitly selected provider", async () => {
  const invocations = [];
  const bridge = testBridge({ onInvocation: (invocation) => invocations.push(invocation) });
  const caller = bridge.connect(identity("tasknotes-workflows"));
  const first = bridge.connect(identity("canvas-bases-one"));
  const second = bridge.connect(identity("canvas-bases-two"));
  await registerCardProvider(first, "provider-one", "one");
  await registerCardProvider(second, "provider-two", "two");

  await assert.rejects(
    caller.invokeAction({
      contract: { id: createCardAction.id, version: "^1.0.0" },
      input: { canvas: "Projects/Report.canvas", title: "Prepare report" }
    }),
    errorWithCode("ambiguous_provider")
  );

  const outcome = await caller.invokeAction({
    request_id: "req_card_01",
    contract: { id: createCardAction.id, version: "^1.0.0" },
    requested_provider: { application: "canvas-bases-one" },
    correlation_id: "flow_01",
    causation_id: "evt_01",
    input: { canvas: "Projects/Report.canvas", title: "Prepare report" }
  });

  assert.equal(outcome.status, "succeeded");
  assert.deepEqual(outcome.output, { card_id: "one" });
  assert.equal(invocations.length, 1);
  assert.equal(invocations[0].request_id, "req_card_01");
  assert.equal(invocations[0].provider.application, "canvas-bases-one");
  assert.equal(invocations[0].contract.digest, await contractDigest(createCardAction));
  assert.notEqual(invocations[0].invocation_id, invocations[0].attempt_id);

  await registerCardProvider(
    bridge.connect(identity("canvas-bases-three")),
    "provider-three",
    "three"
  );
  assert.equal(outcome.provider.application, "canvas-bases-one");
  assert.equal(invocations[0].provider.application, "canvas-bases-one");
  await bridge.dispose();
});

test("providers return validated success, rejection, failure, and indeterminate outcomes", async () => {
  for (const scenario of [
    {
      name: "invalid output",
      handler: async () => ({ wrong: true }),
      status: "failed",
      code: "invalid_action_output"
    },
    {
      name: "rejected",
      handler: async () => {
        throw new ActionHandlerError("rejected", {
          code: "request_rejected",
          message: "The board is read-only."
        });
      },
      status: "rejected",
      code: "request_rejected"
    },
    {
      name: "handler failure",
      handler: async () => {
        throw new Error("private stack detail");
      },
      status: "failed",
      code: "handler_failure"
    },
    {
      name: "indeterminate",
      handler: async () => {
        throw new ActionHandlerError("outcome_indeterminate", {
          code: "outcome_indeterminate",
          message: "The external system did not confirm the effect."
        });
      },
      status: "outcome_indeterminate",
      code: "outcome_indeterminate"
    }
  ]) {
    const bridge = testBridge();
    const provider = bridge.connect(identity("canvas-bases"));
    const actionCaller = bridge.connect(identity("workflows"));
    await provider.registerActionProvider({
      declaration_id: "canvas.actions",
      handlers: [{
        handler_id: "canvas.card.create",
        contract: createCardAction,
        handler: scenario.handler
      }]
    });
    const outcome = await actionCaller.invokeAction({
      contract: { id: createCardAction.id, version: "1.0.0" },
      input: { canvas: "Board.canvas", title: "Card" }
    });
    assert.equal(outcome.status, scenario.status, scenario.name);
    assert.equal(outcome.error.code, scenario.code, scenario.name);
    assert.doesNotMatch(outcome.error.message, /private stack detail/, scenario.name);
    await bridge.dispose();
  }
});

test("request deduplication returns the recorded outcome only when declared", async () => {
  const bridge = testBridge();
  const provider = bridge.connect(identity("canvas-bases"));
  const caller = bridge.connect(identity("workflows"));
  let calls = 0;
  await provider.registerActionProvider({
    declaration_id: "canvas.actions",
    handlers: [{
      handler_id: "canvas.card.create",
      contract: createCardAction,
      idempotency: { mode: "request", retention_seconds: 60 },
      handler: async () => ({ card_id: `card-${++calls}` })
    }]
  });
  const request = {
    request_id: "req_deduplicated",
    contract: { id: createCardAction.id, version: "1.0.0" },
    idempotency_key: "flow:card",
    input: { canvas: "Board.canvas", title: "Card" }
  };
  const first = await caller.invokeAction(request);
  const second = await caller.invokeAction(request);

  assert.deepEqual(second, first);
  assert.equal(calls, 1);
  await bridge.dispose();
});

test("concurrent duplicate requests share one outcome and reject changed intent", async () => {
  const bridge = testBridge();
  const provider = bridge.connect(identity("canvas-bases"));
  const caller = bridge.connect(identity("workflows"));
  let calls = 0;
  let finish;
  let markStarted;
  const started = new Promise((resolve) => {
    markStarted = resolve;
  });
  await provider.registerActionProvider({
    declaration_id: "canvas.actions",
    handlers: [{
      handler_id: "canvas.card.create",
      contract: createCardAction,
      idempotency: { mode: "request", retention_seconds: 60 },
      handler: async () => {
        calls += 1;
        markStarted();
        await new Promise((resolve) => {
          finish = resolve;
        });
        return { card_id: "card-one" };
      }
    }]
  });
  const request = {
    request_id: "req_concurrent",
    contract: { id: createCardAction.id, version: "1.0.0" },
    idempotency_key: "flow:card",
    input: { canvas: "Board.canvas", title: "Card" }
  };
  const first = caller.invokeAction(request);
  const second = caller.invokeAction(request);
  await started;
  finish();

  assert.deepEqual(await second, await first);
  assert.equal(calls, 1);
  await assert.rejects(
    caller.invokeAction({
      ...request,
      input: { ...request.input, title: "Different card" }
    }),
    errorWithCode("request_rejected")
  );
  await bridge.dispose();
});

test("portable payloads must be JSON and fit the advertised transport limit", async () => {
  const bridge = testBridge({ transport: { max_payload_bytes: 900 } });
  const source = bridge.connect(identity("tasknotes"));
  const provider = bridge.connect(identity("canvas-bases"));
  const caller = bridge.connect(identity("workflows"));
  await source.registerEventSource({
    declaration_id: "task-events",
    contracts: [{ contract: completedEvent }]
  });
  await registerCardProvider(provider, "canvas.actions", "card-one");

  await assert.rejects(
    source.publishEvent({
      contract: { id: completedEvent.id, version: completedEvent.version },
      data: {
        task_id: "task-1",
        completed_at: new Date("2026-07-28T01:30:00Z")
      }
    }),
    errorWithCode("invalid_event_data")
  );
  await assert.rejects(
    caller.invokeAction({
      contract: { id: createCardAction.id, version: "1.0.0" },
      input: { canvas: "Board.canvas", title: "x".repeat(1000) }
    }),
    errorWithCode("unsupported_transport_capability")
  );
  await bridge.dispose();
});

test("required idempotency rejects providers that cannot deduplicate requests", async () => {
  const bridge = testBridge();
  const provider = bridge.connect(identity("canvas-bases"));
  const required = structuredClone(createCardAction);
  required.behavior.idempotency = "required";

  await assert.rejects(
    provider.registerActionProvider({
      declaration_id: "canvas.actions",
      handlers: [{
        handler_id: "canvas.card.create",
        contract: required,
        handler: async () => ({ card_id: "card-1" })
      }]
    }),
    errorWithCode("request_rejected")
  );
  await bridge.dispose();
});

test("CloudEvents reject invalid extension attribute names", async () => {
  const bridge = testBridge();
  const source = bridge.connect(identity("tasknotes"));
  await source.registerEventSource({
    declaration_id: "tasknotes.events",
    contracts: [{ contract: completedEvent }]
  });

  await assert.rejects(
    source.publishEvent({
      contract: { id: completedEvent.id, version: completedEvent.version },
      extensions: { "not-valid": "value" },
      data: {
        task_id: "task-123",
        completed_at: "2026-07-28T01:30:00.000Z"
      }
    }),
    errorWithCode("invalid_event_data")
  );
  await bridge.dispose();
});

test("cooperative cancellation and provider unload remove live registrations", async () => {
  const bridge = testBridge();
  const provider = bridge.connect(identity("canvas-bases"));
  const caller = bridge.connect(identity("workflows"));
  const registration = await provider.registerActionProvider({
    declaration_id: "canvas.actions",
    handlers: [{
      handler_id: "canvas.card.create",
      contract: createCardAction,
      cancellation: "cooperative",
      handler: async (_input, { signal }) => await new Promise((resolve, reject) => {
        signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), {
          once: true
        });
      })
    }]
  });
  const pending = caller.invokeAction({
    request_id: "req_cancel",
    contract: { id: createCardAction.id, version: "1.0.0" },
    input: { canvas: "Board.canvas", title: "Card" }
  });
  await new Promise((resolve) => setImmediate(resolve));
  const cancelled = await caller.cancelAction("req_cancel", "Workflow stopped.");

  assert.equal(cancelled.status, "cancelled");
  assert.equal((await pending).status, "cancelled");
  await registration.dispose();
  await assert.rejects(
    caller.invokeAction({
      contract: { id: createCardAction.id, version: "1.0.0" },
      input: { canvas: "Board.canvas", title: "Another" }
    }),
    errorWithCode("no_provider")
  );
  assert.equal(bridge.describe().action_providers.length, 0);
  await bridge.dispose();
});

test("authorization and transport requirements fail closed", async () => {
  const bridge = testBridge({
    authorize: ({ operation, principal }) =>
      operation !== "subscribe_event" || principal.application !== "denied"
  });
  const denied = bridge.connect(identity("denied"));
  await assert.rejects(
    denied.subscribeEvents(
      { contract: { id: completedEvent.id, version: "^1.0.0" } },
      () => undefined
    ),
    errorWithCode("unauthorized")
  );
  const allowed = bridge.connect(identity("allowed"));
  await assert.rejects(
    allowed.subscribeEvents(
      {
        contract: { id: completedEvent.id, version: "^1.0.0" },
        require_transport: { delivery: ["durable_cursor"] }
      },
      () => undefined
    ),
    errorWithCode("unsupported_transport_capability")
  );
  await bridge.dispose();
});

async function registerCardProvider(client, declarationId, cardId) {
  return await client.registerActionProvider({
    declaration_id: declarationId,
    handlers: [{
      handler_id: "canvas.card.create",
      contract: createCardAction,
      idempotency: { mode: "request", retention_seconds: 60 },
      cancellation: "cooperative",
      handler: async () => ({ card_id: cardId })
    }]
  });
}

function schema(value) {
  return { dialect: "json-schema-2020-12", value };
}

function identity(application) {
  return {
    application,
    implementation: `${application}.obsidian`,
    version: "1.0.0"
  };
}

function testBridge(options = {}) {
  let sequence = 0;
  return new InMemoryInteropBridge({
    authorize: () => true,
    now: () => new Date("2026-07-28T01:30:00.000Z"),
    idFactory: (prefix) => `${prefix}_${++sequence}`,
    ...options
  });
}

function errorWithCode(code) {
  return (error) => error instanceof InteropError && error.code === code;
}
