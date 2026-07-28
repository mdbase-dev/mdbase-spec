---
kind: mdbase.type
name: runtime_dead_letter
version: 1
description: Canonical Markdown implementation of mdbase.runtime.dead-letter.
match:
  where:
    type: runtime_dead_letter
schema:
  dialect: json-schema-2020-12
  ref: ../schemas/mdbase.runtime.dead-letter/1.0.0.schema.json
implements:
  - contract: mdbase.runtime.dead-letter
    version: 1.0.0
    fields:
      type: type
      id: id
      reason: reason
      status: status
      evidence_kind: evidence_kind
      evidence: evidence
      created_at: created_at
      acknowledged_at: acknowledged_at
---

# Runtime dead letter

This canonical type makes `runtime_dead_letter` records discoverable through
the ordinary mdbase record-contract registry.
