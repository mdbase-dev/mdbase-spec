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

The type's path match replaces `x-obsidian.bases.include`, and the record
operations replace the saved-view source operations for Bases. Both remain
defined below for collections that do not list `base` as a record extension.
They are transitional: they are removed in the release that removes the
saved-view source operations for canonical views, and no new consumer should
adopt them.

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

## Existing files during setup

When setup enables `base` as a record extension, it assesses the existing ordinary
`.base` files that will become records and lists them for the user or application.
Promotion is an identity-preserving holder transition, not delete followed by
create: the same identity, exact path, and exact source bytes become a YAML document
record. It does not create a new view resource.

For a replicated provider, the logical transition is
`ordinary_file_to_record { id, path, prior: FileContent, doc }`:

- `id` is the existing file identity; `path` is its exact current path.
- `prior` is the **complete** current file-content descriptor (`FileContent`),
  including its content profile, length, hash and storage/crypto references where
  applicable. A hash alone is not full-descriptor CAS.
- `doc` is the complete exact UTF-8 source, not a re-serialized parsed value. Its
  full-source hash and byte length MUST match the authenticated prior content.
  Declared metadata alone is not proof that the source bytes were authenticated.

Apply MUST verify current authority and that the current holder is an ordinary
file with the same identity, path, and complete content descriptor. Concurrent
content edits, moves, holder changes, or same-hash resealing/rekeying invalidate
that comparison. The transition refuses rather than overwriting a changed file;
there is no partial file-removal/record-insertion prefix. The current and prospective
record-extension configuration and type packs are checked as part of setup, not
bypassed by the filename. Promotion grants no additional read or write authority.

The exact source MUST fit the provider's whole-record source limit and pass its
bounded YAML mapping admission. Syntax or structural-admission failure leaves the
ordinary file and its bytes untouched and produces a typed, file-specific receipt
diagnostic; it does not fail the entire setup. Successful promotion preserves
comments, unknown keys and formatting. It MUST NOT apply create-time lifecycle
rewrites, assign a new identity, or create, remove, or change tombstones.

Configuration, packs, and admitted promotions form one atomic setup application
when the provider can perform that transaction. If it cannot, it MUST report the
per-file outcomes explicitly rather than imply all-or-nothing completion. A stale
CAS is an apply failure, not a successful promotion or a YAML parse diagnostic.

During verified lost-tail resurrection, an acknowledged promotion MUST NOT be
replayed. It has no effects and produces a typed diagnostic; the current holder,
bytes, and history stay unchanged. Setup can be re-applied idempotently against
fresh current state afterwards. This recovery exception does not relax the normal
setup CAS checks and MUST NOT be a client-selectable bypass.

This describes setup semantics, not a new general-purpose public operation or
wire allocation. Providers with a signed mutation format MUST define a closed,
typed transition in that format before activation; unknown operations MUST NOT
partially apply. Removing the extension does not implicitly reverse promotion.

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
