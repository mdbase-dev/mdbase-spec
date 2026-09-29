# Obsidian Bases Adapter

## Purpose

This companion document defines how an mdbase collection provider exposes
Obsidian `.base` files as saved-view sources. It builds on the saved-view model
in [Querying](../11-querying.md) and the saved-view operations in
[Operations](../12-operations.md). Implementations that do not advertise the
`obsidian_bases_views` optional feature ignore `.base` files and the
`x-obsidian` configuration section.

## Bases as records

A collection that lists `base` in `settings.record_extensions` stores each
`.base` file as a YAML document record (Chapter 03). A Base is a saved-view
source when its matched type implements the `obsidian.base` record contract
(`_contracts/obsidian.base/1.0.0.md`), exactly as a canonical view is one when
its type implements `mdbase.view`:

```yaml
kind: mdbase.type
name: obsidian_base
version: 1
match: { path_glob: 'TaskNotes/Views/**/*.base' }
implements:
  - contract: obsidian.base
    version: 1.0.0
    fields: { filters: filters, formulas: formulas, properties: properties, views: views }
```

`list_views` discovers such records alongside `mdbase.view` records and reports
`source.format: obsidian.base`. `execute_view` selects the evaluator from the
contract the record's type implements: the Query profile for `mdbase.view`, the
Obsidian Bases dialect below for `obsidian.base`. A Base is created, replaced,
renamed, and deleted with the ordinary record operations under ordinary record
grants. Because Obsidian owns the format, writers SHOULD replace a Base with a
whole-document `update` so comments and layout survive; structured patches
remain valid but re-emit the YAML.

The type's path match replaces `x-obsidian.bases.include`, which remains
defined below for collections that do not list `base` as a record extension.
Sources discovered that way are not records: they are listed and executed but
report `source.writable: false`, and changes to them are reported as
`view_changed`. Configured discovery is transitional and no new consumer should
adopt it; it is removed, with `view_changed`, once collections have adopted
Bases as records.

## Sources

Obsidian `.base` files are external saved-view sources. A collection provider
discovers configured sources and exposes them through the saved-view operations
in [Operations](../12-operations.md). Core Read continues to discover records
through the collection's record extensions.

Collections enable discovery with a namespaced configuration section:

```yaml
x-obsidian:
  bases:
    include:
      - TaskNotes/Views/**/*.base
    create_folder: TaskNotes/Views
    default_for_new_views: true
```

`include` contains collection-relative globs as defined in
[Collection Layout](../02-collection-layout.md). The provider MUST apply
the same path-boundary and symlink protections used for record discovery.
`create_folder` identifies the preferred location for new Obsidian sources.
`default_for_new_views` makes that source format the collection's default when
a view-creation interface offers no explicit format.

A writer that replaces a Base record with a whole-document `update` preserves
unknown top-level keys, view keys, property metadata, formulas, and
presentation options, so a source editor can modify the structures it
understands while round-tripping the remainder.

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

Execution returns the headless result envelope from
[Operations](../12-operations.md). Selected and
presentation-mapped values appear under each row's `values`; renderer metadata
may approximate layout while retaining the source's filtering, formula,
ordering, grouping, and pagination semantics.

Obsidian placement state maps to the portable invocation context rather than to
query semantics: opening a Base directly supplies the view definition, an
embed supplies its embedding record, and an active-file interface supplies its
active record. The adapter resolves that host state into an explicit invocation
context before calling the query or view executor.

## Optional Feature Requirements

An implementation advertises `obsidian_bases_views` through
`optional_features` when it:

- discovers `.base` sources selected by `x-obsidian.bases.include`
- assigns deterministic named-view IDs and source revisions
- parses filters and formulas before candidate evaluation
- evaluates the Obsidian Bases expression dialect, including formula
  dependencies, file and link values, date and duration behavior, methods, and
  coercions
- combines source and named-view filters with AND
- applies source order, sort, group, limit, and presentation metadata
- exposes the source's ordered properties and display names
- returns the saved-view headless result envelope
- keeps `.base` sources authoritative throughout discovery and execution

Conformance suites for `obsidian_bases_views` MUST include an oracle corpus
captured from the supported Obsidian expression environment. Each case records
the expression, evaluation context, expected value or error, and source
environment version. Known upstream divergences are identified individually in
the corpus.
