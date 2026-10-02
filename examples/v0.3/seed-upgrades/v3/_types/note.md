---
kind: mdbase.type
name: note
version: 3
description: A note with a creation date and tags.
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
      tags: { type: array, items: { type: string } }
    additionalProperties: true
---
# Note

A note in this collection.
