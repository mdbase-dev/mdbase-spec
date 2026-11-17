---
kind: mdbase.type
name: runtime_diagnostic
version: 2
description: Canonical Markdown implementation of mdbase.runtime.diagnostic.
match:
  where:
    type: runtime_diagnostic
schema:
  dialect: json-schema-2020-12
  ref: ../schemas/mdbase.runtime.diagnostic/1.1.0.schema.json
implements:
  - contract: mdbase.runtime.diagnostic
    version: 1.1.0
    fields:
      id: id
      severity: severity
      code: code
      message: message
      run_id: run_id
      attempt_id: attempt_id
      path: path
      details: details
      created_at: created_at
---

# Runtime diagnostic

This canonical type makes `runtime_diagnostic` records discoverable through
the ordinary mdbase record-contract registry.

Apps create these records by naming the type; the engine writes it under the
collection's configured explicit type key. The `match` rule also
recognises hand-written `type: runtime_diagnostic` records in collections
whose type key is something else.
