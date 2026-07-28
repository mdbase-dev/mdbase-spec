import type { Ajv2020, ValidateFunction } from "ajv/dist/2020.js";
import type {
  ActionContractArtifact,
  ContractArtifact,
  EventContractArtifact,
  ExactContractReference,
  InlineSchema,
  SchemaWrapper
} from "./types.js";
import { InteropError } from "./errors.js";
import { formatSchemaErrors } from "./schemas.js";

export function resolvedSchema(wrapper: SchemaWrapper, label: string): Record<string, unknown> {
  if (!("value" in wrapper)) {
    throw new InteropError(
      "contract_digest_conflict",
      `${label} must be resolved to an inline JSON Schema before runtime registration.`
    );
  }
  return structuredClone(wrapper.value);
}

export function contractDigestInput(artifact: ContractArtifact): Record<string, unknown> {
  const base: Record<string, unknown> = {
    kind: artifact.kind,
    contract_type: artifact.contract_type,
    id: artifact.id,
    version: artifact.version
  };
  switch (artifact.contract_type) {
    case "record":
      base.record_schema = resolvedSchema(artifact.record_schema, "record_schema");
      if (artifact.binding_schema) {
        base.binding_schema = resolvedSchema(artifact.binding_schema, "binding_schema");
      }
      break;
    case "event":
      base.data_schema = resolvedSchema(artifact.data_schema, "data_schema");
      if (artifact.source_schema) {
        base.source_schema = resolvedSchema(artifact.source_schema, "source_schema");
      }
      break;
    case "action":
      base.input_schema = resolvedSchema(artifact.input_schema, "input_schema");
      if (artifact.output_schema) {
        base.output_schema = resolvedSchema(artifact.output_schema, "output_schema");
      }
      if (artifact.error_schema) {
        base.error_schema = resolvedSchema(artifact.error_schema, "error_schema");
      }
      if (artifact.provider_schema) {
        base.provider_schema = resolvedSchema(artifact.provider_schema, "provider_schema");
      }
      if (artifact.behavior) base.behavior = structuredClone(artifact.behavior);
      break;
  }
  return base;
}

export async function contractDigest(artifact: ContractArtifact): Promise<string> {
  return portableDigest(contractDigestInput(artifact));
}

export async function portableDigest(value: unknown): Promise<string> {
  return `sha256:${await sha256(canonicalize(value))}`;
}

export async function exactContractReference(
  artifact: ContractArtifact
): Promise<ExactContractReference> {
  return {
    id: artifact.id,
    version: artifact.version,
    digest: await contractDigest(artifact)
  };
}

export function compileEventValidators(
  ajv: Ajv2020,
  artifact: EventContractArtifact
): {
  data: ValidateFunction;
  source?: ValidateFunction;
} {
  return {
    data: compileSchema(ajv, artifact.data_schema, `${artifact.id} data_schema`),
    ...(artifact.source_schema
      ? { source: compileSchema(ajv, artifact.source_schema, `${artifact.id} source_schema`) }
      : {})
  };
}

export function compileActionValidators(
  ajv: Ajv2020,
  artifact: ActionContractArtifact
): {
  input: ValidateFunction;
  output?: ValidateFunction;
  error?: ValidateFunction;
  provider?: ValidateFunction;
} {
  return {
    input: compileSchema(ajv, artifact.input_schema, `${artifact.id} input_schema`),
    ...(artifact.output_schema
      ? { output: compileSchema(ajv, artifact.output_schema, `${artifact.id} output_schema`) }
      : {}),
    ...(artifact.error_schema
      ? { error: compileSchema(ajv, artifact.error_schema, `${artifact.id} error_schema`) }
      : {}),
    ...(artifact.provider_schema
      ? { provider: compileSchema(ajv, artifact.provider_schema, `${artifact.id} provider_schema`) }
      : {})
  };
}

export function assertSchemaValue(
  validator: ValidateFunction | undefined,
  value: unknown,
  code: "invalid_event_data" | "invalid_action_input" | "invalid_action_output",
  label: string
): void {
  if (!validator || validator(value)) return;
  throw new InteropError(code, `${label} failed JSON Schema validation: ${formatSchemaErrors(validator.errors)}`);
}

function compileSchema(
  ajv: Ajv2020,
  wrapper: SchemaWrapper,
  label: string
): ValidateFunction {
  try {
    return ajv.compile(resolvedSchema(wrapper, label));
  } catch (error) {
    throw new InteropError(
      "contract_digest_conflict",
      `${label} could not be compiled: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

export function inlineSchema(value: Record<string, unknown>): InlineSchema {
  return { dialect: "json-schema-2020-12", value };
}

function canonicalize(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, child]) => child !== undefined)
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0);
  return `{${entries.map(([key, child]) => `${JSON.stringify(key)}:${canonicalize(child)}`).join(",")}}`;
}

async function sha256(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
