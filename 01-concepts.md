# 01. Concepts

## Collection

A collection is a directory tree identified by an `mdbase.yaml` file. It
contains Markdown records, type files, optional data contract files, optional
runtime records, and optional derived state.

A collection root is the directory containing the active `mdbase.yaml`.

## Record

A record is a Markdown file in the collection that is not excluded, not a type
or data contract file, and not another reserved collection file. A record has:

- a collection-relative path
- optional YAML frontmatter
- a Markdown body
- derived file metadata such as basename, extension, folder, size, and modified
  time

The persisted frontmatter object is the raw record value. Effective read values
may additionally include `collection.read_defaults`.

A record is identified by its path. A record carries no required mdbase
metadata: no ID, revision, or merge state is ever required in the file.
Implementations MAY keep internal record identities outside the collection's
records and follow a record across moves with the move detection of Chapter
12A.

## Type

A type is a Markdown file, usually under `_types/`, whose frontmatter has
`kind: mdbase.type`. The type frontmatter wraps a JSON Schema and optional
mdbase sections.

Types define shape and collection semantics for matching records. Runtime
providers and workflows supply executable behavior.

## Data Contract

A data contract is a versioned `mdbase.contract` control file that defines a
portable record interface and optional implementation binding using JSON Schema
2020-12. A record contract normally names shared application semantics; event
and action contracts describe complete messages.

A type implements a data contract through its top-level `implements` section.
The contract does not replace the type, select a provider, assign ownership, or
grant access. Several types can implement one contract, and several
applications can consume the same implementing type. One type can contain
separate implementations of several contracts.

## Schema

In v0.3, "schema" means JSON Schema 2020-12 unless explicitly qualified.

`schema.value` validates persisted frontmatter object shape. mdbase-specific
sections such as `match`, `collection`, `lifecycle`, and `implements` are
outside the JSON Schema payload.

## Match

Matching decides which type or types apply to an existing record. A record can
match no types, one type, or multiple types.

Explicit type declarations take precedence over inferred match rules. When a
record matches multiple types, it is valid only if it validates against every
matched type's JSON Schema and every matched type's mdbase collection
validators.

Membership should be a deterministic function of the record's path, its
persisted frontmatter, and the type registry, independent of the current time
and of other records. Chapter 07 defines the diagnostic for match rules that
break this.

## Validity

Validity is a property reported when a record is read, never a guarantee.
Any tool can write any bytes to a file, so a collection may always contain
invalid records. Conforming tools read, index, and query them, and report
their issues. Chapter 04 defines which checks may reject a write made through
an engine.

## Collection Semantics

Collection semantics are rules that require knowledge of the file tree or
runtime context. Examples:

- link parsing and target resolution
- cross-record uniqueness
- effective read defaults
- path generation
- display metadata
- type matching
- path safety

These rules extend record validation with collection context.

## Lifecycle

Lifecycle policy runs during mutating operations. It can materialize managed
values such as IDs, creation timestamps, modification timestamps, slugs, and
simple transforms.

Lifecycle policy is deterministic operation behavior within Core Write. It runs
from type policy during the active mutation.

## Merge

A merge combines two concurrent edits of one record against their common base
version. Each top-level frontmatter field has a merge strategy, declared in
`collection.merge` or derived from the type, and the body merges line by line.
Chapter 12A defines the merge function. When and where merges happen is an
implementation concern.

## Expression

mdbase has one expression language: the mdbase CEL profile. Expressions appear
in `match.expr`, queries, projections, lifecycle guards, runtime conditions,
and workflow input templates.

`match.where` is a structured predicate written as YAML data, not an
expression language; Chapter 07 defines it. Other expression syntaxes, such
as Obsidian Bases formulas, are adapter dialects (Chapter 10).

## View

A view is an ordinary Markdown record whose matched type implements the
`mdbase.view` record contract. It stores shared query scope and one or more
named queries, with optional advisory presentation metadata. The type name is
not significant; the contract implementation is.

Views do not introduce a second query engine. A view-aware tool resolves a
named view to the query model from Chapter 11 and executes it through the Query
profile. Tools that do not support view execution continue to read and validate
view files as ordinary typed records.

View records are passive collection data. Rendering a view, registering a
renderer, or connecting user interaction to actions may be tool- or
runtime-specific, but the record itself declares no event, action, or
executable behavior.

## Link

A link is a frontmatter value or body reference that can resolve to another
record. mdbase recognizes wikilinks, Markdown links, and bare path strings where
a field is declared as link-aware.

JSON Schema validates the local string or array shape. `collection.links`
declares link meaning, target type, and existence requirements.

## Runtime

A runtime is a process, plugin, daemon, CLI, CI job, or agent that executes
companion-profile behavior for a collection.

The core collection model is runtime-neutral. Event and action interfaces are
ordinary data contracts with `contract_type: event` or `contract_type: action`.
Live event sources and action providers declare the exact contracts they
implement through the event/action interoperability profile. The durable
runtime profile stores workflows, policies, runs, and related state as ordinary
records whose types implement the standard runtime record contracts.

Installing a contract, type, or pack never runs code or grants authority. A
host admits a live declaration under its own policy before that code can act.
