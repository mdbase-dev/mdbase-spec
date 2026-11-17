---
kind: mdbase.type
name: runtime_checkpoint
version: 2
description: Canonical Markdown implementation of mdbase.runtime.checkpoint.
match:
  where:
    type: runtime_checkpoint
schema:
  dialect: json-schema-2020-12
  ref: ../schemas/mdbase.runtime.checkpoint/1.1.0.schema.json
implements:
  - contract: mdbase.runtime.checkpoint
    version: 1.1.0
    fields:
      id: id
      run_id: run_id
      generation: generation
      status: status
      state: state
      updated_at: updated_at
---

# Runtime checkpoint

This canonical type makes `runtime_checkpoint` records discoverable through
the ordinary mdbase record-contract registry.

Apps create these records by naming the type; the engine writes it under the
collection's configured explicit type key. The `match` rule also
recognises hand-written `type: runtime_checkpoint` records in collections
whose type key is something else.
