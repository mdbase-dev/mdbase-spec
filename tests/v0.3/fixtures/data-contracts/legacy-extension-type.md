---
kind: mdbase.type
name: legacy_task
version: 1
match:
  path_glob: "legacy/**/*.md"
schema:
  dialect: json-schema-2020-12
  value:
    type: object
    properties:
      title: { type: string }
x-tasknotes:
  contract: tasknotes.task
  version: 1
---

# Legacy extension fixture
