#!/usr/bin/env node

import {
  InMemoryInteropBridge,
  InteropError,
  contractDigest
} from "../../interop/src/index.ts";

const implementation = {
  id: "mdbase-interop.typescript.reference",
  name: "mdbase TypeScript in-memory interoperability bridge",
  version: "0.1.0-rc.2",
  language: "TypeScript",
  target: "Node.js"
};

const scenarios = [
  "interop.action-ambiguous",
  "interop.action-explicit-provider",
  "interop.action-single-provider",
  "interop.authority-boundary",
  "interop.contract-digest-drift",
  "interop.event-multicast",
  "interop.invalid-payload",
  "interop.provider-disappearance",
  "interop.request-replay"
];

const command = process.argv[2];
if (command === "describe") {
  write({
    kind: "mdbase.testbed.adapter",
    protocol_version: "0.1",
    implementation,
    profiles: ["event_action_interop/0.1"],
    roles: [
      "event_source",
      "event_consumer",
      "action_caller",
      "action_provider",
      "bridge"
    ],
    scenarios
  });
} else if (command === "run") {
  try {
    const request = JSON.parse(await readStdin());
    if (
      request.kind !== "mdbase.testbed.run"
      || request.protocol_version !== "0.1"
      || !scenarios.includes(request.scenario?.id)
    ) {
      throw new Error("Unsupported or invalid mdbase testbed run request.");
    }
    const entries = await runScenario(request);
    write({
      kind: "mdbase.testbed.transcript",
      protocol_version: "0.1",
      scenario_id: request.scenario.id,
      implementation,
      entries
    });
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
    process.exitCode = 1;
  }
} else {
  process.stderr.write("Usage: reference.mjs describe|run\n");
  process.exitCode = 2;
}

async function runScenario(request) {
  switch (request.scenario.id) {
    case "interop.event-multicast":
      return await eventMulticast(fixture(request, "contract.record-changed"));
    case "interop.action-single-provider":
      return await actionSingleProvider(fixture(request, "contract.record-annotate"));
    case "interop.action-ambiguous":
      return await actionAmbiguous(fixture(request, "contract.record-annotate"));
    case "interop.action-explicit-provider":
      return await actionExplicitProvider(fixture(request, "contract.record-annotate"));
    case "interop.provider-disappearance":
      return await providerDisappearance(fixture(request, "contract.record-annotate"));
    case "interop.contract-digest-drift":
      return await contractDigestDrift(fixture(request, "contract.record-changed"));
    case "interop.invalid-payload":
      return await invalidPayload(
        fixture(request, "contract.record-changed"),
        request.scenario.parameters.data
      );
    case "interop.authority-boundary":
      return await authorityBoundary(fixture(request, "contract.record-annotate"));
    case "interop.request-replay":
      return await requestReplay(fixture(request, "contract.record-annotate"));
    default:
      throw new Error(`Unsupported scenario ${request.scenario.id}.`);
  }
}

async function eventMulticast(contract) {
  const bridge = testBridge();
  try {
    const source = bridge.connect(identity("source"));
    const alpha = bridge.connect(identity("consumer-alpha"));
    const beta = bridge.connect(identity("consumer-beta"));
    const received = [];
    await source.registerEventSource({
      declaration_id: "source.events",
      contracts: [{ contract }]
    });
    await alpha.subscribeEvents(
      { contract: { id: contract.id, version: "^1.0.0" } },
      () => received.push("consumer-alpha")
    );
    await beta.subscribeEvents(
      { contract: { id: contract.id, version: ">=1.0.0 <2.0.0" } },
      () => received.push("consumer-beta")
    );
    const published = await source.publishEvent({
      id: "evt-shared-1",
      contract: { id: contract.id, version: contract.version },
      data: { record_id: "note-1", revision: 1 }
    });
    return [
      entry(1, "arrange", "source", "event-source.register", "succeeded", {
        contract: contract.id,
        version: contract.version
      }),
      entry(2, "arrange", "consumer-alpha", "event.subscribe", "succeeded", {
        version: "^1.0.0"
      }),
      entry(3, "arrange", "consumer-beta", "event.subscribe", "succeeded", {
        version: ">=1.0.0 <2.0.0"
      }),
      entry(4, "act", "source", "event.publish", "succeeded", {
        event_id: published.event.id
      }),
      entry(5, "observe", "bridge", "event.deliver", "succeeded", {
        consumers: received,
        deliveries: published.deliveries,
        duplicate: published.duplicate,
        exact_contract:
          published.event.mdbasecontractversion === contract.version
          && published.event.mdbasecontractdigest === await contractDigest(contract),
        specversion: published.event.specversion
      })
    ];
  } finally {
    await bridge.dispose();
  }
}

async function actionSingleProvider(contract) {
  const bridge = testBridge();
  try {
    const calls = { count: 0 };
    const provider = bridge.connect(identity("provider-alpha"));
    const caller = bridge.connect(identity("caller"));
    await registerProvider(provider, contract, calls);
    const outcome = await caller.invokeAction({
      request_id: "req-single-1",
      contract: { id: contract.id, version: "^1.0.0" },
      idempotency_key: "req-single-1",
      input: { record_id: "note-1", label: "observed" }
    });
    return [
      entry(1, "arrange", "provider-alpha", "action-provider.register", "succeeded", {
        contract: contract.id,
        idempotency: "request"
      }),
      entry(2, "act", "caller", "action.invoke", status(outcome), {
        request_id: outcome.request_id
      }),
      entry(3, "observe", "bridge", "action.outcome", status(outcome), {
        exact_contract:
          outcome.contract.version === contract.version
          && outcome.contract.digest === await contractDigest(contract),
        provider: outcome.provider.application,
        provider_calls: calls.count,
        request_id: outcome.request_id
      })
    ];
  } finally {
    await bridge.dispose();
  }
}

async function actionAmbiguous(contract) {
  const bridge = testBridge();
  try {
    const alphaCalls = { count: 0 };
    const betaCalls = { count: 0 };
    const caller = bridge.connect(identity("caller"));
    await registerProvider(
      bridge.connect(identity("provider-alpha")),
      contract,
      alphaCalls
    );
    await registerProvider(
      bridge.connect(identity("provider-beta")),
      contract,
      betaCalls
    );
    const code = await rejectedCode(() => caller.invokeAction({
      contract: { id: contract.id, version: "^1.0.0" },
      idempotency_key: "req-ambiguous-1",
      input: { record_id: "note-1", label: "observed" }
    }));
    return [
      entry(1, "arrange", "provider-alpha", "action-provider.register", "succeeded", {
        contract: contract.id
      }),
      entry(2, "arrange", "provider-beta", "action-provider.register", "succeeded", {
        contract: contract.id
      }),
      entry(3, "act", "caller", "action.invoke", "rejected", {
        code,
        provider_calls: alphaCalls.count + betaCalls.count
      })
    ];
  } finally {
    await bridge.dispose();
  }
}

async function actionExplicitProvider(contract) {
  const bridge = testBridge();
  try {
    const alphaCalls = { count: 0 };
    const betaCalls = { count: 0 };
    const caller = bridge.connect(identity("caller"));
    await registerProvider(
      bridge.connect(identity("provider-alpha")),
      contract,
      alphaCalls
    );
    await registerProvider(
      bridge.connect(identity("provider-beta")),
      contract,
      betaCalls
    );
    const outcome = await caller.invokeAction({
      contract: { id: contract.id, version: "^1.0.0" },
      requested_provider: { application: "provider-beta" },
      idempotency_key: "req-explicit-1",
      input: { record_id: "note-1", label: "observed" }
    });
    return [
      entry(1, "arrange", "provider-alpha", "action-provider.register", "succeeded", {
        contract: contract.id
      }),
      entry(2, "arrange", "provider-beta", "action-provider.register", "succeeded", {
        contract: contract.id
      }),
      entry(3, "act", "caller", "action.invoke", status(outcome), {
        selected: outcome.provider.application
      }),
      entry(4, "observe", "bridge", "action.outcome", status(outcome), {
        provider: outcome.provider.application,
        provider_alpha_calls: alphaCalls.count,
        provider_beta_calls: betaCalls.count
      })
    ];
  } finally {
    await bridge.dispose();
  }
}

async function providerDisappearance(contract) {
  const bridge = testBridge();
  try {
    const calls = { count: 0 };
    const provider = bridge.connect(identity("provider-alpha"));
    const caller = bridge.connect(identity("caller"));
    await registerProvider(provider, contract, calls);
    const before = bridge.describe().action_providers.length;
    await provider.dispose();
    const after = bridge.describe().action_providers.length;
    const code = await rejectedCode(() => caller.invokeAction({
      contract: { id: contract.id, version: "^1.0.0" },
      idempotency_key: "req-disappeared-1",
      input: { record_id: "note-1", label: "observed" }
    }));
    return [
      entry(1, "arrange", "provider-alpha", "action-provider.register", "succeeded", {
        providers: before
      }),
      entry(2, "act", "provider-alpha", "client.dispose", "succeeded", {
        providers: after
      }),
      entry(3, "observe", "caller", "action.invoke", "rejected", {
        code,
        provider_calls: calls.count
      })
    ];
  } finally {
    await bridge.dispose();
  }
}

async function contractDigestDrift(contract) {
  const bridge = testBridge();
  try {
    const alpha = bridge.connect(identity("source-alpha"));
    const beta = bridge.connect(identity("source-beta"));
    await alpha.registerEventSource({
      declaration_id: "alpha.events",
      contracts: [{ contract }]
    });
    const drifted = structuredClone(contract);
    drifted.data_schema.value.properties.record_id.minLength = 2;
    const code = await rejectedCode(() => beta.registerEventSource({
      declaration_id: "beta.events",
      contracts: [{ contract: drifted }]
    }));
    const sources = bridge.describe().event_sources.length;
    return [
      entry(1, "arrange", "source-alpha", "event-source.register", "succeeded", {
        sources: 1
      }),
      entry(2, "act", "source-beta", "event-source.register", "rejected", {
        code
      }),
      entry(3, "observe", "bridge", "registry.inspect", "succeeded", {
        atomic: sources === 1,
        sources
      })
    ];
  } finally {
    await bridge.dispose();
  }
}

async function invalidPayload(contract, data) {
  const bridge = testBridge();
  try {
    const source = bridge.connect(identity("source"));
    const consumer = bridge.connect(identity("consumer"));
    let deliveries = 0;
    await source.registerEventSource({
      declaration_id: "source.events",
      contracts: [{ contract }]
    });
    await consumer.subscribeEvents(
      { contract: { id: contract.id, version: "^1.0.0" } },
      () => { deliveries += 1; }
    );
    const code = await rejectedCode(() => source.publishEvent({
      contract: { id: contract.id, version: contract.version },
      data
    }));
    return [
      entry(1, "arrange", "source", "event-source.register", "succeeded", {
        contract: contract.id
      }),
      entry(2, "arrange", "consumer", "event.subscribe", "succeeded", {
        version: "^1.0.0"
      }),
      entry(3, "act", "source", "event.publish", "rejected", { code }),
      entry(4, "observe", "consumer", "event.deliver", "skipped", { deliveries })
    ];
  } finally {
    await bridge.dispose();
  }
}

async function authorityBoundary(contract) {
  const bridge = testBridge({
    authorize: ({ operation, principal }) =>
      operation !== "register_action_provider"
      || principal.application !== "untrusted-provider"
  });
  try {
    const provider = bridge.connect(identity("untrusted-provider"));
    const digest = await contractDigest(contract);
    const code = await rejectedCode(() => registerProvider(
      provider,
      contract,
      { count: 0 }
    ));
    return [
      entry(1, "arrange", "untrusted-provider", "contract.validate", "succeeded", {
        contract: digest.startsWith("sha256:") ? contract.id : ""
      }),
      entry(2, "act", "untrusted-provider", "action-provider.register", "rejected", {
        code
      }),
      entry(3, "observe", "bridge", "registry.inspect", "succeeded", {
        providers: bridge.describe().action_providers.length
      })
    ];
  } finally {
    await bridge.dispose();
  }
}

async function requestReplay(contract) {
  const bridge = testBridge();
  try {
    const calls = { count: 0 };
    const provider = bridge.connect(identity("provider-alpha"));
    const caller = bridge.connect(identity("caller"));
    await registerProvider(provider, contract, calls);
    const request = {
      request_id: "req-replay-1",
      contract: { id: contract.id, version: contract.version },
      idempotency_key: "run-1:annotate",
      input: { record_id: "note-1", label: "observed" }
    };
    const first = await caller.invokeAction(request);
    const second = await caller.invokeAction(request);
    return [
      entry(1, "arrange", "provider-alpha", "action-provider.register", "succeeded", {
        idempotency: "request"
      }),
      entry(2, "act", "caller", "action.invoke", status(first), {
        request_id: first.request_id
      }),
      entry(3, "act", "caller", "action.replay", status(second), {
        request_id: second.request_id
      }),
      entry(4, "observe", "bridge", "action.outcome", status(second), {
        handler_calls: calls.count,
        same_outcome: JSON.stringify(first) === JSON.stringify(second)
      })
    ];
  } finally {
    await bridge.dispose();
  }
}

async function registerProvider(client, contract, calls) {
  return await client.registerActionProvider({
    declaration_id: `${client.identity?.application ?? "provider"}.actions`,
    handlers: [{
      handler_id: "annotate",
      contract,
      idempotency: { mode: "request", retention_seconds: 60 },
      cancellation: "cooperative",
      handler: async ({ record_id }) => {
        calls.count += 1;
        return { record_id, applied: true };
      }
    }]
  });
}

function testBridge(options = {}) {
  let nextId = 0;
  return new InMemoryInteropBridge({
    authorize: () => true,
    now: () => new Date("2026-07-29T00:00:00.000Z"),
    idFactory: (prefix) => `${prefix}_${++nextId}`,
    ...options
  });
}

function identity(application) {
  return {
    application,
    implementation: `${application}.testbed`,
    version: "1.0.0",
    instance_id: `${application}-instance`
  };
}

function fixture(request, id) {
  const fixtureValue = request.fixtures?.[id];
  if (!fixtureValue) throw new Error(`Scenario request is missing fixture ${id}.`);
  return structuredClone(fixtureValue.value);
}

function entry(sequence, phase, actor, operation, outcome, facts) {
  return { sequence, phase, actor, operation, outcome, facts };
}

function status(outcome) {
  if (outcome.status === "succeeded") return "succeeded";
  if (outcome.status === "outcome_indeterminate") return "indeterminate";
  if (outcome.status === "rejected") return "rejected";
  return "failed";
}

async function rejectedCode(operation) {
  try {
    await operation();
  } catch (error) {
    if (error instanceof InteropError) return error.code;
    throw error;
  }
  throw new Error("Expected interoperability operation to reject.");
}

async function readStdin() {
  let source = "";
  for await (const chunk of process.stdin) source += chunk;
  return source;
}

function write(value) {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}
