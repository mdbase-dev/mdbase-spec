import { GENERATED_CANONICAL_SCHEMAS } from "./generated-schemas.js";
import { Ajv2020, type ErrorObject, type ValidateFunction } from "ajv/dist/2020.js";
import addFormatsImport from "ajv-formats";
import type { RuntimeContractRecord } from "./types.js";

export interface CanonicalSchemas {
  config: Record<string, unknown>;
  conformanceClaim: Record<string, unknown>;
  coreDiagnostic: Record<string, unknown>;
  operationResult: Record<string, unknown>;
  recordDocument: Record<string, unknown>;
  queryResult: Record<string, unknown>;
  typeFile: Record<string, unknown>;
  dataContract: Record<string, unknown>;
  typePack: Record<string, unknown>;
  provider: Record<string, unknown>;
  action: Record<string, unknown>;
  event: Record<string, unknown>;
  capability: Record<string, unknown>;
  workflow: Record<string, unknown>;
  runtimePolicy: Record<string, unknown>;
  run: Record<string, unknown>;
  checkpoint: Record<string, unknown>;
  timer: Record<string, unknown>;
  diagnostic: Record<string, unknown>;
  eventEnvelope: Record<string, unknown>;
}

export type ProviderRuntimeContractType = Extract<
  RuntimeContractRecord["type"],
  "action" | "event" | "capability" | "workflow"
>;

export type CanonicalSchemaName = keyof CanonicalSchemas;

export interface CanonicalSchemaValidationError {
  instancePath: string;
  schemaPath: string;
  keyword: string;
  message?: string;
  params: Record<string, unknown>;
}

export interface CanonicalSchemaValidationResult {
  valid: boolean;
  errors: CanonicalSchemaValidationError[];
}

const schemas = GENERATED_CANONICAL_SCHEMAS as unknown as CanonicalSchemas;
let validators: Partial<Record<CanonicalSchemaName, ValidateFunction>> | undefined;

/** Returns an isolated copy so callers cannot mutate the package's canonical schemas. */
export function getCanonicalSchemas(): CanonicalSchemas {
  return clone(schemas);
}

export function getProviderRuntimeContractSchemas(): Record<
  ProviderRuntimeContractType,
  Record<string, unknown>
> {
  return clone({
    action: schemas.action,
    event: schemas.event,
    capability: schemas.capability,
    workflow: schemas.workflow,
  });
}

export function getProviderSchema(): Record<string, unknown> {
  return clone(schemas.provider);
}

export function getEventEnvelopeSchema(): Record<string, unknown> {
  return clone(schemas.eventEnvelope);
}

/** Validates a value against an embedded canonical schema without filesystem access. */
export function validateCanonicalSchema(
  name: CanonicalSchemaName,
  value: unknown
): CanonicalSchemaValidationResult {
  const validate = getCanonicalValidators()[name];
  const valid = validate(value);
  return {
    valid,
    errors: valid ? [] : (validate.errors ?? []).map(toValidationError)
  };
}

function getCanonicalValidators(): Record<CanonicalSchemaName, ValidateFunction> {
  if (validators) return validators as Record<CanonicalSchemaName, ValidateFunction>;
  const ajv = new Ajv2020({
    allErrors: true,
    strict: false,
    allowUnionTypes: true,
    schemas: Object.values(schemas)
  });
  const addFormats = addFormatsImport as unknown as (instance: Ajv2020) => void;
  addFormats(ajv);
  validators = Object.fromEntries(
    Object.entries(schemas).map(([name, schema]) => {
      const id = schema.$id;
      const validate = typeof id === "string" ? ajv.getSchema(id) : undefined;
      return [name, validate ?? ajv.compile(schema)];
    })
  ) as Record<CanonicalSchemaName, ValidateFunction>;
  return validators as Record<CanonicalSchemaName, ValidateFunction>;
}

function toValidationError(error: ErrorObject): CanonicalSchemaValidationError {
  return {
    instancePath: error.instancePath,
    schemaPath: error.schemaPath,
    keyword: error.keyword,
    message: error.message,
    params: clone(error.params)
  };
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
