# 04. Configuration

## `mdbase.yaml`

The collection config file is named `mdbase.yaml` and lives at the collection
root.

Minimal v0.3 config:

```yaml
spec_version: "0.3.0"
```

Recommended config:

```yaml
spec_version: "0.3.0"

settings:
  timezone: Australia/Melbourne
  types_folder: _types
  contracts_folder: _contracts
  record_extensions: [md]
  validation: error
  explicit_type_keys: [type, types]
  id_field: id
```

## Required Keys

`spec_version` is required. During major-zero development, the minor component
is the compatibility boundary. A v0.3 tool MUST reject v0.2 and v0.4
collections unless an explicit compatibility adapter is enabled.

Pre-1.0 draft versions MAY be accepted by explicit compatibility setting.

## Settings

| Key | Type | Default | Meaning |
| --- | --- | --- | --- |
| `settings.timezone` | string | local runtime | durable IANA timezone for authority-owned calendar semantics |
| `settings.types_folder` | string | `_types` | folder containing type files |
| `settings.contracts_folder` | string | `_contracts` | folder containing data contract files |
| `settings.record_extensions` | list of strings | `[md]` | record file extensions without dot |
| `settings.validation` | string | `error` | default validation level: `off`, `warn`, or `error` |
| `settings.explicit_type_keys` | list of strings | `[type, types]` | frontmatter keys used for explicit type declarations |
| `settings.id_field` | string | none | field used for ID-based wikilink resolution; when absent, wikilinks resolve by path and filename only |
| `settings.exclude` | list of globs | `[]` | paths excluded in addition to the built-in exclusions in Chapter 02 |

`settings.explicit_type_keys` replaces the default key list. An empty list makes
all type membership inferred.

`settings.timezone`, when present, MUST be an IANA timezone identifier. `UTC`
is the canonical identifier for Coordinated Universal Time. Numeric offsets and
ambient aliases such as `local` are invalid because they do not name a durable
calendar authority or model daylight-saving transitions. An invalid configured
timezone makes the collection configuration invalid; an implementation MUST
NOT silently substitute its runtime timezone.

The types and contracts folders MUST be different normalized paths. Both are
reserved control-file folders and are excluded from ordinary record discovery.

Unknown config keys MUST produce a warning while normal config loading
continues. An explicit strict-config mode MAY reject them.

## Validation Levels

`settings.validation` controls how record validation issues affect operations.
Record validation issues are JSON Schema failures, `format_invalid`, collection
validator failures such as uniqueness and `validate_exists`, non-mapping
frontmatter, and data contract view failures.

| Level | Record validation | Reads and queries | Create, update, rename, batch |
| --- | --- | --- | --- |
| `off` | not performed | return records without validation diagnostics | write without record validation |
| `warn` | performed | return records with `warning` diagnostics | write and report `warning` diagnostics |
| `error` | performed | return records with `error` diagnostics | fail before writing when the resulting record has any issue |

At every level a read returns the record, including an invalid one, and a query
evaluates every candidate. Queries do not report per-record validation issues
unless the caller requests them.

Validation levels never relax request and safety checks: invalid requests, path
escapes, type-file and configuration errors, `type_conflict`,
`type_membership_changed`, lifecycle failures, concurrency conflicts, and
expression compilation errors are always errors.

An explicit `validate` operation always performs record validation. At level
`off` it reports issues as `warning`.

## Runtime Host Config

Durable-runtime enablement, worker identity, storage, transport binding, and
policy selection are host concerns and are not part of the core `mdbase.yaml`
schema. This prevents merely opening a collection from activating executable
behavior.

Portable runtime policies and workflow/state records are ordinary records
implemented by the standard runtime pack. A host MAY preserve private
configuration under an `x-*` extension or in its own settings store, but that
configuration does not change core contract resolution. Runtime profile 0.2
has one resolution model and no contract mode.

## Expressions

Portable v0.3 expressions are CEL. No config key is required to opt into CEL.

Tools MAY support non-portable UI expression dialects. Portable stored v0.3
files MUST use the mdbase CEL profile unless a feature declares a different
extension namespace.

View records use CEL for portable filters, projections, selections, and custom
summaries. Compatibility tools MAY read another view or expression format, but
alternate source and round-trip metadata belong under an `x-*` extension and do
not change the meaning of the portable CEL fields.

## Version Compatibility

Patch versions within the same stable minor version MUST be backward compatible.

For prerelease v0.3 versions, tools MUST require and report the exact supported identifier
when rejecting a collection.

## Environment And Includes

Config includes and environment substitution are optional local extensions.
Expanded values MUST be the values used for validation and query behavior.
Non-portable config extensions SHOULD use a namespaced key.
