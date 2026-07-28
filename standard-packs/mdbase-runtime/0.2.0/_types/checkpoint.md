---
kind: mdbase.type
name: runtime_checkpoint
version: 1
description: Canonical Markdown implementation of mdbase.runtime.checkpoint.
match:
  where:
    type: runtime_checkpoint
schema:
  dialect: json-schema-2020-12
  ref: ../schemas/mdbase.runtime.checkpoint/1.0.0.schema.json
implements:
  - contract: mdbase.runtime.checkpoint
    version: 1.0.0
    fields:
      type: type
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
