---
type: chapter
id: 08-links
title: "Links"
description: "Link syntax, parsing, resolution, traversal, and backlinks"
section: 8
conformance_levels: [4]
test_categories: [links]
depends_on:
  - "[[07-field-types]]"
  - "[[02-collection-layout]]"
---

# 8. Links

Links are references from one file to another. They are a first-class concept in this specification due to their prevalence in markdown-based knowledge systems. This section defines link syntax, parsing, resolution, and traversal.

---

## 8.1 Why Links Matter

Links transform a folder of files into a knowledge graph. They enable:

- **Navigation**: Jump between related documents
- **Backlinks**: See what references a document
- **Queries**: Find documents by their relationships
- **Validation**: Ensure references point to real files
- **Refactoring**: Rename files without breaking connections

This specification treats links as typed data with well-defined parsing and resolution semantics.

---

## 8.2 Link Formats

The `link` field type accepts three input formats:

### 8.2.1 Wikilinks

The format popularized by wikis and knowledge management tools:

```
[[target]]
[[target|alias]]
[[target#anchor]]
[[target#anchor|alias]]
[[folder/target]]
[[./relative]]
[[../parent/target]]
```

**Components:**
- **target**: The file being linked to (without extension by default)
- **alias**: Display text (does not affect resolution)
- **anchor**: A heading or block reference within the target
- **path**: May be absolute (from collection root) or relative (from current file)

**Examples:**
```yaml
# Simple link
parent: "[[task-001]]"

# Link with alias (alias is metadata, not used for resolution)
assignee: "[[alice|Alice Smith]]"

# Link to specific section
reference: "[[api-docs#authentication]]"

# Relative link
related: "[[./sibling-task]]"

# Path from root
spec: "[[docs/specs/api-v2]]"
```

### 8.2.2 Markdown Links

Standard markdown link syntax:

```
[text](path.md)
[text](./relative.md)
[text](../other/file.md)
[text](path.md#anchor)
```

The text portion is treated as an alias.

**Examples:**
```yaml
parent: "[Parent Task](./tasks/parent.md)"
reference: "[API Docs](docs/api.md#auth)"
```

### 8.2.3 Bare Paths

A path without link syntax:

```
./sibling.md
../other/file.md
folder/file.md
```

**Examples:**
```yaml
config: "./config.md"
parent: "../parent-project/overview.md"
```

Bare paths follow the same resolution rules as markdown links: they are relative to the containing file's directory unless they start with `/` (root-relative).

---

## 8.3 Link Parsing

When a link value is read, implementations MUST parse it into a structured representation:

| Component | Type | Description |
|-----------|------|-------------|
| `raw` | string | Original string value exactly as written |
| `target` | string | File path or identifier (without anchor/alias) |
| `alias` | string? | Display text if provided, otherwise null |
| `anchor` | string? | Heading/block reference if provided, otherwise null |
| `format` | enum | One of: `wikilink`, `markdown`, `path` |
| `is_relative` | boolean | Whether path starts with `./` or `../` |

**Parsing examples:**

| Input | target | alias | anchor | format | is_relative |
|-------|--------|-------|--------|--------|-------------|
| `[[task-001]]` | `task-001` | null | null | wikilink | false |
| `[[task-001\|My Task]]` | `task-001` | `My Task` | null | wikilink | false |
| `[[docs/api#auth]]` | `docs/api` | null | `auth` | wikilink | false |
| `[[./sibling]]` | `./sibling` | null | null | wikilink | true |
| `[Link](file.md)` | `file.md` | `Link` | null | markdown | false |
| `./other.md` | `./other.md` | null | null | path | true |

---

## 8.4 Link Resolution

Resolution transforms a parsed link into an absolute path (relative to collection root) pointing to the target file.

### Resolution Algorithm

Given a link value and the path of the file containing it:

1. **Parse the link** into components (target, format, is_relative)

2. **If format is `markdown` or `path`**:
   - If target starts with `/`, resolve from collection root (strip the leading `/`)
   - Otherwise, resolve relative to the containing file's directory (markdown-standard behavior)
   - Example: Link `[Docs](docs/api.md)` in `notes/meeting.md` resolves to `notes/docs/api.md`

3. **If format is `wikilink`**:
   - If target starts with `./` or `../`, resolve relative to the containing file's directory
   - If target starts with `/`, resolve from collection root (strip the leading `/`)
   - If target contains `/` (and is not relative), resolve from collection root
   - Example: `[[docs/api]]` resolves to `docs/api`

4. **If simple name** (no `/`, no `./` or `../`, and format is `wikilink`):
   - Define the search scope:
     - If the link field has `target` constraint specifying a type, scope to files matching that type
     - Otherwise, scope to the entire collection
   - **ID match pass**: Search scoped files for `id_field == name`
     - If exactly one match, resolve to it
     - If multiple matches, resolution MUST fail with `ambiguous_link`
   - **Filename match pass**: If no `id_field` match exists, search scoped **markdown files (records)** by filename
     - If exactly one match exists, resolve to it
     - If multiple matches exist, resolution MUST fail closed: resolve to `null` and emit `ambiguous_link`

   Implementations MUST NOT choose among duplicate simple-name matches by
   referring directory, path length, scan order, or lexical order. Those
   choices are unstable across providers and can silently bind a relationship
   to a different record after an unrelated move or import. Authors can make
   the target unambiguous with a path, a unique `id_field`, or a narrower typed
   target constraint.

   > **Note:** Non-markdown files are not records and are not candidates for simple name matching (per [§2.9](./02-collection-layout.md)). A wikilink `[[diagram]]` will not match `diagram.png` — only markdown files are searched by `id_field` and filename. Non-markdown files are only resolved when explicitly referenced by path (with extension or relative path).

5. **Extension handling**:
   - If target lacks extension, try configured extensions in order (default: `.md`)
   - Example: `[[readme]]` tries `readme.md`, `readme.mdx`, etc.

6. **Path traversal check**:
   - After resolution and normalization, if the resolved path would escape the collection root, abort with `path_traversal`

7. **Return**:
   - The absolute path (relative to collection root) if found
   - `null` if no matching file exists

### Resolution Examples

Given collection structure:
```
/
├── mdbase.yaml
├── tasks/
│   ├── task-001.md
│   └── subtasks/
│       └── task-002.md
├── notes/
│   └── meeting.md
├── people/
│   └── alice.md
└── journal/
    └── 2024/
        └── 01/
            └── 15.md
```

Link resolution from `tasks/subtasks/task-002.md`:

| Link Value | Resolved Path | Notes |
|------------|---------------|-------|
| `[[task-001]]` | `tasks/task-001.md` | Search by name |
| `[[../task-001]]` | `tasks/task-001.md` | Relative path |
| `[[./task-003]]` | `tasks/subtasks/task-003.md` | Relative (may not exist) |
| `[[notes/meeting]]` | `notes/meeting.md` | Absolute from root |
| `[[meeting]]` | `notes/meeting.md` | Search by name |
| `[[alice]]` | `people/alice.md` | Search by name |
| `[link](../task-001.md)` | `tasks/task-001.md` | Markdown, relative |
| `../task-001.md` | `tasks/task-001.md` | Bare path, relative |

---

## 8.5 Link Schema Options

When defining a link field in a type:

```yaml
fields:
  parent:
    type: link
    target: task           # Constrain resolution to 'task' type
    validate_exists: true  # Fail if target doesn't exist
    description: "Parent task this subtask belongs to"
  
  related:
    type: list
    items:
      type: link          # List of links (no constraints)
```

### `target` Constraint

Limits resolution scope to files of a specific type:

```yaml
assignee:
  type: link
  target: person
```

When resolving `[[alice]]` for this field:
1. Implementation searches only files that match the `person` type
2. Matches by the configured `id_field` (default: `id`)
3. If no `person` type file has `id: alice`, resolution fails

### `validate_exists` Constraint

When `true`, unresolved links cause validation errors:

```yaml
parent:
  type: link
  validate_exists: true
```

Default is `false` (links can point to non-existent files).

---

## 8.6 Link and Tag Extraction (for `file.*` properties)

To support `file.links`, `file.backlinks`, `file.embeds`, and `file.tags`, implementations
MUST extract links and tags from both frontmatter and body content using these rules:

### Link Extraction

**Included:**
- Frontmatter fields of type `link` and `list` of `link`
- Body links in wikilink form (`[[target]]`, `[[target|alias]]`, `[[target#anchor]]`)
- Body links in markdown form (`[text](path.md)`), including `#anchor`
- Embeds in wikilink form (`![[target]]`) and markdown form (`![alt](path.md)`)

**Excluded:**
- Links inside fenced code blocks (`` ``` `` or `~~~` delimiters)
- Links inside indented code blocks (4+ spaces or tab-indented lines per CommonMark §4.4)
- Links inside inline code spans (`` ` `` delimiters)
- Escaped wikilinks: a backslash immediately before `[[` (i.e., `\[[`) prevents wikilink parsing. The backslash is consumed and the brackets are treated as literal text. This does not apply to markdown links, which follow standard CommonMark escaping rules.

`file.links` returns all non-embed links; `file.embeds` returns only embeds.

### Tag Extraction

`file.tags` includes:
- Raw persisted frontmatter `tags` field if present (string or list of strings)
- Inline tags in body content of the form `#tag`

Inline tags MUST:
- Be preceded by whitespace or appear at the start of a line
- Match the pattern `[A-Za-z0-9_/-]+` after `#` (forward slashes create nested tag hierarchies)
- Be outside fenced code blocks, indented code blocks, and inline code spans
- Not be preceded by `](` or `](http` patterns (to exclude URL fragments)

Implementations SHOULD ignore `#` fragments in URLs. A simple heuristic is to skip any `#` that is preceded by `)`, `"`, `'`, or appears within a markdown link target (`[text](url#fragment)`).

### Nested Tags

Tags MAY contain forward slashes (`/`) to create hierarchies: `#inbox/to-read`, `#project/alpha/urgent`.

The `file.hasTag()` function performs **prefix matching** on nested tags: `file.hasTag("inbox")` matches `#inbox`, `#inbox/to-read`, and `#inbox/processing`. This is consistent with Obsidian's tag behavior.

Nesting has no depth limit. The `/` character is purely conventional — implementations do not need to build a tree structure.

---

## 8.7 Link Traversal

Links can be traversed to access properties of the linked file using the `asFile()` method.

### The `asFile()` Method

In expressions, `link.asFile()` resolves a link to its target file object:

```yaml
# Filter: tasks assigned to someone on the engineering team
filters: 'assignee.asFile().team == "engineering"'

# Formula: get the parent task's status
formulas:
  parent_status: "parent.asFile().status"
```

If the link cannot be resolved, `asFile()` returns `null`. Subsequent property access on `null` returns `null` (no error).

Self-referential links (a file linking to itself) are allowed. `asFile()` resolves to the same file, and the traversal depth limit prevents infinite loops when chained.

### Multi-Hop Traversal

`asFile()` MAY be chained to traverse multiple links:

```
assignee.asFile().manager.asFile().name
parent.asFile().project.asFile().status
```

Each `asFile()` call resolves the link field on the current file and returns the target file object.

**Null propagation:** If any hop returns `null`, the entire chain evaluates to `null` (no error).

**Depth limit:** Implementations MUST enforce a maximum traversal depth (default: 10 hops). Exceeding this limit MUST produce an `expression_depth_exceeded` error. Circular traversal (A → B → A) does not cause infinite loops because the depth limit applies.

### Accessing Linked File Properties

Once resolved, you can access:

**Frontmatter fields:**
```
parent.asFile().status
parent.asFile().priority
assignee.asFile().name
```

**File metadata:**
```
parent.asFile().file.name
parent.asFile().file.mtime
parent.asFile().file.path
```

### Performance Considerations

Each hop requires loading and parsing the target file. Implementations SHOULD:

- Cache resolved files during query execution
- Document performance characteristics for multi-hop queries
- Consider lazy resolution (only resolve when accessed)
- Warn users about expensive traversals in large collections

---

## 8.8 Link Functions

The following functions operate on links and files in expressions:

| Function | Description | Example |
|----------|-------------|---------|
| `link.asFile()` | Resolve link to file object | `assignee.asFile().name` |
| `file.hasLink(target)` | File contains link to target | `file.hasLink(link("tasks/main"))` |
| `file.links` | List of outgoing links | `file.links.length > 5` |
| `file.backlinks` | List of incoming links (requires index) | `file.backlinks.length` |
| `link(path)` | Construct a link from path | `link("people/alice")` |

### Backlinks

`file.backlinks` returns files that link **or embed** the current file (frontmatter link fields,
body wikilinks/markdown links, and embeds). This requires either:

- A full scan of all files (slow without cache)
- A pre-computed reverse index (requires cache)

Implementations SHOULD document whether `file.backlinks` requires caching for reasonable performance.

**Example: Find files linking to current file**
```yaml
filters: "file.hasLink(this.file)"
```

---

## 8.9 Link Storage and Round-Tripping

When writing links to frontmatter, implementations SHOULD preserve the original format when possible:

- If user wrote `[[note]]`, prefer outputting `[[note]]` over `./note.md`
- If user wrote a relative path, preserve relativity when possible
- If user wrote with an alias, preserve the alias

This preserves user intent and keeps files human-readable.

---

## 8.10 Links in Body Content

While this specification focuses on frontmatter, links also appear in markdown body content. Implementations SHOULD support:

- Parsing links from body content
- Updating body links during rename operations
- Including body links in `file.links`

Implementations that do NOT support body link parsing MUST document this limitation. See [Operations](./12-operations.md) for rename behavior.

---

## 8.11 Broken Links

A "broken link" is a link that cannot be resolved to an existing file. Handling options:

| Scenario | Behavior |
|----------|----------|
| `validate_exists: false` (default) | Broken links are allowed; `asFile()` returns `null` |
| `validate_exists: true` | Broken links cause validation errors |
| Rename operations | Implementations SHOULD update links to maintain validity |
| Delete operations | Implementations MAY warn about incoming links that will break |

---

## 8.12 Link Examples

### Simple Task Hierarchy

```yaml
# tasks/parent.md
---
type: task
id: parent
title: Main Feature
subtasks:
  - "[[child-1]]"
  - "[[child-2]]"
---
```

```yaml
# tasks/child-1.md
---
type: task
id: child-1
title: Subtask One
parent: "[[parent]]"
---
```

### Cross-Type References

```yaml
# tasks/implement-api.md
---
type: task
assignee: "[[alice]]"
spec: "[[docs/api-spec]]"
related:
  - "[[tasks/write-tests]]"
  - "[[tasks/update-docs]]"
---
```

### Relative Links

```yaml
# projects/alpha/tasks/task-001.md
---
type: task
parent: "[[../overview]]"           # projects/alpha/overview.md
sibling: "[[./task-002]]"           # projects/alpha/tasks/task-002.md
global_reference: "[[people/bob]]"  # people/bob.md (from root)
---
```

---

## 8.13 Path Sandboxing

Link resolution MUST NOT resolve to paths outside the collection root.

### Rules

- After resolving relative paths (applying `../` segments), the resulting absolute path MUST be within the collection root directory
- If resolution would escape the collection root, the link MUST resolve to `null` and implementations MUST emit a `path_traversal` error
- This applies to all link formats: wikilinks, markdown links, and bare paths
- Implementations MUST normalize paths (resolve `.` and `..` segments) before checking containment

### Example

In a collection rooted at `/home/user/notes/`:

| Link | From File | Result |
|------|-----------|--------|
| `[[../../../etc/passwd]]` | `notes/daily.md` | `null` + `path_traversal` error |
| `[[../../secrets/key]]` | `deep/nested/file.md` | `null` + `path_traversal` error |
| `[[../sibling]]` | `tasks/task-001.md` | Resolves normally (stays within root) |
