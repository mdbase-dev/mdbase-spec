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
with configured record extensions. The default extension set is:

```yaml
record_extensions: [md]
```

Tools MUST:

- use forward slash paths in collection APIs
- skip excluded paths
- skip the configured types folder
- skip the configured contracts folder
- skip `.mdbase/`
- skip `mdbase.lock.yaml`
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
