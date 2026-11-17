---
kind: mdbase.type
name: runtime_policy
version: 2
description: Canonical Markdown implementation of mdbase.runtime.policy.
match:
  where:
    type: runtime_policy
schema:
  dialect: json-schema-2020-12
  ref: ../schemas/mdbase.runtime.policy/1.1.0.schema.json
implements:
  - contract: mdbase.runtime.policy
    version: 1.1.0
    fields:
      id: id
      version: version
      name: name
      enabled: enabled
      executors: executors
      provider_selections: provider_selections
      grants: grants
---

# Runtime policy

This canonical type makes `runtime_policy` records discoverable through
the ordinary mdbase record-contract registry.

Apps create these records by naming the type; the engine writes it under the
collection's configured explicit type key. The `match` rule also
recognises hand-written `type: runtime_policy` records in collections
whose type key is something else.
