---
kind: mdbase.type
name: runtime_action_attempt
version: 1
description: Canonical Markdown implementation of mdbase.runtime.action-attempt.
match:
  where:
    type: runtime_action_attempt
schema:
  dialect: json-schema-2020-12
  ref: ../schemas/mdbase.runtime.action-attempt/1.0.0.schema.json
implements:
  - contract: mdbase.runtime.action-attempt
    version: 1.0.0
    fields:
      type: type
      id: id
      run_id: run_id
      step_id: step_id
      request_id: request_id
      invocation_id: invocation_id
      attempt_id: attempt_id
      contract: contract
      provider: provider
      provider_declaration_digest: provider_declaration_digest
      handler_id: handler_id
      idempotency_key: idempotency_key
      status: status
      request: request
      invocation: invocation
      outcome: outcome
      created_at: created_at
      updated_at: updated_at
      completed_at: completed_at
---

# Durable action attempt

This canonical type makes `runtime_action_attempt` records discoverable through
the ordinary mdbase record-contract registry.
