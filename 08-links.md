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
  resolution when no record has that ID.

After normalization, a link that escapes the collection root is invalid.

## Ambiguity

If multiple records have the same configured ID, ID-based resolution is
ambiguous and MUST fail without falling back to filename resolution.

If filename resolution finds multiple candidates, tools SHOULD apply stable
tiebreakers:

1. same directory as referring file
2. shortest collection path
3. alphabetical path

If ambiguity remains, resolution returns null and reports an ambiguous link
warning.

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
record validation issue whose severity follows the validation level in
Chapter 04.

When `target_type` is present, a resolved target is valid only if it matches the
target type.

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
