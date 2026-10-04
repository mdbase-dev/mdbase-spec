# 00. Overview

## Abstract

This specification defines the behavior of tools that treat folders of
Markdown files as typed, queryable, link-aware data collections. It covers
collection discovery, JSON Schema types, validation, links, CEL queries,
ordinary records that save named views, record operations, lifecycle policy,
and optional runtime workflows.

## Motivation

Markdown files with YAML frontmatter are a common way to store structured
content. The pattern appears in static site generators, knowledge management
tools such as Obsidian, documentation systems, agent workspaces, and AI agent
frameworks that use Markdown for persistent state.

These ecosystems need consistent conventions for frontmatter structure,
validation, querying, links, and updates. This specification defines one
coherent set of behaviors so that:

- a CLI tool and an editor plugin can operate on the same files with consistent
  semantics
- an AI agent can read and write Markdown files that a human can inspect and
  edit
- tool authors can implement a shared behavior contract
- collections can move between conforming tools

### Intended implementers

**CLI tools** for querying, validating, and manipulating Markdown collections
from the command line.

**Editor plugins** for applications such as Obsidian and VS Code that provide
validation, completion, navigation, and query interfaces.

**Libraries** in different languages that applications can use to work with
typed Markdown.

**AI agent frameworks** that need structured, human-readable persistent
storage.

**Runtime hosts** that connect collection events to declared actions and
workflows.

## What a conforming tool does

Depending on its conformance profiles and optional features, a tool implementing
this specification:

1. **Recognizes collections** by the presence of an `mdbase.yaml` configuration
   file.
2. **Loads type definitions** from Markdown files that wrap JSON Schema.
3. **Matches records to types** through explicit declarations or configured
   match rules.
4. **Validates frontmatter** against matched schemas and collection-aware
   rules.
5. **Resolves links** between records and exposes link-aware metadata.
6. **Executes queries** using CEL expressions for filtering, ordering, and
   projection.
7. **Executes saved view records** when it advertises the optional
   `view_records` feature.
8. **Performs record operations** with validation, reference handling, and
   lifecycle-managed values.
9. **Exchanges events and actions and runs durable workflows** when it claims
   the corresponding companion profiles.

Conformance profiles define the expected behavior for each capability and its
dependencies.

## Design Principles

**Files are the source of truth.** Tools read from and write to the filesystem.
Indexes, caches, and derived databases can be rebuilt from collection state.

**Plain Markdown.** A collection never requires mdbase metadata in a user's
files. Record identity, revisions, merge state, and other engine bookkeeping
live outside records, so a file written by any editor is a complete record.

**Validity is reported, not guaranteed.** Files are edited by tools that know
nothing about types. A conforming tool reads, indexes, and reports every record
whatever its validity. Engines may reject an invalid write made through them,
as feedback to the writer, but only for checks within that single record.
Chapter 04 defines the principle and its three tiers.

**Human-readable first.** Persistent collection data uses open text formats. A
user with a text editor can read and modify every record and type file.

**Progressive strictness.** A collection can begin with untyped records. Types,
validation, link rules, and lifecycle policy can be introduced incrementally.

**Portable.** Conforming tools share the same record and collection semantics.
Implementation-specific features use explicit extension namespaces.

**Git-friendly.** Durable collection state is stored as text that can be
reviewed in diffs and versioned with the rest of a project.

**Standard building blocks.** JSON Schema describes frontmatter shape. CEL
provides portable expressions. Named mdbase sections describe behavior that
depends on collection context.

## How It Works

### A collection is a folder with an `mdbase.yaml` marker

```text
my-project/
├── mdbase.yaml            # marks this folder as a collection
├── _types/                # type definitions
│   ├── task.md
│   └── person.md
├── tasks/
│   ├── fix-bug.md         # a task record
│   └── write-docs.md
└── people/
    └── alice.md           # a person record
```

The minimal configuration declares the specification version:

```yaml
# mdbase.yaml
spec_version: "0.3.0"
```

### Types are defined as Markdown files

A type describes a category of records. Type files usually live in `_types/`.
Their frontmatter contains a JSON Schema and optional mdbase collection rules;
their body documents the type for people and tools.

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
    required: [type, title]
    additionalProperties: false
    properties:
      type:
        const: task
      title:
        type: string
        minLength: 1
      status:
        enum: [open, in_progress, done]
      priority:
        type: integer
        minimum: 1
        maximum: 5
      assignee:
        type: string
      due:
        type: string
        format: date
      tags:
        type: array
        items: { type: string }

collection:
  read_defaults:
    status: open
  links:
    assignee:
      target_type: person
      validate_exists: true
---

# Task

A task represents a unit of work. Set `status` to track progress.
```

JSON Schema validates the persisted frontmatter object. The `collection`
section supplies rules that require collection context, including effective
read defaults, links, uniqueness, and path policy.

### Data contracts make type meaning portable

Types can implement exact, versioned data contracts stored under
`_contracts/`. A contract uses JSON Schema for its normalized record interface
and optional binding. The type's `implements` entry maps contract fields to
record fields. Record contracts normally describe compact application
semantics rather than storage layouts or external wire formats.

Several types can implement one contract, one type can implement several
contracts, and several applications can consume the same contract view.
Discovery returns the complete implementation set; it never
silently picks a provider. Data contracts are passive interoperability and do
not grant access.

### Records are Markdown files with typed frontmatter

A record provides field values in frontmatter and free-form Markdown in its
body. Records may declare a type explicitly or match a type through configured
rules.

```markdown
---
type: task
title: Fix the login bug
status: in_progress
priority: 4
assignee: "[[alice]]"
tags: [bug, auth]
---

The login form rejects addresses containing a `+` character.
```

### Queries filter and sort records with CEL

Queries are YAML objects with optional clauses for filtering, ordering,
projection, and pagination:

```yaml
types: [task]
where: 'status != "done" && priority >= 3'
order_by:
  - field: priority
    direction: desc
limit: 20
```

CEL expressions can access frontmatter values, file metadata, dates, lists,
and resolved links. Dates are RFC 3339 date strings, so they compare
chronologically:

```cel
status == "open" && "urgent" in tags
due != null && due < today().addDays(7)
assignee != null && assignee.asFile().team == "engineering"
```

Expressions follow standard CEL semantics. A filter that raises an error for
a record, for example by reading through a broken link, excludes that record
and reports a diagnostic.

### View records save reusable queries

A collection can install the `mdbase.view` contract and a type that implements
it, then store one or more named queries in a Markdown record. Shared query scope, named-view filters,
projections, ordering, grouping, and summaries remain machine-readable, while
the Markdown body documents the view for people. Optional presentation metadata
can select a renderer without changing query results.

### Validation is progressive and reported

Files in a collection can remain untyped records. Types can be added
incrementally, and validation severity is configurable as `off`, `warn`, or
`error`. JSON Schema controls field shape and unknown-property handling.
Collection rules add checks that depend on other records or paths.

Validity is a property reported when records are read. At level `error`, a
write made through an engine fails when the resulting record breaks one of
its own checks. Checks that span records, such as link existence and
uniqueness, are reported and never block a write, unless a uniqueness rule
explicitly opts into `enforce: write`.

### Concurrent edits merge field by field

When two edits to one record meet, for example an application update and an
edit made in a text editor, a tool that reconciles them uses the three-way
record merge of Chapter 12A. Different fields merge, timestamps take the
later value, set-like lists take the union, appends to the body are both kept,
and only real disagreements are conflicts. How a tool surfaces a conflict, and
whether it replicates collections at all, is outside this specification.

### Links connect records across the collection

Records can reference each other with wikilinks such as `[[alice]]`, Markdown
links such as `[Alice](../people/alice.md)`, or declared path values. Link-aware
tools resolve targets, extract links and tags from record bodies, traverse
links in queries, and can update references during rename operations.

### Lifecycle policy manages values during writes

Lifecycle policy can assign IDs, timestamps, slugs, copied values, and literals
during create and update operations. Lifecycle runs before final validation, so
managed fields participate in the same schema and collection checks as supplied
frontmatter.

### Companion profiles add active behavior

Event and action interfaces are ordinary data contracts. The optional
event/action interoperability profile defines how live event sources and action
providers declare and exchange them. The optional durable runtime profile adds
workflow records, admission, authorization, and recoverable execution. Opening
a collection never activates executable behavior.

### Conformance is profile-based

Implementations claim the profiles they support, such as Core Read, Collection
Semantics, Data Contracts, Links, Query, Core Write, Type Packs, Lifecycle,
Event/Action Interoperability, Durable Runtime, and Watch. Profile dependencies
keep those claims precise and independently testable.

## Specification Structure

| Document | Description |
| --- | --- |
| [01-concepts.md](./01-concepts.md) | Core terminology and data model |
| [02-collection-layout.md](./02-collection-layout.md) | Collection discovery, paths, and reserved state |
| [03-records-and-frontmatter.md](./03-records-and-frontmatter.md) | Markdown parsing and YAML value semantics |
| [04-configuration.md](./04-configuration.md) | The `mdbase.yaml` configuration file |
| [05-type-files.md](./05-type-files.md) | JSON Schema type wrappers and metadata |
| [05a-data-contracts.md](./05a-data-contracts.md) | versioned data contracts, type implementations, and transactional type packs |
| [06-json-schema-profile.md](./06-json-schema-profile.md) | Supported JSON Schema vocabulary and reference rules |
| [07-collection-semantics.md](./07-collection-semantics.md) | Matching, defaults, uniqueness, links, and paths |
| [08-links.md](./08-links.md) | Link syntax, resolution, traversal, and backlinks |
| [09-lifecycle.md](./09-lifecycle.md) | Managed values and mutation-time policy |
| [10-cel-profile.md](./10-cel-profile.md) | Portable expressions and host bindings |
| [11-querying.md](./11-querying.md) | Filters, ordering, projection, and result envelopes |
| [12-operations.md](./12-operations.md) | Read and write operations, concurrency, and diagnostics |
| [12a-concurrent-edits.md](./12a-concurrent-edits.md) | Record identity, move detection, three-way merge, and writer format fidelity |
| [13-migrations-and-compatibility.md](./13-migrations-and-compatibility.md) | Migration from earlier versions and compatibility |
| [14-conformance.md](./14-conformance.md) | Profiles, claims, fixtures, and runners |

Companion documents are versioned or scoped independently of the core
chapters:

| Document | Description |
| --- | --- |
| [interop/0.1.md](./interop/0.1.md) | Event and action interoperability profile 0.1 |
| [runtime/0.2.md](./runtime/0.2.md) | Durable runtime companion profile 0.2: standard pack, authorization, admission, execution, and recovery |
| [adapters/obsidian-bases.md](./adapters/obsidian-bases.md) | Obsidian Bases saved-view adapter |

The [portable interoperability testbed](/testbed/) runs neutral contract,
event/action, and durable-runtime scenarios through black-box adapters. Its
canonical transcripts make cross-language and cross-application behavior
directly comparable without making one product's internal API normative.

## Versioning

This specification uses semantic versioning. The current version is **0.3.0**,
in its fifth release candidate (`0.3.0-rc.5`). 0.3.0 is declared stable once
implementations pass the conformance suite.
Collections declare their specification version with `spec_version` in
`mdbase.yaml`. Tools declare the profiles and versions they implement.

Companion profiles, artifacts, and schemas carry their own versions:

| Versioned thing | Declared by | Current | Format |
| --- | --- | --- | --- |
| collection specification | `spec_version` in `mdbase.yaml` | `0.3.0` | semantic version |
| event/action interoperability profile | conformance claim `interop_profile_version` | `0.1` | major.minor |
| durable runtime profile | conformance claim `runtime_profile_version` | `0.2` | major.minor |
| interoperability testbed protocol | testbed evidence | `0.1` | major.minor |
| canonical schemas | `$id` path segment, such as `/schemas/v0.3/` | matches the owning specification or profile | `v` plus major.minor |
| type definition | type file `version` | author-defined | positive integer |
| data contract | contract file `version` | author-defined | semantic version |
| type pack | pack manifest `version` | author-defined | semantic version |

A type version identifies revisions of one local type. Contract and pack
versions follow semantic versioning because other artifacts depend on them
through version requirements.

## Normative Language

The keywords `MUST`, `MUST NOT`, `SHOULD`, `SHOULD NOT`, and `MAY` are to be
interpreted as described in RFC 2119.

Draft notes use ordinary prose and are non-normative. A paragraph that begins
with **Provisional (rc.5).** records a choice made where the design input
left a detail open. It is normative in the release candidate and may change
before 0.3.0 is declared stable. The
[0.3.0-rc.5 release notes](./docs/releases/0.3.0-rc.5.md) list every such
choice.

## License

This specification is released under the [MIT License](https://opensource.org/licenses/MIT).
