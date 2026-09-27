---
kind: mdbase.type
name: pickle_response_approval
version: 1
description: Approve, reject, or request revision for a Pickle request.
schema:
  dialect: json-schema-2020-12
  value:
    $schema: https://json-schema.org/draft/2020-12/schema
    type: object
    additionalProperties: true
    properties:
      type:
        const: pickle_response_approval
      id:
        type: string
      request:
        type: string
      decision:
        enum:
          - approve
          - reject
          - revise
      comment:
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
      - decision
collection:
  display:
    name_field: decision
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

