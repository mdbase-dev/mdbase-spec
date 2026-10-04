# 02. Collection Layout

## Identification

A directory is an mdbase v0.3 collection when it contains `mdbase.yaml` with a
supported v0.3 `spec_version`.

```yaml
spec_version: "0.3.0"
```

Tools MUST NOT treat a parent directory as owning records below a nested
directory that has its own `mdbase.yaml`.

## Recommended Layout

```text
collection/
  mdbase.yaml
  mdbase.lock.yaml
  _types/
    meta.md
    task.md
    view.md
  _contracts/
    example.task.md
    mdbase.view/
      1.0.0.md
  tasks/
    example.md
  views/
    tasks.md
```

Only `mdbase.yaml` is required. Untyped records form a valid collection.

View records are ordinary records identified by their type's `mdbase.view`
contract implementation, not by location, and require no reserved folder. A collection
MAY organize them under `Views/`, `_views/`, or any other non-excluded path.
Unlike the configured types folder, such a folder remains part of the normal
record scan unless explicitly excluded.

## Reserved Paths

The following paths are reserved by default:

- `mdbase.yaml`
- `mdbase.lock.yaml`, when managed type packs are installed
- the configured types folder, default `_types/`
- the configured contracts folder, default `_contracts/`
- `.mdbase/` for derived implementation state
- nested collection roots

Folders holding durable runtime state, such as `workflows/` or `runs/`,
contain ordinary records unless excluded by configuration. Their meaning comes
from their type files, never from their folder names.

## Record Discovery

Tools discover records by recursively scanning the collection root for files
with configured record extensions. Each extension fixes the record's format
(Chapter 03); `base` files are YAML document records. The
default extension set is:

```yaml
record_extensions: [md]
```

Tools MUST:

- use forward slash paths in collection APIs
- skip excluded paths
- skip the configured types folder
- skip the configured contracts folder
- skip `.mdbase/`
- skip `mdbase.yaml` and `mdbase.lock.yaml`, whatever the record extensions
- stop scanning at nested collection roots
- ignore non-record extensions unless configured otherwise
- skip the built-in exclusions below

Every tool applies the same built-in exclusions so that conforming tools
discover the same record set:

- any path with a component beginning with `.`, such as `.git/`, `.obsidian/`,
  or `.hidden.md`
- any path with a component named `node_modules`

`settings.exclude` globs are excluded in addition to the built-in exclusions.

## Path Globs

Every mdbase glob, including `match.path_glob`, `settings.exclude`, and
`collection.unique` path scopes, matches a complete collection-relative path
with these rules:

| Pattern | Matches |
| --- | --- |
| `*` | zero or more characters other than `/` |
| `?` | exactly one character other than `/` |
| `[abc]`, `[a-z]`, `[!abc]` | one character other than `/` in, or not in, the set |
| `**` as a complete path component | zero or more complete path components |
| any other character | itself |

Matching is case-sensitive and uses Unicode code points. A glob has no leading
`/`. A `**` that is not a complete path component is invalid, as are brace
expansion and backslash escapes. `tasks/**` matches every path below `tasks/`,
and `tasks/**/*.md` matches Markdown files at any depth below `tasks/`.

## Type Discovery

The configured `types_folder` defaults to `_types`.

Every Markdown file directly or recursively under the types folder whose
frontmatter declares `kind: mdbase.type` is a candidate type definition.

Tools MAY warn for files under the types folder that are not valid type files.
They MUST NOT treat type files as data records.

## Data Contract Discovery

The configured `contracts_folder` defaults to `_contracts`.

Every Markdown file directly or recursively under the contracts folder whose
frontmatter declares `kind: mdbase.contract` is a candidate data contract.
Contract loading, exact-version identity, and implementation validation are
defined in Chapter 05A.

Tools MAY warn for files under the contracts folder that are not valid contract
files. They MUST NOT treat data contract files as records.

## Runtime Record Discovery

Durable runtime records are discovered like ordinary records. A workflow is a
record whose matched type implements the `mdbase.runtime.workflow` record
contract, such as the standard pack's `runtime_workflow` type. Contract
implementation is authoritative; folder names and filenames are conventions and
have no discovery meaning.

Event and action contracts are data contract files under the contracts folder,
not records.

## Paths And Safety

All collection paths are relative to the collection root and use `/`.

Operations MUST reject paths that escape the collection root after normalization.
This includes `..` traversal, symlink traversal where the implementation follows
symlinks, and absolute paths supplied where a collection-relative path is
required.

Implementations MAY reject platform-reserved filenames or characters when a
write operation targets a filesystem where those paths cannot be represented.

## Path Equivalence

Two collection paths name the same record path when their **path keys** are
equal. The path key of a path is computed as follows:

1. normalize the path to Unicode Normalization Form C (NFC)
2. apply Unicode default case folding (the full `C` and `F` mappings of
   `CaseFolding.txt`, without locale tailoring)
3. normalize the result to NFC again

`Notes/Café.md` written with a precomposed `é` and `notes/CAFE\u0301.md`
written with a combining accent have the same path key. So do `Straße.md` and
`STRASSE.md`. Path keys never appear in results; paths are always reported as
written.

Path equivalence exists because macOS and Windows file systems treat such
paths as one file, while Linux does not. Every tool therefore agrees on what
collides, whatever file system it runs on:

- A write MUST NOT create a record whose path key equals the path key of a
  different existing record. The collision rule below decides what happens
  instead.
- A rename whose source and target have the same path key, such as
  `tasks/todo.md` to `tasks/Todo.md`, changes only the spelling of the path
  and is not a collision.
- When record discovery finds several files with one path key, which can
  happen on a case-sensitive file system, each file is still a record. Core
  Read reports a `path_collision` warning on every record of the group, with
  `details.paths` listing the group in code-point order.

Path globs (above) remain case-sensitive and match paths as written.

**Provisional (rc.5).** Case folding uses the full mappings, so `ß` and
`ss` collide. This flags more collisions than some file systems would, never
fewer.

## Path Collisions

When a new record would take a path whose path key is already in use, the
outcome depends on where the path came from:

| Path source | Outcome |
| --- | --- |
| an explicit path supplied by the caller of create or rename | the operation fails with `path_conflict` before any write |
| a path derived from `collection.path.pattern` (Chapter 07) | the record receives the first free suffixed path |
| two records that already hold equivalent paths, for example after concurrent creates or an engine copying records onto another file system | the earlier-ordered record keeps the path; each later one receives the first free suffixed path |

A suffixed path inserts ` (n)`, a space and a decimal integer in parentheses,
before the final extension of the last path component: `tasks/Call Bob.md`
becomes `tasks/Call Bob (2).md`. Candidates are tried with `n = 2, 3, 4, …`,
and the first candidate whose path key is unused is chosen. Existing suffixes
are not parsed: the next candidate for `Call Bob (2).md` is
`Call Bob (2) (2).md`.

The ordering of records is supplied by whatever applies the rule, for example
the order in which an engine confirmed two creates. When no order exists
between the records, the record whose path as written is smaller in Unicode
code-point order is earlier. Every tool that applies the rule to the same
records in the same order computes the same paths.

A suffixed path is an ordinary path. Applying the rule never edits a record's
frontmatter or body, and the record keeps whatever identity its tool tracks.
