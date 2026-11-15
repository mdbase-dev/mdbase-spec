# 0.3.0 Authoritative Runtime Conformance

Date: 2026-11-15. No runtime source, expectations, or committed vendor files
were changed, blessed, or pushed. Both audit checkouts are temporary worktrees.

## Revisions and method

- Specification main: `47d257d6a56e34c7279e5ebb959af0b0f49744b2`.
- Connect main: `17b79aec9b4ce01bcf7d07220c28e48ec16e6f14`.
- `runtime/conformance/spec/SOURCE` vendors that exact specification commit;
  its selected 359 cases are not the full 483-case v0.3 suite.
- `runtime/crates/core/src/semantics.rs` declares sem 1.0 and 1.1 against
  `0.3.0-rc.5`, and current sem 1.2 against `0.3.0-rc.6`, not stable 0.3.0.
- Built with `rcargo`, not local cargo. Ran the unchanged vendor ratchet using
  `rcargo run --locked -p mdbn-conformance --bin spec-conformance -- --verbose`.
- Pulled that same runner with
  `rcargo --pull spec-conformance build --locked -p mdbn-conformance --bin spec-conformance`.
  Copied the complete spec-main
  `tests/v0.3` and example fixtures into a separate audit root, retained the
  original expectations, and ran
  `MDBN_REPO_ROOT=<audit-root> target/debug/spec-conformance --verbose`.
  Then repeated with only the two
  stable-release expectations changed. No adapter or runtime fixes were made.

## Results

| Run | Pass | Mismatch | Unsupported operation | Exit | Ratchet violations |
| --- | ---: | ---: | ---: | ---: | ---: |
| Committed vendor subset, spec main | 357 / 359 | 2 | 0 | 0 | 0 |
| All v0.3 cases, spec main | 381 / 483 | 12 | 90 | 1 | 124 unlisted cases |
| All v0.3 cases, prepared stable release | 379 / 483 | 14 | 90 | 1 | 124 unlisted cases + 2 regressions |

**Full conformance: FAIL.** A successful ratchet exit is not a complete pass:
`paths.discovered_collision` and `collection.unique_collection_scope` are
already recorded as `pending`. The full-suite runner labels all non-passing
outcomes "pending" in its summary, but only those two have an expected-failure
status. The other failures and unsupported operations are unlisted, not
approved expected failures. There are no skips. Companion fixtures are included
in the all-case totals; they do not establish additional collection-profile
obligations or prove runtime behavior for an unsupported adapter operation.

Some mismatches are adapter-envelope gaps, not demonstrated engine defects.
For example, the filter-warning case has the expected warning in `diagnostics`
but the adapter does not implement `diagnostics_contain`; body filtering omits
`body_returned`; invalid-query cases return `error` instead of the requested
`diagnostics` envelope. The date conversion adapter lacks a timezone context;
context-link evaluation cannot select `lead` from null. The two runtime contract
cases are also outside the committed vendor selection. None of these have been
"fixed" by changing the spec or the ratchet.

## Every mismatching case

The IDs ending in `@gN.tN` are the unchanged runner's positional IDs for fixtures
without an explicit ID. They are zero-based group/test indices.

| Case ID | Status and observation |
| --- | --- |
| `cel.date_timestamp_conversion` | Unlisted: adapter context has no timezone rules; result is null instead of true. |
| `cel_query.filter_error_excludes_record` | Unlisted: `diagnostics_contain` subset assertion is not exposed; actual diagnostics include the expected warning. |
| `cel.query_body_filter` | Unlisted: `body_returned: false` is not exposed. |
| `cel_query.context_links` | Unlisted: `lead` selected from null; expected task is excluded. |
| `cel_match.nondeterministic_match_warning` | Stable-release regression: warning severity, valid catalog, and invalid types retained instead of error severity and exclusion. |
| `cel_match.match_deterministic_ok` | Stable-release regression: matches `[open_task, overdue]` instead of `[open_task]`. |
| `paths.discovered_collision` | Existing expected failure: no `path_collision` warning is returned. |
| `collection.unique_collection_scope` | Existing expected failure: subset assertion is not exposed; the actual result also contains a second duplicate-value issue. |
| `runtime.standard-contract-registry` | Unlisted companion fixture: adapter returns `valid: false`, expected `valid: true`. |
| `runtime.workflow-implementation` | Unlisted companion fixture: adapter returns `valid: false`, expected a valid `mdbase.runtime.workflow` contract at `1.0.0`. |
| `v0.3/views/view-records.yaml@g0.t12` | Unlisted: invalid-query failure is returned as `error`, not the expected `diagnostics`. |
| `v0.3/views/view-records.yaml@g0.t13` | Unlisted: invalid-query failure is returned as `error`, not the expected `diagnostics`. |
| `v0.3/views/view-records.yaml@g0.t15` | Unlisted: invalid-query failure is returned as `error`, not the expected `diagnostics`. |
| `v0.3/views/view-records.yaml@g0.t16` | Unlisted: invalid-query failure is returned as `error`, not the expected `diagnostics`. |

## Every unsupported case

These 90 cases return `UnknownOperation` from the existing adapter. This is a
coverage boundary, not evidence that the runtime implements or violates their
semantics. Schema and migration fixtures are independently executable in the
specification's own checker; that is not a runtime conformance claim.

| Adapter operation | Case IDs |
| --- | --- |
| `embedded_json_schema_validate` | `v0.3/migration/pickle-collection-migration.yaml@g0.t1`, `v0.3/migration/tasknotes-type-migration.yaml@g0.t6`, `v0.3/schema/schema-artifacts.yaml@g0.t10`, `v0.3/schema/schema-artifacts.yaml@g0.t19` |
| `execute_view` | `views.explicit_context`, `views.grouping_summaries`, `v0.3/views/view-records.yaml@g0.t3`, `v0.3/views/view-records.yaml@g0.t4`, `v0.3/views/view-records.yaml@g0.t5`, `v0.3/views/view-records.yaml@g0.t6`, `views.context_shape`, `v0.3/views/view-records.yaml@g0.t8`, `v0.3/views/view-records.yaml@g0.t9`, `v0.3/views/view-records.yaml@g0.t10`, `v0.3/views/view-records.yaml@g0.t11`, `views.contract_execution`, `views.unclaimed_type_value` |
| `inspect_yaml` | `v0.3/migration/pickle-collection-migration.yaml@g0.t2`, `v0.3/migration/pickle-collection-migration.yaml@g0.t3`, `v0.3/migration/tasknotes-type-migration.yaml@g0.t8` |
| `interop_action_cancellation` | `interop-action-cancellation` |
| `interop_action_duplicate` | `v0.3/event-action-interop/event-action-interop.yaml@g2.t2` |
| `interop_action_failures` | `v0.3/event-action-interop/event-action-interop.yaml@g1.t5` |
| `interop_action_indeterminate` | `v0.3/event-action-interop/event-action-interop.yaml@g2.t3` |
| `interop_action_invalid_output` | `interop-action-invalid-output` |
| `interop_action_invoke` | `interop-action-success`, `interop-action-ambiguous`, `v0.3/event-action-interop/event-action-interop.yaml@g1.t2` |
| `interop_action_pin_then_register` | `v0.3/event-action-interop/event-action-interop.yaml@g1.t3` |
| `interop_authorization` | `interop-authorization-default-deny` |
| `interop_client_dispose` | `v0.3/event-action-interop/event-action-interop.yaml@g2.t5` |
| `interop_contract_conflict` | `v0.3/event-action-interop/event-action-interop.yaml@g2.t1` |
| `interop_event_duplicate` | `interop-event-duplicate` |
| `interop_event_multicast` | `interop-event-multicast` |
| `interop_event_publish` | `interop-event-invalid-data`, `v0.3/event-action-interop/event-action-interop.yaml@g0.t2` |
| `interop_transport_requirement` | `interop-transport-capabilities` |
| `json_document_schema_validate` | `v0.3/schema/schema-artifacts.yaml@g2.t1`, `v0.3/schema/schema-artifacts.yaml@g2.t2` |
| `json_document_valid` | `v0.3/migration/pickle-collection-migration.yaml@g0.t4`, `v0.3/migration/tasknotes-type-migration.yaml@g0.t7` |
| `json_schema_meta_validate` | `runtime.standard-pack-schemas`, `v0.3/schema/schema-artifacts.yaml@g0.t0`, `v0.3/schema/schema-artifacts.yaml@g1.t0`, `v0.3/schema/schema-artifacts.yaml@g2.t0` |
| `list_views` | `v0.3/views/view-records.yaml@g0.t0`, `views.contract_discovery` |
| `markdown_frontmatter_schema_validate` | `v0.3/migration/pickle-collection-migration.yaml@g0.t0`, `v0.3/migration/tasknotes-type-migration.yaml@g0.t5`, `runtime.standard-record-types`, `runtime.standard-contract-artifacts`, `v0.3/schema/schema-artifacts.yaml@g0.t1`, `v0.3/schema/schema-artifacts.yaml@g0.t8`, `v0.3/schema/schema-artifacts.yaml@g0.t9`, `v0.3/schema/schema-artifacts.yaml@g0.t13`, `v0.3/schema/schema-artifacts.yaml@g0.t17`, `v0.3/schema/schema-artifacts.yaml@g0.t18`, `v0.3/schema/schema-artifacts.yaml@g1.t1`, `v0.3/schema/schema-artifacts.yaml@g1.t2` |
| `migrate_type` | `v0.3/migration/tasknotes-type-migration.yaml@g0.t0`, `v0.3/migration/tasknotes-type-migration.yaml@g0.t1`, `v0.3/migration/tasknotes-type-migration.yaml@g0.t2`, `v0.3/migration/tasknotes-type-migration.yaml@g0.t3`, `v0.3/migration/tasknotes-type-migration.yaml@g0.t4` |
| `runtime_admit_event` | `workflow.atomic-admission` |
| `runtime_admit_workflow` | `runtime.exact-admission` |
| `runtime_execute_event` | `workflow.deterministic-plan`, `workflow.dispatch-authorization` |
| `runtime_fire_timer` | `workflow.one-shot-timer` |
| `runtime_preflight_workflow` | `runtime.provider-ambiguity`, `runtime.authorization-separate` |
| `runtime_prune_journal` | `workflow.journal-reset` |
| `runtime_race_workers` | `workflow.executor-concurrency` |
| `runtime_recover_dispatch` | `workflow.idempotent-recovery`, `workflow.non-idempotent-recovery` |
| `runtime_transition_run` | `workflow.state-machine` |
| `runtime_validate_record` | `runtime.legacy-parallel-contract` |
| `type_pack_resources_validate` | `runtime.standard-pack-resources`, `v0.3/schema/schema-artifacts.yaml@g0.t12` |
| `yaml_document_schema_validate` | `v0.3/schema/schema-artifacts.yaml@g0.t2`, `v0.3/schema/schema-artifacts.yaml@g0.t3`, `v0.3/schema/schema-artifacts.yaml@g0.t4`, `v0.3/schema/schema-artifacts.yaml@g0.t5`, `v0.3/schema/schema-artifacts.yaml@g0.t6`, `v0.3/schema/schema-artifacts.yaml@g0.t7`, `v0.3/schema/schema-artifacts.yaml@g0.t11`, `v0.3/schema/schema-artifacts.yaml@g0.t14`, `v0.3/schema/schema-artifacts.yaml@g0.t15`, `v0.3/schema/schema-artifacts.yaml@g0.t16`, `v0.3/schema/schema-artifacts.yaml@g1.t3` |

## Follow-up boundary

Do not tag or publish Connect from this PR. Its release must address the two
existing expected failures, the nondeterministic-match change, and any claimed
profile's remaining adapter/implementation gaps; re-vendor the exact merged
specification revision and qualify before changing its supported-spec registry.
No deprecated engine evidence is used here.
