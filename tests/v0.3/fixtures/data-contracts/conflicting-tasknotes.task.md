---
kind: mdbase.contract
contract_type: record
id: tasknotes.task
version: 0.2.0
name: Conflicting TaskNotes task
record_schema:
  dialect: json-schema-2020-12
  value:
    type: object
    required: [different]
    properties:
      different: { type: boolean }
---

# Deliberately conflicting contract fixture
