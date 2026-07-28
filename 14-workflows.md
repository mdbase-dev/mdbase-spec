# 14. Durable Workflow Execution

## Purpose

Chapter 13 defines the companion-profile boundary, standard records, policy,
and admission. This chapter defines the durable protocol after a workflow and
event have been admitted.

JSON Schema proves that persisted evidence has the right shape. The transition,
transaction, lease, replay, and recovery rules below are behavioral
requirements and cannot be replaced by schema validation.

## Execution Inputs

A worker executes only an immutable admitted plan. The plan contains:

- workflow content revision;
- exact triggering event contract and source declaration;
- exact action contracts;
- one exact provider identity, declaration digest, and handler ID per step;
- selected runtime policy revision;
- evaluated limits and authority evidence;
- run idempotency and concurrency decisions.

The worker may confirm that a live declaration still matches the pin. It must
not silently resolve a replacement.

## Deterministic Evaluation

Workflow variables, conditions, templates, and iteration use the expression
rules in Chapter 11. Runtime activation exposes the shared CloudEvent as
`event`; portable payload values therefore appear below `event.data`.

- variables are evaluated once in dependency order;
- cycles fail preflight;
- trigger and step conditions must evaluate to boolean true to continue;
- object values are literals unless they have exactly one `$expr` key;
- steps execute in document order;
- `for_each` visits list items in list order;
- evaluated action input is validated by the interoperability bridge before
  provider invocation;
- action output or declared error data is validated before it becomes durable
  step state.

Every execution limit is the stricter of the workflow and current policy.

## Durable Event Admission

Event delivery may be repeated. The data authority therefore commits the
following atomically:

- validated CloudEvent and exact source evidence;
- duplicate/tombstone state;
- monotonically increasing delivery cursor;
- every run admitted from the event;
- run idempotency reservations;
- concurrency queue changes;
- immutable admitted plans.

A crash cannot expose the event without its derived runs or a run without its
event. Retrying the same event ID and contract/source evidence returns the
original cursor and does not create another logical run. Reuse of an event ID
with different canonical content fails closed.

Pruning may remove event bodies after the documented retention period but
keeps sufficient tombstone evidence through the replay horizon. Reading from a
cursor older than retained history reports `cursor_expired` and the earliest
available cursor; it never silently skips the gap.

## Run State Machine

Portable run states and transitions are:

| From | To | Cause |
| --- | --- | --- |
| admitted | `queued` | concurrency delays execution |
| admitted or `queued` | `running` | worker obtains current lease |
| `running` | `waiting` | durable checkpoint suspends execution |
| `waiting` | `queued` | checkpoint becomes ready |
| `running` | `succeeded` | all required steps complete |
| `running` | `failed` | deterministic failure or deadline |
| `queued`, `running`, `waiting` | `cancelled` | cancellation completes without ambiguous effects |
| `running` | `indeterminate` | non-replayable action outcome is unknown |

`succeeded`, `failed`, `cancelled`, and `indeterminate` are terminal. A host
rejects every transition from a terminal state.

## Leases

A worker claims a run with a bounded lease containing owner, opaque token, and
expiry. Every state-changing write compares the current lease token.

- workers renew before expiry;
- an expired lease may be recovered by another worker;
- a stale worker cannot commit a step, checkpoint, or terminal state;
- handler execution is never treated as proof that its outcome was committed.

Lease duration and renewal strategy are host configuration. The observable
stale-write rejection is portable.

## Action Attempts

Before invoking a provider, the runtime durably writes an action-attempt intent
containing the shared request ID, invocation ID, attempt ID, exact contract,
provider identity, provider-declaration digest, handler ID, idempotency key,
deadline, and input.

It then sends the ordinary interoperability request. The bridge produces the
ordinary invocation and outcome evidence. The runtime stores those envelopes
without redefining them.

Attempt states are:

```text
admitted → dispatching → succeeded
                      ↘ rejected
                      ↘ failed
                      ↘ cancelled
                      ↘ indeterminate
```

Only an outcome with matching request, invocation, attempt, contract, and
provider evidence completes the attempt.

## Idempotency And Crash Recovery

The workflow run has an idempotency key. If the author does not supply one, the
host derives:

```text
workflow.id + ":" + event.id + ":" + trigger.id
```

The key is reserved during admission, before any dispatch.

Action replay follows the action artifact and provider declaration:

- for request-idempotent actions, recovery reuses the same request and
  invocation identity as required by the binding and obtains the retained
  outcome or safely retries;
- for non-idempotent actions, a crash after dispatch but before durable outcome
  creates `indeterminate`; the runtime does not guess or replay;
- conflicting reuse of a request or idempotency key fails closed;
- an action marked as requiring idempotency is ineligible when the provider or
  transport cannot supply it.

Exactly-once external side effects are not promised. The profile provides
durable intent, duplicate suppression, explicit replay rules, and honest
indeterminate outcomes.

## Concurrency

The optional workflow concurrency policy applies to an evaluated group:

| Policy | New run while group is active |
| --- | --- |
| `skip` | record the admission decision and do not execute |
| `queue` | preserve event-cursor order |
| `replace` | request cancellation, then wait for a terminal state |
| `allow` | run concurrently |

When no group expression is supplied, the workflow ID is the group. Completed
effects are never rolled back by `replace`. A replacement waits when the active
action cannot be cancelled safely.

## Cancellation And Deadlines

Cancellation is cooperative and uses the interoperability cancellation
envelope. The runtime records the request before delivery.

- not-yet-started attempts are not dispatched;
- cooperative providers receive cancellation through the bridge;
- a confirmed cancelled outcome permits `cancelled`;
- a completed action outcome wins a race with cancellation;
- loss of a non-idempotent outcome becomes `indeterminate`;
- terminal runs ignore repeated cancellation requests idempotently.

A run deadline prevents all new dispatches after expiry. A deterministic
deadline failure becomes `failed`; an already-dispatched action whose outcome
cannot be known follows the indeterminate rule.

## Checkpoints

A checkpoint stores enough state to resume deterministically:

- run ID and current generation;
- next step/item position;
- immutable variables and completed step outputs;
- pending request/invocation evidence;
- wait condition;
- current workflow/admitted-plan revision;
- lease-safe updated time.

Checkpoint generation only increases. A stale generation or stale lease write
is rejected. Completion is recorded before the worker advances.

## Timers

A durable timer is generation-safe and one-shot.

1. scheduling writes generation `n`, fire time, and an event contract
   requirement plus event data;
2. rescheduling writes generation `n + 1` and makes older generations stale;
3. a worker atomically claims the current due generation;
4. firing publishes `mdbase.runtime.timer.fired` or the requested event through
   an interoperability event source;
5. the resulting CloudEvent is admitted through the ordinary event journal;
6. the timer becomes `fired` only with matching event evidence.

After restart, an overdue current generation fires once under
`missed_run_policy: fire_once`. Polling or racing workers cannot create two
logical events.

## Policy Rechecks

Admission pins compatibility and selection. Authority is checked again
immediately before each dispatch because grants, scopes, or approval may have
changed.

A new denial prevents dispatch and fails the attempt with
`capability_denied`. A policy change does not substitute another provider or
contract in an admitted plan. That requires re-admission.

## Diagnostics And Dead Letters

Protocol failures use stable codes and durable evidence. Important examples
include:

- `unknown_contract`;
- `contract_digest_conflict`;
- `event_source_unavailable`;
- `no_provider`;
- `ambiguous_provider`;
- `capability_denied`;
- `idempotency_unavailable`;
- `invalid_run_transition`;
- `stale_lease`;
- `cursor_expired`;
- `outcome_indeterminate`.

Unprocessable event/request/outcome evidence may be retained as
`mdbase.runtime.dead-letter`. A dead-letter record is passive. Requeue is an
explicit authorized operation that creates new admission evidence.

## Minimum Durable Conformance

A runtime claiming profile 0.2 must demonstrate:

- ordinary record-contract validation of runtime records;
- exact contract/source/provider pinning through interoperability declarations;
- authorization separate from conformance;
- atomic event/run admission and duplicate suppression;
- legal run and attempt transitions;
- stale-lease rejection and crash recovery;
- idempotent versus non-idempotent recovery;
- generation-safe timers;
- cursor expiry behavior;
- cancellation and deadline races;
- machine-readable diagnostics.

The reference TypeScript executor demonstrates the boundary and shared
exchange model but is intentionally non-durable. Durable conformance belongs to
hosts such as the Rust runtime and Connect binding.
