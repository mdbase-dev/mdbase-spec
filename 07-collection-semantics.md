# 07. Collection Semantics

## Purpose

`match` selects the records governed by a type. `collection` defines behavior
that depends on the surrounding Markdown collection.

```yaml
match:
  path_glob: "tasks/**/*.md"

collection:
  display:
    name_field: title
  read_defaults:
    status: open
  unique:
    - field: code
      scope: type
  links:
    assignee:
      target_type: person
      validate_exists: true
  merge:
    completedDate: max
```

## Field References

Field references appear in collection sections, lifecycle `set` keys, update
`unset` lists, and `implements` field maps. A field reference has one of two
forms, distinguished by its first character.

**Field path** (the readable default). One or more object keys separated by
`.`, where any segment may end in `[]` to select every item of an array, such
as `title`, `metadata.owner`, or `blocks[]`. A segment begins with an ASCII
letter or `_` and contains only ASCII letters, digits, `_`, `:`, and `-`.

**JSON Pointer** (the exact form). A non-empty
[RFC 6901 JSON Pointer](https://www.rfc-editor.org/rfc/rfc6901) beginning with
`/`, such as `/@type`, `/metadata/owner`, or `/a~1b`. Pointer tokens escape `~`
as `~0` and `/` as `~1`, so `/a~1b` selects the key `a/b`. Numeric tokens are
zero-based array indices. The URI-fragment form beginning with `#` and the
empty pointer are not accepted, because collection semantics always address a
field inside the frontmatter object.

Use a field path unless a key contains another character, such as `@`, `$`,
`.`, `/`, or a space, or a single array item must be addressed. Only field paths expand arrays with `[]`;
a pointer resolves exactly one value. An operation that accepts a link
collection applies its link rule to every item when the resolved value is an
array.

Lifecycle `set` creates missing intermediate objects. It MUST fail rather than
replace a non-object intermediate value. Assignment through an array index is
valid only when that array and index already exist.

## Matching Decision Process

Matching uses the collection-relative record path, raw persisted frontmatter,
the configured explicit type keys, and the loaded type registry.

For each record, an implementation follows this sequence:

1. Inspect the configured explicit type keys in configuration order.
2. If any configured key is present, read and validate its declarations, resolve
   those names against the type registry, and use the resulting explicit set.
3. Otherwise, evaluate every type that has a `match` section against the record.
4. Collect the matching types and order them by canonical lower-case name.

The explicit branch completes type selection. Inferred rules, including
`match.expr`, are skipped for that record. The selected types still perform
their normal schema and collection validation.

An explicit type value is a type-name string or a non-empty list of type-name
strings. Declarations from several configured keys are concatenated in key order
and case-insensitively de-duplicated while preserving the first occurrence.
Invalid value shapes and unknown type names produce diagnostics.

The default keys are `type` and `types`. Configuring
`settings.explicit_type_keys` replaces that default list. An empty list selects
inferred matching for every record.

A type with no `match` section can be selected explicitly. It contributes no
inferred match.

## Inferred Match Rules

All members present in one `match` object combine with AND:

```yaml
match:
  path_glob: "tasks/**/*.md"
  fields_present: [title, "/@type"]
  where:
    status:
      neq: done
```

This type matches a candidate only when its path, required fields, and
structured predicates all match. A list in `path_glob` combines its patterns
with OR. Every selector in `fields_present` MUST resolve to a raw, non-null
value.

Empty string, `false`, zero, and empty list count as present. A missing value or
explicit `null` does not.

Match rules read persisted frontmatter. Read defaults and projections are
applied after type selection and therefore do not influence inferred matching.

### Structured Predicates

`match.where` is the portable structured predicate language for basic matching.
A `where` mapping combines different field selectors with AND. A direct value
uses deep JSON equality. An operator mapping combines its operators with AND.

| Operator | Meaning |
| --- | --- |
| `eq`, `neq` | deep JSON equality or inequality |
| `gt`, `gte`, `lt`, `lte` | number, string, date, time, or date-time comparison |
| `contains` | string substring or array item equality |
| `containsAll`, `containsAny` | array contains all or any requested values |
| `startsWith`, `endsWith` | string prefix or suffix |
| `matches` | portable regular-expression match |
| `exists` | raw key presence, including an explicit null value |

Except for `exists`, an operator evaluates to false when its field is missing or
null. Ordering evaluates to false for incomparable values. `neq` also evaluates
to false for a missing field. A predicate with an operand of the wrong type
evaluates to false.

`matches` uses the same portable regular-expression subset as JSON Schema
`pattern`: Unicode-aware matching without backreferences or look-around. An
unsupported or invalid pattern is a type-file diagnostic.

### CEL Matching

The CEL Match profile adds `match.expr` for inferred rules that need a portable
expression:

```yaml
match:
  path_glob: "tasks/**/*.md"
  expr:
    $expr: 'has(raw.tags) && tags.exists(t, t == "task")'
```

The expression combines with the other members of `match` using AND. It receives
the matching context defined in Chapter 10 and MUST evaluate to boolean true for
the type to match.

Type membership drives validation, lifecycle, path policy, and merge, so every
tool and every replay MUST compute the same membership for the same record.
`match.expr` SHOULD therefore be deterministic: it SHOULD NOT call `now()` or
`today()`, read `file.mtime` or `file.ctime`, or use a helper that reads
other records, such as `asFile()`, `file.backlinks`, or `file.hasLink()`.
Queries, projections, and lifecycle guards MAY use these functions.

A tool that loads a type whose `match.expr` uses one of them MUST report a
`warning` diagnostic with code `nondeterministic_match`, the type name, and
`details.binding` naming the function or field. The type still loads and the
expression is evaluated as before, with `now()` and `today()` reading the
operation's captured instant. Membership of such a type can differ between
tools and over time, so tools that merge or replay edits cannot rely on it.

In 0.3.0 stable such a `match.expr` is an error: the type is invalid and
reports `nondeterministic_match` with severity `error`. The warning in the
release candidates gives authors a window to move time-dependent or
cross-record logic into queries or collection projections.

Implementations compile `match.expr` when loading the type. Parse and type
errors invalidate the type definition. A per-record evaluation error reports a
diagnostic for that record and expression and yields a non-match. False and null
also yield a non-match.

A type containing `match.expr` requires the `cel_match` conformance profile.
Loading it under a claim that omits `cel_match` produces
`unsupported_profile`.

## Read Defaults

`collection.read_defaults` supplies effective read and query values for missing
fields.

```yaml
collection:
  read_defaults:
    status: open
    recurrenceAnchor: scheduled
```

For each defaulted field:

- a missing raw field receives the configured effective value
- an explicit `null` remains null
- JSON Schema `required` continues to evaluate the raw frontmatter
- raw-frontmatter presence remains false
- read and query operations leave the persisted file unchanged

Create and editor tooling MAY mirror static values into JSON Schema `default`
annotations for presentation or scaffolding.

Three mechanisms supply default-like values, each with one purpose:

| Need | Mechanism | Persisted |
| --- | --- | --- |
| a value readers and queries see when a field is missing | `collection.read_defaults` | no |
| a value written into new records | lifecycle `on_create` with a `literal`, `now`, `ulid`, or other provider | yes |
| a suggestion shown by editors and create forms | JSON Schema `default` | only if the caller submits it |

JSON Schema `default` never changes validation, reads, or queries.

## Links

JSON Schema validates a link field's local shape.
`collection.links` supplies its collection-level meaning.

```yaml
collection:
  links:
    parent:
      target_type: task
      validate_exists: true
    blocks[]:
      target_type: task
      validate_exists: false
    "/relations":
      target_type: task
      validate_exists: true
```

`blocks[]` applies the rule to every item in the `blocks` array. Chapter 08
defines link parsing and resolution. `/relations` applies the same item-wise
rule when the exactly selected value is an array.

## Uniqueness

`collection.unique` declares that a field's values must differ between
records:

```yaml
collection:
  unique:
    - field: code
      scope: type
      enforce: write
    - field: slug
      scope: path_glob
      path_glob: "docs/**"
```

| Member | Required | Meaning |
| --- | --- | --- |
| `field` | yes | field reference (Chapter 07); with `[]`, every selected item takes part |
| `scope` | no, default `type` | which records the governed records must differ from |
| `path_glob` | when `scope` is `path_glob` | a portable glob (Chapter 02) |
| `enforce` | no, default `report` | `report` or `write` |

A rule **governs** every record that matches its declaring type. With
`scope: path_glob`, it governs only those whose path also matches
`path_glob`. The scope selects the **comparison set**:

| Scope | Comparison set |
| --- | --- |
| `type` | every record that matches the declaring type |
| `collection` | every record in the collection, whatever its types |
| `path_glob` | every record whose path matches `path_glob`, whatever its types |

A governed record violates the rule when another record in the comparison set
holds an equal value for the field. Values are compared as follows:

- the persisted (raw) value is compared; read defaults and projections never
  take part
- missing and null values are exempt
- values are equal under deep JSON equality, where numbers are equal when
  their numeric values are equal; there is no coercion between types, so `1`
  and `"1"` differ, and strings are compared exactly, without case folding or
  normalization
- when the field reference selects several values, each value takes part;
  repeated items within one record's own array are not a uniqueness violation
  (JSON Schema `uniqueItems` covers that)

Each violation is a `duplicate_value` issue on the governed record, with the
rule's field and `details.paths` listing the other records that hold the value
in code-point order.

### Enforcement

`enforce` declares whether a rule is checked when a write is made through an
engine:

- `report` (the default): violations are cross-record issues (Chapter 04).
  They are reported and never block a write.
- `write`: a create, update, rename, or batch item made through an engine
  fails with `duplicate_value` before writing when it would give a governed
  record a value that another record in the comparison set already holds, or
  would add to the comparison set a record whose value a governed record
  already holds. This belongs to the request and safety tier, so it applies
  at every validation level.

`enforce: write` is the one cross-record check that can reject a write. It
requires that concurrent writes are checked in a single order: when two writes
would claim the same value, the first one in that order succeeds and the later
one fails. How an implementation orders writes, for example through a single
writer or a coordination service, is outside this specification. An
implementation that cannot order writes that way for a collection MUST reject
writes to fields covered by an `enforce: write` rule rather than accept them
unchecked. Collections that need unique identifiers without coordination
SHOULD generate them with lifecycle `ulid` or `uuid`.

An `enforce: write` rule rejects only writes that introduce a duplicate. A
write that leaves a record's covered values unchanged succeeds even when the
record already violates the rule, for example after an external edit. Edits
made by other tools and the results of a merge (Chapter 12A) are never
rejected; their violations are reported.

**Provisional (rc.5).** An `enforce: write` rule applies at every
validation level, including `off`, because the author opted into it
explicitly.

## Path Policy

Path policy guides create and rename operations:

```yaml
collection:
  path:
    pattern: "tasks/{id}.md"
```

The portable grammar uses `{field}` placeholders for top-level frontmatter
fields. Values are converted to strings without expression evaluation: a
string is used as written, and a number or boolean uses its JSON
representation. A missing or null value produces `path_value_missing`.

A placeholder value always stays within one path component. A converted
value is invalid, and the operation fails with `path_value_invalid` naming the
field, when it:

- is an array or an object
- is empty
- contains `/`, `\`, or a NUL character
- begins with `.`

A title such as `Q3/Q4 plan` therefore cannot create a subfolder. Generated
paths MUST remain inside the collection root and MUST satisfy the path safety
rules of Chapter 02. When a derived path's path key is already in use, the
record receives the first free suffixed path defined in Chapter 02; the
operation does not fail. Runtime-owned path logic and richer template
languages belong under an `x-*` extension.

## Merge Strategies

`collection.merge` declares how each top-level frontmatter field combines when
two concurrent edits of a record are merged (Chapter 12A):

```yaml
collection:
  merge:
    completedDate: max
    status: conflict
    reviewers: union
```

Each key names one top-level frontmatter field, as a field path with one
segment and no `[]`, or a JSON Pointer with one token. Each value is a
strategy:

| Strategy | When both sides changed the field to different values |
| --- | --- |
| `conflict` | the field is in conflict |
| `max` | the greater of the two values |
| `min` | the lesser of the two values |
| `union` | an observed-remove set union of the two lists |

Chapter 12A defines each strategy exactly. A strategy matters only when both
sides changed the same field differently. A field changed on one side always
takes that side's value, and a field changed identically on both sides takes
the shared value.

A field without a declaration uses its default strategy. The first rule that
applies wins:

1. `max` when a matched type's lifecycle assigns the field with `{ now: true }`
   or `{ today: true }`, so that concurrent modification timestamps never
   conflict
2. `union` when the field is named `tags`, or when a matched type's schema
   declares the field's top-level property with `uniqueItems: true`
3. `conflict` otherwise

A declaration always replaces the default, so `dateModified: conflict` turns
the timestamp default off. Applications that maintain timestamps in their own
code, rather than through lifecycle, declare `max` explicitly.

Merge strategies describe concurrent edits only. They never change
validation, reads, queries, or the result of a single write.

## Display Metadata

`collection.display` contains advisory presentation metadata:

```yaml
collection:
  display:
    name_field: title
    description_field: summary
    icon: check-circle
    color_field: status
```

Editors, collection views, and generated documentation can use these values.
Record validation ignores display metadata.

## Projections

Collection projections are the optional feature `collection_projections`: an
effective-value feature declared outside JSON Schema and expressed in CEL:

```yaml
collection:
  projections:
    is_overdue:
      expr: 'due != null && due < today() && status != "done"'
```

Projection values are available to queries. Persistence occurs only through an
explicit write operation or runtime workflow.

Collection projections enter the effective record and `effective_frontmatter`
under their declared field names, after read defaults are applied. They never
replace a persisted field: a record that persists a field with the same name as
a projection keeps its persisted value and reports a `projection_shadowed`
warning. A projection whose evaluation fails is absent from that record's
effective values and reports an expression diagnostic.

Projections evaluate in the query context of Chapter 10 without `projection` or
`this`. A projection MAY reference another collection projection by its field
name; implementations evaluate them in dependency order and reject cycles when
loading the type.

An implementation that does not advertise `collection_projections` still loads a
type that declares projections. It leaves the projection values absent and
reports a `warning` diagnostic with code `unsupported_feature`, the type name,
and `details.feature: collection_projections`, so that authors never lose
projections silently.

Query- and view-local named projections are separate, live under the
`projection` CEL namespace, and never replace a collection projection or
persisted field with the same name.

## Private Domain Namespaces

Private annotations with no portable interoperability meaning use namespaced
extension sections:

```yaml
x-example-app:
  fields:
    status:
      role: status
      completed_values: [done, cancelled]
```

This keeps the JSON Schema reusable and gives each private extension an
explicit owner. Portable domain interfaces use the first-class data contracts
and type-local `implements` entries from Chapter 05A.
