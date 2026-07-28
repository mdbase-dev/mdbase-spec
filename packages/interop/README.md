# `@callumalpass/mdbase-interop`

Browser-safe TypeScript models, canonical schemas, validation helpers, and the
reference in-memory bridge for mdbase event/action interoperability profile
`0.1`.

Events are CloudEvents 1.0 structured JSON. Actions use separate logical
request, admitted invocation, cancellation, and terminal outcome envelopes.
Event subscriptions multicast; actions resolve to exactly one provider.

```ts
import {
  InMemoryInteropBridge,
  type EventContractArtifact
} from "@callumalpass/mdbase-interop";

const bridge = new InMemoryInteropBridge({
  authorize: ({ principal }) => principal.application.startsWith("example.")
});

const source = bridge.connect({
  application: "example.tasks",
  implementation: "example.tasks.obsidian",
  version: "1.0.0"
});

const completed: EventContractArtifact = {
  kind: "mdbase.contract",
  contract_type: "event",
  id: "example.task.completed",
  version: "1.0.0",
  data_schema: {
    dialect: "json-schema-2020-12",
    value: {
      type: "object",
      required: ["task_id"],
      additionalProperties: false,
      properties: { task_id: { type: "string" } }
    }
  }
};

await source.registerEventSource({
  declaration_id: "example.tasks.events",
  contracts: [{ contract: completed }]
});
```

The bridge defaults to deny. A host supplies authorization independently from
contract compatibility. Client handles scope implementation identity and
remove subscriptions, source declarations, and providers on disposal.

Runtime registration requires inline resolved schema values. Collection tools
may store `schema.ref`, but must resolve it before passing an artifact to the
bridge.

The package has no Obsidian, Node filesystem, workflow, or persistence
dependency.
