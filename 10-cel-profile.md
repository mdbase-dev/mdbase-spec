# 10. CEL Profile

## Purpose

Portable v0.3 expressions use CEL. This chapter defines the data available to an
expression, mdbase host functions, missing-value behavior, limits, and error
handling.

The base `cel` conformance profile covers this shared expression model. Features
that embed CEL add their own context requirements: `cel_match`, `cel_query`,
Lifecycle, and Workflow.

Each containing object defines how source text is stored. Query `where` uses a
string, while `match.expr` and workflow expression values use an object such as:

```yaml
$expr: 'status == "open"'
```

Plain strings in workflow inputs remain literal strings.

## Expression Locations

CEL appears in:

- `match.expr`
- query filters and projections
- collection projections
- lifecycle guards
- workflow variables, conditions, inputs, iteration, and run policy

`match.where` uses the structured predicate language from Chapter 07.

Tools may translate another user-interface expression language to CEL before
writing portable records. A stored alternate dialect uses an `x-*` extension
whose owner defines its semantics.

## Evaluation Contexts

Every expression location has a context contract. A host supplies exactly the
system bindings listed for that context, along with the applicable top-level
record fields.

| Context | Available values |
| --- | --- |
| inferred match | candidate raw fields at top level; `record`, `raw`, `present`, `file`, `note` |
| query or projection | effective candidate fields at top level; `record`, `raw`, `present`, `file`, `note`; `projection`; `this` as the invocation-context record or null |
| query summary | `values`; the fixed operation time and timezone |
| lifecycle guard | current draft fields at top level; `record`, `raw`, `present`, `old`, `file`, `operation` |
| workflow variable, trigger, or workflow condition | `event`, `workflow`, `trigger`, `vars` |
| workflow step condition or input | `event`, `workflow`, `trigger`, `steps`, `vars`; `item` during iteration |
| workflow run-policy expression | `event`, `workflow`, `trigger`, `vars` |

An unavailable system binding is a compile or preflight diagnostic. For example,
`steps` is unavailable to a trigger condition because no step has run.

The system names `record`, `raw`, `present`, `file`, `note`, `projection`,
`this`, `values`, `old`, `operation`, `event`, `workflow`, `trigger`, `steps`,
`vars`, and `item` are reserved. A frontmatter field with one of those names
remains available through `record.<field>` and `raw.<field>`.

### Query Context

In a query, top-level fields and `record` contain effective values. `raw`
contains persisted frontmatter. `note` is an alias for `record`.

```cel
present.raw.status == false && record.status == "open"
```

`file` supplies the candidate metadata and helpers defined by the collection,
query, and link profiles. `projection` contains named query projections after
their dependency-ordered evaluation.

`this` is reserved for the query invocation-context record. It is null when no
context is bound. A non-null context mirrors the candidate query namespaces:

- `this.<field>`, `this.record.<field>`, and `this.note.<field>` expose
  effective context values
- `this.raw.<field>` exposes persisted context frontmatter
- `this.present.record.<field>` and `this.present.raw.<field>` expose presence
- `this.file` exposes context-file metadata and the helpers available to the
  active profiles

When an effective context field conflicts with the reserved members `record`,
`note`, `raw`, `present`, or `file`, it remains available through
`this.record.<field>` and `this.raw.<field>`.

The host resolves and snapshots the context once before evaluating candidates.
All candidates see the same immutable context, operation time, and timezone.
Context link values and `this.file` helpers resolve relative to the context
record; candidate values and `file` helpers resolve relative to the candidate.
`this` is record-only and MUST NOT be repurposed as an arbitrary caller
parameter map. A feature that adds parameters uses a distinct binding and
declares its own context contract.
Chapter 11 defines portable context binding and saved-view invocation.

### Matching Context

In `match.expr`, the candidate has not yet acquired a type. `record`, `raw`,
`note`, and top-level field names therefore refer to the same raw frontmatter
object. `present.record` and `present.raw` contain the same values.

```cel
file.inFolder("tasks") && present.raw.tags && tags.exists(t, t == "task")
```

Read defaults and projections enter after matching and are absent from this
context.

### Lifecycle Context

Lifecycle expressions evaluate against the current write draft. Top-level
fields, `record`, and `raw` contain that draft. On update, `old` contains the
previous raw frontmatter. `operation` describes the active create or update and
`file` describes its target path and available metadata.

```cel
old.status != status
```

### Workflow Context

Workflow expressions use the validated event envelope and workflow metadata.
Trigger and run-policy expressions execute before steps. Step expressions also
receive the standard results of completed steps. Iteration adds the current
item under the configured iteration name, with `item` as the default.

```cel
event.data.zone.id
```

```cel
steps.patch_status.output.path
```

Chapter 14 defines when each workflow expression is evaluated.

## Missing And Null

mdbase preserves four observable record states:

| Raw state | Effective state | `present.raw` | `present.record` | Top-level query value |
| --- | --- | --- | --- | --- |
| missing, no default | missing | `false` | `false` | `null` |
| missing, read default | default value | `false` | `true` | default value |
| explicit null | null | `true` | `true` | `null` |
| persisted value | persisted value | `true` | `true` | persisted value |

Hosts MUST make missing record fields evaluate to null and presence entries
evaluate to false. `present` includes schema-known, persisted, and defaulted field
names so these checks do not depend on host map-access behavior.

Property access through null returns null. Type errors in query evaluation also
yield null and produce an expression diagnostic; a query filter includes only a
record whose condition evaluates to boolean true.

Portable frontmatter-presence checks use `present.raw.<field>`.
`present.record.<field>` tests effective presence. CEL's `has()` macro remains
available for objects whose host representation has ordinary CEL presence
semantics, such as event payload objects.

## Date And Duration

The profile defines these host functions:

- `now()`
- `today()`
- `duration(string)`

`now()` returns an RFC 3339 UTC date-time. `today()` returns the calendar date in
the runtime's declared timezone. The operation or runtime context MUST declare
that timezone. `duration(string)` accepts ISO 8601 durations in portable stored
expressions.

Timestamp comparison uses the represented instant. Date comparison uses the
calendar date. Date, time, timestamp, and duration values have stable
serialization across reads and query results.

## File And Link Helpers

Core Read supplies file metadata and:

- `file.inFolder(path)`

The Links profile adds:

- `link(value)`
- `file.hasTag(tag)`
- `file.hasLink(linkValue)`
- `file.asLink()`
- `linkValue.asFile()`

`asFile()` returns null for an unresolved link. Traversal depth is bounded as
described below. Expressions can use helpers supplied by every profile in the
implementation's conformance claim.

## Limits

Implementations MUST bound expression source size, AST depth, evaluation work,
and link traversal. The portable minimum supported limits are:

| Limit | Minimum supported value |
| --- | --- |
| expression source | 64 KiB |
| AST depth | 100 |
| link traversal depth | 10 |

Hosts SHOULD also bound list iteration, elapsed evaluation time, and memory.
Operational limits are reported in conformance claims. Exceeding a limit
produces a diagnostic identifying the limit and configured value.

## Compilation And Evaluation Errors

All stored expressions MUST compile during preflight of their containing type,
query, lifecycle policy, workflow, or runtime object. Parse and type errors
invalidate that containing object.

Evaluation outcomes depend on context:

| Context | Evaluation error |
| --- | --- |
| inferred match | report a diagnostic and treat the candidate as a non-match |
| query filter or projection | yield null for that record and report a diagnostic |
| lifecycle guard | fail the write operation with `lifecycle_expression_error` |
| workflow trigger or workflow condition | create a failed-run diagnostic |
| workflow step or run policy | fail the step or run with a runtime diagnostic |

A condition that evaluates normally to false or null does not match or execute.

Diagnostics SHOULD include the source, code, message, context name, and line,
column, or byte range when available. Parse/type diagnostics and runtime
evaluation diagnostics use distinct codes.
