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
    - field: id
      scope: type
  links:
    assignee:
      target_type: person
      validate_exists: true
```

## Field References

Every collection-semantic selector uses one field-reference syntax. A field
reference is either:

- the existing mdbase field-path form, such as `title`, `metadata.owner`, or
  `blocks[]`
- a non-root [RFC 6901 JSON Pointer](https://www.rfc-editor.org/rfc/rfc6901),
  such as `/@type`, `/metadata/owner`, or `/schema/$id`

Field paths remain supported for compatibility and for the `[]` array-item
selector. JSON Pointer is the exact, standards-based form for every JSON object
key, including keys that contain `.`, `/`, `~`, `@`, or `$`. Pointer tokens
escape `~` as `~0` and `/` as `~1`; for example `/a~1b` selects the key `a/b`.
The URI-fragment form beginning with `#` is not accepted.

The empty JSON Pointer denotes the whole document in RFC 6901, but it is not a
valid mdbase field reference. Collection semantics always address a field
inside the frontmatter object.

JSON Pointer resolves one exact value. Array tokens are zero-based indices.
`[]` expansion belongs only to the field-path form. An operation that accepts a
link collection applies its link rule to every item when the resolved value is
an array.

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
    $expr: 'present.raw.tags && tags.exists(t, t == "task")'
```

The expression combines with the other members of `match` using AND. It receives
the matching context defined in Chapter 10 and MUST evaluate to boolean true for
the type to match.

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

## Cross-File Uniqueness

`collection.unique` declares collection-level uniqueness:

```yaml
collection:
  unique:
    - field: id
      scope: type
```

| Scope | Comparison set |
| --- | --- |
| `collection` | every record in the collection |
| `type` | every record matching the declaring type |
| `path_glob` | every record under the configured path glob |

Missing and null values are exempt from uniqueness comparison.

## Path Policy

Path policy guides create and rename operations:

```yaml
collection:
  path:
    pattern: "tasks/{id}.md"
```

The portable grammar uses `{field}` placeholders for top-level frontmatter
fields. Values are converted to strings without expression evaluation. A
missing or null value produces `path_value_missing`.

Generated paths MUST remain inside the collection root. Placeholder values that
produce `/`, `\\`, `.`, or `..` path components are invalid. Runtime-owned path
logic and richer template languages belong under an `x-*` extension.

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

Collection projections are an optional effective-value feature declared outside
JSON Schema and expressed in CEL:

```yaml
collection:
  projections:
    is_overdue:
      expr: 'present.record.due && due < today() && status != "done"'
```

Projection values are available to queries. Persistence occurs only through an
explicit write operation or runtime workflow.

Collection projections enter the effective record and remain available through
their declared field names. Query- and view-local named projections are
separate, live under the `projection` CEL namespace, and never replace a
collection projection or persisted field with the same name.

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
