# 05A. Data Contracts

## Why Data Contracts Exist

A type describes one collection's records. A data contract describes the
portable meaning that one or more independently designed types agree to expose.

For example, `personal_task`, `work_task`, and `task` can all implement
`tasknotes.task`. Their filenames, additional fields, matching rules, and local
presentation can differ. An application can discover the shared contract,
understand each type's field mapping, and operate without requiring every
collection to use one canonical type name.

Data contracts are passive data interoperability. They do not describe
executable actions, events, providers, permissions, or workflows. Those are
runtime contracts and are defined in Chapter 13.

## Three Portable Artifacts

The complete data-contract model has three intentionally small parts:

1. An `mdbase.contract` artifact defines a versioned interface and optional
   binding schema using JSON Schema 2020-12.
2. A type's `implements` entry maps that interface to the type and supplies
   contract-specific binding data.
3. An optional `mdbase.type-pack` manifest groups contracts, types, and their
   referenced schemas for transactional installation.

An application requirement, authorization grant, or network protocol is not a
fourth collection artifact. Such systems consume the verified facts exposed by
the collection.

## Contract Files

Contract files are Markdown files under the configured contracts folder,
default `_contracts/`. Their frontmatter has `kind: mdbase.contract` and
validates against `schemas/v0.3/data-contract.schema.json`.

```markdown
---
kind: mdbase.contract
id: example.task
version: 1.0.0
name: Example task
description: A small portable task interface.

schema:
  dialect: json-schema-2020-12
  value:
    $schema: "https://json-schema.org/draft/2020-12/schema"
    type: object
    required: [title, status]
    additionalProperties: false
    properties:
      title: { type: string, minLength: 1 }
      status: { type: string, minLength: 1 }
      due: { type: string, format: date }

binding_schema:
  dialect: json-schema-2020-12
  value:
    $schema: "https://json-schema.org/draft/2020-12/schema"
    type: object
    required: [completed_values]
    additionalProperties: false
    properties:
      completed_values:
        type: array
        minItems: 1
        uniqueItems: true
        items: { type: string }
---

# Example task

The body explains the interface to people. Portable behavior is defined by the
frontmatter schemas.
```

`id` is a lower-case namespaced identifier. `version` is an exact semantic
version. A type implementation never names a version range.

`schema` validates the normalized contract view produced from a record.
`binding_schema`, when present, validates implementation-specific semantic
configuration. Both use the same JSON Schema profile and reference rules as
type schemas.

Contract files are control files, not records. They do not participate in
ordinary record scans, queries, links, or runtime workflow discovery.

## Contract Registry

During collection load, a data-contract-aware implementation:

1. scans the configured contracts folder recursively
2. validates every candidate against the built-in data-contract schema
3. resolves and compiles `schema` and `binding_schema`
4. registers each contract by the exact pair `(id, version)`
5. computes its contract digest
6. validates every type `implements` entry against the resulting registry

Several versions of one contract ID may coexist. Two artifacts with the same
ID and version are valid only when their contract digests are identical.
Different content for the same ID and version is
`data_contract_conflict`.

Resolution is collection-local and offline. Core implementations MUST NOT fetch
a missing contract from the network. Applications and installers carry the
contract files they require, usually in a type pack.

## Type Implementations

`implements` belongs in the type file because an implementation is a claim
about each record that matches that one type.

```yaml
implements:
  - contract: example.task
    version: 1.0.0
    fields:
      title: title
      status: workflow_state
      due: due_date
      "/@type": "/card/@type"
    binding:
      completed_values: [done, cancelled]
```

Each implementation contains:

| Key | Meaning |
| --- | --- |
| `contract` | exact contract ID |
| `version` | exact contract semantic version |
| `fields` | contract field reference to record field reference mapping |
| `binding` | optional configuration validated by the contract's `binding_schema` |

Both sides of `fields` use the field-reference syntax from Chapter 07. Existing
field paths remain valid. RFC 6901 JSON Pointer is the exact form for keys that
field paths cannot represent, so `/@type` addresses an `@type` property and
`/a~1b` addresses an `a/b` property. The left side addresses the normalized
contract view. The right side addresses effective record frontmatter. Mapping
is direct: core does not rename values, coerce values, run expressions, or
apply hidden transforms.

A type MUST NOT contain two implementations of the same contract ID and
version. Field mappings MUST address fields declared by the resolved contract
schema and the resolved type schema. Every unconditional top-level field named
by the contract schema's `required` array MUST be mapped, either by the matching
one-segment field path or by the matching one-token JSON Pointer.

When a contract has a `binding_schema`, the implementation's `binding` value, or
an empty object when omitted, MUST validate against it. When a contract has no
`binding_schema`, `binding` MUST be absent or empty.

Private application metadata may remain under `x-*`, but an `x-*` object has no
contract-discovery, conformance, or authorization meaning.

## Contract Views And Record Validation

To construct a contract view, a tool starts with a record's effective
frontmatter and copies every mapped value to its contract field reference. Missing
optional values remain missing. The resulting object is validated against the
contract's `schema`.

Contract validation complements rather than replaces type validation:

- the type schema validates raw persisted frontmatter
- collection semantics construct the effective record
- the field map constructs a normalized contract view
- the contract schema validates that view

A record can therefore satisfy its type schema and still produce
`data_contract_record_invalid` for one declared implementation. Implementations
MUST surface that diagnostic whenever they expose the record through that
contract.

Static checks at collection load SHOULD diagnose obviously incompatible mapped
schema types early. Runtime contract-view validation remains authoritative when
JSON Schema composition makes static implication impractical.

## Stable Digests

Digests let a consumer distinguish an approved implementation from a later
change that happens to retain the same name.

The contract digest is SHA-256 over RFC 8785 JSON Canonicalization Scheme bytes
for this object, using the fully resolved JSON Schema values rather than their
storage wrappers or reference paths:

```json
{
  "kind": "mdbase.contract",
  "id": "...",
  "version": "...",
  "schema": {},
  "binding_schema": {}
}
```

`binding_schema` is omitted when absent. Human-facing `name`, `description`,
Markdown body, `x-*` metadata, schema wrapper dialects, and local `ref` paths
do not affect portable identity. Consequently, an inline schema and a local
referenced schema with identical resolved JSON values have the same contract
digest, while changing the bytes at a stable reference path changes the
digest.

The implementation digest is SHA-256 over RFC 8785 bytes for:

```json
{
  "contract_digest": "sha256:...",
  "type": {
    "name": "...",
    "version": 1,
    "match": {},
    "schema": {},
    "collection": {},
    "lifecycle": {}
  },
  "implementation": {}
}
```

Absent optional members are omitted. This deliberately includes membership,
shape, defaults, links, paths, and lifecycle behavior. A consumer that pinned
an implementation can detect any portable change that may alter the records or
values it observes.

Digest strings use `sha256:` followed by 64 lower-case hexadecimal characters.

## Multiple Implementations

A contract lookup returns a set of conforming type implementations, never an
arbitrarily selected provider.

Multiple applications may consume the same type implementation. Implementing a
contract does not create an owner, lease, or exclusive provider relationship.

When several types implement one compatible contract requirement:

- read and list experiences SHOULD initially offer their explicit union
- user-facing approval MUST show every included type
- an existing approval MUST pin the exact type names, contract digest, and
  implementation digests
- a later implementation MUST NOT silently join that approval
- creation MUST use one explicitly selected implementing type

A product may let a user select a subset instead of the union. It MUST NOT hide
the selection or silently choose the first filesystem entry.

These rules separate interoperability from authorization. A type's
`implements` claim says what it can mean; it does not say which application may
read or mutate it.

## Contract Access And Whole Records

The portable contract view contains only mapped contract fields. A gateway that
grants access "through a contract" MUST expose only that view plus the minimum
record identity needed by its protocol. If a record has several approved views
and the operation does not identify one unambiguously, the gateway MUST require
an explicit contract ID, exact version, and implementing type rather than merge
or guess.

Access to unmapped frontmatter, the Markdown body, or arbitrary records is
whole-record or whole-collection access and MUST be requested and presented
explicitly. Merely implementing a contract never grants either form of access.

Core collection APIs remain authorization-neutral. This distinction is
normative for gateways and application protocols that use data contracts as an
authorization boundary.

## Type Packs

A type pack is a directory or archive with an `mdbase-pack.yaml` manifest that
validates against `schemas/v0.3/type-pack.schema.json`.

```yaml
kind: mdbase.type-pack
id: example.tasks
version: 1.0.0
name: Example task types
resources:
  - kind: contract
    source: contracts/example.task.md
    target: _contracts/example.task.md
    digest: sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef
  - kind: type
    source: types/task.md
    target: _types/task.md
    digest: sha256:abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789
```

Resource digests are SHA-256 over the exact resource bytes. Source and target
paths are relative, forward-slash paths without traversal.
A directory, archive, repository, or package that distributes a pack MUST
preserve those bytes exactly, including line endings. Rewriting a text resource
from LF to CRLF therefore creates a different resource and MUST fail digest
verification. This repository fixes text checkouts to LF so its example pack
has identical bytes on every supported platform.

Type packs are installation units, not record types and not permission grants.
A pack may include several contracts, several implementing or auxiliary types,
and local JSON Schemas referenced by those artifacts.

## Transactional Pack Installation

A pack-aware installer MUST:

1. validate the manifest, safe paths, source bytes, and resource digests
2. stage every resource without changing the live collection
3. resolve the complete staged contract and type registries
4. validate every contract, implementation, type, reference, and affected
   existing record
5. compute and present the exact create, replace, and unchanged diff
6. acquire its collection mutation boundary and recheck overwritten hashes
7. commit all resources as one recoverable transaction
8. reopen the collection and verify the committed registry

An invalid resource aborts before any live write. A conflict or concurrent
change aborts with the live collection unchanged. Implementations may use an
atomic directory exchange or a durable backup journal with rollback. After a
crash, recovery MUST restore either the complete pre-install state or the
complete committed state before normal collection operations resume.

Revoking an application's access does not uninstall its type pack. Uninstall is
a separate, explicitly requested operation because records may still depend on
the installed types.

A pack install or dry-run result reports the pack `id`, exact `version`, and
every resource in manifest order as `{ target, action, digest }`, where
`action` is `create`, `replace`, or `unchanged`. It also reports
`cleanup_deferred` when committed state is valid but transaction-journal cleanup
must be retried. Reinstalling identical bytes is valid and reports every
resource as `unchanged`; it MUST NOT create a new logical collection revision.

## Diagnostics

Data-contract-aware tools use these codes:

| Code | Meaning |
| --- | --- |
| `invalid_data_contract` | contract frontmatter or schema is invalid |
| `data_contract_not_found` | an implementation references no local exact contract |
| `data_contract_conflict` | one ID and version resolve to different contract digests |
| `data_contract_version_mismatch` | a consumer requirement has no compatible exact version |
| `data_contract_binding_invalid` | implementation binding fails its binding schema |
| `data_contract_field_invalid` | a mapped contract or record field is missing or incompatible |
| `data_contract_record_invalid` | a projected contract view fails the contract schema |
| `invalid_type_pack` | a pack manifest, resource, path, or digest is invalid |
| `type_pack_conflict` | a target differs from live state and replacement was not approved |
| `type_pack_apply_failed` | transactional commit or recovery did not complete normally |

Diagnostics use the canonical shape from Chapter 16 and identify the contract
ID, exact version, type name, and relevant field mapping in `details`.
