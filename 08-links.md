# 08. Links

## Link Values

mdbase recognizes three link syntaxes:

| Syntax | Example |
| --- | --- |
| Wikilink | `[[people/alice|Alice]]` |
| Markdown link | `[Alice](people/alice.md)` |
| Bare path | `people/alice.md` |

`collection.links` makes a field link-aware. JSON Schema validates its local
shape, usually `string` or an array of strings.

## Link Components

Parsed links expose:

- `raw`
- `target`
- `alias`
- `anchor`
- `format`
- `is_relative`

`format` is one of `wikilink`, `markdown`, or `path`.

## Resolution

Resolution is performed against the collection root and the containing file.

General rules:

- Markdown links and bare relative paths resolve relative to the containing
  file's folder.
- Absolute collection paths use `/` from the collection root.
- Wikilinks beginning with `./` or `../` resolve relative to the containing
  file's folder. Other wikilinks containing `/`, such as `[[people/alice]]`,
  resolve from the collection root.
- Simple wikilinks without path separators resolve by filename, matching the
  target against record filenames with or without their record extension.
- When `settings.id_field` is configured, a simple wikilink first tries
  ID-based resolution against that field and falls back to filename
  resolution only when no record has that ID. When `settings.id_field` is
  absent, no ID-based resolution happens, whatever fields records contain.

A record has an ID when its persisted `id_field` value is a non-empty string.
ID-based resolution compares the wikilink target with record IDs exactly,
without case folding or normalization.

After normalization, a link that escapes the collection root is invalid.

## Ambiguity

If several records have the configured ID, ID-based resolution is ambiguous.
The link resolves to null, and the tool MUST NOT fall back to filename
resolution. Duplicate IDs are not a record validation issue of the records
that hold them.

If filename resolution finds multiple candidates, tools MUST apply these
tiebreakers in order:

1. same directory as referring file
2. shortest collection path
3. smallest path in Unicode code-point order

Filename candidates whose paths are equivalent under Chapter 02 path keys are
ambiguous with each other even after the tiebreakers. If ambiguity remains,
the link resolves to null.

An ambiguous link reports an `ambiguous_link` cross-record issue on the
referring record, with `details.candidates` listing the candidate paths in
code-point order. An ambiguous link creates no backlink, and for
`validate_exists` it counts as unresolved but reports `ambiguous_link` rather
than `link_not_found`.

## Target Constraints

`collection.links` can require a target type:

```yaml
collection:
  links:
    assignee:
      target_type: person
      validate_exists: true
```

When `validate_exists` is true, an unresolved link is a `link_not_found`
record validation issue.

When `target_type` is present, a resolved target that does not match the
target type is a `link_target_type_mismatch` record validation issue.

Both are cross-record checks (Chapter 04): their severity follows the
validation level, and they are reported but never block a write. A record
can lose its link target at any time through an edit, delete, or rename of
another record.

## Body Links

`file.links` includes, in this order and without de-duplication:

- values of frontmatter fields declared in `collection.links`
- every other frontmatter string, or string item of a frontmatter array, whose
  complete value is a wikilink, such as `related: "[[alpha]]"`
- body wikilinks
- body Markdown links

Undeclared frontmatter values in Markdown-link or bare-path syntax are not
links, because ordinary strings often contain paths.

Each entry is a link value that resolves exactly as the original link does,
without its alias or anchor: a wikilink target is written `[[target]]`, and a
path that resolves from the containing folder, from a Markdown link, a bare
path, or a wikilink beginning with `./` or `../`, is written with a leading
`./` or `../`. For example, `[[people/alice|Alice]]` becomes
`[[people/alice]]` and `[notes](plan.md#goals)` becomes `./plan.md`.
`file.embeds` uses the same form. `file.embeds` includes
Markdown and wikilink embeds in the body.

## Backlinks

`file.backlinks` is a list of link values, as produced by `file.asLink()`, for
the records whose `file.links` or `file.embeds` resolve to the current record,
ordered by referring record path. A referring
record appears once even when it links several times. A record that links to
itself appears in its own backlinks. Unresolved and ambiguous links create no
backlinks.

Backlinks are derived from the current collection state. After a successful
write, subsequent reads and queries observe backlinks that reflect it.

Links and tags inside fenced code blocks and inline code MUST be ignored by
body extraction.

## Tags

`file.tags` includes:

- frontmatter tags from `tags` when the field is string or list of strings
- inline body tags beginning with `#`

Inline tags must begin at the start of a line or after whitespace. URL
fragments MUST NOT be treated as tags.

`file.hasTag("project")` uses complete tag-segment prefixes. It matches
`#project` and `#project/alpha`; its result for `#projection` is false.

## Link Host Functions

The CEL profile defines host functions and methods for links:

- `link(value)`
- `file.hasLink(linkValue)`
- `file.hasTag(tag)`
- `file.asLink()`
- `linkValue.asFile()`

`asFile()` returns null for a broken link. Selecting a field of null is a CEL
evaluation error, so traversal through a link that may be broken uses a null
check or optional selection, as shown in Chapter 10.

## Round Trip

Write operations SHOULD preserve link format when updating references:

- wikilinks remain wikilinks
- Markdown links remain Markdown links
- bare paths remain bare paths
- aliases and anchors are preserved where possible

ID-based links SHOULD NOT be rewritten during rename if the target ID did not
change.
