import { Ajv2020, type ErrorObject, type ValidateFunction } from "ajv/dist/2020.js";
import addFormatsImport from "ajv-formats";
import { GENERATED_INTEROP_SCHEMAS } from "./generated-schemas.js";

type SchemaName = keyof typeof GENERATED_INTEROP_SCHEMAS;

const addFormats = addFormatsImport as unknown as (ajv: Ajv2020) => Ajv2020;

export function getInteropSchemas(): Record<SchemaName, Record<string, unknown>> {
  return Object.fromEntries(
    Object.entries(GENERATED_INTEROP_SCHEMAS).map(([name, schema]) => [
      name,
      structuredClone(schema)
    ])
  ) as unknown as Record<SchemaName, Record<string, unknown>>;
}

export function createInteropAjv(): Ajv2020 {
  const ajv = new Ajv2020({
    allErrors: true,
    strict: false,
    validateFormats: true
  });
  addFormats(ajv);
  const schemas = getInteropSchemas();
  ajv.addSchema(schemas.profile);
  for (const [name, schema] of Object.entries(schemas)) {
    if (name !== "profile") ajv.addSchema(schema);
  }
  return ajv;
}

export function compileInteropSchema(
  ajv: Ajv2020,
  name: Exclude<SchemaName, "profile">
): ValidateFunction {
  const id = String(GENERATED_INTEROP_SCHEMAS[name].$id);
  const validator = ajv.getSchema(id);
  if (!validator) throw new Error(`Canonical interoperability schema is unavailable: ${name}`);
  return validator;
}

export function formatSchemaErrors(errors: ErrorObject[] | null | undefined): string {
  return (errors ?? [])
    .map((error) => `${error.instancePath || "/"} ${error.message ?? error.keyword}`)
    .join("; ");
}
