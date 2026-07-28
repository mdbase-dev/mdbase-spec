---
kind: mdbase.type
name: invalid_binding_task
version: 1
match:
  path_glob: "invalid-binding/**/*.md"
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
---

# Invalid binding fixture
