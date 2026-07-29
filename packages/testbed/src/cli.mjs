#!/usr/bin/env node

import { writeFileSync } from "node:fs";
import {
  loadTestbed,
  runTestbed,
  validateTestbed
} from "./index.mjs";

const [command = "help", ...args] = process.argv.slice(2);

try {
  if (command === "list") {
    const { scenarios } = loadTestbed();
    for (const scenario of scenarios) {
      process.stdout.write(
        `${scenario.id}\t${scenario.ring}\t${scenario.profile}\t${scenario.name}\n`
      );
    }
  } else if (command === "validate") {
    const summary = validateTestbed();
    process.stdout.write(
      `Testbed 0.1 valid: ${summary.fixtures} fixtures, `
      + `${summary.scenarios} scenarios, ${summary.profiles.length} profiles.\n`
    );
  } else if (command === "run") {
    const options = parseRunArgs(args);
    const run = await runTestbed(options);
    for (const result of run.results) {
      process.stdout.write(`${result.pass ? "PASS" : "FAIL"} ${result.id}\n`);
      if (!result.pass) {
        process.stderr.write(
          `${result.id}: observable transcript did not match the canonical transcript.\n`
          + `  first difference at ${result.mismatch.path}\n`
          + `  expected: ${JSON.stringify(result.mismatch.expected)}\n`
          + `  received: ${JSON.stringify(result.mismatch.actual)}\n`
        );
      }
    }
    if (options.evidence) {
      writeFileSync(options.evidence, `${JSON.stringify(run.evidence, null, 2)}\n`, "utf8");
      process.stdout.write(`Evidence: ${options.evidence}\n`);
    }
    if (!run.results.every(({ pass }) => pass)) process.exitCode = 1;
  } else {
    process.stdout.write(`mdbase-testbed 0.1

Usage:
  mdbase-testbed validate
  mdbase-testbed list
  mdbase-testbed run [--adapter reference|PATH] [--adapter-arg VALUE]
                     [--scenario ID] [--profile PROFILE]
                     [--evidence PATH] [--timeout-ms NUMBER]

Use --adapter command:NAME with repeated --adapter-arg options when an adapter
is launched through a command such as cargo.
`);
  }
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}

function parseRunArgs(values) {
  const options = {
    adapter: "reference",
    adapterArgs: [],
    scenarios: []
  };
  for (let index = 0; index < values.length; index += 1) {
    const flag = values[index];
    const value = values[index + 1];
    if (
      ![
        "--adapter",
        "--adapter-arg",
        "--scenario",
        "--profile",
        "--evidence",
        "--timeout-ms"
      ].includes(flag)
    ) {
      throw new Error(`Unknown option: ${flag}`);
    }
    if (value === undefined) throw new Error(`${flag} requires a value.`);
    index += 1;
    if (flag === "--adapter") options.adapter = value;
    if (flag === "--adapter-arg") options.adapterArgs.push(value);
    if (flag === "--scenario") options.scenarios.push(value);
    if (flag === "--profile") options.profile = value;
    if (flag === "--evidence") options.evidence = value;
    if (flag === "--timeout-ms") {
      options.timeoutMs = Number(value);
      if (!Number.isInteger(options.timeoutMs) || options.timeoutMs < 1) {
        throw new Error("--timeout-ms must be a positive integer.");
      }
    }
  }
  return options;
}
