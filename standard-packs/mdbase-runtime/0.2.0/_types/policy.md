---
kind: mdbase.type
name: runtime_policy
version: 1
description: Canonical Markdown implementation of mdbase.runtime.policy.
match:
  where:
    type: runtime_policy
schema:
  dialect: json-schema-2020-12
  ref: ../schemas/mdbase.runtime.policy/1.0.0.schema.json
implements:
  - contract: mdbase.runtime.policy
    version: 1.0.0
    fields:
      type: type
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
