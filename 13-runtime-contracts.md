# 13. Durable Runtime Companion Profile

## Purpose

The durable runtime profile turns passive, portable definitions into
recoverable automation. It is deliberately a **companion** to two simpler
specifications:

1. the core mdbase contract system defines contract identity, semantic
   versions, JSON Schemas, digests, record implementations, resolution, and
   packs;
2. the [event/action interoperability profile](./interop/0.1.md) defines
   CloudEvents, action requests and outcomes, event-source and action-provider
   declarations, provider selection, and baseline exchange behavior;
3. this profile adds durable admission, authorization, execution state,
   retries, timers, cancellation, and recovery.

The separation is practical. An application can consume portable records or
exchange events and actions without implementing a workflow engine.

This chapter defines runtime companion profile `0.2`. The profile is versioned
independently from mdbase collection specification `0.3.0`.

## The Short Version

```text
contract artifact        what an event, action, or record means
type implements          how a Markdown record stores a record contract
source/provider declares how live code implements an event/action contract
runtime policy           whether that exact code may act here
admitted plan            exact contract digests and implementations for one run
durable runtime          safely executes and recovers that admitted plan
```

Installing a contract, type, or pack never runs code and grants no authority.
Markdown provider-registration records are audit evidence only. A host must
verify and admit a live interoperability declaration before code is eligible.

## No Second Contract System

Runtime profile 0.2 has no runtime-specific contract record, registry,
provider-owned contract definition, event envelope, or contract mode.

- Event and action interfaces are ordinary `mdbase.contract` artifacts.
- Runtime state is stored in ordinary record types that implement standard
  record contracts.
- Live event sources and action providers use interoperability declarations.
- Runtime indexes are derived caches of those verified registries.
- Bundled artifacts, installed artifacts, and exported copies have identical
  identity and conflict semantics.

Private `x-*` metadata, filenames, and folders have no discovery,
authorization, or activation meaning.

The superseded `type: action`, `type: event`, `type: provider`,
`contract_version`, `schemas.payload`, `runtime.contract_mode`, and
provider-supplied contract arrays are not runtime profile 0.2.

## Standard Runtime Pack

The official `mdbase.runtime.standard` pack is at
[`standard-packs/mdbase-runtime/0.2.0`](./standard-packs/mdbase-runtime/0.2.0/).
It installs atomically and contains:

| Record contract | Canonical record type | Purpose |
| --- | --- | --- |
| `mdbase.runtime.workflow` | `runtime_workflow` | portable workflow definition |
| `mdbase.runtime.policy` | `runtime_policy` | local authority and provider selection |
| `mdbase.runtime.provider-registration` | `runtime_provider_registration` | optional declaration audit snapshot |
| `mdbase.runtime.capability-grant` | `runtime_capability_grant` | optional materialized grant |
| `mdbase.runtime.run` | `runtime_run` | durable run and admitted plan |
| `mdbase.runtime.action-attempt` | `runtime_action_attempt` | invocation intent and outcome evidence |
| `mdbase.runtime.checkpoint` | `runtime_checkpoint` | durable continuation |
| `mdbase.runtime.timer` | `runtime_timer` | generation-safe one-shot timer |
| `mdbase.runtime.diagnostic` | `runtime_diagnostic` | machine-readable runtime issue |
| `mdbase.runtime.dead-letter` | `runtime_dead_letter` | retained unprocessable evidence |

It also contains inspectable event/action artifacts for
`mdbase.runtime.timer.fired` and `mdbase.runtime.run.cancel`.

These artifacts are a standard library, not privileged built-ins. A host may
bundle the pack for offline use without copying it into each collection.
Exporting a bundled artifact is an inspection feature; it does not create a new
definition or alter precedence.

## Runtime Records Are Ordinary Implementations

The canonical workflow type illustrates the model:

```yaml
kind: mdbase.type
name: runtime_workflow
version: 1
match:
  where:
    type: runtime_workflow
schema:
  dialect: json-schema-2020-12
  ref: ../schemas/mdbase.runtime.workflow/1.0.0.schema.json
implements:
  - contract: mdbase.runtime.workflow
    version: 1.0.0
    fields:
      type: type
      id: id
      version: version
      name: name
      enabled: enabled
      triggers: triggers
      steps: steps
```

The core collection engine discovers and validates this exactly like any other
record contract. A durable runtime asks the core engine for the verified
descriptor and projected view. It does not scan for `workflows/`, special-case
the filename, or reconstruct a separate registry.

Internal database rows and indexes do not need Markdown record contracts.
Materialize runtime state when it is intended to be portable, inspectable,
exportable, or shared through mdbase. Private storage tables remain
implementation details but must preserve the same protocol evidence.

## Event Sources And Action Providers

Live implementations use the interoperability profile unchanged.

An event source declaration binds a verified implementation identity to one or
more exact event artifacts. An action provider declaration binds handler IDs to
exact action artifacts. Declarations include their own canonical digest.

A provider does not return an action or event definition from executable code.
Registration supplies the already-resolved artifact to the interoperability
bridge, which validates the implementation binding and publishes a declaration.

Several sources may publish one event contract. Several providers may implement
one action contract. Events remain multicast. Actions select exactly one
provider:

- an explicit provider selector in the workflow wins;
- otherwise a single matching runtime-policy selection may apply;
- otherwise one eligible provider is unambiguous;
- zero providers fails with `no_provider`;
- multiple providers fail with `ambiguous_provider`.

Executable providers are never unioned.

## Authorization Is Separate

Conformance answers “can this implementation speak this interface?”
Authorization answers “may it act here, for this caller, on this resource?”

A host checks, independently:

- selected and enabled runtime policy;
- caller and executor identity;
- named capabilities;
- collection and record scope;
- action contract and exact provider implementation;
- operational limits;
- required user approval;
- transport and host authority.

Deny takes precedence. The standard pack ships no permissive policy. A
contract, type, workflow, provider declaration, or audit record is passive
until a host admits it under current authority.

## Workflow Requirements

Authors use a contract ID and SemVer requirement:

```yaml
type: runtime_workflow
id: canvas.zone.set-status
version: 1.0.0
name: Set status from canvas zone
enabled: true

triggers:
  - id: drop
    event:
      id: canvas.drop
      version: ^1.0.0

steps:
  - id: patch-status
    action:
      id: mdbase.record.patch
      version: ^2.0.0
    requires:
      capabilities: [mdbase.record.write]
    input:
      path:
        $expr: event.data.file.path
      patch:
        status:
          $expr: event.data.zone.id
```

The readable workflow does not contain a digest for every normal dependency.
An author may add a digest to a requirement when deliberately pinning it.

Workflows normally depend on behavior, not an application name. Add a provider
selector only when the workflow intentionally needs a provider-specific
implementation:

```yaml
provider:
  application: tasknotes
  implementation: tasknotes-v5
```

## Preflight And Admission

Preflight is derived and repeatable. It:

1. validates the workflow through `mdbase.runtime.workflow`;
2. checks unique trigger and step IDs and compiles expressions;
3. resolves each contract requirement through the core contract registry;
4. uses verified interoperability declarations to find implementations;
5. applies explicit or policy provider selection;
6. evaluates capability and operational policy;
7. reports every missing, conflicting, ambiguous, or denied dependency.

Preflight does not make an execution durable.

Admission occurs for one validated event delivery. In one durable transaction
the authority:

1. journals and deduplicates the CloudEvent;
2. identifies the exact event-source declaration;
3. evaluates trigger and admission policy;
4. resolves every action provider;
5. pins the workflow revision;
6. pins exact event/action contract ID, version, and digest;
7. pins exact source/provider identities and declaration digests;
8. records handler IDs, idempotency decisions, and deadlines;
9. reserves the run idempotency key and concurrency position;
10. writes the run and immutable admitted plan.

Registry changes after this transaction do not alter the plan. Changing an
admitted dependency requires explicit migration or re-admission.

## Shared Envelopes

Runtime event intake is a structured CloudEvents 1.0 envelope from the
interoperability profile. Runtime action dispatch persists and exchanges the
standard:

- `mdbase.action.request`;
- `mdbase.action.invocation`;
- `mdbase.action.outcome`;
- `mdbase.action.cancel`.

The runtime does not wrap these in another envelope or rename `data` to
`payload`. Runtime-specific run, attempt, cursor, and lease records refer to
the shared envelope evidence.

## Runtime Configuration

The core `mdbase.yaml` schema does not define `runtime.contract_mode`.
Runtime enablement, storage, worker identity, policy selection, and transport
binding are host configuration. A host may store portable policy records in the
collection, but loading the collection remains safe and does not activate them.

## Conformance Boundary

A conformant core engine supports contract artifacts, type implementations,
record projection, conflict detection, and packs. It need not execute
workflows.

A conformant interoperability implementation supports its claimed event/action
roles. It need not persist runs.

A conformant durable runtime supports admission and the execution/recovery
rules in this chapter and Chapter 14. It uses core and interoperability
evidence rather than publishing a second contract model.
