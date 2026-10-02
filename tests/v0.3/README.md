# mdbase v0.3 Conformance Suite

This directory is the parallel v0.3 conformance suite. It does not replace the
existing `tests/level-*` v0.2.x suite.

v0.3 conformance claims use the atomic profiles defined by the specification.
The tests below are grouped into eleven fixture sets for the rollout plan:

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
- `runtime_load_contracts`
- `runtime_compose_registry`
- `runtime_preflight_workflows`
- `runtime_validate_event`
- `runtime_validate_action_input`
- `runtime_validate_action_output`
- `migrate_type`
- `assess_type_pack`
- `apply_type_pack`

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
