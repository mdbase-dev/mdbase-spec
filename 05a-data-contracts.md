# 05A. Data Contracts

## Why Data Contracts Exist

A contract describes one portable interface independently from the local type
or application that implements it.

For example, `personal_task`, `work_task`, and `task` can all implement
`tasknotes.task`. Their filenames, additional fields, matching rules, and local
presentation can differ. An application can discover the shared contract,
understand each type's field mapping, and operate without requiring every
collection to use one canonical type name.

`mdbase.contract` is the shared identity and JSON Schema substrate for passive
record views, events, and actions. `contract_type` discriminates their
subject-specific schema fields. This chapter defines the shared artifact and
record implementation rules. The optional
[event/action interoperability profile](./interop/0.1.md) defines executable
source/provider declarations and message exchange. Contracts never grant
permission.

## Three Portable Artifacts

The complete collection contract model has three intentionally small parts:

1. An `mdbase.contract` artifact defines a versioned subject-specific
   interface using JSON Schema 2020-12.
2. For a `record` contract, a type's `implements` entry maps that interface to
   the type and supplies contract-specific binding data.
3. An optional `mdbase.type-pack` groups contracts, types, and their
   referenced schemas for transactional installation and evolution. It is
   defined by the separately versioned
   [type packs profile](./type-packs/0.1.md).

Event sources and action providers make runtime declarations because they are
executable, instance-specific implementations rather than record types.
Requirements, authorization grants, and transports are not collection
contract artifacts.

## Designing Record Contracts

A record contract SHOULD describe a compact, application-facing semantic
interface. Its properties name values that independent consumers can rely on,
while an implementing type remains free to choose local field names, matching
rules, additional fields, and presentation.

Record contracts SHOULD:

- keep the unconditionally required surface as small as the shared behavior
  permits
- use optional properties for semantics that not every implementing type can
  provide
- use `binding_schema` for implementation-specific vocabularies and behavior,
  such as which local task statuses count as completed
- be shared by applications that need the same semantics rather than duplicated
  under application-specific IDs

A record contract SHOULD NOT reproduce an external interchange or storage
format merely so applications can request that serialization. An importer,
exporter, or application adapter can translate a semantic record view to
JSContact, vCard, or another wire format. A wire-format-shaped record contract
remains valid when the implementing type intentionally stores and exposes that
exact shape.

Event and action contracts are different: their schemas describe complete
messages at an interoperability boundary, so a transport-shaped schema is
usually appropriate.

## Contract Files

Contract files are Markdown files under the configured contracts folder,
default `_contracts/`. Their frontmatter has `kind: mdbase.contract` and
validates against `schemas/v0.3/data-contract.schema.json`.

```markdown
---
kind: mdbase.contract
contract_type: record
id: example.task
version: 1.0.0
name: Example task
description: A small portable task interface.

record_schema:
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

`id` is a lower-case namespaced identifier. `version` is the artifact's exact
semantic version.

### Version Requirements

Type implementations and interoperability requirements name the contract
versions they support with a version requirement. The portable grammar is a
subset of the npm `semver` range syntax:

| Form | Satisfied by |
| --- | --- |
| `1.4.2` or `=1.4.2` | exactly `1.4.2` |
| `^1.4.2` | `>=1.4.2 <2.0.0-0` |
| `^0.4.2` | `>=0.4.2 <0.5.0-0` |
| `^0.0.4` | `>=0.0.4 <0.0.5-0` |
| `~1.4.2` | `>=1.4.2 <1.5.0-0` |
| `>=1.2.0 <2.0.0` | every comparator: one or more of `>`, `>=`, `<`, `<=`, or `=` followed by a version, separated by single spaces |

Versions compare by SemVer 2.0.0 precedence, so a pre-release sorts before its
release and `2.0.0-0` is the lowest version with major `2`. A pre-release
version satisfies a requirement whenever it lies within these bounds. Build
metadata is ignored. Other range syntaxes, such as `x` wildcards, hyphen
ranges, and `||` alternatives, are not portable.

A requirement resolves to the highest registered version of that contract ID
that satisfies it. Resolution is deterministic for a given contract registry
and is repeated whenever the registry changes.

## Contract Registry

During collection load, a data-contract-aware implementation:

1. scans the configured contracts folder recursively
2. validates every candidate against the built-in data-contract schema
3. resolves and compiles the schemas selected by `contract_type`
4. registers each contract by the exact pair `(id, version)`
5. computes its contract digest
6. resolves every type `implements` requirement to one exact contract version
7. validates every type `implements` entry against its resolved contract

Several versions of one contract ID may coexist. Two artifacts with the same
ID and version are valid only when their contract digests are identical.
Different content for the same ID and version is
`data_contract_conflict`.

Resolution is collection-local and offline. Core implementations MUST NOT fetch
a missing contract from the network. Applications and installers carry the
contract files they require, usually in a
[type pack](./type-packs/0.1.md).

## Type Implementations

`implements` belongs in the type file because a record implementation is a
claim about each record that matches that one type. A type can implement only a
`record` contract. Event sources and action providers declare implementations
through the interoperability profile instead.

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
| `version` | contract version requirement |
| `fields` | contract field reference to record field reference mapping |
| `binding` | optional configuration validated by the contract's `binding_schema` |

Both sides of `fields` use the field-reference syntax from Chapter 07. Existing
field paths remain valid. RFC 6901 JSON Pointer is the exact form for keys that
field paths cannot represent, so `/@type` addresses an `@type` property and
`/a~1b` addresses an `a/b` property. The left side addresses the normalized
contract view. The right side addresses effective record frontmatter. Mapping
is direct: core does not rename values, coerce values, run expressions, or
apply hidden transforms.

The `binding` object does not transform projected record values. It supplies
validated semantic policy that a contract-aware application can interpret. For
example, a task implementation can expose the local status value unchanged
while declaring several values in `binding.completed_values`. This preserves
the user's vocabulary and avoids inventing an ambiguous reverse mapping.

A type MUST NOT contain two implementations of the same contract ID. Field mappings MUST address fields declared by the resolved
`record_schema` and the resolved type schema. Every unconditional top-level
field named by the contract's `record_schema.required` array MUST be mapped,
either by the matching one-segment field path or by the matching one-token JSON
Pointer.

When a contract has a `binding_schema`, the implementation's `binding` value, or
an empty object when omitted, MUST validate against it. When a contract has no
`binding_schema`, `binding` MUST be absent or empty.

Private application metadata may remain under `x-*`, but an `x-*` object has no
contract-discovery, conformance, or authorization meaning.

## Contract Views And Record Validation

To construct a contract view, a tool starts with a record's effective
frontmatter and copies every mapped value to its contract field reference. Missing
optional values remain missing. The resulting object is validated against the
contract's `record_schema`.

Contract validation complements rather than replaces type validation:

- the type schema validates raw persisted frontmatter
- collection semantics construct the effective record
- the field map constructs a normalized contract view
- the contract's `record_schema` validates that view

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
  "contract_type": "record",
  "id": "...",
  "version": "...",
  "record_schema": {},
  "binding_schema": {}
}
```

The digest object contains the subject-specific schema keys selected by
`contract_type`: `record_schema` and `binding_schema`; `data_schema` and
`source_schema`; or `input_schema`, `output_schema`, `error_schema`,
`provider_schema`, and `behavior`. Absent optional members are omitted.
Human-facing `name`, `description`, Markdown body, `x-*` metadata, schema
wrapper dialects, and local `ref` paths do not affect portable identity.
Consequently, an inline schema and a local referenced schema with identical
resolved JSON values have the same contract digest, while changing the bytes
at a stable reference path changes the digest.

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

`contract_digest` is the digest of the contract version the implementation's
requirement resolved to. `collection` omits `collection.display`, and
`implementation` is the `implements` entry. Absent optional members are omitted.

This deliberately includes membership, shape, defaults, links, paths,
projections, lifecycle behavior, and the resolved contract. A consumer that
pinned an implementation can detect any portable change that may alter the
records or values it observes. Advisory presentation metadata, the type's
Markdown body, and `x-*` sections do not affect the digest, so editing an icon
or description never invalidates an approval.

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

## Diagnostics

Data-contract-aware tools use these codes:

| Code | Meaning |
| --- | --- |
| `invalid_data_contract` | contract frontmatter or schema is invalid |
| `data_contract_not_found` | no registered contract has the referenced ID |
| `data_contract_conflict` | one ID and version resolve to different contract digests |
| `data_contract_version_mismatch` | no registered version satisfies an implementation or consumer requirement |
| `data_contract_binding_invalid` | implementation binding fails its binding schema |
| `data_contract_field_invalid` | a mapped contract or record field is missing or incompatible |
| `data_contract_record_invalid` | a projected contract view fails the contract schema |

Diagnostics use the canonical shape from Chapter 14 and identify the contract
ID, exact version, type name, and relevant field mapping in `details`.
