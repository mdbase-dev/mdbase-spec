---
kind: mdbase.type
name: runtime_timer
version: 1
description: Canonical Markdown implementation of mdbase.runtime.timer.
match:
  where:
    type: runtime_timer
schema:
  dialect: json-schema-2020-12
  ref: ../schemas/mdbase.runtime.timer/1.0.0.schema.json
implements:
  - contract: mdbase.runtime.timer
    version: 1.0.0
    fields:
      type: type
      id: id
      generation: generation
      status: status
      fire_at: fire_at
      event: event
      missed_run_policy: missed_run_policy
      created_at: created_at
      updated_at: updated_at
      fired_at: fired_at
---

# Runtime timer

This canonical type makes `runtime_timer` records discoverable through
the ordinary mdbase record-contract registry.
