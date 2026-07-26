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
- read_view_source
- create_view_source
- update_view_source
- delete_view_source

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
8. choose or validate path policy
9. write Markdown file
10. update derived indexes
11. emit watch/runtime events after state is consistent

Static JSON Schema defaults MAY be used by editor and create interfaces.
Validation-time mutation occurs when the create operation explicitly copies a
default into the draft.

## Update

Update modifies an existing record.

Pipeline:

1. read existing raw frontmatter
2. apply the requested patch
3. re-match and freeze types when type-affecting fields or path changed
4. apply lifecycle `on_update`
5. verify type membership did not change as a lifecycle side effect
6. validate JSON Schema
7. run collection validators
8. write frontmatter and preserve body
9. update derived indexes
10. emit watch/runtime events

If a patch sets a field to missing, the key is removed. If a patch sets a field
to null, the key is persisted as null unless the operation policy says null
means remove.

## Delete

Delete removes a record.

Tools supporting link/reference profiles SHOULD optionally report broken
backlinks before deleting.

Delete is a Core Write operation and MAY emit an event for workflow runtimes.

## Rename

Rename moves a record within the collection.

Tools MUST reject target paths that escape the collection root.

If reference updating is enabled, link updates SHOULD preserve link style,
alias, and anchor where possible. ID-based links SHOULD not be rewritten if the
target ID did not change.

Atomic reference updates across all affected files belong to a transaction
profile.

## Batch

Batch operations group operations for validation and reporting.

Recommended behavior:

- validate every operation before writing unless `allow_partial` is true
- support dry-run with full diagnostics
- report per-operation result and diagnostics
- stop on first error unless configured otherwise

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
`source.writable` describes whether the provider accepts writes for that source
format. Each nested descriptor exposes the stable named-view ID, its display
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

### Saved-view source operations

A provider that advertises a source as `writable: true` MUST support the four
saved-view source operations. These operations exchange the complete source
document so format-aware editors can preserve source data they do not
interpret.

`read_view_source` accepts a `path` from `list_views` and returns:

```yaml
path: TaskNotes/Views/tasks.base
format: obsidian.base
revision: sha256:opaque
document: |
  views:
    - type: tasknotesTaskList
      name: Tasks
```

`create_view_source` accepts `document` and may accept `path`, `format`, and
`name`. When `path` is absent, the provider selects a collection-relative path
using the requested format and the collection's format configuration. Creation
MUST validate the complete document and MUST fail with `path_conflict` rather
than replace an existing source.

`update_view_source` accepts `path`, `document`, and optional `if_revision`.
The complete candidate document MUST be valid before the current source is
atomically replaced. `delete_view_source` accepts `path` and optional
`if_revision`.

All source operations apply the collection's path-boundary and symlink rules.
Update and delete use the concurrency behavior defined below. A successful
create or update returns the same fields as `read_view_source`; a successful
delete returns `path` and `deleted: true`.

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

Dry runs return operation-specific preflight results rather than record
documents. They use the same envelope and MUST NOT change files, indexes,
runtime state, or revisions.

## Events

After a successful mutation, tools MAY emit watch/runtime events. Events MUST be
delivered after the derived read/query state is consistent. Watch consumers and
workflow runtimes may subscribe to the same stream.
