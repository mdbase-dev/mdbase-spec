# 13. Migrations And Compatibility

## Migration Philosophy

This chapter has two parts. The first lists what changed for v0.3 collections
and engines between the fourth and fifth release candidates. The second
migrates v0.2.x collections into the v0.3 source model.

Migration never rewrites a record.

## Changes Since rc.4

0.3.0-rc.5 adds the concurrent-edit semantics of Chapter 12A and relaxes
several write-time checks. Collections keep `spec_version: "0.3.0"` and need
no edit. Record files, type files, contracts, type packs, view records, and
queries that were valid under rc.4 stay valid.

Most changes are relaxations: a write that rc.4 rejected now succeeds and is
reported. A few rules are tightened, and each tightening is reported as a
diagnostic rather than by rejecting a collection, so that no collection that
worked under rc.4 stops loading.

### Behavior changes

| Area | rc.4 | rc.5 | To keep the rc.4 behavior |
| --- | --- | --- | --- |
| `collection.unique` | at level `error`, a write that creates a duplicate fails | duplicates are reported and never block a write (`enforce: report` is the default) | add `enforce: write` to the rule |
| `unique.scope` | listed, but its comparison set was underspecified | a rule governs records of its type; `scope` selects the records they must differ from; raw values compare without coercion; the default scope is `type` | nothing; check reports for records in the now exact scope |
| link `validate_exists` and `target_type` | at level `error`, a write with a broken link fails | reported, never blocking | no equivalent; cross-record checks never block |
| a successful write with cross-record issues | not applicable | returns `valid: true` with `warning` diagnostics | nothing |
| concurrent edits | whole-record revision checks | tools that reconcile edits merge field by field (Chapter 12A); `if_revision` is opt-in and never added on a caller's behalf | pass `if_revision` explicitly |
| lifecycle `now` and `today` fields, `tags`, `uniqueItems` arrays | no merge semantics | merge as `max`, `union`, and `union` by default | declare `conflict` in `collection.merge` |
| update | `patch`, `unset`, `body`, `document` | adds `add` and `remove` list operations, and `body_edits` against a `body_base` digest | nothing |
| regular expressions in CEL `matches()`, JSON Schema `pattern`, and `match.where` | engine-dependent; Unicode-aware classes were implied | one profile everywhere: RE2 syntax with ASCII-only `\d`, `\w`, `\s`, `\b`, and case folding (Chapter 10); `\p{...}` is invalid | none; list non-ASCII characters explicitly, or lowercase text before matching |
| derived path already taken | `path_conflict` | the first free suffixed path | supply an explicit path to get an error instead |
| structured writes to Markdown frontmatter | only array and object structure SHOULD be preserved | MUST re-emit only changed entries | nothing |
| structured writes to YAML document records | could re-emit the whole mapping | follow writer format fidelity | nothing |
| filename link tiebreakers | SHOULD; "shortest path" unmeasured | MUST: referring directory, then fewest path segments, then code-point order; never scan or storage order | nothing |
| rename with reference updating | which links are rewritten was unspecified | only links that resolved to the renamed record, including tiebreaker-selected matches; ambiguous links and links to other records unchanged; listed in `references_updated` | nothing |

### Tightenings reported as diagnostics

| Rule | How an engine reports a collection that relies on the rc.4 behavior |
| --- | --- |
| `match.expr` should not call `now()` or `today()`, read `file.mtime` or `file.ctime`, or follow links (Chapter 07) | the type still loads and its expression is evaluated as before; the engine reports a `warning` with code `nondeterministic_match`, the type name, and `details.binding`. In 0.3.0 stable this becomes an error that invalidates the type, so authors must move such logic before then |
| a `collection.path.pattern` value may not contain `/` or `\`, begin with `.`, or be empty (Chapter 07) | existing records are unaffected, whatever their paths; only a create that would derive such a path fails, with `path_value_invalid` naming the field. rc.4 already called such values invalid, but engines created folders from them |
| paths equal under case folding and NFC name one record path (Chapter 02) | existing files that collide stay records and each reports a `warning` with code `path_collision` and `details.paths`; an explicit create or rename onto an equivalent path fails with `path_conflict` |
| an ambiguous configured ID does not fall back to filename resolution (Chapter 08) | the link resolves to null and the referring record reports an `ambiguous_link` warning with `details.candidates`. rc.4 already required this; engines that fell back are non-conforming |
| a pattern may not use Unicode classes such as `\p{L}`, backreferences, or look-around (Chapter 10) | a type whose JSON Schema `pattern` or `match.where` pattern does so is invalid with `invalid_pattern`; a CEL literal pattern is an `expression_compile_error`. Patterns that only use `\w`, `\d`, `\s`, `\b`, or `(?i)` stay valid but match only ASCII in those constructs, so an rc.4 engine with Unicode classes diverges on non-ASCII text |
| `settings.id_field` has no default (Chapter 04) | rc.4 already required this; an engine that resolved through `id` without configuration is non-conforming. A collection that relies on ID resolution adds `id_field: id` |

### What needs no change

- `spec_version`, which stays `0.3.0`
- record files, frontmatter, and bodies
- JSON Schemas, read defaults, links, projections, and display metadata
- lifecycle policies, apart from the merge defaults above
- CEL queries, collection projections, view records, and lifecycle guards,
  which may still use `now()` and `today()`
- data contracts and their digests, type packs, and `mdbase.lock.yaml`
- the event/action interoperability profile 0.1 and the durable runtime
  profile 0.2

### Engines

An engine moving from rc.4 to rc.5:

- stops rejecting writes for cross-record issues, other than
  `enforce: write` uniqueness rules, and reports those issues as warnings on
  successful writes
- evaluates every pattern with the mdbase regex profile
- implements `body_edits`, at least the direct case
- implements `add` and `remove`, path keys and the collision rule,
  `path_value_invalid`, and the writer format fidelity rule
- stops supplying `if_revision` on a caller's behalf
- implements the merge of Chapter 12A if it reconciles concurrent edits, and
  claims the `merge` profile
- implements move detection if it reports renames of externally moved files
- reports `nondeterministic_match`, `path_collision`, and `ambiguous_link`
- applies the filename tiebreakers exactly, and rewrites on rename only the
  links that resolved to the renamed record
- removes any `id` default for `settings.id_field`

Engines that conform to rc.4 keep claiming `0.3.0-rc.4` until they pass the
rc.5 suite. The [rc.5 release notes](./docs/releases/0.3.0-rc.5.md) list every
conformance test whose expected outcome changed, which is where an rc.4 engine
diverges.

## From v0.2 To v0.3

The rest of this chapter migrates v0.2.x collections into the v0.3 source
model.

Migration tooling should produce:

- a readable diff
- a machine-readable report
- explicit unsupported-feature notes
- generated output only with user approval or generated-file detection

Migration analyzes the complete collection. Before a write, tooling MUST
validate every existing record against the proposed target types and include
incompatible records in the report.

### Configuration

Configuration migration preserves which files are records and how they
validate and resolve:

- `spec_version` becomes `0.3.0`.
- `settings.default_validation`, or a top-level `default_validation`, becomes
  `settings.validation`. When neither is set, migration writes
  `validation: warn`, the v0.2 default.
- A top-level `id_field` moves under `settings`. When neither is set,
  migration writes `id_field: id`, because v0.2 resolved wikilinks by ID by
  default.
- `settings.extensions` becomes `settings.record_extensions`, without leading
  dots and including `md`.
- `settings.include_subfolders: false` adds the exclusion `*/**`, and the
  setting is removed.
- Each `settings.exclude` pattern becomes a portable glob that excludes the
  same paths. A bare name without `/`, `*`, `?`, or `[` excluded that root
  path and everything below it, so `archive` becomes `archive/**`. A pattern
  without `/` that contains a wildcard matched file names at any depth, so
  `*.draft.md` becomes `**/*.draft.md`. A pattern containing `/` is kept.
  Patterns that only repeat the built-in exclusions from Chapter 02 or name the
  types or contracts folder may be dropped. A pattern that is not a portable
  glob is reported for review.
- Other v0.2 settings, such as `default_strict` and the write options, have no
  v0.3 meaning. Migration moves them under `x-legacy-v0.2` in the configuration
  and migrates strictness into each type's `additionalProperties`.

### Type Mapping

| v0.2.x feature | v0.3 destination |
| --- | --- |
| `fields` | JSON Schema `properties` |
| field `required` | JSON Schema root `required` |
| `type: string` | `{ type: "string" }` |
| `type: integer` | `{ type: "integer" }` |
| `type: number` | `{ type: "number" }` |
| `type: boolean` | `{ type: "boolean" }` |
| `type: date` | `{ type: "string", format: "date" }` |
| `type: datetime` | `{ type: "string", format: "date-time" }` |
| `type: time` | `{ type: "string", format: "time" }` |
| `type: enum`, `values` | JSON Schema `enum` |
| `type: list` | JSON Schema `array` |
| `type: object` | JSON Schema `object` |
| `type: link` | JSON Schema string/array plus `collection.links` |
| `default` | JSON Schema `default` and/or `collection.read_defaults` |
| `strict` | `additionalProperties` |
| `unique` | `collection.unique` |
| `generated` | `lifecycle` |
| `computed` | query projection, collection projection, or workflow |
| `path_pattern` | `collection.path.pattern` |
| `display_name_key` | `collection.display.name_field` |
| `extends` | JSON Schema `$ref`/`allOf` or explicit duplication |

### Defaults

Migration should distinguish:

- creation/editor hints: JSON Schema `default`
- effective read/query defaults: `collection.read_defaults`
- dynamic values: `lifecycle`

For current mdbase field defaults, the safest migration is to emit both JSON
Schema `default` and `collection.read_defaults` for static scalar defaults, with
a report explaining the difference.

### Generated Fields

Generated fields migrate to lifecycle. v0.2 generated values apply only when the
field is missing, while lifecycle `set` always assigns, so migration adds a
`!has(raw.field)` guard to preserve that rule:

| v0.2.x generated | v0.3 lifecycle |
| --- | --- |
| `now` | `on_create: [{ if: '!has(raw.field)', set: { field: { now: true } } }]` |
| `now_on_write` | unguarded `on_create` and `on_update` actions setting `{ now: true }` |
| `uuid` | guarded `on_create` action setting `{ uuid: true }` |
| `ulid` | guarded `on_create` action setting `{ ulid: true }` |
| `slugify from field` | guarded `on_create` action setting `{ slugify: source }` |
| `from field` without a transform | guarded `on_create` action setting `{ copy: source }` |
| `sequence` | no destination; reported as unsupported |

`sequence` assigned "largest existing value plus one". It has no portable
destination because concurrent creates on different devices allocate the same
number unless every create is coordinated (Chapter 09). Migration reports each
sequence field and recommends a guarded `ulid` or `uuid` action. Tools that
must keep allocating numbers do so through an implementation provider under
an `x-*` extension.

### Computed Fields

Computed fields migrate to one of:

- query projection suggestion
- `collection.projections` when the target tool supports it
- workflow/runtime policy when the computed value should be materialized
- unsupported note when the computation has side effects or depends on
  non-portable functions

### Expressions

Current mdbase expressions migrate to CEL where possible.

Tool-specific expression dialects are adapter concerns. Tools may translate
them to CEL for portable storage and translate them back for user interfaces or
exports.

### Runtime Workflows

Current generated-field and tool-conforming behavior that causes mutation
should be reviewed as lifecycle or workflow behavior.

Generated IDs and timestamps usually become lifecycle.

Cross-record behavior, agent work, approval flows, external APIs, and scheduled
checks become workflows and action/event contracts.

### Data Contract Implementations

Portable application interfaces migrate to a local data contract plus a
type-local `implements` entry.

Example:

```yaml
implements:
  - contract: example.task
    version: 1.0.0
    fields:
      status: status
    binding:
      completed_values: [done, cancelled]
```

The migration bundle MUST include the exact `mdbase.contract` artifact required
by the implementation. Existing convention-based `x-*` objects do not become
contracts merely because they contain keys named `contract` or `version`.

Private annotations with no portable contract meaning remain under a
namespaced `x-*` section. They SHOULD NOT become JSON Schema custom keywords.

### Version Detection

A v0.2.x type file usually has `name` and `fields` without `kind:
mdbase.type`.

A v0.3 type file has `kind: mdbase.type` and `schema`.

Migration tooling SHOULD refuse ambiguous files unless the user supplies an
explicit source version.

## Safe Migration Protocol

A conforming migration command has separate analyze and apply phases:

1. discover source config, type files, extension metadata, and records
2. generate proposed config/types without modifying the collection
3. validate generated schemas and type files
4. validate all existing records against the proposed target
5. emit a human-readable diff and machine-readable report
6. require explicit approval unless every target is recognized as generated
7. create a backup manifest containing hashes and original paths
8. write through temporary files and atomic renames where supported
9. re-open and validate the migrated collection

Apply MUST abort before writes when analysis has unsupported features or invalid
target records unless the caller explicitly selects a documented partial mode.
A failed apply restores files from the backup manifest when restoration is
possible and reports any paths requiring manual recovery.

Apply SHOULD durably journal the currently attempted path and completed paths
inside the backup before each replacement. Tooling MUST provide a recovery path
that can resume or restore an interrupted apply. Restoration MUST validate the
backup hashes from the manifest before replacing current files and MUST require
explicit approval when invoked as a separate command.

Repeated analysis of unchanged inputs MUST produce the same report. Re-applying
an already migrated type MUST fail without writing.

Unknown source metadata is preserved under `x-legacy-v0.2` with its original
key paths unless a named migration adapter handles it. YAML comments and style
preservation are best effort. Markdown bodies MUST be preserved byte for byte.

The report includes source and target hashes, generated-file evidence, exact
mappings, warnings, unsupported constructs, invalid record paths, proposed file
operations, backup location, and post-apply validation status.
