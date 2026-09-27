# @mdbase/cel-host

Prototype host-binding package for the mdbase v0.3 CEL profile.

This package exists to make the CEL boundary concrete. It builds the activation
object that mdbase passes to a CEL engine and evaluates expressions through
[`@marcbachmann/cel-js`](https://github.com/marcbachmann/cel-js) with optional
types enabled, following the standard CEL semantics required by Chapter 10.

## Activation Shape

Record expressions receive:

- effective frontmatter fields at the top level, for ergonomic filters such as
  `status == "open"`; an unreserved identifier naming a missing field is null
- `record`: effective frontmatter, including `collection.read_defaults`
- `raw`: persisted frontmatter only
- `file`: file metadata, body, tags, links, and embeds

Reserved system names are never shadowed. Use `record.<field>` or `raw.<field>`
when a collection has a frontmatter field named `file`, `raw`, or `record`.

Presence checks use CEL's `has()` macro, which tests map key presence even when
the value is null:

- `has(raw.status)` is true when `status` exists in persisted frontmatter
- `has(record.status)` is true when `status` exists in the effective record,
  including values supplied by `collection.read_defaults`

Selecting a missing key, such as `raw.status` when `status` is absent, is a CEL
evaluation error. Null-safe access uses optional selection:
`raw.?status.orValue("none")`.

YAML integers are CEL `int` values and other numbers are `double`. Dates are
RFC 3339 `full-date` strings; fields named in `dateTimeFields` become CEL
timestamps. `today()`, `date(timestamp)`, and `startOfDay()` use the
`timezone` passed to `evaluateCel`, and `now()` uses its `now` instant.

Workflow expressions receive:

- `event`
- `steps`
- `vars`
- optional `item`

## Local Verification

```bash
npm test --prefix packages/cel-host
```
