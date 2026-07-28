# 15. Migrations And Compatibility

## Migration Philosophy

v0.3 uses the source model defined by Chapters 01–14. Migration translates
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

Generated fields migrate to lifecycle:

| v0.2.x generated | v0.3 lifecycle |
| --- | --- |
| `now` | `on_create.set.field: { now: true }` |
| `now_on_write` | `on_update.set.field: { now: true }` |
| `uuid` | `{ uuid: true }` |
| `ulid` | `{ ulid: true }` |
| `slugify from field` | `{ slugify: field }` |

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

## Obsidian Bases Views

Obsidian `.base` files are external saved-view sources. A collection provider
discovers configured sources and exposes them through the saved-view operations
in Chapter 12. Core Read continues to discover records through the collection's
record extensions.

Collections enable discovery with a namespaced configuration section:

```yaml
x-obsidian:
  bases:
    include:
      - TaskNotes/Views/**/*.base
    create_folder: TaskNotes/Views
    default_for_new_views: true
```

`include` contains collection-relative glob patterns. The provider MUST apply
the same path-boundary and symlink protections used for record discovery.
`create_folder` identifies the preferred location for new Obsidian sources.
`default_for_new_views` makes that source format the collection's default when
a view-creation interface offers no explicit format. Providers advertising
write support use these values when creating a source.

Write-capable providers validate the complete `.base` document before a
source operation commits it. They preserve unknown top-level keys, view keys,
property metadata, formulas, and presentation options supplied in the
document. A source editor can therefore modify the structures it understands
while round-tripping the remainder.

The `.base` file remains authoritative for a discovered Obsidian source.
`list_views` returns `source.format: obsidian.base`, a revision derived from the
source bytes, and a stable named-view ID for each contained view. Stable IDs are
derived deterministically from view names when the source format supplies no
ID. Collisions receive deterministic source-order suffixes.

The structural mapping is:

| Obsidian Bases | mdbase view record |
| --- | --- |
| global `filters` | `query.where` |
| view `filters` | named-view `where`, combined with the shared filter |
| `formulas` | `query.projections` |
| `formula.name` | `projection.name` |
| `properties` | property metadata |
| view `order` | `select` order |
| view `sort` | `order_by` |
| `groupBy` | `group_by` |
| custom and property summaries | `summary_functions` and `summaries` |
| view `type` | `presentation.type` |
| plugin view keys | presentation options or `x-*` extension data |

Executing an Obsidian source evaluates its filters and formulas with Obsidian
Bases expression semantics. The adapter parses the source dialect into an
inspectable syntax tree and applies the source dialect's value coercion, date,
link, file, formula, and error behavior. Translation to canonical CEL is an
export operation and succeeds only when behavior is preserved. Translation
diagnostics identify unsupported expressions, functions, coercions, or
renderer features. Lossless source and round-trip metadata may be retained
under `x-obsidian`.

Execution returns the headless result envelope from Chapter 12. Selected and
presentation-mapped values appear under each row's `values`; renderer metadata
may approximate layout while retaining the source's filtering, formula,
ordering, grouping, and pagination semantics.

Obsidian placement state maps to the portable invocation context rather than to
query semantics: opening a Base directly supplies the view definition, an
embed supplies its embedding record, and an active-file interface supplies its
active record. The adapter resolves that host state into an explicit invocation
context before calling the query or view executor.

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
