# 11. Querying

## Query Object

A query selects records from a collection. The canonical query-object schema is
`schemas/v0.3/query.schema.json`.

```yaml
types: [task]
context:
  this:
    path: projects/alpha.md
projections:
  is_overdue:
    expr: 'present.record.due && due < today() && status != "done"'
where: 'status != "done" && priority >= 3'
select:
  - title
  - due
  - projection.is_overdue
order_by:
  - field: due
    direction: asc
limit: 20
offset: 0
include_body: false
```

Unknown query members are invalid. `x-*` members MAY carry adapter metadata but
MUST NOT change the meaning of portable members.

Schema violations and semantic preflight failures such as cyclic projection
dependencies or duplicate result names produce `invalid_query` and abort before
candidate evaluation.

## Types

`types` is an OR filter. A record is included if it matches at least one listed
type.

If `types` is omitted, all records are candidates.

## Invocation Context And `this`

A query MAY bind one collection record as its invocation context:

```yaml
context:
  this:
    path: projects/alpha.md
```

The path is collection-relative and MUST resolve to an ordinary record in the
same collection. The implementation reads the context through the same raw and
effective-value pipeline as any other record, snapshots it once before
candidate evaluation, and binds it to `this` as defined in Chapter 10.

When no context is supplied, `this` is null. Supplying an unresolved context
produces `context_not_found` and aborts the query before candidate evaluation.
An invalid context is handled according to the collection validation level.

Query time, timezone, and collection state are fixed for the context and all
candidates in one execution. A caller MUST NOT replace or mutate the context
between candidate evaluations.

## Named Projections

Queries MAY define named projections evaluated for every candidate before the
filter:

```yaml
projections:
  is_overdue:
    expr: 'present.record.due && due < today() && status != "done"'
  urgency:
    expr: 'priority + (projection.is_overdue ? 10 : 0)'
```

Projection names are available under `projection.<name>` in subsequent
projection expressions, `where`, selection expressions, ordering, grouping,
summaries, and presentation mappings.

Implementations MUST resolve projection dependencies deterministically and
reject direct or indirect cycles before evaluating candidates. A projection
evaluation error produces null for that candidate and a per-record diagnostic;
it does not abort evaluation of other candidates.

Named query projections are effective query values. They are not persisted and
do not replace raw or effective frontmatter fields with the same name.

## Where

`where` is a CEL expression evaluated against the effective candidate and its
named projections. The expression result includes the record only when it is
boolean true.

Evaluation errors MUST produce null for that record, exclude it, and report a
diagnostic according to query options.

## Selection

Queries MAY request a logical result shape:

```yaml
select:
  - title
  - file.path
  - projection.is_overdue
  - name: display_due
    expr: 'due == null ? "Unscheduled" : string(due)'
    label: Due
```

A string selects an effective field, file value, or named projection. An object
defines a named CEL result value. Selection expressions run after filtering and
may use the candidate, named projections, and `this`.

For a string selector, the output name is the effective-field name or the final
member of a `file.<name>` or `projection.<name>` selector. An object uses its
required `name`. Two selections that produce the same output name make the
query invalid; callers use an object selection to assign an unambiguous name.

Computed selection values belong to the query result. Persistence requires an
explicit write operation. Every result includes `file.path` in its `file`
object even when `file.path` is not selected.

## Ordering

`order_by` sorts by one or more effective fields, file values, named
projections, or named selection values.

```yaml
order_by:
  - field: due
    direction: asc
  - field: projection.urgency
    direction: desc
```

Null values sort last in ascending order and first in descending order.

When all ordering fields compare equal, tools MUST tie-break by ascending
`file.path` for deterministic results.

## Grouping And Summaries

Queries MAY group the complete filtered and ordered result set by one or more
values:

```yaml
group_by:
  - field: status
    direction: asc
```

Each distinct ordered tuple of grouping values creates one group. Null and
missing values form the same null group. Group tuple ordering applies the same
direction and null rules as `order_by`. Results within a group retain query
order.

Queries MAY define custom summary functions and apply built-in or custom
functions to values:

```yaml
summary_functions:
  completion_rate:
    expr: 'values.size() == 0 ? 0 : values.filter(v, v).size() * 100 / values.size()'

summaries:
  - field: estimate
    function: sum
    name: total_estimate
  - field: projection.is_completed
    function: completion_rate
    name: completion_rate
```

A custom summary expression receives `values`, an ordered list containing one
value per matching result in result order. Missing fields contribute null.
When grouping is active, the function is evaluated independently for each
group; otherwise it is evaluated once for the complete match set.

A summary's result key is its explicit `name`, or its `function` identifier when
`name` is omitted. Duplicate result keys make the query invalid.

The portable built-in summary identifiers are `count`, `sum`, `average`,
`minimum`, `maximum`, `earliest`, `latest`, `empty`, and `filled`. `count`
counts all values. `empty` and `filled` count empty and non-empty values using
the CEL missing/null contract. Other built-ins ignore null values and produce
null when no compatible non-null value exists. Incompatible non-null values
produce a summary diagnostic and a null summary result.

Grouping and summaries are calculated before pagination and therefore describe
the complete filtered match set. Group metadata does not replace the flat
`results` page.

## Pagination

`limit` and `offset` apply after filtering and sorting.

`limit: 0` returns an empty result page. Total count, grouping, and summary
metadata still describe the complete match set.

## Body Search

`file.body` MAY be used in filters even when `include_body` is false. In that
case the body is available for filtering but not returned in results.

Tools MAY report that body filtering requires a profile or index when they
cannot read bodies on demand.

## Frontmatter Mode

`frontmatter_mode` controls which fixed-semantics frontmatter members appear in
each result:

- `effective` (the default) returns `effective_frontmatter`
- `persisted` returns `frontmatter`
- `both` returns both `frontmatter` and `effective_frontmatter`

The mode changes result serialization only. Filtering, projections, selection,
ordering, grouping, and summaries continue to use effective values unless an
expression explicitly reads the persisted namespace. Unlike a complete record
document returned by Core Read or a mutation, a query result is a summary and
MAY omit the member excluded by the requested mode.

## Result Envelope

Query results MUST use this envelope:

```yaml
results:
  - file:
      path: tasks/fix-login.md
    effective_frontmatter:
      title: Fix login
      status: open
    values:
      title: Fix login
      is_overdue: true
meta:
  total_count: 1
  has_more: false
  context:
    path: projects/alpha.md
  groups:
    - values:
        status: open
      count: 1
      summaries:
        total_estimate: 30
diagnostics: []
```

Each result MUST include `file.path`. `meta.total_count` is the count before
pagination, and `meta.has_more` is true when additional matching records remain.
Diagnostics use the canonical diagnostic envelope from the conformance chapter.

Read defaults are included in `effective_frontmatter`. `values` contains
requested selection values and is omitted when `select` is omitted.

`meta.context.path` identifies the bound invocation context and is omitted when
`this` is null. `meta.groups` is present only when grouping or summaries were
requested. Without grouping, summaries appear in one group whose `values` is an
empty object.

## Saved View Records

A saved view is an ordinary Markdown record matched by the `view` type. The
canonical query object above supplies its execution semantics, and the view
record provides a portable persisted container. The canonical record schema is
`schemas/v0.3/view.schema.json`; a collection can materialize the corresponding
`_types/view.md` type file.

One view record contains a shared canonical query fragment and one or more
named views. The shared fragment is nested under `query` so its `types` member
cannot be mistaken for the record-level explicit type declaration:

```markdown
---
type: view
id: tasknotes.tasks
version: 1
name: Task views

query:
  types: [task]
  projections:
    urgency:
      expr: 'priority + (due < today() ? 10 : 0)'

views:
  - id: today
    name: Today
    where: 'due == today() || scheduled == today()'
    select: [title, due, projection.urgency]
    order_by:
      - field: projection.urgency
        direction: desc
    presentation:
      type: tasknotes.task-list
      fallback: mdbase.table
---

# Task views

Reusable task views for editors, CLIs, and agents.
```

### Named-view resolution

A named view is addressed by the view record path or stable record ID plus the
named-view ID. Human-readable names are not identifiers. Duplicate named-view
IDs make the view record invalid.

To derive an executable query:

1. inherit `query.types` unless the named view supplies `types`
2. combine `query.where` and named-view `where` with AND
3. merge `query.projections` and named-view projections; the same name may appear in both
   only when its parsed definition is structurally equal, ignoring mapping key
   order
4. inherit `query.context` unless the named view supplies context
5. copy the named view's selection, ordering, grouping, summaries, pagination,
   and body options
6. bind the invocation context using the rules below

Record-level property metadata and summary functions remain available to every
named view. Resolving an unknown view record or named-view ID produces
`view_not_found`.

View execution returns the query envelope and adds
`meta.view: { path, id }`, using the resolved view-record path and named-view
ID.

Property-metadata keys MAY name effective fields, `file.*` values,
`projection.*` values, or selection outputs. They provide labels, descriptions,
format hints, and visibility hints. `select` remains the source of result
values.

### View invocation context

View records declare what to do when the caller supplies no context:

```yaml
query:
  context:
    this:
      on_missing: view
      types: [project]
```

`on_missing` values are:

| Value | Behavior |
| --- | --- |
| `view` | bind the view-definition record; default |
| `null` | bind `this` to null |
| `error` | abort with `context_required` |

An explicitly supplied context always wins. If `types` is present, a non-null
context must match at least one listed type or execution aborts with
`context_type_mismatch`. A named-view context declaration replaces, rather than
partially merges with, the shared `query.context` declaration.

An embedding host supplies the embedding record. A headless caller supplies a
collection-relative record path. An editor may map an active record to the
explicit invocation context, but ambient concepts such as workspace leaves or
sidebars are not part of portable execution.

### Presentation

`presentation.type` and `presentation.fallback` are open renderer identifiers,
not a closed enumeration. `select` defines the portable logical result shape;
presentation mappings and options describe how a supporting tool may render
that result.

Each `presentation.mappings` key is a renderer-defined role and its value names
an output produced by `select`. Selected named projections are therefore
available to presentation without giving presentation its own projection
language. A named view with no `presentation` is a complete headless saved
query.

Saved-view discovery exposes the selected outputs as ordered property
descriptors. A renderer uses those descriptors to preserve selection order and
labels while reading the corresponding values from each result row.

Presentation metadata is advisory. Filtering, projection, ordering, grouping,
summaries, pagination, and the headless result envelope retain their canonical
query semantics. Headless execution succeeds for every renderer identifier. A
request for rendered output reports `unsupported_presentation` when neither the
requested renderer nor its declared fallback is available.

Source syntax, renderer configuration, and round-trip data use `x-*`
extensions. Chapter 15 defines the adapter contract for Obsidian Bases sources.

### Optional support

Core Read implementations treat a canonical view file as an ordinary typed
record. A tool advertises `view_records` in its `optional_features` claim when
it resolves, lists, and executes named views with the semantics in this
chapter.
