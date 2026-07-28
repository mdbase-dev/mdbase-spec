# 05. Type Files

## Purpose

A type file connects three parts of the mdbase model:

- a rule for selecting records
- a JSON Schema for validating their persisted frontmatter
- collection behavior such as defaults, links, lifecycle assignments, and path
  policy
- portable data-contract implementations

The YAML frontmatter is the machine-readable definition. The Markdown body can
document the type for people and tools.

## Minimal Type

```markdown
---
kind: mdbase.type
name: task
version: 1

match:
  path_glob: "tasks/**/*.md"

schema:
  dialect: json-schema-2020-12
  value:
    $schema: "https://json-schema.org/draft/2020-12/schema"
    type: object
    required: [title]
    additionalProperties: false
    properties:
      type:
        const: task
      title:
        type: string
        minLength: 1
---

# Task

Task records live under `tasks/`.
```

## Type Evaluation Model

Type processing has a collection-load phase and a record-evaluation phase.

During collection load, an implementation:

1. discovers candidate type files under the configured types folder
2. validates each file against the built-in type-file schema
3. canonicalizes type names for lookup and detects name conflicts
4. resolves the embedded or referenced JSON Schema
5. validates and compiles that schema against the v0.3 JSON Schema profile
6. resolves and validates every `implements` entry against the local data
   contract registry

Each valid definition then enters the collection's type registry. Diagnostics
for an invalid definition identify the type-file path and the failing section.

For each record, an implementation:

1. parses the record path and raw persisted frontmatter
2. determines its matched types using Chapter 07
3. validates the raw frontmatter against every matched JSON Schema
4. evaluates every matched type's collection validators
5. constructs effective read values, including compatible read defaults and
   projections supported by the implementation

Type selection and record validation are separate operations. An explicit type
declaration selects a type and still subjects the record to that type's schema
and collection rules.

Write operations use the same model around lifecycle processing: determine
membership from the requested draft, run the applicable lifecycle assignments,
then confirm membership once before final validation. The complete write order
is defined in Chapters 09 and 12.

## Required Frontmatter

A type file MUST include:

- `kind: mdbase.type`
- `name`
- `schema`

`version` SHOULD be present and SHOULD be a positive integer.

## Type Names

Type names are stable identifiers. They SHOULD use lower-case ASCII names with
letters, numbers, `_`, and `-`.

Tools MUST compare type names case-insensitively for matching and conflict
detection. Displays SHOULD preserve the casing written by the author.

Two type files whose names differ only by case are conflicting definitions.

## Schema Section

`schema.dialect` identifies the schema profile. v0.3 core defines:

```yaml
schema:
  dialect: json-schema-2020-12
```

The schema can be embedded:

```yaml
schema:
  dialect: json-schema-2020-12
  value:
    type: object
    properties:
      title: { type: string }
```

or referenced:

```yaml
schema:
  dialect: json-schema-2020-12
  ref: "../schemas/task.schema.json"
```

External references resolve relative to the type-file path. Resolution MUST
remain within the collection or installed pack root that owns the schema.

Exactly one of `value` and `ref` is required. A type containing both is invalid.

The JSON Schema validates raw persisted frontmatter. Read defaults,
projections, and lifecycle values enter at the stages defined by their own
chapters.

## mdbase Sections

The following top-level sections are defined by v0.3:

| Section | Purpose |
| --- | --- |
| `match` | select records for inferred type membership |
| `collection` | define Markdown-aware collection semantics |
| `lifecycle` | assign managed values during mutations |
| `runtime` | attach runtime annotations to the type |
| `migrations` | declare explicit type-version migration steps |
| `implements` | declare exact, schema-validated data contract implementations |

Portable type-file validation accepts the core sections and `x-*` extension
sections. Domain and provider metadata belongs under an extension name:

```yaml
x-local:
  owner: research-team
```

This naming rule lets the type-file schema diagnose misspelled core keys such as
`collecton`.

Portable interoperability metadata does not belong under `x-*`. It uses the
first-class `implements` section defined in Chapter 05A:

```yaml
implements:
  - contract: example.task
    version: 1.0.0
    fields:
      title: title
      status: status
```

## Meta Type

Implementations MUST have a built-in schema for validating v0.3 type files.

`init` or equivalent tooling SHOULD materialize `_types/meta.md` for inspection.
That file is itself a v0.3 type file matching `_types/**/*.md` and validating
type-file frontmatter against the v0.3 type-file JSON Schema.

The built-in schema is authoritative during bootstrap. A materialized
`_types/meta.md` mirrors and documents that behavior.

## View Type

Saved views use the ordinary `view` type defined by
`schemas/v0.3/view.schema.json`. A collection that stores portable view records
SHOULD materialize `_types/view.md` with `match.where.type: view` and a local
reference to that schema. The repository's `_types/view.md` is the canonical
materialization.

Unlike the meta type, the view type is not required for bootstrap and is not a
built-in control-file category. A view file remains an ordinary Markdown record
and participates in normal reads, validation, links, writes, and type matching.
View-aware execution is the optional behavior defined in Chapter 11.

## Type Membership

Records may select types explicitly or through inferred matching. Chapter 07
defines the decision process, the structured match language, and the optional
CEL Match profile.

Matched type order is deterministic:

- explicit declarations retain declaration order after case-insensitive
  de-duplication
- inferred matches are ordered by canonical lower-case type name

## Multiple Matched Types

If a record matches several types, the implementation validates it independently
against every matched type schema and collection validator. The record is valid
only when all of those validations pass.

Collection behavior composes as follows:

- uniqueness rules are additive and are each evaluated in the type that
  declared them
- identical read defaults, link rules, path policies, lifecycle assignments,
  and projections coalesce
- different values for the same read-default field, link selector, path policy,
  lifecycle event and field, or projection name produce `type_conflict`
- display metadata remains associated with its declaring type; a flattened
  display uses the first explicit type or first canonical inferred type

Implementations MUST detect these conflicts before applying the affected
behavior. A write fails before mutation. A read or query reports the conflict
and leaves the conflicted derived value unavailable. The result is independent
of filesystem load order.

For a uniqueness rule with `scope: type`, the comparison set contains every
record that matches the declaring type. A record matching several types
participates independently in each declaring type's uniqueness set.

## Write-Time Type Membership

Write operations determine membership from the requested draft and target path
before lifecycle runs. Explicit declarations use the same precedence as reads.

After lifecycle has run, the implementation MUST evaluate membership once more.
If the final membership differs from the pre-lifecycle membership, the operation
fails with `type_membership_changed`. Lifecycle is applied once per operation.

An operation that changes membership intentionally expresses that change in its
input patch, target path, or explicit type list.

## Reusable Schema Composition

Reusable record shapes use JSON Schema `$defs`, `$ref`, `allOf`, `anyOf`, and
`oneOf`. Reusable collection behavior can be generated or supplied by a named
pack or extension.

## Display Metadata

Human-facing metadata belongs in `collection.display`:

```yaml
collection:
  display:
    name_field: title
    icon: check-circle
```

JSON Schema `title` and `description` remain schema annotations.
`collection.display` supplies the collection-specific presentation hints.
