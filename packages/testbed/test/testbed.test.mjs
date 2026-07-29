import assert from "node:assert/strict";
import { test } from "node:test";
import {
  canonicalJson,
  describeAdapter,
  firstDifference,
  loadTestbed,
  portableDigest,
  runTestbed,
  validateTestbed
} from "../src/index.mjs";

test("validates the complete neutral scenario inventory", () => {
  const result = validateTestbed();
  assert.deepEqual(result, {
    fixtures: 9,
    scenarios: 16,
    profiles: [
      "core_read",
      "event_action_interop/0.1",
      "runtime/0.2"
    ]
  });
});

test("keeps scenarios product-neutral and expected transcripts sequential", () => {
  const { scenarios } = loadTestbed();
  const encoded = JSON.stringify(scenarios);
  for (const productName of [
    "tasknotes",
    "canvas-bases",
    "workflows",
    "pickle",
    "connect"
  ]) {
    assert.equal(encoded.includes(productName), false, productName);
  }
  for (const scenario of scenarios) {
    assert.deepEqual(
      scenario.expect.entries.map(({ sequence }) => sequence),
      scenario.expect.entries.map((_, index) => index + 1)
    );
  }
});

test("describes and runs the black-box reference adapter", async () => {
  const description = await describeAdapter("reference");
  assert.equal(description.kind, "mdbase.testbed.adapter");
  assert.equal(description.scenarios.length, 9);

  const run = await runTestbed({ adapter: "reference" });
  assert.equal(run.results.length, 9);
  assert.equal(run.results.every(({ pass }) => pass), true);
  assert.equal(run.evidence.result, "pass");
});

test("can select one scenario and rejects an unsupported requested ring", async () => {
  const selected = await runTestbed({
    adapter: "reference",
    scenarios: ["interop.event-multicast"]
  });
  assert.deepEqual(selected.results.map(({ id }) => id), [
    "interop.event-multicast"
  ]);

  await assert.rejects(
    runTestbed({
      adapter: "reference",
      scenarios: ["runtime.crash-recovery"]
    }),
    /does not support requested scenario/
  );
});

test("portable transcript digests use recursively sorted JSON object keys", () => {
  assert.equal(canonicalJson({ z: 1, a: { y: 2, b: 3 } }), '{"a":{"b":3,"y":2},"z":1}');
  assert.equal(
    portableDigest({ b: 2, a: 1 }),
    portableDigest({ a: 1, b: 2 })
  );
  assert.match(portableDigest({ stable: true }), /^sha256:[0-9a-f]{64}$/u);
});

test("reports the first stable transcript difference", () => {
  assert.deepEqual(
    firstDifference(
      [{ facts: { calls: 1, exact: true } }],
      [{ facts: { calls: 2, exact: true } }],
      "entries"
    ),
    {
      path: "entries[0].facts.calls",
      expected: 1,
      actual: 2
    }
  );
});
