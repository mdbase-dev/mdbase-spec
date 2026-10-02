---
kind: mdbase.type
name: note
version: 1
description: A note.
match:
  where:
    type: note
schema:
  dialect: json-schema-2020-12
  value:
    type: object
    required: [title]
    properties:
      title: { type: string }
    additionalProperties: true
---
# Note

A note in this collection.
