# 09. Lifecycle

## Purpose

`lifecycle` defines deterministic mutation-time behavior for managed fields.

Lifecycle is part of Core Write behavior and runs independently of the workflow
runtime.

## Events

Lifecycle policy runs on:

- `on_create`, during a create operation
- `on_update`, during an update operation, including an update that only
  changes the body

Rename and delete do not run lifecycle policy. Behavior triggered by those
operations belongs to workflows.

## Actions

The value of each event is one action or a non-empty list of actions. An action
contains a `set` mapping and an optional CEL guard `if`:

```yaml
lifecycle:
  on_create:
    - if: '!has(raw.id)'
      set:
        id: { ulid: true }
    - set:
        dateCreated: { now: true }
        dateModified: { now: true }
  on_update:
    set:
      dateModified: { now: true }
```

Each key of `set` is a field reference as defined in Chapter 07, and each value
is a value provider. `set` always assigns: it replaces a value that the caller
supplied or that already exists. A guard such as `'!has(raw.id)'` limits an
assignment to records where the field is missing.

Actions run in list order. Each guard evaluates against the draft as modified by
the preceding actions. All providers in one `set` read the draft as it was
before that action, and its assignments then apply together. When two actions
of one type assign the same field, the later assignment wins.

## Standard Value Providers

Core lifecycle providers:

| Provider | Meaning |
| --- | --- |
| `{ now: true }` | current instant as an RFC 3339 date-time in UTC with `Z` |
| `{ today: true }` | current date in the operation timezone, as an RFC 3339 `full-date` |
| `{ uuid: true }` | random UUID in lower-case canonical form |
| `{ ulid: true }` | random ULID in upper-case Crockford Base32 |
| `{ slugify: fieldRef }` | slug of another field's string value |
| `{ copy: fieldRef }` | copy of another field's value |
| `{ literal: value }` | the literal value |

`now` and `today` use the operation's captured instant, so every provider in one
operation observes the same time. The operation timezone follows the same
precedence as the query timezone in Chapter 11.

`slugify` lowercases the value, transliterates it to ASCII where a
transliteration exists, replaces each run of other characters with `-`, and
trims leading and trailing `-`. A missing, null, or non-string source value
produces null. `copy` of a missing field removes the target key.

## Guards

Lifecycle guards use the lifecycle CEL context from Chapter 10:

- current draft frontmatter fields at top level, and as `record` and `raw`
- `old` for the previous raw frontmatter on update
- `file` for file metadata
- `operation` for operation metadata

`old` is a map, so a guard that reads a field that may be missing from the
previous record uses `has()` or optional selection:

```yaml
lifecycle:
  on_update:
    - if: 'old.?status.orValue(null) != status && status == "done"'
      set:
        completedDate: { today: true }
```

A guard that fails to compile invalidates the type definition. A guard that
raises an evaluation error fails the operation with
`lifecycle_expression_error`. A guard that evaluates to anything other than
boolean `true` skips its action.

## Validation Order

For create and update:

1. parse input
2. build a draft frontmatter object
3. determine and freeze type membership from the draft and target path
4. apply the lifecycle actions of every matched type
5. re-evaluate membership and fail with `type_membership_changed` if it differs
6. validate JSON Schema
7. run collection validators
8. write the file

Lifecycle MUST run before final validation so generated IDs and timestamps can
satisfy required schema fields. Chapters 05 and 12 define membership freezing.

Read defaults MUST NOT run as lifecycle policy unless a write operation
explicitly asks to materialize them.

## Relationship To Workflows

Lifecycle is deterministic, local, and operation-scoped.

Workflows are event/action orchestration. They may read or write records, call
agents, request approvals, run commands, or produce run state.

Generated IDs and timestamps belong in lifecycle. Cross-record automation and
agent work belong in workflows.

## Conflicts

When several matched types define lifecycle policy for the same event, each
type's actions run as one unit and types run in matched-type order. The result
MUST NOT depend on that order:

- identical normalized assignments to the same field from different types are
  allowed and execute once
- different assignments to the same field from different types are
  `type_conflict` errors before any write, whether or not their guards would
  run
- diagnostics MUST report the type names and lifecycle paths involved
