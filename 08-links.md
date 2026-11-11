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

## Link Syntax

A **wikilink** is `[[`, a target, an optional `#anchor`, an optional `|alias`,
and `]]`, on one line. The alias is the text after the first `|`. In the text
before the alias, the anchor is the text after the first `#` and the target
is the text before it, with leading and trailing whitespace removed. A
wikilink with an empty target is not a link. The link ends at the first `]]`,
except that a `]` closing a `[` opened inside the link belongs to the link:
`[[Person [draft]]]` has the target `Person [draft]`. `![[...]]` is an embed.

A **Markdown link** is `[text](destination)`, where `text` contains no `[` or
line break and `(` directly follows `]`. `![text](destination)` is an embed.
The destination has one of two forms:

- `<...>`: the destination is the text between the angle brackets exactly as
  written. Only whitespace or a title that begins with `"` may follow it
  before `)`.
- otherwise the destination is the text up to the first space or `)`. Text
  between a space and `)`, such as a `"title"`, is ignored, and each `%20` in
  the destination is read as a space. No other percent-encoding is decoded,
  so a destination that contains a space or `)` is written with `%20` or in
  angle brackets.

The anchor is the text after the first `#` of the destination, and the target
is the text before it. A Markdown link is not a record link, and is ignored,
when its destination is empty, begins with `#`, or begins with a URI scheme:
an ASCII letter, then ASCII letters, digits, `+`, `-`, or `.`, then `:`, as in
`https:` or `mailto:`.

A **bare path** is a complete field value that is neither of the above, is
not empty, contains no `[`, `]`, or line break, and does not begin with a URI
scheme. Its anchor is the text after the first `#`.

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
- A path that names no record as written, and whose last segment does not
  end in a record extension, is tried with each extension of
  `settings.record_extensions` appended, in the configured order. The first
  path that names a record is the target.
- When `settings.id_field` is configured, a simple wikilink first tries
  ID-based resolution against that field and falls back to filename
  resolution only when no record has that ID. When `settings.id_field` is
  absent, no ID-based resolution happens, whatever fields records contain.

A record has an ID when its persisted `id_field` value is a non-empty string.
ID-based resolution compares the wikilink target with record IDs exactly,
without case folding or normalization.

Targets are compared with record paths and filenames by path key (Chapter
02), so `[[Alice]]` and `[[people/Alice]]` resolve to `people/alice.md`. Two
records whose paths have the same path key are already a `path_collision`.
An ID is compared exactly, as above.

After `.` and `..` segments are resolved, a link that escapes the collection
root is invalid.

## Ambiguity

If several records have the configured ID, ID-based resolution is ambiguous.
The link resolves to null, and the tool MUST NOT fall back to filename
resolution. Duplicate IDs are not a record validation issue of the records
that hold them.

If filename resolution finds multiple candidates, tools MUST apply these
tiebreakers in order:

1. same directory as referring file
2. fewest path segments, that is, the shallowest collection path
3. smallest path in Unicode code-point order

Tools MUST NOT choose among candidates by any other criterion, such as
discovery or scan order, the order in which files were indexed, or a
provider's storage order, so every conforming tool resolves a simple link to
the same record. The path segments of `docs/readme.md` are `docs` and
`readme.md`; its depth is 2 whatever the length of its names.

Filename candidates whose paths are equivalent under Chapter 02 path keys are
ambiguous with each other even after the tiebreakers. If ambiguity remains,
the link resolves to null. A link that the tiebreakers resolve is not
ambiguous and reports no `ambiguous_link`.

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

## Code In The Body

Links and tags inside fenced code blocks and inline code MUST be ignored by
body extraction. Body extraction reads the body one line at a time and
recognizes code as follows, which is a subset of CommonMark:

- A **fenced code block** opens on a line that is indented by fewer than
  four spaces and whose first other characters are a run of at least three
  backticks or at least three tildes. A backtick run opens a block only when
  the rest of its line contains no backtick. The block closes on a line that
  is indented by fewer than four spaces and begins with a run of the same
  character at least as long as the opening run, followed only by
  whitespace. A block that is never closed runs to the end of the body. The
  opening and closing lines are part of the block.
- **Inline code** begins, on a line outside a fenced code block, at a run of
  backticks, and ends after the next place on the same line where that many
  backticks occur. A run with no such place is ordinary text.
- A backslash makes the character after it ordinary text, so `\[[x]]` is not
  a link and a backtick after a backslash opens no inline code.

Indented code blocks are not recognized: a link or tag on an indented line is
extracted.

## Tags

`file.tags` lists, in this order and without de-duplication:

- the frontmatter `tags` value when it is a string, or its string items when
  it is a list, each with any leading `#` characters removed
- the inline tags of the body, in order of appearance

An inline tag is a `#` that is the first character of its line or follows a
whitespace character (Unicode `White_Space`), followed by the longest run of tag characters. A tag
character is a letter or digit (Unicode `Alphabetic`, or general category
`Nd`, `Nl`, or `No`), `_`, `-`, or `/`. The tag is the run, without the `#`.
A run that is empty, or that consists only of ASCII digits, is not a tag, so
`# Heading`, `#123`, and the fragment of `https://example.com/a#section` are
not tags, while `#2026-plan` and `#project/alpha` are.

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
