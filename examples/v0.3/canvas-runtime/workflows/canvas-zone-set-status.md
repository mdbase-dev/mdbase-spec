---
type: runtime_workflow
id: canvas.zone.set-status
version: 1.0.0
name: Set task status from canvas zone
description: When a task card is dropped on a zone, patch the task status to the zone ID.
enabled: true

requires:
  capabilities:
    - mdbase.record.write

triggers:
  - id: drop-on-status-zone
    event:
      id: canvas.drop
      version: ^1.0.0
    if:
      $expr: 'has(event.data.file.path) && has(event.data.zone.id)'

steps:
  - id: patch-task-status
    action:
      id: mdbase.record.patch
      version: ^2.0.0
    requires:
      capabilities:
        - mdbase.record.write
    input:
      path:
        $expr: 'event.data.file.path'
      patch:
        status:
          $expr: 'event.data.zone.id'

run:
  idempotency:
    key:
      $expr: 'workflow.id + ":" + event.id + ":" + trigger.id'
  concurrency:
    group:
      $expr: 'event.data.file.path'
    policy: replace
  limits:
    timeout: 30s
    max_items: 1
  on_error: stop
---

# Set task status from canvas zone

This workflow is collection behavior. A canvas-aware runtime emits the event and
implements the patch action through the interoperability profile; the workflow
declares the mapping between them.
