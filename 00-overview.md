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
9. **Loads runtime contracts and workflows** when it supports active behavior.

Conformance profiles define the expected behavior for each capability and its
dependencies.

## Design Principles

**Files are the source of truth.** Tools read from and write to the filesystem.
Indexes, caches, and derived databases can be rebuilt from collection state.

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
record fields.

Several types can implement one contract, and several applications can consume
the same type. Discovery returns the complete implementation set; it never
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
and resolved links:

```cel
status == "open" && "urgent" in tags
due_date < today()
assignee.asFile().team == "engineering"
```

### View records save reusable queries

A collection can define the ordinary `view` type and store one or more named
queries in a Markdown record. Shared query scope, named-view filters,
projections, ordering, grouping, and summaries remain machine-readable, while
the Markdown body documents the view for people. Optional presentation metadata
can select a renderer without changing query results.

### Validation is progressive

Files in a collection can remain untyped records. Types can be added
incrementally, and validation severity is configurable as `off`, `warn`, or
`error`. JSON Schema controls field shape and unknown-property handling.
Collection rules add checks that depend on other records or paths.

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

### Runtime contracts describe active behavior

Optional runtime records describe providers, events, actions, capabilities,
policies, workflows, runs, and checkpoints. A runtime host loads these
contracts, validates their data, and connects declared workflows to available
event and action implementations.

### Conformance is profile-based

Implementations claim the profiles they support, such as Core Read, Collection
Semantics, Links, Query, Core Write, Lifecycle, Runtime Contracts, Workflow,
and Watch. Profile dependencies keep those claims precise and independently
testable.

## Specification Structure

| Document | Description |
| --- | --- |
| [01-concepts.md](./01-concepts.md) | Core terminology and data model |
| [02-collection-layout.md](./02-collection-layout.md) | Collection discovery, paths, and reserved state |
| [03-records-and-frontmatter.md](./03-records-and-frontmatter.md) | Markdown parsing and YAML value semantics |
| [04-configuration.md](./04-configuration.md) | The `mdbase.yaml` configuration file |
| [05-type-files.md](./05-type-files.md) | JSON Schema type wrappers and metadata |
| [05-data-contracts.md](./05-data-contracts.md) | versioned data contracts, type implementations, and transactional type packs |
| [06-json-schema-profile.md](./06-json-schema-profile.md) | Supported JSON Schema vocabulary and reference rules |
| [07-collection-semantics.md](./07-collection-semantics.md) | Matching, defaults, uniqueness, links, and paths |
| [08-links.md](./08-links.md) | Link syntax, resolution, traversal, and backlinks |
| [09-lifecycle.md](./09-lifecycle.md) | Managed values and mutation-time policy |
| [10-cel-profile.md](./10-cel-profile.md) | Portable expressions and host bindings |
| [11-querying.md](./11-querying.md) | Filters, ordering, projection, and result envelopes |
| [12-operations.md](./12-operations.md) | Read and write operations, concurrency, and diagnostics |
| [13-runtime-contracts.md](./13-runtime-contracts.md) | Providers, events, actions, capabilities, and policy |
| [14-workflows.md](./14-workflows.md) | Workflow records and execution semantics |
| [15-migrations-and-compatibility.md](./15-migrations-and-compatibility.md) | Migration from earlier versions and compatibility |
| [16-conformance.md](./16-conformance.md) | Profiles, claims, fixtures, and runners |

The [portable interoperability testbed](/testbed/) runs neutral contract,
event/action, and durable-runtime scenarios through black-box adapters. Its
canonical transcripts make cross-language and cross-application behavior
directly comparable without making one product's internal API normative.

## Versioning

This specification uses semantic versioning. The current version is **0.3.0**.
Collections declare their specification version with `spec_version` in
`mdbase.yaml`. Tools declare the profiles and versions they implement.

The optional runtime-contract and workflow vocabulary has an independent
profile version. The runtime profile defined by this specification is **0.2**.

## Normative Language

The keywords `MUST`, `MUST NOT`, `SHOULD`, `SHOULD NOT`, and `MAY` are to be
interpreted as described in RFC 2119.

Draft notes use ordinary prose and are non-normative.

## License

This specification is released under the [MIT License](https://opensource.org/licenses/MIT).
