# 12. Operations

## Operation Model

Write-capable tools operate on Markdown files while preserving the collection
contract.

Core operations:

- read
- create
- update
- delete
- rename
- batch

Optional saved-view operations:

- list_views
- execute_view

## Read

Read returns a record by path, including:

- persisted `frontmatter`
- derived `effective_frontmatter`
- body
- file metadata
- matched type names
- diagnostics

Read MUST NOT write defaults or lifecycle values to disk.
Every successful read returns the complete record document defined in Chapter
03.

Read accepts optional `include_document`. When true, the returned record MUST
include the exact `document` source defined in Chapter 03. Providers that
cannot supply exact source MUST reject the request rather than silently return
a reconstructed serialization.

## Create

Create builds a new record.

Pipeline:

1. determine target type or types from explicit input or path/match policy
2. build draft frontmatter
3. freeze pre-lifecycle type membership
4. apply lifecycle `on_create`
5. verify type membership did not change as a lifecycle side effect
6. validate JSON Schema
7. run collection validators
8. choose or validate path policy; the final path's extension fixes the
   record's format (Chapter 03), and a body is rejected when that format is a
   YAML document
9. write Markdown file
10. update derived indexes
11. emit watch/runtime events after state is consistent

Static JSON Schema defaults MAY be used by editor and create interfaces.
Validation-time mutation occurs when the create operation explicitly copies a
default into the draft.

### Selected types and membership representation

A request-level type selector identifies the type the caller intends to create;
it is not itself a persisted frontmatter declaration. Contract selection MUST
resolve and validate its designated implementing type before writing.

When explicit declaration keys are configured, implementations MUST persist a
selected type using those keys, preserving existing valid memberships. They
MUST NOT hard-code `type` or `types` when those keys are not configured. A field
outside the configured declaration keys remains ordinary application data.

When `settings.explicit_type_keys` is empty, implementations MUST NOT add a type
declaration field and MUST NOT reject a create solely because the list is empty.
The selected type guides schema, lifecycle, and path policy. Membership is
inferred from persisted frontmatter and the final canonical path. The selected
(or contract-designated) type MUST be included in the final inferred membership;
otherwise the operation MUST fail without writing a record. All applicable
types participate in validation, not only the requested type. Matching errors
MUST NOT be silently treated as non-matches.

The pre-lifecycle membership freeze and final membership check still apply.
Read defaults and projections are not persisted evidence of membership. A
successful create guarantees membership for the written record under the
current collection rules, not permanent membership after later user edits.

## Update

Update modifies an existing record.

Pipeline:

1. read existing raw frontmatter
2. apply the requested `patch` and `unset`
3. re-match and freeze types when type-affecting fields or path changed
4. apply lifecycle `on_update`
5. verify type membership did not change as a lifecycle side effect
6. validate JSON Schema
7. run collection validators
8. write frontmatter and preserve body
9. update derived indexes
10. emit watch/runtime events

A structured update accepts:

- `patch`: an object whose top-level keys are set to the supplied values,
  replacing any existing value; a null value persists an explicit null
- `unset`: a list of field references, as defined in Chapter 07, whose keys are
  removed from persisted frontmatter
- `body`: optional replacement Markdown body; a non-empty body for a YAML
  document record (Chapter 03) is `invalid_request`

Unsetting a key that is already missing is not an error. A request that names
the same field in `patch` and `unset`, names a field inside a key that `patch`
replaces, or uses an `unset` reference that selects an array item, is invalid
and produces `invalid_request` before any write. When `unset` removes the last key of a
nested object, the now-empty object remains.

As an alternative to a frontmatter patch and body replacement, Update accepts
`document` containing the complete candidate source in the record's format:
Markdown source for a Markdown record, or the whole YAML document for a YAML
document record. A document
replacement MUST NOT be combined with `patch`, `unset`, or `body`. The
candidate is parsed and passes through the same type matching, lifecycle,
validation, concurrency, and atomic-write pipeline as a structured update. When lifecycle policy does not alter the candidate, the exact supplied
source MUST be preserved. If policy changes persisted values, the authoritative
post-policy source MAY be reserialized and is returned when source was
requested.

Update accepts optional `include_document`. A document replacement implies
`include_document: true` for its successful result.

## Delete

Delete removes a record.

Tools supporting link/reference profiles SHOULD optionally report broken
backlinks before deleting.

Delete is a Core Write operation and MAY emit an event for workflow runtimes.

## Rename

Rename moves a record within the collection. It accepts `from` and `to`
collection-relative paths, optional `if_revision`, and optional `update_refs`.

Tools MUST reject target paths that escape the collection root.

If reference updating is enabled, link updates SHOULD preserve link style,
alias, and anchor where possible. ID-based links SHOULD not be rewritten if the
target ID did not change.

An implementation MAY commit a rename and its reference updates as one atomic
batch. Otherwise reference updates are applied after the rename, and failed
reference updates are reported per file.

## Batch

Batch applies a list of create, update, delete, and rename operations as one
request:

```yaml
operations:
  - kind: update
    input:
      path: tasks/a.md
      patch: { status: done }
      if_revision: sha256:opaque
  - kind: rename
    input:
      from: tasks/b.md
      to: archive/b.md
dry_run: false
allow_partial: false
```

Each item names its operation `kind` and that operation's `input`. A request
that names one record path more than once, through `path`, `from`, or `to`,
fails with `duplicate_batch_path` before any operation is prepared, so the
items of one batch never depend on each other.

**Atomic execution** is the default. The implementation prepares every
operation, including lifecycle, type membership, schema and collection
validation, path policy, and `if_revision`, against a staged copy of the
collection. If any operation fails, nothing is written. Otherwise all changes
commit as one recoverable transaction: after a failure or crash, recovery
restores either the complete pre-batch state or the complete committed state
before normal collection operations resume.

**Partial execution** is selected with `allow_partial: true`. Each operation is
prepared and committed independently in request order, and a failed operation
does not prevent the others. A host that can commit only one atomic transaction
per request, such as a durable runtime action, MAY reject `allow_partial` with
`invalid_request`.

**Dry runs** with `dry_run: true` prepare every operation and report the
results without changing files, indexes, runtime state, or revisions.

The result lists every operation in request order:

```yaml
operations:
  - index: 0
    kind: update
    valid: true
    result: {}
    diagnostics: []
succeeded: 1
failed: 0
preflight: false
dry_run: false
```

`result` holds the operation's own result on success. `preflight` is true when
the operations ran only against the staged copy, which happens for a dry run or
a failed atomic batch. The envelope's `valid` is false when any operation
failed.

Watch notifications and runtime events for an atomic batch are delivered after
the whole batch commits. For a partial batch they follow each committed
operation.

## Saved Views

`list_views` discovers the saved-view sources available through the collection
provider. Its result has this shape:

```yaml
valid: true
result:
  views:
    - id: task.views
      name: Task views
      source:
        path: views/tasks.md
        format: mdbase.view
        revision: opaque-source-revision
        writable: true
      views:
        - id: today
          name: Today
          properties:
            - key: title
              label: Task
            - key: urgency
              label: Urgency
          presentation:
            type: tasknotes.task-list
  meta:
    total_count: 1
diagnostics: []
```

`source.path` is a collection-relative path. `source.format` is a stable source
format identifier. `source.revision` is an opaque token for the source content.
`source.writable` is true when the source is a record, whose type implements
`mdbase.view` or `obsidian.base`, and is edited with the record operations.
It is false for a source that is not a record. Each nested descriptor exposes the stable named-view ID, its display
name, and its optional presentation metadata. Discovery order is ascending by
source path and then source-defined named-view order.

`properties` lists the named view's result values in display order. Each entry
has the result `key` and may include `label`, `description`, `format`, and
`hidden` metadata. Canonical view records derive this list from `select`.
Compatible external sources derive it from their ordered property list and
property metadata. Projection and formula results use the same descriptors as
persisted fields.

Malformed configured sources are omitted from `result.views` and reported as
warning diagnostics. Reading a malformed source explicitly produces
`invalid_view`.

`execute_view` accepts:

```yaml
path: views/tasks.md
view: today
context:
  path: projects/alpha.md
limit: 50
offset: 0
render: false
```

`path` and `view` select a descriptor returned by `list_views`. `context` binds
the invocation context defined in Chapter 11. `limit` and `offset` override the
named view's pagination for this invocation. The provider evaluates the
source's declared expression dialect and returns the query result envelope with
`meta.view`.

`render: false` requests the headless result and is the default. `render: true`
requests renderer output using the selected presentation metadata.

### Editing saved views

Saved views are records (Chapter 05a), so they have no dedicated write
operations. A client edits a source whose `source.writable` is true with the
record operations: `read` with `include_document` returns the complete source,
`update` with `document` replaces it exactly as supplied, preserving source
data the client does not interpret, and `create` and `delete` add and remove
sources. The record operations apply their ordinary validation, path-boundary,
symlink and concurrency rules.

## Concurrency

Write-capable tools SHOULD detect external modification between read and write
using mtime, content hash, version token, or platform-specific file identity.

On conflict, tools MUST preserve the current file and report a concurrency
diagnostic.

Successful reads MUST return a stable `revision` token derived from the raw
file state. Write operations MUST accept an optional `if_revision` token and
fail with `concurrent_modification` when it no longer matches. The token format
is implementation-defined and opaque to callers.

## Operation Result Envelope

Every operation returns a mapping with:

```yaml
valid: true
result: {}
diagnostics: []
```

`valid` is false when any error-severity diagnostic applies. Successful
`create`, `update`, and `rename` operations MUST return the complete,
authoritative post-write record document defined in Chapter 03. `rename` adds
its rename-specific metadata to that document.

The document MUST be derived from the bytes actually persisted after lifecycle
hooks, normalization, validation, and the atomic write complete. Clients and
transport adapters MUST NOT reconstruct missing document members from the
request or from another response member.

Create and rename accept optional `include_document`; when true, their
successful record document includes the exact post-write source. Update follows
the source rules above.

Dry runs return operation-specific preflight results rather than record
documents. They use the same envelope and MUST NOT change files, indexes,
runtime state, or revisions.

## Events

After a successful mutation, tools MAY emit watch/runtime events. Events MUST be
delivered after the derived read/query state is consistent. Watch consumers and
workflow runtimes may subscribe to the same stream.
