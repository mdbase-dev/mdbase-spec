# 13. Runtime Contracts

## Purpose

Runtime contracts let a collection describe event-driven behavior through
portable records. They give providers, events, actions, capabilities, policies,
and workflows stable identities and data shapes.

These are runtime contracts, not the passive record-interface data contracts
defined in Chapter 05A. Runtime contract records participate in the normal
record model and become active only through a selected runtime host. Data
contract files are reserved control files implemented by record types.

Contract records describe the interfaces and policy that a runtime uses. The
runtime supplies event delivery, action handlers, authorization, scheduling,
and execution.

This chapter defines runtime profile `0.1.0`. Chapter 14 defines workflow
execution using the contracts introduced here. The runtime profile is versioned
independently from the mdbase collection specification.

## Runtime Model

A runtime turns declared contracts into active behavior through this sequence:

1. Providers supply descriptors and the event, action, and capability contracts
   they own.
2. The runtime validates those contracts and composes an effective registry.
3. Workflow preflight resolves event, action, provider, and capability
   references against the registry.
4. A delivered event resolves to an event contract and validates against its
   payload schema.
5. The runtime evaluates matching workflows, and runtime policy selects the
   executor and available capabilities.
6. Immediately before an action runs, the runtime validates its evaluated input
   and authorizes its effects in the current dispatch context.
7. The runtime validates the action output and any emitted events, and can
   materialize run, checkpoint, or diagnostic records.

The examples in this chapter follow one small system:

```text
canvas-ui provider
  emits canvas.drop
    triggers canvas.zone.set-status workflow
      calls mdbase.record.patch
        requires mdbase.record.write
          authorized by local.runtime policy
```

## Contract Vocabulary

| Contract | Purpose |
| --- | --- |
| provider | identifies a live source of event, action, and capability contracts |
| event | defines the payload delivered when something happens |
| action | defines a callable operation, its input/output, and its effects |
| capability | names a permission or risk atom used by actions and policy |
| runtime policy | selects executors, allows or denies capabilities, and sets limits |
| workflow | connects events to actions; defined in Chapter 14 |
| runtime run | records one workflow execution attempt |
| runtime checkpoint | stores resumable workflow state |
| runtime diagnostic | records a validation or execution issue |

Provider, event, action, capability, policy, and workflow contracts form the
effective registry. Runs, checkpoints, and diagnostics are runtime state
records.

## Contract Records

Contracts can be ordinary Markdown records:

```text
providers/canvas-ui.md
events/canvas.drop.md
actions/mdbase.record.patch.md
capabilities/mdbase.record.write.md
policies/local-runtime.md
workflows/canvas-zone-set-status.md
```

The folder names are conventional. Each record's `type` determines its meaning.

Contract record schemas are strict. Unknown top-level fields are errors unless
their names begin with `x-`. Runtime-specific and provider-specific metadata
belongs under `x-*` extension keys.

Action and event contracts contain embedded JSON Schemas. Implementations MUST
validate those schemas before the contracts enter the effective registry. A
malformed action input, action output, or event payload schema is a contract
error.

## Effective Registry

The effective registry is the complete set of contracts available for
resolution and preflight in one runtime context.

### Contract Sources

Contracts enter the registry from four sources:

| Source | Description |
| --- | --- |
| built-in | core contracts supplied by the runtime |
| provider | implicit contracts supplied by registered live providers |
| installed pack | contracts supplied by an installed collection or runtime pack |
| collection | explicit contract records stored in the collection |

An implicit contract can participate in the registry without a corresponding
Markdown file. Materialization can create an inspectable Markdown
representation later in the lifecycle.

### Composition Rules

Registry composition is deterministic. Sources are processed in this order for
diagnostics and materialization:

1. built-in contracts
2. provider contracts ordered by provider ID
3. installed packs ordered by pack ID
4. collection records ordered by collection path

Resolution MUST NOT depend on filesystem enumeration order.

Duplicate contracts with the same ID, version, and canonically identical
content coalesce. The registry preserves every origin for diagnostics.
Duplicate IDs with different versions or content MUST produce a
`runtime_contract_conflict` error.

Runtime profile 0.1 treats non-identical duplicate definitions as conflicts. A
runtime-specific override uses an `x-*` extension and MUST make the effective
contract and its origin inspectable.

The registry contains separate indexes for providers, events, actions,
capabilities, policies, and workflows. Capability resolution also produces the
effective set of capability IDs supplied by providers, actions, and policy.

## Providers

### Provider Contract

A provider contract identifies the source and ownership of implicit contracts:

```yaml
type: provider
id: canvas-ui
version: 1
name: Canvas UI
provider_version: "1.4.0"
contracts:
  events:
    - canvas.drop
```

`version` is the provider contract-shape revision. `provider_version` is the
provider implementation's SemVer version.

A provider MUST advertise every contract it supplies and MUST NOT advertise a
contract ID it cannot emit or dispatch at the declared contract version.

### Provider Requirements

Workflows, actions, and policies can require a provider. Requirements accept a
string shorthand or an object with a SemVer range:

```yaml
requires:
  providers:
    - id: issue-tracker
      version: ">=4.12.0 <5.0.0"
```

The string shorthand `issue-tracker` accepts any available provider version.
Object version ranges use the SemVer comparator grammar. An unavailable or
incompatible provider is a preflight error.

### Live Provider Registration

A live provider supplies:

- one provider descriptor
- every contract advertised by that descriptor
- its readiness state
- event subscriptions for event contracts it owns
- action dispatch for action contracts it owns
- a way to release its resources

Registration MUST be atomic. Before a provider becomes visible, the runtime
MUST:

1. validate the provider descriptor
2. validate every supplied contract against its canonical record schema
3. compile every embedded event and action schema
4. verify that the supplied contracts match the advertised contract lists
5. reject contract ownership conflicts
6. confirm that the provider is ready

Failure leaves the effective registry unchanged and releases the rejected
provider's resources.

Removing a provider removes its contracts from the effective registry,
invalidates dependent workflow preflight, and prevents new dispatches to that
provider.

## Events

### Event Contract

An event contract identifies the owning provider and defines the payload shape:

```yaml
type: event
id: canvas.drop
version: 1
provider: canvas-ui
name: Canvas drop
schemas:
  dialect: json-schema-2020-12
  payload:
    type: object
    required: [board, file, zone, position]
    properties:
      board:
        type: object
      file:
        type: object
        required: [path]
        properties:
          path: { type: string }
      zone:
        type: object
        required: [id]
        properties:
          id: { enum: [todo, doing, done] }
      position:
        type: object
```

### Event Envelope

Every delivered event uses the canonical envelope:

```yaml
type: canvas.drop
contract_version: 1
id: evt_01H...
occurred_at: "2026-06-14T12:00:00Z"
source:
  runtime: canvas-ui
payload:
  board:
    path: boards/work.md
  file:
    path: tasks/card-001.md
  zone:
    id: doing
  position:
    x: 120
    y: 320
```

Event validation proceeds in this order:

1. validate the complete envelope against the canonical event-envelope schema
2. resolve `type` against the event registry
3. require `contract_version` to equal the resolved event contract version
4. verify provider provenance when `source.provider` is present
5. validate `payload` against the event contract's payload schema

The complete envelope MUST pass structural validation before contract
resolution, provider checks, or payload validation proceed.
`contract_version` is required and MUST equal the resolved event contract
version.

The `source` object accepts its defined fields and `x-*` extension fields. When
`source.provider` is present, it MUST equal the provider declared by the event
contract.

Event IDs MUST be unique within the delivering runtime's deduplication window.
`trace.correlation_id` groups related work. `trace.causation_id` identifies the
event or run that directly caused the event. Runtimes MUST preserve both trace
values when dispatching actions and emitting follow-up events.

### Portable Record Type Membership

Providers that expose the standard `mdbase.record.created`,
`mdbase.record.modified`, `mdbase.record.renamed`, or
`mdbase.record.deleted` events use `payload.types` for the record's type
membership after the change. For deletion, where no record remains,
`payload.types` is the deleted record's last known membership. Rename and
modification payloads MAY additionally expose the former membership as
`payload.previous_types`.

Consumers can therefore select a record type consistently with
`"<type>" in event.payload.types`, including deletion criteria. They MUST NOT
require `previous_types` for a deletion event. This naming rule is independent
of whether a provider includes optional record content in its event contract.

### Durable Event Journal

A durable workflow runtime accepts an event by atomically:

1. validating its envelope and payload
2. reserving `(source.runtime, event.id)` in the deduplication index
3. assigning a monotonically increasing local cursor
4. storing the complete envelope at the data authority
5. admitting all runs derived from that event

The event and its admitted runs become visible together. A crash cannot expose
the event without its run admissions or run admissions without the event.
Repeated delivery within the configured replay horizon returns the original
cursor and MUST NOT create additional runs.

The runtime documents its event retention, deduplication, and cursor-retention
horizons. A cursor older than retained journal history fails explicitly with
`event_cursor_expired` or a `reset_required` page; it MUST NOT silently resume
from the newest event.
Pruning removes envelopes, not dedupe tombstones, within the documented replay
horizon. A journal read reports both the retained boundary and current head so
consumers can distinguish an expired cursor from an empty page.
Journal payloads remain at the authorized data authority. A routing or
notification control plane receives only an opaque signal and cursor unless it
is itself the authorized data authority.

## Actions And Authorization

### Action Contract

An action contract defines a workflow-callable operation:

```yaml
type: action
id: mdbase.record.patch
version: 1
provider: mdbase
name: Patch record frontmatter
schemas:
  dialect: json-schema-2020-12
  input:
    type: object
    required: [path, patch]
    properties:
      path: { type: string }
      patch: { type: object }
  output:
    type: object
    required: [path, frontmatter]
    properties:
      path: { type: string }
      frontmatter: { type: object }
effects:
  - mdbase.record.write
emits:
  - mdbase.record.modified
dispatch:
  idempotency: invocation_id
  cancellation: cooperative
```

The action ID resolves to a handler owned by the declared provider. The runtime
validates evaluated input against `schemas.input` before dispatch and validates
the returned value against `schemas.output`. Events named by `emits` validate
before delivery.

`dispatch.idempotency` declares the provider's replay contract:

| Value | Meaning |
| --- | --- |
| `invocation_id` | repeated dispatch with the same invocation ID returns the same logical effect and receipt |
| `none` | the provider makes no safe replay guarantee |

`dispatch.cancellation` is `cooperative` when the provider accepts a runtime
cancellation request and `none` when an in-flight dispatch cannot be cancelled.
Omitted dispatch properties have `none` semantics. A runtime MUST NOT infer
idempotency from an action name, transport, or successful prior response.

### Capabilities

A capability names a permission or risk atom:

```yaml
type: capability
id: mdbase.record.write
version: 1
name: Record write
risk: medium
description: Allows modifying Markdown record frontmatter.
```

Capability records are optional catalog entries used for display and risk
reporting. The effective capability ID set comes from providers, actions, and
runtime policy. A missing materialized capability record MUST NOT invalidate a
workflow. A required capability that is absent from the effective set or denied
by policy is a preflight error.

### Runtime Policy

A runtime policy selects executors, decides capability access, and sets local
limits:

```yaml
type: runtime_policy
id: local.runtime
version: 1
name: Local runtime policy
executors:
  default: desktop
  workflows:
    canvas.zone.set-status: desktop
capabilities:
  mdbase.record.write:
    mode: allow
limits:
  workflow_timeout: 30s
```

Workflow records identify execution semantics; runtime policy selects the local
executor. Capability entries can allow or deny a capability and attach limits
that the runtime enforces.

Runtime policy becomes effective when selected by local `runtime.policy`
configuration. A policy record arriving through collection synchronization
MUST NOT authorize actions until the local configuration selects it. A
side-effecting workflow with zero or multiple selected policies fails
preflight.

Approval behavior can be defined by runtime or provider extensions.

### Dispatch Authorization

Preflight resolves providers and capabilities and reports whether the workflow
is ready for the current runtime. Immediately before dispatch, the runtime MUST
authorize the evaluated input and current dispatch context.

The dispatch context contains at least:

```yaml
actor: { id: local-user, kind: user }
origin: { workflow: canvas.zone.set-status, path: workflows/canvas-zone-set-status.md }
run_id: run_01j0
correlation_id: corr_01j0
causation_id: evt_01j0
executor: desktop
```

Authorization considers the actor, workflow origin, provider, requested
effects, resource scope, and applicable policy limits. An action with effects
MUST be denied unless the selected policy explicitly allows every required
capability. Dispatch also requires a registered handler for the action ID.

An admitted run dispatches against its pinned canonical action contract
revision. The runtime validates input and output and derives declared effects,
idempotency, and cancellation from that snapshot; a later registry definition
MUST NOT silently replace it. Current policy and the host's current exact grant
are nevertheless re-evaluated immediately before every provider call, so
authorization can be narrowed or revoked after admission. If the pinned
provider handler is unavailable, dispatch fails explicitly rather than falling
back to another action definition.

### Dispatch Identity And Receipts

Every step or iteration item has a stable invocation ID derived before
dispatch. The runtime persists the invocation ID, action contract revision,
evaluated input, attempt number, and dispatch intent before calling the
provider. The provider receives the invocation ID in its dispatch context.

An idempotent provider persists or derives a receipt for the invocation ID and
returns the same logical result when that invocation is replayed. The runtime
stores the receipt and validated output before making emitted events visible.
The result and emitted-event admissions form one durable completion boundary.

If the executor restarts with a dispatch intent but no result:

- an action declaring `dispatch.idempotency: invocation_id` is dispatched again
  with the same invocation ID
- an action with `dispatch.idempotency: none` becomes `indeterminate` and is not
  dispatched automatically

`indeterminate` means that the external effect may have occurred and requires
provider-specific reconciliation or an explicit operator decision. Arbitrary
external effects cannot be made exactly once by the runtime alone.

## Materialization

Materialization writes an implicit contract or runtime state value as a
Markdown record. It supports inspection, documentation, collection-defined
custom contracts, and runtime-specific overrides.

| Mode | Meaning |
| --- | --- |
| `mirror` | exported runtime truth; semantic edits are drift |
| `annotate` | runtime truth plus local documentation fields or body text |
| `override` | runtime-specific override request using an extension mechanism |
| `custom` | collection-defined contract under its own ID |

Materialized contracts remain subject to the same schema validation and
registry conflict rules as other contracts. Materialization records an
interface or state value; executable behavior continues to come from the
registered provider or runtime.

## Runtime State Records

Runtimes MAY materialize state using the canonical runtime record schemas:

| Record | Meaning |
| --- | --- |
| runtime run | one workflow execution attempt, including step results |
| runtime checkpoint | durable state for waiting or resuming a workflow |
| runtime timer | one durable, generation-checked, one-shot timer |
| runtime diagnostic | a validation or execution issue |

Operational run, checkpoint, timer, event-journal, and action-receipt data
defaults to `.mdbase/runtime/`. That path is excluded from ordinary collection
scanning and workflow triggers.

Runtimes MAY materialize human-significant summaries as ordinary collection
records. Such records MUST redact secrets, follow the runtime's retention
policy, and identify their event origin so the runtime can prevent self-trigger
loops.

Example run:

```yaml
type: runtime_run
id: run_01j0
workflow: canvas.zone.set-status
workflow_version: 1
workflow_revision: sha256:7e4b0b28
registry_revision: sha256:70e5581c
policy_revision: sha256:4d322612
trigger: drop
event_id: evt_01j0
event_type: canvas.drop
event_cursor: 42
executor: desktop
idempotency_key: canvas.zone.set-status:evt_01j0:drop
status: succeeded
created_at: "2026-06-15T08:00:00Z"
started_at: "2026-06-15T08:00:00Z"
updated_at: "2026-06-15T08:00:01Z"
finished_at: "2026-06-15T08:00:01Z"
steps:
  - id: patch
    action: mdbase.record.patch
    action_version: 1
    invocation_id: inv_01j0
    attempt: 1
    status: succeeded
```

Every admitted run pins the canonical workflow revision, effective registry
revision, selected policy revision, and resolved action contract revisions used
to build it. A registry or policy change affects new admission and
dispatch-time authorization, but MUST NOT silently rewrite an admitted run's
plan.

Checkpoint records support durable waiting and resumable state. Checkpoint
updates use monotonically increasing revisions. A worker claims runnable state
through a bounded lease containing an owner, opaque token, and expiry. Only the
current lease token may commit a transition. Expired work can be reclaimed;
stale workers MUST fail their writes.

### Canonical Timer Provider

Runtime profile 0.1 defines portable one-shot timers. Recurrence is expressed by
upserting the next one-shot timer after a fire; cron and calendar recurrence are
provider extensions until separately standardized.

A timer provider supplies:

- `timer.upsert`, keyed by timer ID and replacing the prior generation
- `timer.cancel`, cancelling a named generation or the current generation
- `timer.fired`, emitted once for the current generation after `fire_at`

`fire_at` is an RFC 3339 instant. Local timezone and daylight-saving choices are
resolved by the producer before upsert. Each successful upsert increments the
timer generation. A claimed stale generation MUST NOT emit.

The portable missed-run policy is `fire_once`: after downtime, the current
overdue generation fires once with its original scheduled instant and actual
fire time. Repeated scheduler polling, lease expiry, or restart can redeliver
the same `timer.fired` event ID but cannot create a second logical fire.
Cancellation and firing race through one atomic generation transition.

## Workflow Integration

The effective registry includes workflow records alongside their referenced
event, action, provider, and capability contracts. Runtime Contracts preflight
validates the workflow record and resolves those references.

Chapter 14 defines trigger matching, expression evaluation, step dispatch,
iteration, concurrency, executor coordination, and error handling. Workflow
execution is covered by the separate Workflow conformance profile.

## Extension Patterns

Runtime profile 0.1 represents adjacent concerns with the following patterns:

| Concern | Profile 0.1 pattern |
| --- | --- |
| schedule | canonical one-shot timer provider; recurrence is an extension |
| approval | checkpoint plus policy or provider action |
| secret | runtime-managed secret reference value |
| distributed lock beyond run/checkpoint leases | cooperative runtime extension |
| artifact | action output or ordinary file |
| subscription | workflow trigger |

Future runtime profiles can define additional portable record shapes for these
concerns.
