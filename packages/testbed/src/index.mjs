import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import {
  readFileSync,
  readdirSync
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { fileURLToPath } from "node:url";
import { Ajv2020 } from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

export const TESTBED_PROTOCOL_VERSION = "0.1";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const assetsRoot = join(packageRoot, "assets");
const schemasRoot = join(assetsRoot, "schemas");
const suiteRoot = join(assetsRoot, "suite");

export function loadTestbed() {
  const catalog = readJson(join(suiteRoot, "fixtures/catalog.json"));
  const scenarios = readdirSync(join(suiteRoot, "scenarios"))
    .filter((name) => name.endsWith(".json"))
    .sort()
    .map((name) => readJson(join(suiteRoot, "scenarios", name)));
  return { catalog, scenarios };
}

export function validateTestbed() {
  const validators = createValidators();
  const { catalog, scenarios } = loadTestbed();
  assertValid(validators.fixtureCatalog, catalog, "fixture catalog");
  const knownFixtures = new Set(Object.keys(catalog.fixtures));
  const knownScenarios = new Set();

  for (const scenario of scenarios) {
    assertValid(validators.scenario, scenario, `scenario ${scenario.id ?? "<unknown>"}`);
    if (knownScenarios.has(scenario.id)) {
      throw new Error(`Duplicate testbed scenario ID: ${scenario.id}`);
    }
    knownScenarios.add(scenario.id);
    for (const fixture of scenario.fixtures) {
      if (!knownFixtures.has(fixture)) {
        throw new Error(`Scenario ${scenario.id} references unknown fixture ${fixture}.`);
      }
    }
    assertSequential(scenario);
    assertValid(
      validators.transcript,
      {
        kind: "mdbase.testbed.transcript",
        protocol_version: TESTBED_PROTOCOL_VERSION,
        scenario_id: scenario.id,
        implementation: {
          id: "testbed.oracle",
          name: "Canonical expected transcript",
          version: TESTBED_PROTOCOL_VERSION
        },
        entries: scenario.expect.entries
      },
      `expected transcript ${scenario.id}`
    );
  }
  return {
    fixtures: knownFixtures.size,
    scenarios: scenarios.length,
    profiles: [...new Set(scenarios.map(({ profile }) => profile))].sort()
  };
}

export async function describeAdapter(adapter, options = {}) {
  const target = resolveAdapter(adapter, options.adapterArgs ?? []);
  const result = await invoke(target, ["describe"], undefined, options.timeoutMs);
  const description = parseAdapterJson(result.stdout, "adapter description");
  assertValid(createValidators().adapterDescription, description, "adapter description");
  return description;
}

export async function runTestbed(options = {}) {
  validateTestbed();
  const validators = createValidators();
  const { catalog, scenarios } = loadTestbed();
  const target = resolveAdapter(options.adapter ?? "reference", options.adapterArgs ?? []);
  const description = await describeAdapter(options.adapter ?? "reference", options);
  const selected = selectScenarios(scenarios, description, options);
  const results = [];

  for (const scenario of selected) {
    const fixtures = Object.fromEntries(
      scenario.fixtures.map((id) => [id, structuredClone(catalog.fixtures[id])])
    );
    const request = {
      kind: "mdbase.testbed.run",
      protocol_version: TESTBED_PROTOCOL_VERSION,
      scenario,
      fixtures
    };
    assertValid(validators.runRequest, request, `run request ${scenario.id}`);
    const processResult = await invoke(
      target,
      ["run"],
      `${JSON.stringify(request)}\n`,
      options.timeoutMs
    );
    const transcript = parseAdapterJson(
      processResult.stdout,
      `transcript for ${scenario.id}`
    );
    assertValid(validators.transcript, transcript, `transcript ${scenario.id}`);
    if (transcript.scenario_id !== scenario.id) {
      throw new Error(
        `Adapter returned scenario ${transcript.scenario_id} while running ${scenario.id}.`
      );
    }
    if (!isDeepStrictEqual(transcript.implementation, description.implementation)) {
      throw new Error(
        `Transcript implementation does not match the adapter description for ${scenario.id}.`
      );
    }
    const pass = isDeepStrictEqual(transcript.entries, scenario.expect.entries);
    const mismatch = pass
      ? undefined
      : firstDifference(scenario.expect.entries, transcript.entries, "entries");
    results.push({
      id: scenario.id,
      profile: scenario.profile,
      pass,
      ...(mismatch ? { mismatch } : {}),
      transcript,
      transcript_digest: portableDigest(transcript)
    });
  }

  return {
    description,
    results,
    evidence: evidenceFor(description.implementation, results)
  };
}

export function portableDigest(value) {
  return `sha256:${createHash("sha256").update(canonicalJson(value)).digest("hex")}`;
}

export function canonicalJson(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) =>
    `${JSON.stringify(key)}:${canonicalJson(value[key])}`
  ).join(",")}}`;
}

export function firstDifference(expected, actual, path = "$") {
  if (isDeepStrictEqual(expected, actual)) return undefined;
  if (Array.isArray(expected) && Array.isArray(actual)) {
    const length = Math.max(expected.length, actual.length);
    for (let index = 0; index < length; index += 1) {
      if (index >= expected.length) {
        return {
          path: `${path}[${index}]`,
          expected: "<absent>",
          actual: actual[index]
        };
      }
      if (index >= actual.length) {
        return {
          path: `${path}[${index}]`,
          expected: expected[index],
          actual: "<absent>"
        };
      }
      const difference = firstDifference(
        expected[index],
        actual[index],
        `${path}[${index}]`
      );
      if (difference) return difference;
    }
  }
  if (isPlainObject(expected) && isPlainObject(actual)) {
    for (const key of [...new Set([
      ...Object.keys(expected),
      ...Object.keys(actual)
    ])].sort()) {
      if (!(key in expected)) {
        return {
          path: `${path}.${key}`,
          expected: "<absent>",
          actual: actual[key]
        };
      }
      if (!(key in actual)) {
        return {
          path: `${path}.${key}`,
          expected: expected[key],
          actual: "<absent>"
        };
      }
      const difference = firstDifference(
        expected[key],
        actual[key],
        `${path}.${key}`
      );
      if (difference) return difference;
    }
  }
  return { path, expected, actual };
}

function createValidators() {
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);
  const schemas = Object.fromEntries(
    readdirSync(schemasRoot)
      .filter((name) => name.endsWith(".schema.json"))
      .sort()
      .map((name) => [name, readJson(join(schemasRoot, name))])
  );
  for (const schema of Object.values(schemas)) ajv.addSchema(schema);
  return {
    adapterDescription: ajv.getSchema(schemas["adapter-description.schema.json"].$id),
    evidence: ajv.getSchema(schemas["evidence.schema.json"].$id),
    fixtureCatalog: ajv.getSchema(schemas["fixture-catalog.schema.json"].$id),
    runRequest: ajv.getSchema(schemas["run-request.schema.json"].$id),
    scenario: ajv.getSchema(schemas["scenario.schema.json"].$id),
    transcript: ajv.getSchema(schemas["transcript.schema.json"].$id)
  };
}

function selectScenarios(scenarios, description, options) {
  const requestedIds = new Set(options.scenarios ?? []);
  const supported = new Set(description.scenarios);
  const profile = options.profile;
  let selected = scenarios.filter((scenario) =>
    (requestedIds.size === 0 || requestedIds.has(scenario.id))
    && (profile === undefined || scenario.profile === profile)
  );
  if (requestedIds.size > 0) {
    const unknown = [...requestedIds].filter(
      (id) => !scenarios.some((scenario) => scenario.id === id)
    );
    if (unknown.length > 0) {
      throw new Error(`Unknown testbed scenario(s): ${unknown.join(", ")}`);
    }
  }
  if (profile !== undefined || requestedIds.size > 0) {
    const missing = selected.filter((scenario) => !supported.has(scenario.id));
    if (missing.length > 0) {
      throw new Error(
        `Adapter ${description.implementation.id} does not support requested scenario(s): `
        + missing.map(({ id }) => id).join(", ")
      );
    }
  } else {
    selected = selected.filter((scenario) => supported.has(scenario.id));
  }
  if (selected.length === 0) {
    throw new Error(`Adapter ${description.implementation.id} has no selected scenarios.`);
  }
  return selected;
}

function evidenceFor(implementation, results) {
  const evidence = {
    kind: "mdbase.testbed.evidence",
    protocol_version: TESTBED_PROTOCOL_VERSION,
    implementation,
    result: results.every(({ pass }) => pass) ? "pass" : "fail",
    scenarios: results.map((result) => ({
      id: result.id,
      profile: result.profile,
      result: result.pass ? "pass" : "fail",
      transcript_digest: result.transcript_digest
    }))
  };
  assertValid(createValidators().evidence, evidence, "testbed evidence");
  return evidence;
}

function resolveAdapter(adapter, adapterArgs) {
  if (adapter === "reference") {
    return {
      command: process.execPath,
      args: [join(packageRoot, "dist/reference.mjs")]
    };
  }
  if (adapter.startsWith("command:")) {
    const command = adapter.slice("command:".length);
    if (command.length === 0) {
      throw new Error("A command: adapter must name an executable.");
    }
    return { command, args: adapterArgs };
  }
  const resolved = resolve(adapter);
  if (/\.(?:cjs|mjs|js)$/u.test(resolved)) {
    return { command: process.execPath, args: [resolved, ...adapterArgs] };
  }
  return { command: resolved, args: adapterArgs };
}

function invoke(target, args, input, timeoutMs = 30_000) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(target.command, [...target.args, ...args], {
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        ...process.env,
        MDBASE_TESTBED_PROTOCOL_VERSION: TESTBED_PROTOCOL_VERSION
      }
    });
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      rejectPromise(new Error(
        `Adapter timed out after ${timeoutMs}ms: ${target.command} ${args.join(" ")}`
      ));
    }, timeoutMs);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", (error) => {
      clearTimeout(timeout);
      rejectPromise(error);
    });
    child.on("close", (code, signal) => {
      clearTimeout(timeout);
      if (code !== 0) {
        rejectPromise(new Error(
          `Adapter exited with ${code ?? signal}: ${stderr.trim() || "<no diagnostic>"}`
        ));
        return;
      }
      resolvePromise({ stdout, stderr });
    });
    child.stdin.end(input);
  });
}

function parseAdapterJson(source, label) {
  try {
    return JSON.parse(source);
  } catch (error) {
    throw new Error(`Invalid ${label} JSON: ${error.message}`);
  }
}

function assertValid(validator, value, label) {
  if (validator(value)) return;
  const errors = (validator.errors ?? [])
    .map(({ instancePath, message }) => `${instancePath || "/"} ${message}`)
    .join("; ");
  throw new Error(`Invalid ${label}: ${errors}`);
}

function assertSequential(scenario) {
  scenario.expect.entries.forEach((entry, index) => {
    if (entry.sequence !== index + 1) {
      throw new Error(
        `Scenario ${scenario.id} transcript sequence must be ${index + 1}, got ${entry.sequence}.`
      );
    }
  });
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
