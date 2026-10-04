# 10. CEL Profile

## Purpose

mdbase has one expression language: the
[Common Expression Language](https://github.com/google/cel-spec) (CEL) with the
host bindings of this profile. Matching, lifecycle guards, collection
projections, queries, views, and workflows all use it, so one parser, one set
of semantics, and one conformance suite serve every context. This chapter
defines the values an mdbase host binds, the mdbase host functions and
types, limits, and how each embedding context handles evaluation errors.

mdbase does not change CEL's language semantics. Operators, macros, error
propagation, and the standard function library behave as defined by the CEL
specification, so conforming hosts can use an existing CEL engine.

The base `cel` conformance profile covers this shared expression model. Features
that embed CEL add their own context requirements: `cel_match`, `cel_query`,
Lifecycle, and the durable runtime.

Each containing object defines how source text is stored. Query `where` uses a
string, while `match.expr` and workflow expression values use an object such as:

```yaml
$expr: 'status == "open"'
```

Plain strings in workflow inputs remain literal strings.

## Language Requirements

Hosts MUST support:

- the CEL standard definitions, including `has()`, the comprehension macros,
  `timestamp`, `duration`, and heterogeneous numeric comparison
- the CEL optional types extension, including the `.?field` and `[?key]`
  selection syntax, `optional.of`, `optional.none`, `hasValue()`, `value()`,
  `or()`, and `orValue()`
- the mdbase host functions and bindings defined in this chapter
- the mdbase regex profile below for `matches()`

mdbase adds functions only under names that the CEL standard library does not
define, so hosts never need to overload a standard function or operator.

Optional syntax is disabled by default in several CEL engines. A conforming host
enables it for every mdbase expression context.

## Expression Locations

CEL appears in:

- `match.expr`
- query filters and projections
- collection projections
- lifecycle guards
- workflow variables, conditions, inputs, iteration, and run policy

`match.where` is a structured predicate written as YAML data (Chapter 07). It
has no expression syntax.

Other expression syntaxes are **adapter dialects**. The Obsidian Bases
filter and formula language is one: it is evaluated only by the
[Obsidian Bases adapter](./adapters/obsidian-bases.md) for records that
implement the `obsidian.base` contract. An adapter dialect is stored only in a
source format that its adapter owns or under an `x-*` extension whose owner
defines its semantics. A dialect expression never decides type membership,
validation, lifecycle, merge, or the meaning of a portable query. Tools MAY
translate a dialect to CEL before writing portable members, and MAY translate
CEL back for a user interface.

## Evaluation Contexts

Every expression location has a context contract. A host supplies exactly the
system bindings listed for that context, along with the applicable top-level
record fields.

| Context | Available values |
| --- | --- |
| inferred match | candidate raw fields at top level; `record`, `raw`, `file` |
| query or projection | effective candidate fields at top level; `record`, `raw`, `file`; `projection`; `this` as the invocation-context record or null |
| query summary | `values`; the fixed operation time and timezone |
| lifecycle guard | current draft fields at top level; `record`, `raw`, `old`, `file`, `operation` |
| workflow variable or trigger condition | `event`, `workflow`, `trigger`, `vars` |
| workflow step condition or input | `event`, `workflow`, `trigger`, `steps`, `vars`; `item` during iteration |
| workflow run-policy expression | `event`, `workflow`, `trigger`, `vars` |

An unavailable system binding is a compile or preflight diagnostic. For example,
`steps` is unavailable to a trigger condition because no step has run.

The system names `record`, `raw`, `file`, `projection`, `this`, `values`, `old`,
`operation`, `event`, `workflow`, `trigger`, `steps`, `vars`, and `item` are
reserved. A frontmatter field with one of those names remains available through
`record.<field>` and `raw.<field>`.

### Query Context

In a query, top-level fields and `record` contain effective values. `raw`
contains persisted frontmatter.

```cel
!has(raw.status) && record.status == "open"
```

`file` supplies the candidate metadata and helpers defined by the collection,
query, and link profiles. `projection` contains named query projections after
their dependency-ordered evaluation.

`this` is reserved for the query invocation-context record. It is null when no
context is bound. A non-null context mirrors the candidate query namespaces:

- `this.<field>` and `this.record.<field>` expose effective context values
- `this.raw.<field>` exposes persisted context frontmatter
- `this.file` exposes context-file metadata and the helpers available to the
  active profiles

When an effective context field conflicts with the reserved members `record`,
`raw`, or `file`, it remains available through `this.record.<field>` and
`this.raw.<field>`.

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
and top-level field names therefore refer to the same raw frontmatter object,
and frontmatter values are not typed from any schema.

```cel
file.inFolder("tasks") && has(raw.tags) && tags.exists(t, t == "task")
```

Read defaults and projections enter after matching and are absent from this
context.

Matching should be deterministic (Chapter 07). Using `now()`, `today()`,
`file.mtime`, `file.ctime`, or a helper that reads another record, such as
`asFile()`, `file.backlinks`, or `file.hasLink()`, in this context reports a
`nondeterministic_match` warning when the type loads. In 0.3.0 stable it is
an error that invalidates the type.

### Lifecycle Context

Lifecycle expressions evaluate against the current write draft. Top-level
fields, `record`, and `raw` contain that draft. On update, `old` contains the
previous raw frontmatter. `operation` describes the active create or update and
`file` describes its target path and available metadata.

```cel
old.?status.orValue(null) != status
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

The durable runtime profile defines when each workflow expression is evaluated.

## Record Values

**Provisional (rc.5).** CEL maps are unordered, but comprehensions over a
map (`all`, `exists`, `exists_one`, `map`, `filter`) visit its keys, and
`map` and `filter` return lists in that order. Maps iterate in insertion
order: frontmatter maps in the order of their keys in the source, map
literals in the order written. `string(double)` writes the RFC 8785 number
text of Chapter 07 (`1e+21`, `0.3333333333333333`, and `0` for negative zero).

Frontmatter is converted to CEL values after the JSON data-model conversion in
Chapter 06:

| JSON value | CEL value |
| --- | --- |
| object | `map(string, dyn)` |
| array | `list(dyn)` |
| string | `string`, or a timestamp as described below |
| integer-valued number written as a YAML integer | `int` |
| other number | `double` |
| boolean | `bool` |
| null | `null_type` |

CEL's heterogeneous numeric comparison makes `priority >= 3` valid whether
`priority` is an `int` or a `double`. Arithmetic between `int` and `double`
follows CEL and requires an explicit conversion.

### Missing Fields And Presence

mdbase preserves four observable record states:

| Raw state | `has(raw.f)` | `has(record.f)` | Top-level `f` |
| --- | --- | --- | --- |
| missing, no default | `false` | `false` | `null` |
| missing, read default | `false` | `true` | default value |
| explicit null | `true` | `true` | `null` |
| persisted value | `true` | `true` | persisted value |

A host binds every unreserved top-level identifier referenced by an expression.
An identifier naming a missing record field is bound to null. The host does not
bind other values for missing keys: `raw.f` and `record.f` on a missing key, and
field selection on null, are CEL evaluation errors.

Portable presence checks use CEL's `has()` macro: `has(raw.f)` tests persisted
presence and `has(record.f)` tests effective presence. Null-safe traversal uses
optional selection:

```cel
metadata.?owner.orValue("unassigned") == "alice"
```

## Temporal Values

### Representation

The profile adds no host types. Temporal values use CEL's standard types and
strings:

- A **date** is an RFC 3339 `full-date` string such as `"2026-06-20"`. Because
  the format is fixed-width, CEL string comparison orders dates
  chronologically, so `due < today()` needs no conversion.
- A **timestamp** is CEL's standard `google.protobuf.Timestamp`.
- A **duration** is CEL's standard `google.protobuf.Duration`.

Date fields therefore stay strings in every context. In query, projection, and
lifecycle contexts, a string at a location that every matched schema declares
`format: date-time` becomes a timestamp, because date-time offsets make string
comparison unreliable. A schema location is reachable from the root through
`properties`, `items`, and local `$ref`; locations inside `allOf`, `anyOf`,
`oneOf`, `not`, and conditional subschemas are not used for typing. A value
that fails its format stays a string and the record reports `format_invalid`.
Untyped date-times are converted explicitly with `timestamp()`.

### Functions

| Function | Result |
| --- | --- |
| `now()` | timestamp: the context's captured current instant |
| `today()` | date string: the calendar date of `now()` in the effective timezone |
| `date(string)` | the date string, validated as an RFC 3339 `full-date` |
| `date(timestamp)` | date string of the instant in the effective timezone |
| `startOfDay(string)` | timestamp of the start of that date in the effective timezone |
| `timestamp(string)` | CEL standard: RFC 3339 date-time with offset |
| `duration(string)` | CEL standard, for example `duration("36h")` |

These methods take a date string receiver:

| Method | Result |
| --- | --- |
| `d.addDays(int)` | date string |
| `d.addMonths(int)` | date string, clamped to the last day of the target month |
| `d.addYears(int)` | date string, clamping February 29 to February 28 |
| `d.daysUntil(string)` | `int` number of calendar days to another date, negative when earlier |
| `d.year()`, `d.month()`, `d.day()` | `int`; `month()` is 1 for January |
| `d.dayOfWeek()` | `int` ISO weekday, 1 for Monday through 7 for Sunday |

A date function or method whose date argument or receiver is not a valid
`full-date` raises an evaluation error.

Comparing a date string with a timestamp has no CEL overload and is an
evaluation error. Callers convert one side explicitly, for example
`startOfDay(due) < now()` or `due < date(now())`. Fixed spans use
`timestamp ± duration`; calendar spans use the date methods.

The effective timezone is the operation or query timezone defined in
Chapter 11 and MUST be declared by every operation or runtime context that
evaluates `today()`, `date(timestamp)`, or `startOfDay()`.

### Serialization

Date results are already strings. A timestamp result serializes as an RFC 3339
date-time in UTC with a `Z` suffix. A duration result serializes as a CEL
duration string in seconds, such as `"5400s"`. Typing never changes persisted
or `effective_frontmatter` values; it applies only to expression evaluation and
expression results.

## Text Helpers

Standard CEL compares strings exactly. For case-insensitive matching, the
profile adds two string methods:

| Method | Result |
| --- | --- |
| `s.lower()` | `s` with every character mapped to lowercase |
| `s.upper()` | `s` with every character mapped to uppercase |

Both use the Unicode default full case mappings without locale tailoring,
including the context-dependent final sigma rule, from the same Unicode
version as path keys (Chapter 02, provisionally 17.0.0), so
`"Éclair".lower()` is `"éclair"` and `"Straße".upper()` is `"STRASSE"`. A
case-insensitive search lowercases the text it searches:

```cel
file.body.lower().contains("mission body")
```

## Regular Expressions

mdbase has one regular-expression flavor, the **mdbase regex profile**. It
applies to CEL `matches()`, to JSON Schema `pattern` (Chapter 06), and to the
`matches` operator of `match.where` (Chapter 07). Every tool evaluates a
pattern the same way on every platform, which matters because a tool that
replays or re-verifies a write must reach the same result as the tool that
made it.

The profile is RE2 syntax with ASCII-only character classes, the semantics of
the Rust `regex-lite` crate. CEL specifies RE2 syntax for `matches()`; the
profile keeps that syntax and removes Unicode classes from it.

**Syntax.** A pattern may use:

- literal characters; `\` before any ASCII punctuation character, such as
  `\.` or `\\`; and the escapes `\n`, `\t`, `\r`, `\f`, `\v`, `\xHH`, and
  `\x{H...}` for any Unicode scalar value
- `.`, which matches any one Unicode scalar value except `\n` (any scalar
  value with the `s` flag)
- bracket classes such as `[a-z]`, `[^0-9]`, and ASCII class names such as
  `[[:alpha:]]`
- the Perl classes `\d`, `\w`, `\s`, and their negations `\D`, `\W`, `\S`
- the anchors `^`, `$`, `\A`, `\z`, and the word boundaries `\b` and `\B`
- groups `(...)`, non-capturing groups `(?:...)`, and named groups
  `(?P<name>...)`
- alternation `|`, and the repetitions `*`, `+`, `?`, `{n}`, `{n,}`,
  `{n,m}`, each optionally followed by `?` for lazy matching
- the flags `i`, `m`, `s`, and `x`, set as `(?flags)` or `(?flags:...)`

A pattern that uses anything else is invalid. In particular, Unicode classes
such as `\p{L}` and `\pN`, backreferences, and look-around are invalid, and
so are constructs that `regex-lite` accepts beyond this list: `\b{start}` and
the other `\b{...}` boundaries, `(?<name>...)` (use `(?P<name>...)`), the
`U` and `R` flags, escapes of letters or digits other than those listed (such
as `\a` and `\u0041`), nested bracket classes, and class set operations
(`&&`, `--`, `~~`). A `{` that does not begin a valid repetition, and a `]` or
`}` outside a class, are invalid too; escape them. `\<` and `\>` are
literal `<` and `>`, as the escape rule above says, although `regex-lite`
itself reads them as word boundaries.

**Limits.** Every tool accepts and rejects the same patterns:

- a pattern longer than 8,192 bytes is invalid;
- groups nested deeper than 64 are invalid;
- a repetition count above 1,000 in `{n}`, `{n,}`, or `{n,m}` is invalid, as
  in RE2;
- a pattern whose **program size** exceeds 100,000 is invalid. The size is: 1
  for a literal, `.`, a bracket class, or a Perl class; 0 for an anchor or
  boundary; the sum for a concatenation; the sum plus 1 per `|` for an
  alternation; the inner size plus 1 for a group; twice the operand for `*`,
  `+`, and `?`; and the operand times `max(n, m, 1) + 1` for `{n}`, `{n,}`,
  and `{n,m}`.

`regex-lite`'s own size limit depends on the platform's pointer width, so it
cannot be the portable limit.

**Semantics.** Matching runs over Unicode scalar values, and a match is
unanchored unless the pattern anchors it, as in RE2 and JSON Schema. Among
matches at the same position, the leftmost-first (Perl) alternative wins.
Classes and case folding are ASCII only:

| Construct | Matches |
| --- | --- |
| `\d` | `[0-9]` |
| `\w` | `[0-9A-Za-z_]` |
| `\s` | `[\t\n\v\f\r ]` |
| `\b` | a boundary between a `\w` character and a non-`\w` character or the text edge |
| `(?i)` | ASCII letters case-insensitively; every other scalar value only as itself |

So `"é".matches("^\\w$")` is false, `"café".matches("caf\\b")` is true,
`"١".matches("^\\d$")` is false, and `"É".matches("(?i)é")` is false. A
Unicode-aware case-insensitive search lowercases its text first, for example
`title.lower().matches("^éclair")`, and a pattern that needs non-ASCII letters
lists them, as in `[a-zà-ÿ]`.

**Errors.** An invalid pattern written as a CEL string literal is an
`expression_compile_error` when the expression compiles. A pattern computed
during evaluation that turns out invalid raises an evaluation error. An
invalid JSON Schema `pattern` or `match.where` pattern makes its type file
invalid.

**Provisional (rc.5).** The profile follows `regex-lite` because it keeps the
WebAssembly runtime about 740 KB smaller than a Unicode-table engine and can
run identically everywhere. Patterns that depend on Unicode classes behave
differently from rc.4 engines that used a Unicode-aware engine.

## File And Link Helpers

Core Read supplies file metadata and:

- `file.inFolder(path)`

The Links profile adds:

- `link(value)`
- `file.links`, `file.embeds`, `file.tags`, and `file.backlinks`
- `file.hasTag(tag)`
- `file.hasLink(linkValue)`
- `file.asLink()`
- `linkValue.asFile()`

`asFile()` returns the resolved record in the same shape as a query candidate:
its effective fields at top level, plus `record`, `raw`, and `file` members. It
returns null for an unresolved link. A link value resolves relative to the
record it was read from: the candidate, the `this` context, or a record
returned by `asFile()`, so `project.asFile().lead.asFile()` resolves `lead`
from the project's folder. Because field selection on null
is an error, traversal through a possibly broken link uses a guard or an
optional:

```cel
assignee != null && assignee.asFile() != null &&
  assignee.asFile().team == "engineering"
```

Traversal depth is bounded as described below. Expressions can use helpers
supplied by every profile in the implementation's conformance claim.

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
query, lifecycle policy, workflow, or runtime object. Parse errors and
references to unavailable system bindings invalidate that containing object.
Hosts MAY type-check expressions with record fields declared as `dyn`; a
type-check error is a compilation diagnostic only when the expression could not
evaluate successfully for any record.

CEL evaluation errors propagate as defined by the CEL specification, including
its commutative absorption by `&&` and `||`. The containing context decides what
a top-level error means:

| Context | Top-level evaluation error |
| --- | --- |
| inferred match | report a diagnostic and treat the candidate as a non-match |
| query filter | exclude the candidate and report a diagnostic |
| query or collection projection, selection, or ordering value | use null for that value and report a diagnostic |
| lifecycle guard | fail the write operation with `lifecycle_expression_error` |
| workflow trigger condition | create a failed-run diagnostic |
| workflow step or run policy | fail the step or run with a runtime diagnostic |

A condition that evaluates to anything other than boolean `true` does not match
or execute.

Diagnostics SHOULD include the source, code, message, context name, and line,
column, or byte range when available. Compilation diagnostics use
`expression_compile_error`; evaluation diagnostics use
`expression_evaluation_error`. A context that evaluates an expression once per
candidate MAY aggregate identical evaluation diagnostics as defined in
Chapter 11.
