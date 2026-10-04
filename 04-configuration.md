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
| `settings.id_field` | string | none | field used for ID-based wikilink resolution and as a move-detection identity hint; when absent, wikilinks resolve by path and filename only |
| `settings.exclude` | list of globs | `[]` | paths excluded in addition to the built-in exclusions in Chapter 02 |

`settings.explicit_type_keys` replaces the default key list. An empty list makes
all type membership inferred.

`settings.id_field` has no default. When the key is absent, a tool MUST NOT
resolve wikilinks by any frontmatter field, including a field named `id`, and
MUST NOT treat any field as a move-detection identity hint. A collection that
wants ID-based resolution names the field explicitly, as the recommended
configuration above does. The configured field is ordinary frontmatter: mdbase
never requires it, writes it, or reserves it.

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

## Validation Principle

Validity is a property reported when records are read, never a guarantee.
Files are edited by tools that know nothing about types, and a merge of two
individually valid edits can produce an invalid record. A conforming tool
MUST read, index, query, and report every record whatever its validity. An
engine MUST NOT refuse to take in a file because it is invalid, and MUST NOT
modify an invalid file to make it valid unless a caller asks for that write.

Engines MAY reject an invalid write made through them, as feedback to the
writer, but only for request and safety checks and for checks within the
single record being written. Checks are divided into three tiers:

| Tier | Checks | Effect on a write made through an engine |
| --- | --- | --- |
| request and safety | invalid requests, path escapes and unsafe paths, `path_conflict` for an explicit path, configuration and type-file errors, `type_conflict`, `type_membership_changed`, lifecycle failures, `if_revision` failures, expression compilation errors, and `collection.unique` rules with `enforce: write` | always rejected, at every validation level |
| single-record | JSON Schema failures, `format_invalid`, non-mapping frontmatter, and data contract view failures | follows the validation level below |
| cross-record | `collection.unique` rules with `enforce: report`, `link_not_found`, link `target_type` mismatches, `ambiguous_link`, and `path_collision` | reported, never rejected |

A single-record check depends only on the record's own path, frontmatter,
body, and the type registry. A cross-record check also depends on other
records; such a check never blocks a write, because another tool, another
device, or a later edit can change the other records at any time. The only
exception is a uniqueness rule that explicitly opts into `enforce: write`
(Chapter 07).

Writes that do not go through an engine's write operations are never rejected.
That includes edits made by other tools, files that appear through a file
system or synchronization tool, and the results of the merge in Chapter 12A.
Their issues are reported when the record is read or validated.

## Validation Levels

`settings.validation` controls how single-record and cross-record validation
issues are reported, and whether single-record issues reject a write made
through an engine.

| Level | Record validation | Reads and queries | Create, update, rename, batch |
| --- | --- | --- | --- |
| `off` | not performed | return records without validation diagnostics | write without record validation |
| `warn` | performed | return records with `warning` diagnostics | write and report `warning` diagnostics |
| `error` | performed | return records with `error` diagnostics | fail before writing when the resulting record has a single-record issue; write and report cross-record issues as `warning` diagnostics |

At every level a read returns the record, including an invalid one, and a query
evaluates every candidate. Queries do not report per-record validation issues
unless the caller requests them.

A successful write reports any cross-record issues of the written record as
`warning` diagnostics at every level except `off`, so a write that succeeded
always returns `valid: true`. A read or `validate` of the same record reports
them with the level's severity.

Validation levels never relax the request and safety tier: those checks are
always errors.

An explicit `validate` operation always performs record validation. At level
`off` it reports issues as `warning`.

**Provisional (rc.5).** Data contract view failures are classed as
single-record, although a contract view built from collection projections can
depend on other records or on the current time. Such projections are rare in
contract mappings; a later release candidate may move the affected failures to the
cross-record tier.

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

mdbase has one expression language: the mdbase CEL profile (Chapter 10). No
config key is required to opt into CEL. Every expression in a type file,
`mdbase.yaml`, a query, a view record, a lifecycle policy, or a workflow is
CEL.

Other expression syntaxes, such as Obsidian Bases filters and formulas, are
adapter dialects. An adapter dialect appears only in a source format that an
adapter owns, such as an `obsidian.base` record, or under an `x-*` extension
whose owner defines its semantics. A dialect never affects type membership,
validation, lifecycle, merge, or the meaning of a portable query. Tools MAY
translate a dialect to CEL, and MAY offer a dialect in a user interface, as
long as what they store in portable members is CEL.

## Version Compatibility

Patch versions within the same stable minor version MUST be backward compatible.

For prerelease v0.3 versions, tools MUST require and report the exact supported identifier
when rejecting a collection.

## Environment And Includes

Config includes and environment substitution are optional local extensions.
Expanded values MUST be the values used for validation and query behavior.
Non-portable config extensions SHOULD use a namespaced key.
