# Canvas Runtime Companion Example

This collection demonstrates runtime companion profile 0.2:

- `_contracts/` contains ordinary event/action artifacts;
- `workflows/` and `policies/` contain passive runtime records;
- `runtime-events/` contains an ordinary structured CloudEvent;
- live Canvas and mdbase code implement the artifacts with event-source and
  action-provider declarations;
- durable admission pins exact artifact and declaration digests before the
  workflow runs.

Install
[`mdbase.runtime.standard`](../../../standard-packs/mdbase-runtime/0.2.0/)
before opening the workflow and policy as typed records. The pack supplies the
canonical `runtime_workflow` and `runtime_policy` type implementations. Pack
installation does not activate the workflow.

## Flow

1. Canvas registers `canvas.drop` through the interoperability profile.
2. mdbase registers a handler for `mdbase.record.patch`.
3. Canvas publishes the sample CloudEvent.
4. the runtime validates the workflow through `mdbase.runtime.workflow`;
5. policy authorizes `mdbase.record.write` and selects the mdbase provider;
6. admission pins the event contract/source and action contract/provider;
7. execution persists an action attempt and invokes the shared action request;
8. the shared outcome becomes durable step evidence.

There are no provider records, implicit contracts, runtime event envelope, or
contract modes in this example.
