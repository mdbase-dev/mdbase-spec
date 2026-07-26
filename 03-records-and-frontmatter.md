# 03. Records And Frontmatter

## Markdown Record Structure

A Markdown record may begin with YAML frontmatter delimited by `---` on the
first line:

```markdown
---
type: task
title: Fix login
status: open
---

Body text.
```

If the first non-byte-order-mark bytes are not `---` followed by a line ending,
the file has no frontmatter and the full file is body text.

Whitespace or a blank line before the opening delimiter means there is no
frontmatter.

## Frontmatter Value

Frontmatter MUST parse to a YAML mapping. Empty frontmatter is an empty mapping.

If frontmatter is absent, the persisted frontmatter object is `{}`.

If frontmatter parses to a scalar, sequence, or other non-mapping value, the
record is invalid at validation level `error`. At validation level `warn`, tools
SHOULD treat it as empty frontmatter and report a warning.

## Missing, Null, And Empty

Frontmatter has four distinct states:

- missing means a key is not present in persisted frontmatter
- null means a key is present with YAML null
- empty string means a key is present with `""`
- empty list means a key is present with `[]`

These states are not interchangeable.

`collection.read_defaults` applies only to missing keys. It does not replace
explicit null.

## Persisted And Effective Frontmatter

`frontmatter` always means the parsed mapping persisted in the Markdown file.
It does not contain read defaults, computed values, or other derived data.

`effective_frontmatter` is the derived read/query mapping after applying
`collection.read_defaults` and any other read-time computation supported by the
active profile.

These names have fixed meanings in every operation and provider. An operation
MUST NOT place effective values in `frontmatter`, place persisted values in
`effective_frontmatter`, or change either meaning based on request options.

A complete record document has this shape:

```yaml
path: tasks/fix-login.md
revision: sha256:opaque
types: [task]
frontmatter:
  title: Fix login
effective_frontmatter:
  title: Fix login
  status: open
body: |
  Reproduce and fix the login failure.
document: |
  ---
  title: Fix login
  ---
  Reproduce and fix the login failure.
file:
  name: fix-login.md
  folder: tasks
  size: 142
  mtime: 2026-07-26T03:00:00Z
```

`path`, `revision`, `types`, `frontmatter`, `effective_frontmatter`, `body`, and
`file` are all required on a complete record document. Empty frontmatter is
represented by `{}`, not by an absent member.

`document` is an optional complete UTF-8 source representation. It is returned
when an operation explicitly requests source and MUST contain the exact record
text whose bytes produced `revision`, including any byte-order mark, YAML
delimiters, comments, quoting, whitespace, line endings, and trailing newline.
`frontmatter` and `body` MUST be parsed from that same text. Providers MUST NOT
reconstruct `document` from parsed frontmatter and body when exact source is
unavailable.

Validation of JSON Schema `required` is against the persisted or draft
frontmatter object, not against effective read defaults.

## Body

The body is the Markdown content after the closing frontmatter delimiter. The
body is not validated by JSON Schema unless a type explicitly models it through
a separate mdbase feature.

The body may participate in queries through `file.body` when body indexing is
enabled or when a tool can read bodies on demand.

## File Metadata

Every record exposes a file object to expressions and query results:

| Property | Meaning |
| --- | --- |
| `file.path` | collection-relative path |
| `file.name` | basename with extension |
| `file.basename` | basename without the final extension |
| `file.ext` | extension without dot |
| `file.folder` | collection-relative containing folder |
| `file.size` | byte size where available |
| `file.mtime` | modified timestamp where available |
| `file.ctime` | created timestamp where available |
| `file.body` | Markdown body when included or needed for filtering |

File metadata is derived. It MUST NOT be written into frontmatter unless a tool
explicitly maps it to ordinary fields.

## Serialization

Write-capable tools SHOULD preserve unrelated body text and line ending style.

When serializing frontmatter, tools SHOULD:

- omit missing values; bare nulls represent explicit null values
- quote empty strings
- preserve array/object structure
- produce deterministic key ordering when the operation rewrites a generated
  file

When updating a field to null, tools MAY either persist explicit null or remove
the key depending on operation policy. The operation result MUST make the chosen
behavior explicit.

## YAML Profile

Implementations MUST parse UTF-8 Markdown files.

The v0.3 YAML profile SHOULD use a safe YAML parser and MUST NOT execute custom
tags.

Tools SHOULD normalize common YAML scalar forms into the corresponding JSON
data model before JSON Schema validation. Non-JSON YAML values such as NaN,
Infinity, binary values, and timestamps with parser-specific objects MUST be
handled by the mdbase YAML profile before schema validation or rejected with a
clear diagnostic.
