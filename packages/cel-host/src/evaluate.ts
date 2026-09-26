import { Environment } from "@marcbachmann/cel-js";
import { evaluateTemplate, hasTag, inFolder, withMissingFieldsAsNull } from "./activation.js";
import {
  addDays,
  addMonths,
  addYears,
  dateOfInstant,
  daysUntil,
  isoWeekday,
  parseFullDate,
  startOfDay
} from "./dates.js";

export interface CelDiagnostic {
  code: string;
  message: string;
}

export interface CelEvaluationResult {
  valid: boolean;
  value: unknown;
  diagnostics: CelDiagnostic[];
}

export interface EvaluateCelOptions {
  /** IANA timezone used by `today()`, `date(timestamp)`, and `startOfDay()`. */
  timezone?: string;
  /** The operation's captured current instant. */
  now?: Date;
}

interface Clock {
  now: Date;
  timezone: string;
}

// Functions read the active clock; evaluation is synchronous, so a module-level
// slot scoped by evaluateCel is sufficient.
let activeClock: Clock | undefined;

function clock(): Clock {
  if (!activeClock) {
    throw new Error("no evaluation clock is active");
  }
  return activeClock;
}

function integer(value: bigint): number {
  return Number(value);
}

const environment = new Environment({
  unlistedVariablesAreDyn: true,
  enableOptionalTypes: true,
  homogeneousAggregateLiterals: false,
  limits: { maxDepth: 100 }
})
  .registerFunction("now(): google.protobuf.Timestamp", () => new Date(clock().now.getTime()))
  .registerFunction("today(): string", () => dateOfInstant(clock().now, clock().timezone))
  .registerFunction("date(string): string", (value: string) => (parseFullDate(value), value))
  .registerFunction("date(google.protobuf.Timestamp): string", (value: Date) =>
    dateOfInstant(value, clock().timezone)
  )
  .registerFunction("startOfDay(string): google.protobuf.Timestamp", (value: string) =>
    startOfDay(value, clock().timezone)
  )
  .registerFunction("string.addDays(int): string", (value: string, days: bigint) => addDays(value, integer(days)))
  .registerFunction("string.addMonths(int): string", (value: string, months: bigint) =>
    addMonths(value, integer(months))
  )
  .registerFunction("string.addYears(int): string", (value: string, years: bigint) =>
    addYears(value, integer(years))
  )
  .registerFunction("string.daysUntil(string): int", (value: string, other: string) =>
    BigInt(daysUntil(value, other))
  )
  .registerFunction("string.year(): int", (value: string) => BigInt(parseFullDate(value).year))
  .registerFunction("string.month(): int", (value: string) => BigInt(parseFullDate(value).month))
  .registerFunction("string.day(): int", (value: string) => BigInt(parseFullDate(value).day))
  .registerFunction("string.dayOfWeek(): int", (value: string) => BigInt(isoWeekday(value)))
  .registerFunction("map.inFolder(string): bool", (file: Record<string, unknown>, folder: string) =>
    typeof file.folder === "string" && inFolder(file.folder, folder)
  )
  .registerFunction("map.hasTag(string): bool", (file: Record<string, unknown>, tag: string) =>
    Array.isArray(file.tags) && hasTag(file.tags.filter((item): item is string => typeof item === "string"), tag)
  );

export function evaluateCel(
  expression: string,
  activation: Record<string, unknown>,
  options: EvaluateCelOptions = {}
): CelEvaluationResult {
  let program: ReturnType<typeof environment.parse>;
  try {
    program = environment.parse(expression);
  } catch (error) {
    return {
      valid: false,
      value: null,
      diagnostics: [{ code: "expression_compile_error", message: messageOf(error) }]
    };
  }

  const previous = activeClock;
  activeClock = { now: options.now ?? new Date(), timezone: options.timezone ?? "UTC" };
  try {
    const value = program(withMissingFieldsAsNull(activation));
    return { valid: true, value: normalizeCelValue(value), diagnostics: [] };
  } catch (error) {
    // Chapter 10: a top-level evaluation error in a query or projection value
    // yields null for that value plus a diagnostic.
    return {
      valid: true,
      value: null,
      diagnostics: [{ code: "expression_evaluation_error", message: messageOf(error) }]
    };
  } finally {
    activeClock = previous;
  }
}

export function evaluateExpressionValueTemplate(
  value: unknown,
  activation: Record<string, unknown>,
  options: EvaluateCelOptions = {}
): unknown {
  return evaluateTemplate(value, activation, (expr, nestedActivation) =>
    evaluateCel(expr, nestedActivation, options).value
  );
}

/** Serialize a CEL result using the Chapter 10 serialization rules. */
export function normalizeCelValue(value: unknown): unknown {
  if (typeof value === "bigint") {
    const asNumber = Number(value);
    return Number.isSafeInteger(asNumber) ? asNumber : value.toString();
  }
  if (value instanceof Date) {
    return value.toISOString().replace(/\.000Z$/, "Z");
  }
  if (isDuration(value)) {
    return String(value);
  }
  if (Array.isArray(value)) {
    return value.map((item) => normalizeCelValue(item));
  }
  if (value instanceof Map) {
    const result: Record<string, unknown> = {};
    for (const [key, child] of value.entries()) {
      result[String(key)] = normalizeCelValue(child);
    }
    return result;
  }
  if (value !== null && typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value)) {
      result[key] = normalizeCelValue(child);
    }
    return result;
  }
  return value;
}

function isDuration(value: unknown): boolean {
  return (
    value !== null &&
    typeof value === "object" &&
    "seconds" in value &&
    "nanos" in value &&
    value.constructor?.name === "Duration"
  );
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message.split("\n")[0] : String(error);
}
