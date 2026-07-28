# mdbase

Portable types, queries, and automation for Markdown collections.

mdbase is an open specification for tools that work with structured Markdown.
It gives editors, command-line tools, plugins, and agents a shared way to
discover records, validate YAML frontmatter, resolve links, run queries, and
update files safely.

The durable data stays in ordinary Markdown files. Collections remain readable
in a text editor, reviewable in Git, and usable across conforming tools.

The current specification is **v0.3.0**.

[Read the overview](./00-overview.md) ·
[Visit mdbase.dev](https://mdbase.dev) ·
[Explore an example collection](./examples/v0.3/canvas-runtime/)

## What mdbase Provides

- JSON Schema types for YAML frontmatter
- path and frontmatter rules for matching records to types
- collection-aware defaults, uniqueness rules, and validation
- portable links between Markdown records
- CEL expressions for filtering, ordering, and projections
- ordinary Markdown view records for saved queries and advisory presentation
- consistent create, read, update, delete, rename, and batch operations
- lifecycle policies for IDs, timestamps, slugs, and managed values
- first-class record, event, and action contracts with one identity and digest model
- optional CloudEvents-based application interoperability
- optional durable runtime execution for workflows, timers, and recovery
- conformance profiles that show which features each tool supports

## A Collection At A Glance

An mdbase collection starts with an `mdbase.yaml` file:

```text
project/
├── mdbase.yaml
├── _types/
│   └── task.md
└── tasks/
    └── write-docs.md
```

The minimal configuration declares the specification version:

```yaml
spec_version: "0.3.0"
```

A type file associates records with a JSON Schema:

```markdown
---
kind: mdbase.type
name: task

match:
  path_glob: "tasks/**/*.md"

schema:
  dialect: json-schema-2020-12
  value:
    type: object
    required: [title]
    properties:
      title:
        type: string
        minLength: 1
      status:
        enum: [open, in_progress, done]
      priority:
        type: integer
        minimum: 1
        maximum: 5
---

# Task

Task records live under `tasks/`.
```

Records stay recognizable as ordinary Markdown:

```markdown
---
title: Write the documentation
status: in_progress
priority: 2
---

Explain how to create a first collection.
```

A query can select matching records with a CEL expression:

```yaml
types: [task]
where: 'status != "done" && priority <= 2'
order_by:
  - field: priority
    direction: asc
```

## Where To Start

| Goal | Start here |
| --- | --- |
| Understand the model | [Overview](./00-overview.md) and [Concepts](./01-concepts.md) |
| Create a collection | [Collection Layout](./02-collection-layout.md), [Configuration](./04-configuration.md), [Type Files](./05-type-files.md), and [First-Class Contracts](./05-data-contracts.md) |
| Validate, query, or save views over records | [JSON Schema Profile](./06-json-schema-profile.md), [CEL Profile](./10-cel-profile.md), and [Querying](./11-querying.md) |
| Add links or managed fields | [Links](./08-links.md) and [Lifecycle](./09-lifecycle.md) |
| Connect applications | [Event and Action Interoperability](./interop/0.1.md) |
| Define durable automation | [Runtime Contracts](./13-runtime-contracts.md) and [Workflows](./14-workflows.md) |
| Migrate a v0.2 collection | [Migrations And Compatibility](./15-migrations-and-compatibility.md) |
| Exchange typed events and actions | [Event/action interoperability profile 0.1](./interop/0.1.md) and [canonical interoperability schemas](./schemas/interop/v0.1/) |
| Build a conforming tool | [Conformance](./16-conformance.md), [first-class contracts](./05-data-contracts.md), [canonical schemas](./schemas/v0.3/), and [test fixtures](./tests/v0.3/) |

## Implementations

Choose an implementation based on how you want to work with a collection:

| Project | Role |
| --- | --- |
| [mdbase](https://github.com/callumalpass/mdbase) | TypeScript collection library and migration engine |
| [mdbase-rs](https://github.com/callumalpass/mdbase-rs) | Rust collection library |
| [mdbase-cli](https://github.com/callumalpass/mdbase-cli) | Command-line collection operations and migration |
| [mdbase-lsp](https://github.com/callumalpass/mdbase-lsp) | Editor diagnostics and language-server support |
| [mdbase-obsidian](https://github.com/callumalpass/mdbase-obsidian) | Obsidian integration and runtime host adapter |

Implementations declare conformance profiles independently, so their supported
features may differ. Package versions and specification versions advance
independently.

## Specification Guide

The specification is organized by topic:

- Chapters 00–04 introduce the model, records, collection layout, and
  configuration.
- Chapters 05–09 and 05A define types, data contracts, schemas, collection
  semantics, links, and lifecycle policy.
- Chapters 10–12 define CEL expressions, queries, and record operations.
- Chapters 13–14 define optional runtime contracts and workflows.
- Chapters 15–16 cover migration, compatibility, and conformance.

The [v0.2.1 archive](./v0.2/README.md) preserves the earlier specification and
implementer material. Legacy fixtures are documented in
[tests/README.md](./tests/README.md).

## Repository Contents

- [`schemas/v0.3/`](./schemas/v0.3/) contains the canonical JSON Schemas.
- [`tests/v0.3/`](./tests/v0.3/) contains shared conformance fixtures.
- [`examples/v0.3/`](./examples/v0.3/) contains example and migration
  collections.
- [`packages/`](./packages/) contains CEL and runtime support packages.
- [`site/`](./site/) builds the versioned specification reader imported by the
  independently deployed [mdbase.dev](https://github.com/mdbase-dev/mdbase.dev)
  website.

## Repository Verification

Run the relevant checks after changing specification artifacts or support
packages:

```bash
python3 scripts/check_v03_tests.py
python3 scripts/prototype_tasknotes_v03_migration.py --check-fixture
npm test --prefix packages/runtime-contracts
cargo test --manifest-path packages/runtime-contracts-rs/Cargo.toml
npm test --prefix packages/cel-host
npm test --prefix packages/runtime-executor
npm run build --prefix site
```

## License

MIT
