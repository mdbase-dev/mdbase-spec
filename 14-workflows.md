# 14. Workflows

## Purpose

A workflow is a typed Markdown record that connects runtime events to runtime
actions. Chapter 13 defines the event, action, provider, capability, and policy
contracts that a workflow references. This chapter defines how a runtime turns a
validated workflow and event into a run.

## Workflow Record

Workflow records use `trigger.event` and `step.action` identifiers from the
effective registry:

```yaml
type: workflow
id: canvas.zone.set-status
version: 1
name: Set status from canvas zone
enabled: true

triggers:
  - id: drop-on-zone
    event: canvas.drop
    if:
      $expr: 'has(event.payload.zone) && has(event.payload.file)'

steps:
  - id: patch-status
    action: mdbase.record.patch
    input:
      path:
        $expr: 'event.payload.file.path'
      patch:
        status:
          $expr: 'event.payload.zone.id'

run:
  execution:
    mode: single_executor
  idempotency:
    key:
      $expr: 'workflow.id + ":" + event.id + ":" + trigger.id'
```

Workflow, trigger, and step objects use a strict core shape. Extension fields
begin with `x-`. Runtime policy records select executors for the local
deployment.

## Workflow Run Model

A runtime processes a workflow through two phases.

### Preflight

Preflight occurs when the workflow or effective registry changes. The runtime:

1. validates the workflow record against the canonical workflow schema
2. verifies unique trigger IDs and unique step IDs
3. resolves workflow, trigger, and step provider and capability requirements
4. resolves every `trigger.event` and `step.action`
5. compiles every CEL expression in variables, conditions, inputs, iteration,
   idempotency, and concurrency policy
6. confirms that action input and output schemas are compiled
7. evaluates local runtime policy for required capabilities and executor
   selection

A failed preflight makes the workflow unavailable for execution and emits a
runtime diagnostic. Preflight is repeated whenever a referenced contract,
provider, capability, or active runtime policy changes.

### Event-To-Run Sequence

For each delivered event, the runtime:

1. validates the event envelope, contract version, provider provenance, and
   payload as defined in Chapter 13
2. journals and deduplicates the event at the data authority
3. finds enabled workflows with triggers for the event ID
4. applies trigger debounce and minimum-interval admission
5. evaluates workflow variables, the trigger condition, and the workflow-level
   condition
6. applies execution-mode and executor policy
7. derives the idempotency key and concurrency group and admits, queues, skips,
   or replaces the run
8. pins a canonical execution plan and atomically commits event and run
   admission
9. claims the run with a bounded lease and executes steps in document order
10. validates step outputs and emitted events and records every step result
11. moves the run to a terminal status

This sequence is normative. A runtime may combine internal stages while
preserving their validation, authorization, ordering, and diagnostic outcomes.

## Trigger Admission

A trigger subscribes to one event contract ID. Its `id` is unique within the
workflow.

`trigger.debounce` groups matching deliveries for the same workflow and trigger.
Each new delivery resets the timer; when the interval expires, the most recent
validated event is evaluated. `trigger.minimum_interval` admits at most one run
for that workflow and trigger during the interval. Suppressed deliveries do not
create runs.

Durations use an integer followed by `ms`, `s`, `m`, `h`, or `d`.

After admission, the runtime evaluates `trigger.if` and the workflow-level `if`.
Both conditions must evaluate to boolean true. False or null ends processing for
that trigger. An evaluation error creates a failed-run diagnostic.

## Variables

`vars` defines values shared by the workflow's conditions, run policy, and
steps. Literal values are preserved. Expression values are evaluated once for
each admitted trigger using `event`, `workflow`, and `trigger`.

Variables may reference other variables through `vars.<name>`. The runtime
evaluates those dependencies in topological order. A cycle is a workflow
preflight error. The resulting `vars` object is immutable for the run.

## Steps

Steps execute in document order. Each step ID is unique within the workflow and
becomes the key for its standard result under `steps`.

For a step, the runtime:

1. resolves the action from the preflighted registry
2. evaluates `step.if`
3. expands an optional `for_each`
4. recursively evaluates expression values in `step.input`
5. validates the evaluated input against the action input schema
6. checks step provider and capability requirements
7. performs dispatch-time capability authorization
8. calls the selected action handler
9. validates the action output and each emitted event
10. stores the step result before continuing

A false or null step condition records `skipped`. An expression or input
validation error records `failed` and applies `run.on_error`.

### Expression Values

Only an object containing exactly `$expr` is evaluated as an expression:

```yaml
input:
  path:
    $expr: 'event.payload.file.path'
  patch:
    status: in_progress
    updated_at:
      $expr: 'now()'
  note: event.payload.file.path
```

Here, `note` remains the literal string `event.payload.file.path`.

### Iteration

`for_each.items` evaluates to a list:

```yaml
steps:
  - id: patch-each
    action: mdbase.record.patch
    for_each:
      items:
        $expr: 'event.payload.files'
      as: item
    input:
      path:
        $expr: 'item.path'
      patch:
        status: open
```

The item binding defaults to `item` and may be renamed with `as`. Profile 0.1
visits items in list order. The step output is an ordered list of per-item
outputs, and an item failure fails the step. Runtime and workflow limits cap the
number of items.

## Run Coordination

The optional `run` object controls executor selection, duplicate suppression,
concurrency, limits, and step failure behavior:

```yaml
run:
  execution:
    mode: single_executor
  idempotency:
    key:
      $expr: 'workflow.id + ":" + event.id + ":" + trigger.id'
  concurrency:
    group:
      $expr: 'event.payload.file.path'
    policy: replace
  limits:
    timeout: 5m
    max_items: 100
  on_error: stop
```

### Execution Modes

| Mode | Executor behavior |
| --- | --- |
| `single_executor` | the executor selected by runtime policy may create the run |
| `broadcast` | every eligible executor may create its own run |
| `best_effort` | an eligible runtime may execute locally with duplicate or missed delivery accepted |

`single_executor` is the default. Only the runtime selected by policy creates
the run. Other runtimes may preflight and report diagnostics.

Runtime policy selects the executor by workflow ID, falling back to its default
executor:

```yaml
type: runtime_policy
id: local.runtime
version: 1
name: Local runtime policy
executors:
  default: desktop
  workflows:
    canvas.zone.set-status: desktop
    repo.skill.sync: automation-daemon
```

### Idempotency

Event delivery is at least once. Every `single_executor` run therefore has an
idempotency key. `run.idempotency.key` supplies it when declared; otherwise the
runtime derives:

```text
workflow.id + ":" + event.id + ":" + trigger.id
```

Before dispatching the first step, the selected executor MUST reserve that key
in a store shared by every process using the same executor identity. A prior
reservation suppresses the duplicate run. The reservation remains valid across
the provider's documented replay horizon.

The idempotency reservation, concurrency decision, pinned execution plan, and
run record are committed in the event-admission transaction. Reserving a key
after dispatch begins is not conformant.

A missing shared reservation store for a side-effecting `single_executor` run
produces `idempotency_unavailable`. For `broadcast`, reservation scope includes
the executor identity so each eligible executor can run once.

### Concurrency

When `run.concurrency` is absent, the policy is `allow`. When a policy is present
without `group`, the workflow ID is the group.

| Policy | Behavior for a new run in an active group |
| --- | --- |
| `skip` | discard the new run |
| `queue` | start it after earlier runs reach a terminal state |
| `replace` | request cancellation, then start it after the active run is terminal |
| `allow` | run concurrently |

Completed action effects remain committed during replacement. The replacement
waits for an uncancellable active action to finish.

Events are ordered within one provider stream. Queue order for a concurrency
group preserves that delivery order. Ordering between different provider
streams is unspecified, and runtimes tolerate replay.

### Limits And Failure Policy

Workflow limits and runtime-policy limits combine by taking the stricter value.
`timeout` applies to the complete run. `max_items` caps the total items expanded
by any one step.

`run.on_error` defaults to `stop`. `stop` skips remaining steps after a failure.
`continue` records the failed step and proceeds to the next step whose condition
can be evaluated.

## Run And Step Results

A run follows these portable transitions:

| From | To | Cause |
| --- | --- | --- |
| admitted | `queued` | concurrency policy delays execution |
| admitted or `queued` | `running` | a worker obtains the current lease |
| `running` | `waiting` | a durable checkpoint suspends execution |
| `waiting` | `queued` | the checkpoint becomes ready |
| `running` | `succeeded` | every required step completes |
| `running` | `failed` | a deterministic failure or timeout is recorded |
| `queued`, `running`, or `waiting` | `cancelled` | cancellation completes without ambiguous effects |
| `running` | `indeterminate` | a non-idempotent dispatch has an unknown outcome |

`succeeded`, `failed`, `cancelled`, and `indeterminate` are terminal.
Implementations MUST reject transitions from a terminal state and writes made
with a stale lease token.

Each step result contains `id`, `action`, and `status`, with `output` or `error`
when applicable. Step status is one of:

- `pending`
- `running`
- `succeeded`
- `failed`
- `skipped`
- `cancelled`
- `timed_out`
- `indeterminate`

A run deadline prevents every not-yet-started dispatch. If no dispatch intent
is active, the current step is recorded as `timed_out` and the run as `failed`.
Cancellation records the active step and run as `cancelled`. These outcomes
remain distinct in diagnostics and run history.

Action effects completed before a failure remain committed according to the
action contract. Result details SHOULD identify completed external effects so a
person or agent can reconcile partial work.

Profile 0.1 dispatches an action once for each step or iteration item. Retry
behavior uses an `x-*` extension that defines retry conditions, limits, and
result history. An action with external effects is retried only when its
contract declares idempotency support or runtime policy explicitly authorizes
the retry.

### Durable Action Attempt Protocol

For each step or iteration item, the executor:

1. derives and persists a stable invocation ID
2. evaluates and validates input
3. performs current dispatch-time authorization
4. persists a dispatch intent and attempt number
5. invokes the provider with the invocation ID
6. validates output and emitted events
7. atomically persists the receipt, result, step state, and emitted-event
   admissions

Provider timeout does not prove that an effect failed. An executor MUST NOT
erase an active dispatch intent or report a non-idempotent effect as merely
`timed_out`. If no result is durable, recovery follows the action's declared
idempotency contract from Chapter 13: an idempotent invocation may be replayed
with the same invocation ID to reconcile its receipt, while a non-idempotent
invocation becomes `indeterminate`. Reconciliation never permits a new
invocation or subsequent workflow step after the run deadline. If an
idempotent provider returns a committed result after the deadline, the runtime
records its receipt and effect, marks the step `timed_out`, and fails the run.

### Crash Recovery

On startup and periodically, an executor reclaims expired run and checkpoint
leases. Recovery resumes from the last committed state:

- pending work can be claimed normally
- an idempotent dispatch intent is replayed with its original invocation ID
- a non-idempotent dispatch intent becomes `indeterminate`
- a committed step result is never dispatched again
- a committed emitted event can be redelivered but is deduplicated by event ID

Recovery MUST NOT infer success from elapsed time or infer failure from a lost
transport connection.

### Cancellation And Replacement

Cancellation is durable intent. Queued work can be cancelled immediately.
Cooperative actions receive a cancellation request; actions declaring
`dispatch.cancellation: none` are allowed to finish before the run reaches a
terminal state. Completed effects are never rolled back implicitly.

`replace` records cancellation intent for the active run, waits until that run
is terminal, and then makes the replacement runnable. If the active run becomes
`indeterminate`, the replacement remains queued until policy or an operator
explicitly allows it to proceed.

## Workflow Sources

Built-in, provider, pack, and collection workflows enter the effective registry
through the composition rules in Chapter 13. Built-in workflows SHOULD be
inspectable and MAY be materialized. Identical definitions coalesce; conflicting
definitions produce `runtime_contract_conflict` with their origins.
