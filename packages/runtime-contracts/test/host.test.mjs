import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  getCanonicalSchemas,
  InMemoryRuntimeHost,
  MDBASE_RUNTIME_PROFILE_VERSION,
  RuntimeHostError,
  validateCanonicalSchema,
} from "../dist/browser.js";

function createProvider() {
  let eventHandler = null;
  let disposed = false;
  const contracts = [
    {
      type: "capability",
      id: "record.write",
      version: 1,
      name: "Record write",
      risk: "medium",
    },
    {
      type: "action",
      id: "record.patch",
      version: 1,
      name: "Patch record",
      provider: "fixture",
      effects: ["record.write"],
      schemas: {
        dialect: "json-schema-2020-12",
        input: {
          type: "object",
          required: ["path"],
          properties: { path: { type: "string" } },
          additionalProperties: false,
        },
        output: {
          type: "object",
          required: ["updated"],
          properties: { updated: { type: "boolean" } },
          additionalProperties: false,
        },
      },
    },
    {
      type: "event",
      id: "canvas.drop",
      version: 1,
      name: "Canvas drop",
      provider: "fixture",
      schemas: {
        dialect: "json-schema-2020-12",
        payload: {
          type: "object",
          required: ["path"],
          properties: { path: { type: "string" } },
          additionalProperties: false,
        },
      },
    },
  ];

  return {
    provider: {
      descriptor: () => ({
        type: "provider",
        id: "fixture",
        version: 1,
        name: "Fixture provider",
        provider_version: "1.2.3",
        contracts: {
          actions: ["record.patch"],
          events: ["canvas.drop"],
          capabilities: ["record.write"],
        },
      }),
      contracts: () => contracts,
      readiness: () => ({ valid: true, status: "ready", diagnostics: [] }),
      subscribe: (_eventId, handler) => {
        eventHandler = handler;
        return { dispose: () => { eventHandler = null; } };
      },
      dispatch: async () => ({ updated: true }),
      dispose: () => { disposed = true; },
    },
    emit(event) {
      eventHandler?.(event);
    },
    get disposed() {
      return disposed;
    },
  };
}

const context = {
  actor: { id: "test", kind: "user" },
  origin: { provider: "test" },
  run_id: "run-1",
  invocation_id: "invocation-1",
  attempt: 1,
  correlation_id: "correlation-1",
  executor: "test",
};

test("browser export provides a policy-gated provider host", async () => {
  const fixture = createProvider();
  const host = new InMemoryRuntimeHost({
    policy: {
      id: "test-policy",
      selected: true,
      capabilities: { "record.write": "allow" },
    },
  });
  const registration = await host.registerProvider(fixture.provider);

  assert.equal(host.profileVersion, MDBASE_RUNTIME_PROFILE_VERSION);
  assert.deepEqual(host.providers().map((provider) => provider.descriptor.id), ["fixture"]);
  assert.equal(host.preflight({
    providers: [{ id: "fixture", version: "^1.2.0" }],
    capabilities: ["record.write"],
    actions: ["record.patch"],
  }).valid, true);
  assert.deepEqual(await host.dispatch("record.patch", { path: "tasks/a.md" }, context), { updated: true });
  await assert.rejects(
    host.dispatch("record.patch", { missing: true }, context),
    (error) => error instanceof RuntimeHostError && error.code === "invalid_action_input",
  );

  const delivered = [];
  host.subscribe("canvas.drop", (event) => delivered.push(event.id));
  const event = {
    type: "canvas.drop",
    contract_version: 1,
    id: "evt-1",
    occurred_at: "2026-07-16T00:00:00Z",
    source: { runtime: "test", provider: "fixture" },
    payload: { path: "tasks/a.md" },
  };
  fixture.emit(event);
  fixture.emit(event);
  assert.deepEqual(delivered, ["evt-1"]);

  await registration.unregister();
  assert.equal(fixture.disposed, true);
  assert.equal(host.preflight({ actions: ["record.patch"] }).valid, false);
  await host.dispose();
});

test("provider registration enforces the canonical contract schemas", async () => {
  const fixture = createProvider();
  const malformed = {
    ...fixture.provider,
    contracts: () => fixture.provider.contracts().map((contract) =>
      contract.type === "action" ? { ...contract, name: undefined, typo: true } : contract
    ),
  };
  const host = new InMemoryRuntimeHost();

  await assert.rejects(
    host.registerProvider(malformed),
    (error) => error instanceof RuntimeHostError && error.code === "invalid_contract",
  );
  assert.deepEqual(host.providers(), []);
  await host.dispose();
});

test("event delivery validates the canonical envelope and permits omitted source.provider", async () => {
  const fixture = createProvider();
  const diagnostics = [];
  const host = new InMemoryRuntimeHost({ onDiagnostic: (diagnostic) => diagnostics.push(diagnostic) });
  await host.registerProvider(fixture.provider);
  const delivered = [];
  host.subscribe("canvas.drop", (event) => delivered.push(event.id));

  fixture.emit({
    type: "canvas.drop",
    contract_version: 1,
    id: "evt-valid",
    occurred_at: "2026-07-16T00:00:00Z",
    source: { runtime: "test" },
    payload: { path: "tasks/a.md" },
  });
  fixture.emit({
    type: "canvas.drop",
    contract_version: 1,
    id: "evt-invalid",
    occurred_at: "not-a-date",
    source: { runtime: "test" },
    payload: { path: "tasks/a.md" },
  });

  assert.deepEqual(delivered, ["evt-valid"]);
  assert.equal(diagnostics.at(-1)?.code, "invalid_event_envelope");
  await host.dispose();
});

test("default policy denies effectful dispatch", async () => {
  const fixture = createProvider();
  const host = new InMemoryRuntimeHost();
  await host.registerProvider(fixture.provider);

  await assert.rejects(
    host.dispatch("record.patch", { path: "tasks/a.md" }, context),
    (error) => error instanceof RuntimeHostError && error.code === "capability_denied",
  );
  await host.dispose();
});

test("dispatch rechecks action provider requirements", async () => {
  const fixture = createProvider();
  const dependent = {
    ...fixture.provider,
    contracts: () => fixture.provider.contracts().map((contract) =>
      contract.type === "action"
        ? { ...contract, requires: { providers: [{ id: "missing-provider", version: "^2.0.0" }] } }
        : contract
    ),
  };
  const host = new InMemoryRuntimeHost({
    policy: {
      id: "test-policy",
      selected: true,
      capabilities: { "record.write": "allow" },
    },
  });
  await host.registerProvider(dependent);

  await assert.rejects(
    host.dispatch("record.patch", { path: "tasks/a.md" }, context),
    (error) => error instanceof RuntimeHostError && error.code === "provider_unavailable",
  );
  await host.dispose();
});

test("host-owned policy resolvers refresh authorization without replacing providers", async () => {
  const fixture = createProvider();
  let policy = {
    id: "dynamic-policy",
    selected: true,
    capabilities: { "record.write": "deny" },
  };
  const host = new InMemoryRuntimeHost({ policyResolver: () => policy });
  await host.registerProvider(fixture.provider);

  await assert.rejects(
    host.dispatch("record.patch", { path: "tasks/a.md" }, context),
    (error) => error instanceof RuntimeHostError && error.code === "capability_denied",
  );
  policy = {
    id: "dynamic-policy",
    selected: true,
    capabilities: { "record.write": "allow" },
  };
  assert.deepEqual(await host.dispatch("record.patch", { path: "tasks/a.md" }, context), { updated: true });
  assert.equal(host.providers().length, 1);
  await host.dispose();
});

test("main package export is browser-safe", async () => {
  const schemas = getCanonicalSchemas();
  assert.equal(typeof schemas.dataContract.$id, "string");
  assert.equal(typeof schemas.typePack.$id, "string");
  assert.equal(
    schemas.provider.$id,
    "https://mdbase.dev/schemas/runtime/v0.1/provider.schema.json",
  );
  assert.equal(validateCanonicalSchema("provider", {
    type: "provider",
    id: "fixture",
    version: 1,
    provider_version: "1.0.0",
    name: "Fixture",
  }).valid, true);
  assert.equal(validateCanonicalSchema("runtimePolicy", {
    type: "runtime_policy",
    id: "invalid",
    version: 1,
    name: "Invalid",
    typo: true,
  }).valid, false);
  const source = await readFile(new URL("../dist/browser.js", import.meta.url), "utf8");
  assert.doesNotMatch(source, /node:/u);
  assert.doesNotMatch(source, /tasknotes/iu);
  assert.doesNotMatch(source, /obsidian/iu);
});
