---
kind: mdbase.type
name: pickle_response_ack
version: 1
description: Acknowledge that a Pickle message was read.
schema:
  dialect: json-schema-2020-12
  value:
    $schema: https://json-schema.org/draft/2020-12/schema
    type: object
    additionalProperties: true
    properties:
      type:
        const: pickle_response_ack
      id:
        type: string
      request:
        type: string
      message:
        type: string
      responded_at:
        type: string
        format: date-time
      responder:
        type: string
      attachment_paths:
        type: array
        items:
          type: string
    required:
      - request
collection:
  display:
    name_field: message
  links:
    request:
      target_type: pickle_request
      validate_exists: true
  unique:
    - field: id
      scope: collection
lifecycle:
  on_create:
  - if: '!has(raw.id)'
    set:
      id:
        ulid: true
  - if: '!has(raw.responded_at)'
    set:
      responded_at:
        now: true
---

