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
sections such as `match`, `collection`, `lifecycle`, and `runtime` are outside
the JSON Schema payload.

## Match

Matching decides which type or types apply to an existing record. A record can
match no types, one type, or multiple types.

Explicit type declarations take precedence over inferred match rules. When a
record matches multiple types, it is valid only if it validates against every
matched type's JSON Schema and every matched type's mdbase collection
validators.

## Collection Semantics

Collection semantics are rules that require knowledge of the file tree or
runtime context. Examples:

- link parsing and target resolution
- cross-file uniqueness
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

## Expression

Portable v0.3 expressions use the mdbase CEL profile. Expressions appear in
queries, projections, runtime conditions, workflow input templates, and optional
lifecycle guards.

`match.where` uses the standalone structured predicate language defined in
Chapter 07.

## View

A view is an ordinary Markdown record whose matched type is `view`. It stores
shared query scope and one or more named queries, with optional advisory
presentation metadata.

Views do not introduce a second query engine. A view-aware tool resolves a
named view to the query model from Chapter 11 and executes it through the Query
profile. Tools that do not support view execution continue to read and validate
view files as ordinary typed records.

View records are passive collection data. Rendering a view, registering a
renderer, or connecting user interaction to actions may be tool- or
runtime-specific, but the record itself is not a runtime contract.

## Link

A link is a frontmatter value or body reference that can resolve to another
record. mdbase recognizes wikilinks, Markdown links, and bare path strings where
a field is declared as link-aware.

JSON Schema validates the local string or array shape. `collection.links`
declares link meaning, target type, and existence requirements.

## Runtime

A runtime is a process, plugin, daemon, CLI, CI job, or agent that executes
runtime-profile behavior for a collection.

The core collection model is runtime-neutral. Runtime records make active
behavior portable and inspectable without making every implementation a runtime.

## Runtime Contract

A runtime contract is a typed record or virtual registry entry describing the
interface of a provider, event, action, capability, policy, run, checkpoint,
diagnostic, or workflow.

Runtime contracts describe the interfaces used by action handlers, event
sources, watchers, schedulers, agents, and provider APIs supplied by a runtime.

## Explicit And Implicit Runtime Contracts

Explicit contracts are ordinary Markdown records in a collection or installed
pack.

Implicit contracts are supplied by a conforming runtime, for example built-in
file events or core record actions. A runtime may materialize implicit
contracts as Markdown records for inspection or offline tooling.
