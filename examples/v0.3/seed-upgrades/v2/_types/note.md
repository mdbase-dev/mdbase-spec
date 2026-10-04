---
kind: mdbase.type
name: note
version: 2
description: A note with a creation date.
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
      created: { type: string, format: date-time }
    additionalProperties: true
---
# Note

A note in this collection.
