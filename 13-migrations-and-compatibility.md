# 13. Migrations And Compatibility

## Migration Philosophy

v0.3 uses the source model defined by Chapters 01–12. Migration translates
v0.2.x collections into that model and reports features that need adapter-owned
handling.

Migration tooling should produce:

- a readable diff
- a machine-readable report
- explicit unsupported-feature notes
- generated output only with user approval or generated-file detection

Migration analyzes the complete collection. Before a write, tooling MUST
validate every existing record against the proposed target types and include
incompatible records in the report.

## Type Mapping

| v0.2.x feature | v0.3 destination |
| --- | --- |
| `fields` | JSON Schema `properties` |
| field `required` | JSON Schema root `required` |
| `type: string` | `{ type: "string" }` |
| `type: integer` | `{ type: "integer" }` |
| `type: number` | `{ type: "number" }` |
| `type: boolean` | `{ type: "boolean" }` |
| `type: date` | `{ type: "string", format: "date" }` |
| `type: datetime` | `{ type: "string", format: "date-time" }` |
| `type: time` | `{ type: "string", format: "time" }` |
| `type: enum`, `values` | JSON Schema `enum` |
| `type: list` | JSON Schema `array` |
| `type: object` | JSON Schema `object` |
| `type: link` | JSON Schema string/array plus `collection.links` |
| `default` | JSON Schema `default` and/or `collection.read_defaults` |
| `strict` | `additionalProperties` |
| `unique` | `collection.unique` |
| `generated` | `lifecycle` |
| `computed` | query projection, collection projection, or workflow |
| `path_pattern` | `collection.path.pattern` |
| `display_name_key` | `collection.display.name_field` |
| `extends` | JSON Schema `$ref`/`allOf` or explicit duplication |

## Defaults

Migration should distinguish:

- creation/editor hints: JSON Schema `default`
- effective read/query defaults: `collection.read_defaults`
- dynamic values: `lifecycle`

For current mdbase field defaults, the safest migration is to emit both JSON
Schema `default` and `collection.read_defaults` for static scalar defaults, with
a report explaining the difference.

## Generated Fields

Generated fields migrate to lifecycle. v0.2 generated values apply only when the
field is missing, while lifecycle `set` always assigns, so migration adds a
`!has(raw.field)` guard to preserve that rule:

| v0.2.x generated | v0.3 lifecycle |
| --- | --- |
| `now` | `on_create: [{ if: '!has(raw.field)', set: { field: { now: true } } }]` |
| `now_on_write` | unguarded `on_create` and `on_update` actions setting `{ now: true }` |
| `uuid` | guarded `on_create` action setting `{ uuid: true }` |
| `ulid` | guarded `on_create` action setting `{ ulid: true }` |
| `slugify from field` | guarded `on_create` action setting `{ slugify: source }` |
| `from field` without a transform | guarded `on_create` action setting `{ copy: source }` |

## Computed Fields

Computed fields migrate to one of:

- query projection suggestion
- `collection.projections` when the target tool supports it
- workflow/runtime policy when the computed value should be materialized
- unsupported note when the computation has side effects or depends on
  non-portable functions

## Expressions

Current mdbase expressions migrate to CEL where possible.

Tool-specific expression dialects are adapter concerns. Tools may translate
them to CEL for portable storage and translate them back for user interfaces or
exports.

## Runtime Workflows

Current generated-field and tool-conforming behavior that causes mutation
should be reviewed as lifecycle or workflow behavior.

Generated IDs and timestamps usually become lifecycle.

Cross-record behavior, agent work, approval flows, external APIs, and scheduled
checks become workflows and action/event contracts.

## Data Contract Implementations

Portable application interfaces migrate to a local data contract plus a
type-local `implements` entry.

Example:

```yaml
implements:
  - contract: example.task
    version: 1.0.0
    fields:
      status: status
    binding:
      completed_values: [done, cancelled]
```

The migration bundle MUST include the exact `mdbase.contract` artifact required
by the implementation. Existing convention-based `x-*` objects do not become
contracts merely because they contain keys named `contract` or `version`.

Private annotations with no portable contract meaning remain under a
namespaced `x-*` section. They SHOULD NOT become JSON Schema custom keywords.

## Version Detection

A v0.2.x type file usually has `name` and `fields` without `kind:
mdbase.type`.

A v0.3 type file has `kind: mdbase.type` and `schema`.

Migration tooling SHOULD refuse ambiguous files unless the user supplies an
explicit source version.

## Safe Migration Protocol

A conforming migration command has separate analyze and apply phases:

1. discover source config, type files, extension metadata, and records
2. generate proposed config/types without modifying the collection
3. validate generated schemas and type files
4. validate all existing records against the proposed target
5. emit a human-readable diff and machine-readable report
6. require explicit approval unless every target is recognized as generated
7. create a backup manifest containing hashes and original paths
8. write through temporary files and atomic renames where supported
9. re-open and validate the migrated collection

Apply MUST abort before writes when analysis has unsupported features or invalid
target records unless the caller explicitly selects a documented partial mode.
A failed apply restores files from the backup manifest when restoration is
possible and reports any paths requiring manual recovery.

Apply SHOULD durably journal the currently attempted path and completed paths
inside the backup before each replacement. Tooling MUST provide a recovery path
that can resume or restore an interrupted apply. Restoration MUST validate the
backup hashes from the manifest before replacing current files and MUST require
explicit approval when invoked as a separate command.

Repeated analysis of unchanged inputs MUST produce the same report. Re-applying
an already migrated type MUST fail without writing.

Unknown source metadata is preserved under `x-legacy-v0.2` with its original
key paths unless a named migration adapter handles it. YAML comments and style
preservation are best effort. Markdown bodies MUST be preserved byte for byte.

The report includes source and target hashes, generated-file evidence, exact
mappings, warnings, unsupported constructs, invalid record paths, proposed file
operations, backup location, and post-apply validation status.
