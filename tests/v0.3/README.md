# mdbase v0.3 Conformance Suite

This directory is the parallel v0.3 conformance suite. It does not replace the
existing `tests/level-*` v0.2.x suite.

v0.3 conformance claims use the atomic profiles defined by the specification.
The tests below are grouped into thirteen fixture sets:

1. `schema_artifacts`
2. `migration`
3. `core_collection`
4. `data_contracts`
5. `lifecycle`
6. `type_packs`
7. `cel`
8. `views`
9. `event_action_interop`
10. `runtime_contracts`
11. `workflow_execution`
12. `merge` (since rc.5)
13. `watch` (since rc.5)

The suite covers JSON Schema artifacts, type wrappers, first-class data
contracts and projections, collection semantics, CEL host bindings, saved
views, lifecycle operations, portable event/action exchange, runtime contract
registries, workflow preflight, and execution cases for available adapters.
Compatible v0.2 fixtures remain useful for frontmatter parsing, missing/null
semantics, links, operation safety, and watch ordering. Tests tied to the
earlier custom field grammar are migrated into the v0.3 fixture sets.

## Format

Each suite file is YAML with:

```yaml
name: "suite name"
spec_version: "0.3.0"
fixture_set: core_collection
category: validation
spec_ref: "v0.3/07"
groups:
  - name: "group name"
    setup:
      config: |
        spec_version: "0.3.0"
      types:
        task.md: |
          ---
          kind: mdbase.type
          name: task
          schema:
            dialect: json-schema-2020-12
            value:
              type: object
          ---
      files: {}
    tests:
      - name: "test name"
        operation: validate
        input: {}
        expect: {}
```

The shape is intentionally close to the v0.2 runner format. A fixture set may
exercise several atomic conformance profiles, but passing it is not itself a
conformance claim. `manifest.yaml` records its non-normative `coverage_targets`;
verified claims must use `schemas/v0.3/conformance-claim.schema.json` and provide
evidence for every claimed profile.

**Comparing issue and diagnostic lists.** `expect.issues` and
`expect.diagnostics` list *every* issue or diagnostic the operation reports,
compared as a set: same length, each expected entry matching a distinct
actual one, order ignored. An expected entry matches when every key it gives
matches; extra keys in the actual entry are ignored. `issues_contain` and
`diagnostics_contain` require only that each listed entry is present.

`input` and `expect` form an adapter-facing semantic assertion DSL. They are not
the native API or wire shape. Adapters may normalize a language-specific API
into this shape; an implementation's v0.3 operation surface must still use the
normative operation and query result envelopes.

`manifest.yaml` is also the coverage ledger for atomic profiles. A profile is
`draft` until its normative requirements are represented by shared tests. A
`coverage_complete` status means every declared requirement has at least one
test with a stable `id` and qualified `covers` entry; it does not mean any
implementation has passed those tests. Implementation claims remain separate,
validated documents with dated evidence.

## Adapter Operations

Future v0.3 adapters should support these operations:

- `load_config`
- `load_types`
- `get_types`
- `get_data_contracts`
- `get_contract_view`
- `read`
- `validate`
- `query`
- `list_views`
- `execute_view`
- `evaluate_cel`
- `create`
- `update`
- `rename`
- `runtime_load_contracts`
- `runtime_compose_registry`
- `runtime_preflight_workflows`
- `runtime_validate_event`
- `runtime_validate_action_input`
- `runtime_validate_action_output`
- `migrate_type`
- `assess_type_pack`
- `apply_type_pack`
- `load_types`
- `resolve_link`
- `merge_records`, `merge_strategies`, `path_equivalence`, `allocate_path`,
  `derive_path`, `detect_moves`, `regex_match`, and `apply_body_edits` (since
  rc.5; see below)

### Type-pack history

`assess_type_pack` and `apply_type_pack` tests may prepare the collection with
`input.history`, steps applied in order after `setup` and before the operation:

- `apply: <pack>` assesses and applies a pack; the step must succeed.
- `write: { path, content }` writes exact bytes.
- `replace: { path, old, new }` replaces the single occurrence of `old` in the
  current bytes; the step fails unless `old` occurs exactly once.

Seed-upgrade expectations, all keyed by collection target:

- `resources`: entries matched by `target`, asserting `action`, optionally
  `upgrade_baseline_version` (the assessment's `upgrade_baseline.version`), and
  `reason` (`true` when a reason must be present, `false` when it must not).
  For `apply_type_pack`, these refer to the first run's assessment.
- `target_matches_source`: the target's bytes equal the named source file.
- `target_unchanged`: the target's bytes equal what they were before the
  operation.
- `target_frontmatter`: JSON Pointer to expected value in the target's parsed
  frontmatter. Merged output may be reformatted, so merges are compared
  structurally rather than by bytes.
- `target_body_contains`: text that must appear in the target's body.
- `lock_origin`: the target's lock `origin_digest` is the SHA-256 of the named
  source file, or `absent`.

The repository also includes `scripts/check_v03_tests.py`, which validates the
suite structure and executes local artifact checks that do not require a full
v0.3 implementation. It also runs the prototype TaskNotes migration checks for
`examples/v0.3/tasknotes-migration`.

Artifact checks cover schemas, examples, and migration output. Core operations,
lifecycle behavior, CEL evaluation, runtime dispatch, and workflow execution
use adapters or local prototype implementations. Stable-release adapter gates
are tracked in [release/v0.3.0.md](../../release/v0.3.0.md).

## Release-candidate markers

Tests added after 0.3.0-rc.4 carry `since: 0.3.0-rc.5`. Existing tests whose
expected outcome changed carry `changed: 0.3.0-rc.5`. An engine that conforms
to rc.4 passes every test without either marker; the release notes in
`docs/releases/0.3.0-rc.5.md` list the changed tests. Requirements added in
rc.5 are marked with a `# since 0.3.0-rc.5` comment in `manifest.yaml`.

## Concurrent-edit, regex, and body-edit operations (since rc.5)

The merge, path, and move-detection fixtures use the operations below. They
are pure functions of their input and the group's `setup.types`, so
`scripts/check_v03_tests.py` executes them against the executable model in
`scripts/concurrent_edits_model.py`. The rc.5 Core Write tests also use
`update` with `add` and `remove`, and `load_types` to return type-loading
diagnostics. Tests that create two files differing only in case, such as
`paths.discovered_collision`, need a case-sensitive file system; an adapter on
a case-insensitive one reports them as skipped. An adapter for an engine that
resolves discovered collisions by the collision rule (Chapter 02) also reports
`paths.discovered_collision` as skipped.

### `rename` with `update_refs` (since rc.5)

`core/rename-references.yaml` renames with `input.update_refs: true` and
expects `references_updated`: every rewritten link, ordered by referring path,
with `path`, `field` (or `location: body`), `old_value`, and `new_value`. A
record the list does not name is unchanged, so an empty list asserts that no
link was rewritten.

### `merge_records`

The extension for merge cases: base + two edits + declarations -> expected
result. Declarations come from the group's `setup.types`, as in every other
suite.

```yaml
operation: merge_records
input:
  path: tasks/T.md          # the path of all three versions, or:
  paths: { base: items/a.md, first: items/a.md, second: items/b.md }
  base: |                   # exact source of the common base version
    ---
    ...
  first: |                  # the earlier-ordered edited version
  second: |                 # the later-ordered edited version
expect:
  document: |               # exact bytes of the merged version
  conflicts:                # every conflict, in frontmatter key order, then
    - kind: field           # frontmatter, body, path
      field: status
  path: items/b.md          # optional: the merged path
```

`first` is the version ordered earlier, for example the one an engine
confirmed first. At a conflict the merged document holds the first version's
value. `expect.conflicts` lists conflicts by `kind` (`field`, `frontmatter`,
`body`, or `path`) and `field`; adapters may return the base, first, and
second values as well, which the expectation does not compare. Because
`expect.document` is exact bytes, these tests also check writer format
fidelity.

The first group converts the mdbase-next prototype's merge fixtures
(`reference/prototype/crates/mdb-core/tests/merge_fixtures/*.json`): the
prototype's `theirs` (sequenced first) became `first` and its `ours` (the
incoming external edit) became `second`. The prototype's `x-merge: max` schema
annotation became `collection.merge: { completedDate: max }`.

### `merge_strategies`

```yaml
operation: merge_strategies
input:
  path: items/a.md
  document: |               # source used for type matching
expect:
  strategies: { firstSeen: min, tags: union, title: conflict }
  # or
  error: { code: type_conflict, field: rank }
```

### `path_equivalence`

`input.paths` is a list of paths; `expect.groups` lists every group of two or
more equivalent paths, each sorted, and the groups sorted.

### `allocate_path`

`input.requested` is a path and `input.existing` the paths already in use;
`expect.path` is the path the collision rule chooses.

### `derive_path`

`input.pattern` and `input.frontmatter`; `expect.path`, or `expect.error` with
`code` and `field`.

### `detect_moves`

```yaml
operation: detect_moves
input:
  id_field: id              # optional settings.id_field
  disappeared:              # last observed state of records that disappeared
    - { path: notes/a.md, content: "...", file_id: f1 }
  appeared:                 # current state of records that appeared
    - { path: archive/a.md, content: "...", file_id: f1 }
expect:
  moves: [{ from: notes/a.md, to: archive/a.md }]   # sorted by from
  deleted: []                                       # sorted
  created: []                                       # sorted
```

`file_id` stands for a platform file identity. Omit it to model a platform
that cannot supply one. All entries are observed within one observation
window.

### `regex_match`

`input.pattern` and `input.text`; `expect.matches` is whether the mdbase regex
profile (Chapter 10) finds an unanchored match, or `expect.error.code` is
`invalid_pattern`. Adapters run the pattern through the same engine they use
for CEL `matches()` and JSON Schema `pattern`.

### `apply_body_edits`

```yaml
operation: apply_body_edits
input:
  base: |                   # the base body; body_base is its digest
  current: |                # the record's current body
  edits:                    # offsets count Unicode scalar values of base
    - { start: 9, end: 15, text: costs }
  base_available: false     # optional: the engine has no copy of the base
expect:
  body: |                   # the body written, or:
  error: { code: concurrent_modification, details: { reason: body_conflict } }
```

It models the body part of an `update` with `body_edits` (Chapter 12).

