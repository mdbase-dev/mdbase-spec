# `@callumalpass/mdbase-runtime`

Reference TypeScript support for mdbase durable runtime profile 0.2.

The package deliberately does **not** define another contract registry,
provider API, action dispatcher, or event envelope:

- ordinary mdbase contracts own identity, SemVer, schemas, digests, and record
  implementations;
- `@callumalpass/mdbase-interop` owns CloudEvents, action requests/outcomes,
  source/provider declarations, and provider resolution;
- this package validates standard runtime records and produces immutable,
  authorization-checked admitted plans for durable execution.

```ts
import { admitWorkflow } from "@callumalpass/mdbase-runtime";

const result = await admitWorkflow({
  workflow,
  trigger_id: "changed",
  event,
  bridge: interopBridge.describe(),
  policy
});

if (!result.valid) throw new Error(result.diagnostics[0].message);
await durableStore.commit(result.plan);
```

Workflow files contain readable contract requirements. The admitted plan pins
exact contract digests, event-source identity, action-provider identity,
provider declaration digest, and handler ID. A registry change therefore
cannot silently change an already-admitted run.

Installing the standard runtime pack is passive and never enables execution.
