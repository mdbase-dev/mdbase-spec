---
kind: mdbase.type
name: runtime_workflow
version: 2
description: Canonical Markdown implementation of mdbase.runtime.workflow.
match:
  where:
    type: runtime_workflow
schema:
  dialect: json-schema-2020-12
  ref: ../schemas/mdbase.runtime.workflow/1.1.0.schema.json
implements:
  - contract: mdbase.runtime.workflow
    version: 1.1.0
    fields:
      id: id
      version: version
      name: name
      description: description
      enabled: enabled
      requires: requires
      vars: vars
      triggers: triggers
      steps: steps
      run: run
---

# Durable workflow

This canonical type makes `runtime_workflow` records discoverable through
the ordinary mdbase record-contract registry.

Apps create these records by naming the type; the engine writes it under the
collection's configured explicit type key. The `match` rule also
recognises hand-written `type: runtime_workflow` records in collections
whose type key is something else.
