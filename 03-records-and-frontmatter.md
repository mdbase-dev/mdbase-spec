# 03. Records And Frontmatter

## Record Formats

A record's format is fixed by its file extension:

| Extension | Format |
| --- | --- |
| `base` | YAML document record |
| any other record extension | Markdown record |

The table is part of this specification, not collection configuration, so every
tool reads a file the same way from its path alone. A row is added when a file
type has a consumer, per file type rather than per syntax: a future JSON
format would name the file type it serves (for example `canvas`), never every
`.json` file. A collection opts into a format by listing the extension in
`settings.record_extensions` (Chapter 04). Every format yields the same record
model: persisted frontmatter, a body, and file metadata. Types, contracts,
validation, queries, links, and operations apply to every format alike.

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

## YAML Document Record Structure

The whole file of a YAML document record is its frontmatter. There are no
delimiters and no body:

```yaml
filters:
  and:
    - 'status == "open"'
views:
  - type: table
    name: Open tasks
```

An empty file is an empty mapping. The body is always the empty string.

YAML document records let a collection type and query files that another
application owns, such as Obsidian `.base` files (see the
[Obsidian Bases adapter](./adapters/obsidian-bases.md)), without a second
storage, discovery, or authorization model.

## Frontmatter Value

Frontmatter MUST parse to a YAML mapping. Empty frontmatter is an empty mapping.

If frontmatter is absent, the persisted frontmatter object is `{}`.

If frontmatter parses to a scalar, sequence, or other non-mapping value, the
record's persisted frontmatter is treated as `{}` and the record reports an
`invalid_frontmatter` validation issue with `details.reason` set to
`non_mapping_frontmatter`, whose severity follows the validation level in
Chapter 04. A structured update of such a record fails with
`invalid_frontmatter` at every validation level, so that the original value is
never silently discarded; an explicit `document` replacement can repair it.

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

The body of a Markdown record is the content after the closing frontmatter
delimiter. A YAML document record has no body. The body is not validated by JSON Schema unless a type explicitly models it through
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

Write-capable tools MUST preserve unrelated body text and SHOULD preserve the
line ending style.

A YAML document record serializes as its frontmatter mapping alone. A create or
update that supplies a non-empty body for a YAML document record fails with
`invalid_request` before any write. A whole-document `document` replacement
(Chapter 12) is written exactly as supplied.

A write that changes some frontmatter keys of an existing record follows the
format fidelity rule of Chapter 12A: it re-emits only the changed top-level
entries, keeps every other entry byte-identical, including comments, quoting,
blank lines, and order, and keeps a changed entry's collection style. The rule
applies to Markdown records and YAML document records alike.

When serializing frontmatter, tools MUST:

- write an explicit null value for a key whose value is null
- omit keys that are missing
- quote empty strings

Tools SHOULD produce deterministic key ordering when an operation writes a new
record or rewrites a generated file. New keys added to an existing record are
appended after its existing entries.

A null value in written frontmatter always means explicit null. Removing a key
is a distinct operation; Chapter 12 defines how an update requests it.

## YAML Profile

Implementations MUST parse UTF-8 Markdown files.

The v0.3 YAML profile SHOULD use a safe YAML parser and MUST NOT execute custom
tags.

Tools SHOULD normalize common YAML scalar forms into the corresponding JSON
data model before JSON Schema validation. Non-JSON YAML values such as NaN,
Infinity, binary values, and timestamps with parser-specific objects MUST be
handled by the mdbase YAML profile before schema validation or rejected with a
clear diagnostic.
