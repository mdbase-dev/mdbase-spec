---
kind: mdbase.contract
id: tasknotes.task
version: 0.2.0
name: Conflicting TaskNotes task
schema:
  dialect: json-schema-2020-12
  value:
    type: object
    required: [different]
    properties:
      different: { type: boolean }
---

# Deliberately conflicting contract fixture
