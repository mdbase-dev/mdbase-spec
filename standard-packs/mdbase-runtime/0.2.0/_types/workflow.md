---
kind: mdbase.type
name: runtime_workflow
version: 1
description: Canonical Markdown implementation of mdbase.runtime.workflow.
match:
  where:
    type: runtime_workflow
schema:
  dialect: json-schema-2020-12
  ref: ../schemas/mdbase.runtime.workflow/1.0.0.schema.json
implements:
  - contract: mdbase.runtime.workflow
    version: 1.0.0
    fields:
      type: type
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
