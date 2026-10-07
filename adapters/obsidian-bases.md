# Obsidian Bases Adapter

## Purpose

This companion document defines how an mdbase collection provider exposes
Obsidian Bases document records as saved-view sources. It builds on the saved-view
model in [Querying](../11-querying.md) and the view operations in
[Operations](../12-operations.md). Implementations that do not advertise the
`obsidian_bases_views` optional feature can still store and edit these records;
they need not discover or execute them as views.

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
match: { path_glob: '**/*.base' }
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

## Discovery and extension opt-in

A provider discovers view sources from records whose matched type implements
`obsidian.base`. Discovery MUST NOT use a separate path scan or side list. A path
glob can match a record to a type, as above, but the implemented contract is what
makes that record a view source. The contract itself grants no read, execute, or
write authority; ordinary record grants still apply.

The `obsidian.base` catalog pack provides the managed contract and a seeded,
user-editable `obsidian_base` type matching `**/*.base`. A pack that depends on it
(such as TaskNotes) can seed additional view records. Seeded view records are
user-owned and MUST NOT be overwritten on upgrade; user-created Base records
are discovered by the same contract rule.

`.base` is not a global record-extension default or a special resource kind.
The pack declares, through its `setup.configuration` collection-setup envelope,
a requirement that `/settings/record_extensions` contains `"base"`, with a
`set_add` provision for `"base"`. Assessment shows this addition before apply;
apply preserves the effective `md` default and existing extensions. Uninstall
MUST NOT silently remove the extension. Without that opt-in, `.base` files are
not records and MUST NOT become views through an alternate discovery path.
Record discovery retains the path-boundary and symlink protections in
[Collection Layout](../02-collection-layout.md).

The older `x-obsidian.bases.include` discovery mechanism and saved-view source
mutation operations are superseded, not an alternative when the extension is
disabled. Bases use ordinary record create, update, rename, and delete operations;
no separate include list, creation-folder setting, or source-operation path is
required.

Record writers validate the complete Base document before a record mutation
commits it. They preserve unknown top-level keys, view keys,
property metadata, formulas, and presentation options supplied in the
document. A source editor can therefore modify the structures it understands
while round-tripping the remainder.

The Base record remains authoritative for a discovered Obsidian source.
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

- discovers record sources whose matched type implements `obsidian.base`
- assigns deterministic named-view IDs and source revisions
- parses filters and formulas before candidate evaluation
- evaluates the Obsidian Bases expression dialect, including formula
  dependencies, file and link values, date and duration behavior, methods, and
  coercions
- combines source and named-view filters with AND
- applies source order, sort, group, limit, and presentation metadata
- exposes the source's ordered properties and display names
- returns the saved-view headless result envelope
- keeps Base records authoritative throughout discovery and execution

Conformance suites for `obsidian_bases_views` MUST include an oracle corpus
captured from the supported Obsidian expression environment. Each case records
the expression, evaluation context, expected value or error, and source
environment version. Known upstream divergences are identified individually in
the corpus.
