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
3. An optional managed `mdbase.type-pack` groups contracts, types, and their
   referenced schemas for transactional installation and evolution.

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
contract files they require, usually in a type pack.

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
    mode: managed
    source: contracts/example.task.md
    target: _contracts/example.task.md
    digest: sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef
  - kind: type
    mode: managed
    source: types/task.md
    target: _types/task.md
    digest: sha256:abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789
```

`mode` is required. A `managed` resource remains owned by the pack and may be
updated or retired by a later pack version only while its live bytes still
match the installed digest. A `seed` resource is created only when its target
is absent and becomes user-owned immediately; later pack versions neither
replace nor delete it unless an explicit seed-type upgrade is declared below.

A seed **type** resource MAY declare `upgrade_from`: one baseline, or a
non-empty list of baselines. A baseline is `{ digest, document }` with an
optional integer `version`. `document` is the exact bytes of a starter the
publisher previously shipped for this resource, pinned by SHA-256 in `digest`;
it is not an assertion that the user's current document is unchanged. `version`,
when present, is the `version` that document declares and is only for
presentation. A single baseline is equivalent to a list containing it. Listing
every previously shipped starter that remains supported lets a collection
upgrade from any of them, not only from the most recent. This declaration is
part of the reviewed manifest and its digest. Ordinary seeds are unaffected.
Engines that do not support this member MUST reject the manifest.

The manifest is invalid (`invalid_type_pack`) when `upgrade_from` appears on a
resource that is not a seed type, when a baseline's digest is not the SHA-256 of
its document, when two baselines share a digest, when a baseline's digest equals
the resource's own digest, when a baseline document's frontmatter `kind` or
`name` differs from the desired document's, or when a baseline's `version`
differs from the `version` its document's frontmatter declares.

A seed's **origin** is the publisher document its live target descends from.
The lock records it (see Pack Identity And Portable Provenance). When the target
exists, is not an intentionally preserved seed target, and the resource declares
`upgrade_from`, the engine plans exactly one of these, in order:

1. The live bytes equal the desired document: `preserve`.
2. The live bytes equal a baseline's document: `update`, writing the desired
   document byte-for-byte. Byte equality proves the origin, whatever the lock
   records.
3. The origin is the desired document: `preserve`. The seed was already upgraded
   and has been edited since.
4. The origin is a baseline: `update` by a three-way merge of that baseline, the
   live type, and the desired type.
5. Otherwise, because the origin is unknown or is not a listed baseline:
   `preserve`, with a `reason` stating that no upgrade baseline applies. The
   type is left as it is; it does not make the pack conflict.

An engine MUST NOT choose a merge baseline any other way. In particular, it MUST
NOT merge against a baseline the seed is not known to descend from, because the
differences between that baseline and the seed's actual origin would be applied
as if they were the user's edits. The assessment reports, for every seed
`update`, the baseline used as `upgrade_baseline: { digest, version? }`.

A three-way merge is conservative. The type kind and name MUST match. Unchanged publisher
settings retain live customizations; unchanged live settings accept publisher
changes. Object settings merge recursively. Contract implementations merge by
contract ID only when unambiguous, retaining customized field mappings and
bindings while updating exact version references. Competing changes (including
ambiguous implementation lists) MUST fail closed. Other arrays are indivisible.
Missing values and explicit null are distinct. Top-level setting removal
requires separate manual review. The live Markdown body and unrelated YAML
nodes MUST be preserved. Reformatting a changed YAML node is permitted.

The merged resource digest MUST appear in the assessment. Normal assessment
and collection revision guards still apply. The upgrade, contract resources,
and provenance MUST publish atomically only after validating the staged
collection. A remaining reference to a removed exact contract MUST block the
whole upgrade; implementations MUST NOT rewrite additional types implicitly.
Record documents MUST NOT be migrated by this mechanism. An intentionally
preserved seed target MUST NOT be upgraded.

This is not version negotiation or grant migration. Callers coordinating
applications must retain old contracts and implementations when supported
applications still require them, or arrange a separately reviewed coordinated
upgrade. Existing grants never acquire the new contract version implicitly.

Resource digests are SHA-256 over the exact resource bytes. Source and target
paths are relative, forward-slash paths without traversal.
A directory, archive, repository, or package that distributes a pack MUST
preserve those bytes exactly, including line endings. Rewriting a text resource
from LF to CRLF therefore creates a different resource and MUST fail digest
verification. Distributors that store packs in version control SHOULD disable
line-ending conversion for pack resources.

Type packs are installation units, not record types and not permission grants.
A pack may include several contracts, several implementing or auxiliary types,
and local JSON Schemas referenced by those artifacts.

## Pack Identity And Portable Provenance

The pack digest is SHA-256 over RFC 8785 JSON Canonicalization Scheme bytes for
the complete validated manifest, prefixed with `sha256:`. Because every
resource digest is part of the manifest, the pack digest identifies the exact
manifest and exact resource bytes without incorporating their distribution
location.

Managed pack state is stored in `mdbase.lock.yaml` at the collection root and
validates against `schemas/v0.3/type-pack-lock.schema.json`. The lock is
portable collection source, not derived cache state. It records each installed
pack's exact ID, version, pack digest, stable installer identity, and the kind,
mode, canonical source, resolved target, and installed digest of every resource. Tools write it
deterministically and users MAY inspect or version it. Tools MUST NOT infer
ownership from filenames, application names, or `x-*` metadata.

A seed resource's entry also records `origin_digest`, the digest of the
publisher document its target descends from, when that is known. Because a seed
becomes user-owned, the installed digest of a seed describes the pack, not the
target, and MUST NOT be used as its origin. An apply sets `origin_digest` to the
desired resource digest when it creates the seed, when it upgrades it (by exact
replacement or by merge), and whenever the target's live bytes equal the desired
document, whatever else applies. Otherwise it carries the previous entry's
`origin_digest` for that target forward unchanged, or omits it when there is
none. A seed target that existed before the pack was installed, and an
intentionally preserved seed target, therefore have no origin unless their bytes
equal the desired document. A lock entry without `origin_digest` means the
origin is unknown. Locks written before `origin_digest` existed carry none, so
an edited seed under such a lock is preserved with a reason rather than merged
until it is upgraded or recreated; an unedited seed still upgrades, because its
bytes prove its origin. `origin_digest` is defined only for seed resources and
MUST NOT appear on a managed resource. An apply that changes only seed origins leaves the pack's
status `current`; it is not a reconfiguration.

Full collection snapshots, authority transfers, and unscoped synchronization
MUST carry `mdbase.lock.yaml` when it exists. A scoped application projection
MAY omit it to avoid disclosing unrelated pack metadata. A storage provider
MUST NOT reject the lock under a per-document limit that the collection owner
cannot remediate, because tools generate it.

An absent lock means no resource is pack-managed, including resources created
by older one-shot installers. Adopting existing files into managed ownership is
a separate explicit operation and MUST verify their exact digests.

## Assessment And Transactional Apply

Pack evolution has two public phases: `assess_type_pack` is read-only and
`apply_type_pack` consumes a reviewed assessment. A caller supplies the desired
manifest, exact resources, and a stable reverse-domain `installed_by`
application or tool identity. Optional `target_overrides` map canonical manifest
targets to collection-specific paths without changing the publisher-owned pack
identity. Overrides are validated as safe collection paths, are included in the
assessment digest, and the resolved targets are written to the receipt.

Assessment reports one of `current`, `install`, `upgrade`, `downgrade`,
`reconfigure`, or `conflict`, the current and desired pack identities, and every resource in a
stable exact diff. Resource actions are `create`, `update`, `delete`,
`adopt`, `unchanged`, `preserve`, or `conflict`. `adopt` records an existing
byte-identical managed resource without rewriting it. `preserve` is used for seed resources
and for seed resources retired from a newer pack. A conflicting assessment is
not applicable. The assessment also reports the planned `mdbase.lock.yaml`
action (`create`, `update`, or `unchanged`) and its resulting digest, so storage
adapters can persist the complete authority transaction without inferring
hidden engine writes.

`reconfigure` means the exact same immutable pack is being resolved to different
collection targets. Managed resources are relocated only when their installed
bytes are unchanged; modified resources conflict. Seed resources are never
moved or deleted automatically. A caller may name seed targets in
`preserve_seed_targets` to record an intentional omission, such as when a user
maps the contract to an existing type instead of accepting the starter. Unknown
or non-seed preservation targets MUST be rejected.

When guided setup maps a provided contract to an existing user-owned type, the
reviewed `contract_setups` choices are part of the same assessment and apply.
The assessment reports their exact type-resource diff and binds the selected
type revisions, field mappings, and bindings into `assessment_digest`. Apply
MUST stage those edits together with the managed resources and lock, validate
the combined collection, and commit them in the same transaction. A stale type
revision therefore leaves both the user-owned type and every pack resource
unchanged. A connector MUST NOT install the pack first and apply the reviewed
mapping as a later independent mutation.

The assessment includes a deterministic `assessment_digest` over the desired
pack identity, current lock entry, and every relevant live target digest. Apply
MUST recompute it inside the collection mutation boundary and fail with
`concurrent_modification` before writing when it differs. Downgrades require an
explicit `allow_downgrade` decision.

An unmanaged target with different bytes is a conflict unless the assessment
request contains an explicit adoption decision naming that target and its exact
current digest. An accepted adoption may plan `update`, records the adopted
digest in the diff, and is covered by `assessment_digest`. This is the safe
upgrade bridge for collections created before pack receipts existed: tools can
show the files that will become package-managed, require informed approval, and
remain race-safe. Unknown targets, seed targets, and stale adoption digests MUST
be rejected. Adoption is never inferred from application access or install
intent.

A pack-aware apply implementation MUST:

1. validate the manifest, safe paths, source bytes, and resource digests
2. stage every resource and reviewed existing-type setup without changing the live collection
3. resolve the complete staged contract and type registries
4. validate every contract, implementation, type, reference, and affected
   existing record
5. compute and present the exact resource diff and assessment digest
6. acquire its collection mutation boundary and recheck the assessment
7. commit all resource changes and the lock as one recoverable transaction
8. reopen the collection and verify the committed registry and lock

An invalid resource aborts before any live write. A conflict or concurrent
change aborts with the live collection unchanged. Implementations may use an
atomic directory exchange or a durable backup journal with rollback. After a
crash, recovery MUST restore either the complete pre-install state or the
complete committed state before normal collection operations resume.

Revoking an application's access does not uninstall its type pack. Uninstall is
a separate, explicitly requested operation because records may still depend on
the installed types.

Applying a current pack is valid and reports every managed resource as
`unchanged`; it MUST NOT create a new logical collection revision. Applying an
upgrade deletes a retired managed target only when its live digest still
matches the lock. User-modified managed resources produce `conflict` and no
live write. Successful apply reports the committed receipt, exact resource
diff, and `cleanup_deferred` when transaction-journal cleanup must be retried.

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
| `invalid_type_pack` | a pack manifest, lock, resource, path, or digest is invalid |
| `type_pack_conflict` | ownership, live bytes, or an untracked target prevents a safe apply |
| `type_pack_apply_failed` | transactional commit or recovery did not complete normally |

Diagnostics use the canonical shape from Chapter 14 and identify the contract
ID, exact version, type name, and relevant field mapping in `details`.
