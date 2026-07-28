---
kind: mdbase.type
name: runtime_provider_registration
version: 1
description: Canonical Markdown implementation of mdbase.runtime.provider-registration.
match:
  where:
    type: runtime_provider_registration
schema:
  dialect: json-schema-2020-12
  ref: ../schemas/mdbase.runtime.provider-registration/1.0.0.schema.json
implements:
  - contract: mdbase.runtime.provider-registration
    version: 1.0.0
    fields:
      type: type
      id: id
      declaration_kind: declaration_kind
      declaration: declaration
      verified_at: verified_at
      active: active
---

# Provider registration evidence

This canonical type makes `runtime_provider_registration` records discoverable through
the ordinary mdbase record-contract registry.
