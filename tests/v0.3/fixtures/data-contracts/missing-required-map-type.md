---
kind: mdbase.type
name: incomplete_task
version: 1
match:
  path_glob: "incomplete/**/*.md"
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
      status: status
      dateCreated: dateCreated
    binding:
      status:
        completed_values: [done]
        default: open
---

# Missing required field map fixture
