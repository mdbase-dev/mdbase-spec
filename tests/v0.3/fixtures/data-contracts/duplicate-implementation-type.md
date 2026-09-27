---
kind: mdbase.type
name: duplicated_task
version: 1
match:
  path_glob: "duplicated/**/*.md"
schema:
  dialect: json-schema-2020-12
  value:
    type: object
    required: [title, status, dateCreated]
    properties:
      title: { type: string }
      status: { type: string }
      dateCreated: { type: string, format: date-time }
implements:
  - contract: tasknotes.task
    version: 0.2.0
    fields:
      title: title
      status: status
      dateCreated: dateCreated
    binding:
      status:
        completed_values: [done]
        default: open
  - contract: tasknotes.task
    version: ^0.2.0
    fields:
      title: title
      status: status
      dateCreated: dateCreated
    binding:
      status:
        completed_values: [done]
        default: open
---

# Duplicate implementation fixture

A type implements each contract ID at most once, whatever versions the
entries request.
