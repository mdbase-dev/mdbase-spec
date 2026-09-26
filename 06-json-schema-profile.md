# 06. JSON Schema Profile

## Base Dialect

v0.3 uses JSON Schema 2020-12 for persisted frontmatter shape.

Every embedded schema SHOULD include:

```yaml
$schema: "https://json-schema.org/draft/2020-12/schema"
```

The containing type file MUST declare:

```yaml
schema:
  dialect: json-schema-2020-12
```

## Data Model

YAML frontmatter is converted into the JSON data model before schema
validation:

- mapping -> object
- sequence -> array
- string -> string
- integer/float -> number, with integer constraints enforced by JSON Schema
- boolean -> boolean
- null -> null

Values that cannot be represented in the JSON data model MUST be rejected or
normalized by the mdbase YAML profile before JSON Schema validation.

## Required Support

Core v0.3 JSON Schema support includes:

- `type`
- `required`
- `properties`
- `additionalProperties`
- `items`
- `enum`
- `const`
- `oneOf`
- `anyOf`
- `allOf`
- `if`, `then`, `else`
- `minimum`, `maximum`
- `exclusiveMinimum`, `exclusiveMaximum`
- `multipleOf`
- `minLength`, `maxLength`
- `pattern`
- `minItems`, `maxItems`, `uniqueItems`
- `$defs`
- local `$ref`
- `title`, `description`, `default`, `examples`, and other annotations

Tools MAY support more of JSON Schema 2020-12. The required profile defines the
portable baseline for Core Read conformance.

## Discriminated Unions

v0.3 uses ordinary JSON Schema constructs for discriminated unions.

Example:

```yaml
type: object
required: [kind, input]
oneOf:
  - properties:
      kind: { const: notice.show }
      input:
        type: object
        required: [message]
        properties:
          message: { type: string }
        additionalProperties: false
    required: [kind, input]
  - properties:
      kind: { const: mdbase.record.patch }
      input:
        type: object
        required: [path, patch]
        properties:
          path: { type: string }
          patch: { type: object }
        additionalProperties: false
    required: [kind, input]
```

Runtime workflow steps normally use `step.action` plus action contracts instead
of embedding every action union directly in the workflow schema.

## Defaults

JSON Schema `default` is an annotation. Record mutation occurs through create,
lifecycle, or explicit default materialization, and `required` evaluates the raw
record during validation.

Tools MAY use `default` as a create/editor hint.

Effective read defaults belong in `collection.read_defaults`.

Dynamic defaults such as `now`, `uuid`, `ulid`, and `slugify` belong in
`lifecycle`.

## Format

JSON Schema `format` is an annotation in the base dialect. The mdbase v0.3
profile requires assertion behavior for:

- `format: date`
- `format: date-time`
- `format: time`

`date`, `time`, and `date-time` use the RFC 3339 productions referenced by JSON
Schema. `date-time` values MUST contain `Z` or a numeric UTC offset. Invalid
values produce `format_invalid` diagnostics.

Other formats such as `email`, `uri`, and `uuid` MAY be asserted by
implementations. Collections that require them depend on implementation-specific
behavior until a conformance profile defines their semantics.

## References

Tools MUST support fragment-only `$ref` references within an embedded schema.
They MUST also support a type wrapper's `schema.ref` to a local JSON file.

The base URI for `schema.ref` is the directory containing the type file. The
resolved file MUST remain inside the collection root or inside the installed
pack root that supplied the type. Symlinks are resolved before this boundary
check. Escapes produce `schema_ref_forbidden`.

Nested file-to-file `$ref` references use the optional feature identifier
`external_schema_refs`. An implementation supporting the feature lists it under
`optional_features` in its claim document. Such references use the containing
schema document as their base URI, obey the same owning-root boundary, detect
cycles, and produce `schema_ref_unresolved` or `schema_ref_cycle` diagnostics.
Implementations that do not support the feature report `unsupported_feature`
before invoking a resolver.

Core tools MUST NOT fetch network references during collection validation.
Canonical `https://mdbase.dev/schemas/...` identifiers resolve only from the
tool's bundled schema registry. Other HTTP(S) references are
`schema_ref_forbidden` unless a non-portable extension explicitly enables them.

An embedded `$id` changes JSON Schema identifier resolution. The owning-root and
network boundaries continue to apply.

## Canonical Schema Identity

Normative mdbase schemas have stable `$id` values under:

```text
https://mdbase.dev/schemas/v0.3/
```

Companion profile schemas use their independently versioned namespaces:

```text
https://mdbase.dev/schemas/interop/v0.1/
https://mdbase.dev/schemas/runtime/v0.2/
```

Implementations MUST validate against the canonical schema contents associated
with the exact declared spec/profile version. `latest` aliases are unsuitable
for validation.

## Validation Result

JSON Schema validation errors are reported as mdbase validation issues. Each
issue SHOULD include:

- path to the record
- JSON pointer or field path
- code
- severity
- message
- type name
- schema location when available

Tools SHOULD preserve native JSON Schema diagnostic detail when exposing
machine-readable results.

JSON Schema validation diagnostics use `schema_<keyword>`, where the JSON
Schema keyword is converted to lower snake_case. For example, `required`
produces `schema_required`, `additionalProperties` produces
`schema_additional_properties`, and `unevaluatedProperties` produces
`schema_unevaluated_properties`. Implementations MUST NOT place camelCase JSON
Schema keyword names into the canonical diagnostic `code` field.

## Additional Properties

Strictness is expressed with JSON Schema `additionalProperties`.

```yaml
additionalProperties: false
```

A type that persists configured explicit keys such as `type` and `types` MUST
include them in its JSON Schema.
