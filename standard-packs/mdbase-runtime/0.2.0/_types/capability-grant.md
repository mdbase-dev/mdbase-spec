---
kind: mdbase.type
name: runtime_capability_grant
version: 1
description: Canonical Markdown implementation of mdbase.runtime.capability-grant.
match:
  where:
    type: runtime_capability_grant
schema:
  dialect: json-schema-2020-12
  ref: ../schemas/mdbase.runtime.capability-grant/1.0.0.schema.json
implements:
  - contract: mdbase.runtime.capability-grant
    version: 1.0.0
    fields:
      type: type
      id: id
      capability: capability
      principal: principal
      mode: mode
      actions: actions
      providers: providers
      granted_at: granted_at
      expires_at: expires_at
---

# Capability grant evidence

This canonical type makes `runtime_capability_grant` records discoverable through
the ordinary mdbase record-contract registry.
