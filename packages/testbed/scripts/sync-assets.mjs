import { cpSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = resolve(packageRoot, "../..");
const destination = join(packageRoot, "assets");

rmSync(destination, { recursive: true, force: true });
mkdirSync(destination, { recursive: true });
cpSync(
  join(repositoryRoot, "schemas/testbed/v0.1"),
  join(destination, "schemas"),
  { recursive: true }
);
cpSync(
  join(repositoryRoot, "testbed/v0.1"),
  join(destination, "suite"),
  { recursive: true }
);
