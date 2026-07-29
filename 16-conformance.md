# 16. Conformance

## Conformance Profiles

A v0.3 conformance claim names the atomic behavior sets an implementation has
verified. Profiles let readers distinguish collection reading, matching,
queries, writes, runtime preflight, workflow execution, and watching.

| Profile | Purpose |
| --- | --- |
| Core Read | discover collections, parse records, load types and data contracts, and validate JSON Schema |
| Collection Semantics | apply defaults, uniqueness, path policy, multi-type composition, and collection diagnostics |
| CEL | compile and evaluate the shared mdbase CEL language and host contract |
| CEL Match | evaluate `match.expr` against raw candidate records |
| Query | evaluate contextual CEL filters, projections, grouping, summaries, and query envelopes |
| Links | parse, resolve, validate, and traverse links |
| Core Write | create, update, delete, rename, and batch records |
| Lifecycle | apply standard managed-field policy during writes |
| Event/Action Interoperability | exchange CloudEvents and admitted action invocations through independently claimable roles |
| Durable Runtime 0.2 | validate standard runtime records, admit exact plans through interoperability declarations, and execute/recover them durably |
| Watch | report ordered collection changes after consistent state |

Normative profile IDs and dependencies are:

| Profile ID | Requires |
| --- | --- |
| `core_read` | none |
| `collection_semantics` | `core_read` |
| `cel` | none |
| `cel_match` | `core_read`, `cel` |
| `cel_query` | `core_read`, `cel` |
| `links` | `collection_semantics`, `cel` |
| `core_write` | `collection_semantics` |
| `lifecycle` | `core_write`, `cel` |
| `event_action_interop/0.1` | none |
| `runtime/0.2` | `core_read`, `event_action_interop/0.1`, `cel` |
| `watch` | `core_read` |

An implementation claims a profile after passing every required behavior and
test for that profile. `optional_features` records additional work outside the
verified profile list.

### Conformance Claim Documents

Conformance claims MUST validate against
`schemas/v0.3/conformance-claim.schema.json`. A claim names:

- the implementation and exact implementation version
- the exact mdbase specification version
- every supported profile ID, including dependency profiles
- the runtime profile version when a runtime profile is claimed
- the supported JSON Schema keywords and formats
- operational limits that affect portable behavior
- evidence commands and the time and environment in which they passed

A general compatibility label is supported by this validated profile list.
Profile claims derive from verified behavior independently of product roles such
as LSP, CLI, plugin, and server.

`v0_2_read` and `v0_2_migrate` are compatibility declarations for transition
behavior. They appear separately from v0.3 profiles.

The canonical claim schema enforces profile dependencies. Claim verification
tools SHOULD reject evidence produced for a different implementation artifact
or specification version and SHOULD report stale evidence.

### Portable Interoperability Testbed

The spec-owned interoperability testbed in `testbed/v0.1/` supplements the
profile suites with executable, implementation-neutral integration scenarios.
It has three rings:

| Ring | Boundary under test |
| --- | --- |
| Contract | record contracts, type `implements` declarations, projections, and multiple independent consumers |
| Interop | live event sources/consumers and action callers/providers connected through the interoperability profile |
| Runtime | durable admission, action attempts, crash recovery, leases, and fencing |

The testbed is deliberately role-based. An application MAY consume the same
type or contract as any number of other applications. An event is delivered to
every compatible authorized subscriber. An action still resolves to exactly one
admitted provider; multiple eligible providers remain an error until a caller
or policy selects one. The testbed does not turn an application name into a
contract owner.

Every testbed scenario MUST validate against
`schemas/testbed/v0.1/scenario.schema.json`, use only fixtures from the validated
neutral catalog, and include its canonical expected transcript. An adapter MUST
run behind the `describe`/`run` process boundary defined by testbed protocol
`0.1`. A runner MUST start a fresh adapter process for each scenario, validate
the run request and returned transcript, and compare the complete ordered
transcript entries. Adapters MUST derive entries from behavior observed through
public or documented implementation boundaries; copying the scenario's
expected entries is not a conforming adapter.

Transcripts intentionally contain stable facts rather than private state.
Generated IDs, database keys, wall-clock values, stack traces, scheduling
jitter, and implementation-specific objects MUST be normalized or omitted
unless a scenario explicitly makes them observable. Scenario order, actor,
operation, outcome, and facts are all significant.

Portable testbed evidence validates against
`schemas/testbed/v0.1/evidence.schema.json` and binds every scenario result to a
canonical transcript digest. A conformance claim records it with evidence kind
`testbed_transcript`, the protocol version, scenario IDs, artifact path, and
evidence digest. `evidence_digest` MUST be the SHA-256 digest of the evidence
artifact's recursively key-sorted, whitespace-free JSON form, prefixed with
`sha256:`. Passing the testbed does not replace the complete profile suite: it
is integration evidence for the normative requirements named by each scenario.

Conformance never grants authority. A testbed adapter may be able to construct
a compatible payload or declaration while the real host correctly rejects the
operation as unauthorized.

## Canonical Diagnostics

Every diagnostic contains:

```yaml
severity: error
code: type_conflict
message: Human-readable context
path: tasks/example.md
field: status
type: task
schema_location: "https://mdbase.dev/schemas/v0.3/type-file.schema.json#/..."
details: {}
```

`severity`, `code`, and `message` are required. Paths use collection-relative
forward-slash form. `field` uses JSON Pointer or an explicitly identified
frontmatter selector. Implementations MAY add fields under `x-*`.

The v0.3 core codes include `unsupported_profile`, `type_conflict`,
`type_membership_changed`, `path_value_missing`, `schema_ref_forbidden`,
`schema_ref_unresolved`, `schema_ref_cycle`, `format_invalid`,
`lifecycle_expression_error`, `concurrent_modification`, `invalid_query`,
`context_not_found`, `context_required`, `context_type_mismatch`,
`view_not_found`, `invalid_view`, `unsupported_presentation`,
`invalid_data_contract`, `data_contract_not_found`,
`data_contract_conflict`, `data_contract_version_mismatch`,
`data_contract_binding_invalid`, `data_contract_field_invalid`, and
`data_contract_record_invalid`. Runtime profile 0.2 reuses interoperability
codes such as `unknown_contract`, `contract_digest_conflict`, `no_provider`,
`ambiguous_provider`, and `capability_denied`, and additionally defines
`event_source_unavailable`, `idempotency_unavailable`, `cursor_expired`,
`stale_lease`, `invalid_run_transition`, `outcome_indeterminate`, and
`stale_timer_generation`.

## Core Read Requirements

Core Read implementations MUST:

- identify a collection by `mdbase.yaml`
- scan records using collection-relative forward-slash paths
- load and validate v0.3 type files
- load exact-version data contracts and validate type `implements` entries
- expose deterministic contract and implementation digests
- project and validate contract views when a record is accessed through an
  implementation
- validate embedded JSON Schema against the v0.3 profile
- select explicit types and evaluate structured inferred match rules
- validate raw frontmatter independently against every matched schema
- reject a type that requires an unsupported optional profile with
  `unsupported_profile`
- report diagnostics in the canonical machine-readable shape

## Collection Semantics Requirements

Collection Semantics implementations MUST:

- apply `collection.read_defaults` to effective reads
- preserve missing, null, raw, and effective distinctions
- validate every `collection.unique` rule in its declared scope
- validate portable `collection.path` policies for write-capable tools
- expose display metadata as advisory values
- compose compatible behavior from multiple matched types
- report `type_conflict` for incompatible matched behavior

## CEL Requirements

CEL implementations MUST:

- compile and evaluate portable CEL source used by a claimed feature context
- supply the system bindings defined for that context in Chapter 10
- preserve the mdbase missing, null, raw, and effective-value contract
- provide `now()`, `today()`, and `duration()` with declared timezone behavior
- enforce and report expression, evaluation, and traversal limits
- distinguish compilation diagnostics from evaluation diagnostics

The CEL profile supplies the shared language capability. Each embedding profile
defines its context and operational outcome.

## CEL Match Requirements

CEL Match implementations MUST:

- compile `match.expr` while loading its type definition
- evaluate it against raw candidate frontmatter and file metadata
- combine it with other members of `match` using AND
- match only a boolean true result
- report per-record evaluation errors and treat that candidate as a non-match

## Query Requirements

Query implementations MUST:

- validate portable query objects against the canonical query schema
- resolve and snapshot an optional same-collection invocation context
- expose the complete `this` context contract, binding it to null when absent
- evaluate named query projections in dependency order before filtering
- reject cyclic projection dependencies and duplicate result names with
  `invalid_query`
- evaluate `where` filters against the effective query context
- evaluate requested CEL projections
- support OR-based type filtering
- support deterministic ordering and pagination
- support deterministic grouping and built-in and custom summaries
- return total-count and has-more metadata
- return context, grouping, and summary metadata when requested
- expose raw and effective frontmatter when requested
- report per-record evaluation errors and continue evaluating remaining records

## View Record Optional Feature

An implementation advertises `view_records` through `optional_features` when it:

- validates view frontmatter against the canonical view schema
- lists view records with stable source and named-view descriptors
- resolves a stable view-record ID or path plus a stable named-view ID
- rejects duplicate named-view IDs with `invalid_view`
- derives the executable query using the inheritance and merge rules in
  Chapter 11
- exposes selected result properties in display order with their metadata
- applies `context.this.on_missing` and context type constraints before query
  execution
- reports the selected view and resolved context in query result metadata
- applies presentation metadata as advisory input while preserving canonical
  headless results
- keeps alternate dialect and renderer-specific data under `x-*` extensions

A tool MAY advertise supported presentation identifiers separately in
`optional_features`.

An implementation advertises `obsidian_bases_views` through
`optional_features` when it:

- discovers `.base` sources selected by `x-obsidian.bases.include`
- assigns deterministic named-view IDs and source revisions
- parses filters and formulas before candidate evaluation
- evaluates the Obsidian Bases expression dialect, including formula
  dependencies, file and link values, date and duration behavior, methods, and
  coercions
- combines source and named-view filters with AND
- applies source order, sort, group, limit, and presentation metadata
- exposes the source's ordered properties and display names
- returns the saved-view headless result envelope
- keeps `.base` sources authoritative throughout discovery and execution

An implementation advertises `writable_view_sources` through
`optional_features` when it:

- marks only writable source formats with `source.writable: true`
- reads complete source documents with stable opaque revisions
- validates complete candidate documents before create or update
- creates sources without replacing an existing path
- applies `if_revision` to update and delete
- writes source replacements atomically
- preserves source-format extension data supplied by the caller
- makes successful mutations visible to subsequent list and execute operations

Conformance suites for `obsidian_bases_views` MUST include an oracle corpus
captured from the supported Obsidian expression environment. Each case records
the expression, evaluation context, expected value or error, and source
environment version. Known upstream divergences are identified individually in
the corpus.

## Links Requirements

Links implementations MUST:

- parse wikilinks, Markdown links, and bare path link values
- resolve collection-relative and file-relative paths safely
- enforce `collection.links.target_type` and `validate_exists`
- expose `file.links`, `file.embeds`, and `file.tags`
- provide the CEL link helpers from Chapter 10
- bound `asFile()` traversal

## Core Write Requirements

Core Write implementations MUST:

- validate a complete draft before writing
- preserve unrelated Markdown body content where possible
- reject paths that escape the collection root
- enforce `if_revision` and report common concurrency conflicts
- return the canonical operation envelope and final record revision
- update derived state before reporting a successful mutation

## Lifecycle Requirements

Lifecycle implementations MUST:

- support `on_create` and `on_update`
- support `now`, `today`, `uuid`, `ulid`, `slugify`, `copy`, and `literal`
  value providers
- evaluate lifecycle guards in the lifecycle CEL context
- run lifecycle before final record validation
- evaluate membership once after lifecycle and report
  `type_membership_changed`
- report conflicts between matched lifecycle policies

## Runtime Contracts Requirements

Runtime Contracts implementations MUST:

- load provider, action, event, capability, policy, and workflow contract records
- represent implicit contracts supplied by a runtime
- compose the effective registry deterministically
- validate strict contract shapes and `x-*` extension names
- validate embedded action and event JSON Schemas
- validate event envelopes, payloads, action inputs, and action outputs
- resolve workflow event, action, capability, and provider references
- reject duplicate trigger and step IDs within a workflow
- resolve provider listings and runtime-policy workflow and capability selectors
- fail preflight for denied required capabilities
- fail preflight with `executor_not_selected` when policy selects no executor
- include capabilities supplied by providers, actions, and policy in the
  effective capability set
- materialize implicit contracts when claiming materialization support

This profile covers registry composition, contract validation, authorization
preflight, and materialization. Workflow execution has its own profile.

## Workflow Requirements

Workflow implementations MUST:

- follow the preflight and event-to-run sequence in Chapter 14
- atomically journal, deduplicate, and admit delivered events
- apply trigger debounce and minimum-interval admission
- evaluate workflow variables and detect dependency cycles
- evaluate trigger, workflow, and step conditions in their defined contexts
- evaluate step inputs and iteration in deterministic order
- validate evaluated inputs before dispatch
- perform dispatch-time capability authorization
- apply execution mode and runtime-policy executor selection
- reserve idempotency keys with the required executor scope
- apply concurrency policy, run limits, and `on_error`
- pin canonical workflow, registry, action, and policy revisions
- claim work with bounded leases and reject stale lease writes
- persist stable invocation IDs and dispatch intents before provider calls
- recover idempotent attempts and mark ambiguous non-idempotent attempts
  `indeterminate`
- record standard run, step, attempt, receipt, and checkpoint results
- validate action outputs and emitted events
- commit action results and emitted-event admissions atomically
- provide generation-safe one-shot timer upsert, cancel, fire, and missed-run
  behavior when claiming canonical timer support
- report unsupported actions, capabilities, and unsafe execution state through
  runtime diagnostics

Action handlers are runtime-specific contracts in the effective registry. A
claim lists its tested handler set under `optional_features` or associated
evidence.

## Watch Requirements

A watch notification MUST identify a change kind, unique event ID, observation
time, and affected collection-relative path or contract identity. A record
notification has this portable shape:

```yaml
kind: record_modified
id: watch_01J...
observed_at: "2026-07-19T10:30:00Z"
path: tasks/example.md
changed_fields: [status]
frontmatter:
  type: task
  title: Example
  status: done
```

Record notifications use these change kinds:

- `record_created`
- `record_modified`
- `record_deleted`
- `record_renamed`

Config, type, and runtime-aware implementations also use `config_changed`,
`type_changed`, and `runtime_registry_changed` as applicable. A rename may be
reported as `record_deleted` followed by `record_created` when the host cannot
establish file identity.

`record_created` and `record_modified` include current effective frontmatter.
`record_renamed` includes `path`, `previous_path`, and current effective
frontmatter. `record_modified.changed_fields` contains the top-level raw
frontmatter keys whose persisted values changed; it is empty for a body-only
change. A deleted notification may include the last observed frontmatter.

Watch implementations MUST:

- observe the same record extensions, exclusions, type folder, and nested
  collection boundaries as Core Read
- report logical changes caused by external file updates and core write
  operations
- publish record, config, and type notifications after derived read and query
  state reflects the change
- include both paths in a detected rename
- preserve notification order for the same record or configuration subject
- coalesce duplicate host notifications for one logical change and report the
  final observed state
- isolate listener failures so later notifications continue to be delivered

An implementation that also claims Runtime Contracts reports effective registry
changes after registry recomposition through `runtime_registry_changed`.
