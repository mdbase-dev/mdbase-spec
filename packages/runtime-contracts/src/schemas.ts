import { Ajv2020 } from "ajv/dist/2020.js";
import addFormatsImport from "ajv-formats";
import type { ErrorObject, ValidateFunction } from "ajv";
import { GENERATED_RUNTIME_RECORD_SCHEMAS } from "./generated-schemas.js";
import type {
  RuntimeDiagnostic,
  RuntimeRecordValidationResult
} from "./types.js";

const addFormats = addFormatsImport as unknown as (ajv: Ajv2020) => Ajv2020;

export const RUNTIME_RECORD_CONTRACTS = Object.freeze({
  runtime_workflow: "mdbase.runtime.workflow",
  runtime_policy: "mdbase.runtime.policy",
  runtime_provider_registration: "mdbase.runtime.provider-registration",
  runtime_capability_grant: "mdbase.runtime.capability-grant",
  runtime_run: "mdbase.runtime.run",
  runtime_action_attempt: "mdbase.runtime.action-attempt",
  runtime_checkpoint: "mdbase.runtime.checkpoint",
  runtime_timer: "mdbase.runtime.timer",
  runtime_diagnostic: "mdbase.runtime.diagnostic",
  runtime_dead_letter: "mdbase.runtime.dead-letter"
} as const);

export type RuntimeRecordType = keyof typeof RUNTIME_RECORD_CONTRACTS;

const ajv = addFormats(new Ajv2020({
  allErrors: true,
  strict: true,
  allowUnionTypes: false
}));
const validators = new Map<string, ValidateFunction>(
  Object.entries(GENERATED_RUNTIME_RECORD_SCHEMAS).map(([type, schema]) => [
    type,
    ajv.compile(schema)
  ])
);

export function getRuntimeRecordSchemas(): Readonly<Record<string, Record<string, unknown>>> {
  return structuredClone(GENERATED_RUNTIME_RECORD_SCHEMAS);
}

export function validateRuntimeRecord(value: unknown): RuntimeRecordValidationResult {
  if (!isObject(value) || typeof value.type !== "string") {
    return invalid("runtime_record_type_missing", "Runtime records require a string type.");
  }
  const recordType = value.type;
  const validator = validators.get(recordType);
  if (!validator) {
    return invalid(
      "runtime_record_type_unknown",
      `${recordType} is not a standard runtime record type.`
    );
  }
  if (validator(value)) {
    return {
      valid: true,
      diagnostics: [],
      schema: RUNTIME_RECORD_CONTRACTS[recordType as RuntimeRecordType]
    };
  }
  return {
    valid: false,
    schema: RUNTIME_RECORD_CONTRACTS[recordType as RuntimeRecordType],
    diagnostics: (validator.errors ?? []).map(schemaDiagnostic)
  };
}

function schemaDiagnostic(error: ErrorObject): RuntimeDiagnostic {
  return {
    severity: "error",
    code: `schema_${error.keyword}`,
    message: `${error.instancePath || "/"} ${error.message ?? error.keyword}`,
    path: error.instancePath || "/",
    details: error.params
  };
}

function invalid(code: string, message: string): RuntimeRecordValidationResult {
  return {
    valid: false,
    diagnostics: [{ severity: "error", code, message }]
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
