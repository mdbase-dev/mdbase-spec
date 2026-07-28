import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Ajv2020 } from "ajv/dist/2020.js";
import addFormatsImport from "ajv-formats";
import { getCanonicalSchemas, type CanonicalSchemas } from "./canonical-schemas.js";

export type { CanonicalSchemas } from "./canonical-schemas.js";

export { MDBASE_RUNTIME_PROFILE_VERSION, MDBASE_SPEC_VERSION } from "./version.js";

export function defaultSchemaRoot(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), "../../../schemas/v0.3");
}

export function createAjv(): Ajv2020 {
  const ajv = new Ajv2020({
    allErrors: true,
    strict: false,
    allowUnionTypes: true
  });
  const addFormats = addFormatsImport as unknown as (ajv: Ajv2020) => void;
  addFormats(ajv);
  return ajv;
}

export async function loadCanonicalSchemas(schemaRoot?: string): Promise<CanonicalSchemas> {
  if (!schemaRoot) return getCanonicalSchemas();
  return {
    config: await readJson(join(schemaRoot, "config.schema.json")),
    conformanceClaim: await readJson(join(schemaRoot, "conformance-claim.schema.json")),
    coreDiagnostic: await readJson(join(schemaRoot, "diagnostic.schema.json")),
    operationResult: await readJson(join(schemaRoot, "operation-result.schema.json")),
    recordDocument: await readJson(join(schemaRoot, "record-document.schema.json")),
    queryResult: await readJson(join(schemaRoot, "query-result.schema.json")),
    typeFile: await readJson(join(schemaRoot, "type-file.schema.json")),
    dataContract: await readJson(join(schemaRoot, "data-contract.schema.json")),
    typePack: await readJson(join(schemaRoot, "type-pack.schema.json")),
    provider: await readJson(join(schemaRoot, "runtime/provider.schema.json")),
    action: await readJson(join(schemaRoot, "runtime/action.schema.json")),
    event: await readJson(join(schemaRoot, "runtime/event.schema.json")),
    capability: await readJson(join(schemaRoot, "runtime/capability.schema.json")),
    workflow: await readJson(join(schemaRoot, "runtime/workflow.schema.json")),
    runtimePolicy: await readJson(join(schemaRoot, "runtime/runtime-policy.schema.json")),
    run: await readJson(join(schemaRoot, "runtime/run.schema.json")),
    checkpoint: await readJson(join(schemaRoot, "runtime/checkpoint.schema.json")),
    timer: await readJson(join(schemaRoot, "runtime/timer.schema.json")),
    diagnostic: await readJson(join(schemaRoot, "runtime/diagnostic.schema.json")),
    eventEnvelope: await readJson(join(schemaRoot, "runtime/event-envelope.schema.json"))
  };
}

async function readJson(path: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
}
