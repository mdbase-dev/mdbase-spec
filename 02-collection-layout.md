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
  _types/
    meta.md
    task.md
    workflow.md
    action.md
    event.md
  _contracts/
    example.task.md
  actions/
    mdbase.record.patch.md
  events/
    file.created.md
  workflows/
    route-new-file.md
  policies/
    local-runtime-policy.md
  tasks/
    example.md
```

Only `mdbase.yaml` is required. Untyped records form a valid collection.

View records are ordinary records and require no reserved folder. A collection
MAY organize them under `Views/`, `_views/`, or any other non-excluded path.
Unlike the configured types folder, such a folder remains part of the normal
record scan unless explicitly excluded.

## Reserved Paths

The following paths are reserved by default:

- `mdbase.yaml`
- the configured types folder, default `_types/`
- the configured contracts folder, default `_contracts/`
- `.mdbase/` for derived implementation state
- nested collection roots

Runtime folders such as `providers/`, `actions/`, `events/`, `workflows/`,
`capabilities/`, `policies/`, `runs/`, and `checkpoints/` contain ordinary
records unless excluded by configuration. Their meaning comes from their type
files and runtime contracts.

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
- stop scanning at nested collection roots
- ignore non-record extensions unless configured otherwise

Tools SHOULD exclude common derived directories by default, including `.git/`
and `node_modules/`.

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

Runtime records are discovered like ordinary records. A workflow record is a
record whose effective type is `workflow`. An action contract is a record whose
effective type is `action`. The effective type is authoritative; folder names
are conventions.

Tools SHOULD preserve common folder names for portability:

- `actions/`
- `events/`
- `providers/`
- `workflows/`
- `capabilities/`
- `policies/`
- `runs/`
- `checkpoints/`

## Paths And Safety

All collection paths are relative to the collection root and use `/`.

Operations MUST reject paths that escape the collection root after normalization.
This includes `..` traversal, symlink traversal where the implementation follows
symlinks, and absolute paths supplied where a collection-relative path is
required.

Implementations MAY reject platform-reserved filenames or characters when a
write operation targets a filesystem where those paths cannot be represented.
