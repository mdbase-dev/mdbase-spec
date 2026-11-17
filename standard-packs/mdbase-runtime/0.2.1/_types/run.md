---
kind: mdbase.type
name: runtime_run
version: 2
description: Canonical Markdown implementation of mdbase.runtime.run.
match:
  where:
    type: runtime_run
schema:
  dialect: json-schema-2020-12
  ref: ../schemas/mdbase.runtime.run/1.1.0.schema.json
implements:
  - contract: mdbase.runtime.run
    version: 1.1.0
    fields:
      id: id
      workflow_id: workflow_id
      workflow_version: workflow_version
      workflow_revision: workflow_revision
      event_id: event_id
      event_contract: event_contract
      event_source: event_source
      admitted_plan: admitted_plan
      policy_id: policy_id
      policy_revision: policy_revision
      trigger_id: trigger_id
      event_cursor: event_cursor
      executor: executor
      idempotency_key: idempotency_key
      concurrency_group: concurrency_group
      status: status
      created_at: created_at
      updated_at: updated_at
      started_at: started_at
      finished_at: finished_at
      lease: lease
---

# Durable run

This canonical type makes `runtime_run` records discoverable through
the ordinary mdbase record-contract registry.

Apps create these records by naming the type; the engine writes it under the
collection's configured explicit type key. The `match` rule also
recognises hand-written `type: runtime_run` records in collections
whose type key is something else.
