import { basename, dirname, extname } from "node:path/posix";
import { isPlainObject, type MarkdownRecord } from "./markdown.js";

export interface BuildRecordActivationOptions {
  readDefaults?: Record<string, unknown>;
  /** Top-level fields that every matched schema declares `format: date-time`. */
  dateTimeFields?: Iterable<string>;
  includeBody?: boolean;
}

export interface BuildWorkflowActivationOptions {
  event?: Record<string, unknown>;
  steps?: Record<string, unknown>;
  vars?: Record<string, unknown>;
  item?: unknown;
}

export interface MdbaseFileActivation {
  path: string;
  name: string;
  basename: string;
  ext: string;
  folder: string;
  body?: string;
  tags: string[];
  links: string[];
  embeds: string[];
}

export interface RecordActivation {
  [key: string]: unknown;
  raw: Record<string, unknown>;
  record: Record<string, unknown>;
  file: MdbaseFileActivation;
}

export interface WorkflowActivation {
  event?: Record<string, unknown>;
  steps: Record<string, unknown>;
  vars: Record<string, unknown>;
  item?: unknown;
}

/** System names that frontmatter fields never shadow (Chapter 10). */
export const RESERVED_NAMES = new Set([
  "record",
  "raw",
  "file",
  "projection",
  "this",
  "values",
  "old",
  "operation",
  "event",
  "workflow",
  "trigger",
  "steps",
  "vars",
  "item"
]);

export function buildRecordActivation(
  record: MarkdownRecord,
  options: BuildRecordActivationOptions = {}
): RecordActivation {
  const dateTimeFields = new Set(options.dateTimeFields ?? []);
  const raw = typeFields(cloneObject(record.frontmatter), dateTimeFields);
  const effective = typeFields(applyReadDefaults(record.frontmatter, options.readDefaults ?? {}), dateTimeFields);
  const topLevel: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(effective)) {
    if (!RESERVED_NAMES.has(key)) {
      topLevel[key] = value;
    }
  }
  return {
    ...topLevel,
    raw,
    record: effective,
    file: buildFileActivation(record, options)
  };
}

export function buildWorkflowActivation(options: BuildWorkflowActivationOptions): WorkflowActivation {
  return {
    event: options.event,
    steps: options.steps ?? {},
    vars: options.vars ?? {},
    ...(Object.prototype.hasOwnProperty.call(options, "item") ? { item: options.item } : {})
  };
}

/**
 * Wrap a record activation so that an unreserved top-level identifier naming a
 * missing field evaluates to null, while map selection keeps CEL's no-such-key
 * behavior.
 */
export function withMissingFieldsAsNull(activation: Record<string, unknown>): Record<string, unknown> {
  return new Proxy(activation, {
    get(target, key) {
      if (typeof key !== "string" || Object.prototype.hasOwnProperty.call(target, key)) {
        return Reflect.get(target, key);
      }
      return RESERVED_NAMES.has(key) ? undefined : null;
    }
  });
}

export function evaluateTemplate(
  value: unknown,
  activation: Record<string, unknown>,
  evaluate: (expr: string, activation: Record<string, unknown>) => unknown
): unknown {
  if (isExpressionObject(value)) {
    return evaluate(value.$expr, activation);
  }
  if (Array.isArray(value)) {
    return value.map((item) => evaluateTemplate(item, activation, evaluate));
  }
  if (isPlainObject(value)) {
    const result: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value)) {
      result[key] = evaluateTemplate(child, activation, evaluate);
    }
    return result;
  }
  return value;
}

export function applyReadDefaults(raw: Record<string, unknown>, readDefaults: Record<string, unknown>): Record<string, unknown> {
  const effective = cloneObject(raw);
  for (const [key, value] of Object.entries(readDefaults)) {
    if (!Object.prototype.hasOwnProperty.call(effective, key)) {
      effective[key] = value;
    }
  }
  return effective;
}

export function buildFileActivation(
  record: MarkdownRecord,
  options: BuildRecordActivationOptions = {}
): MdbaseFileActivation {
  const name = basename(record.path);
  const ext = extname(name).replace(/^\./, "");
  const base = ext ? name.slice(0, -(ext.length + 1)) : name;
  const folder = dirname(record.path) === "." ? "" : dirname(record.path);
  const body = options.includeBody === false ? undefined : record.body;
  return {
    path: record.path,
    name,
    basename: base,
    ext,
    folder,
    ...(body === undefined ? {} : { body }),
    tags: extractTags(record.frontmatter, record.body),
    links: [],
    embeds: []
  };
}

export function extractTags(frontmatter: Record<string, unknown>, body: string): string[] {
  const tags = new Set<string>();
  const frontmatterTags = frontmatter.tags;
  if (typeof frontmatterTags === "string") {
    tags.add(normalizeTag(frontmatterTags));
  } else if (Array.isArray(frontmatterTags)) {
    for (const tag of frontmatterTags) {
      if (typeof tag === "string") {
        tags.add(normalizeTag(tag));
      }
    }
  }

  for (const tag of extractBodyTags(body)) {
    tags.add(tag);
  }

  return [...tags].filter(Boolean).sort();
}

export function extractBodyTags(body: string): string[] {
  const tags = new Set<string>();
  const withoutCodeBlocks = body.replace(/```[\s\S]*?```/g, "");
  const pattern = /(^|\s)#([A-Za-z0-9_/-]+)/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(withoutCodeBlocks))) {
    tags.add(match[2]);
  }
  return [...tags];
}

export function hasTag(tags: readonly string[], query: string): boolean {
  const normalized = normalizeTag(query);
  return tags.some((tag) => tag === normalized || tag.startsWith(`${normalized}/`));
}

export function inFolder(fileFolder: string, query: string): boolean {
  const normalizedFolder = trimSlashes(fileFolder);
  const normalizedQuery = trimSlashes(query);
  return normalizedFolder === normalizedQuery || normalizedFolder.startsWith(`${normalizedQuery}/`);
}

/** Convert `format: date-time` strings to timestamps; other values are unchanged. */
function typeFields(fields: Record<string, unknown>, dateTimeFields: ReadonlySet<string>): Record<string, unknown> {
  const typed = cloneObject(fields);
  for (const field of dateTimeFields) {
    const value = typed[field];
    if (typeof value === "string") {
      const instant = new Date(value);
      if (!Number.isNaN(instant.getTime()) && /(?:Z|[+-]\d{2}:\d{2})$/i.test(value)) {
        typed[field] = instant;
      }
    }
  }
  return typed;
}

function cloneObject(value: Record<string, unknown>): Record<string, unknown> {
  return { ...value };
}

function normalizeTag(tag: string): string {
  return tag.replace(/^#/, "");
}

function trimSlashes(value: string): string {
  return value.replace(/^\/+|\/+$/g, "");
}

function isExpressionObject(value: unknown): value is { $expr: string } {
  return isPlainObject(value) && typeof value.$expr === "string" && Object.keys(value).length === 1;
}
