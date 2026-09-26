---
kind: mdbase.type
name: pickle_request
version: 1
description: Async request that needs a human response.
schema:
  dialect: json-schema-2020-12
  value:
    $schema: https://json-schema.org/draft/2020-12/schema
    type: object
    additionalProperties: true
    properties:
      type:
        const: pickle_request
      id:
        type: string
      title:
        type: string
      source:
        type: string
      message:
        type: string
      kind:
        enum:
          - approval
          - choice
          - input
          - notice
          - message
      status:
        enum:
          - pending
          - answered
          - cancelled
        description: Legacy lifecycle marker. Response links are authoritative for answered state.
      priority:
        enum:
          - low
          - normal
          - high
          - urgent
      response_type:
        type: string
      created_at:
        type: string
        format: date-time
      due_at:
        type: string
        format: date-time
      dedupe_key:
        type: string
      tags:
        type: array
        items:
          type: string
      links:
        type: array
        items:
          type: object
          additionalProperties: false
          properties:
            label:
              type: string
            url:
              type: string
            path:
              type: string
      attachment_paths:
        type: array
        items:
          type: string
      metadata:
        type: object
        additionalProperties: true
      context:
        type: object
        additionalProperties: false
        properties:
          cwd:
            type: string
          repo:
            type: string
          task:
            type: string
    required:
      - title
      - response_type
collection:
  display:
    name_field: title
  unique:
    - field: id
      scope: collection
lifecycle:
  on_create:
  - if: '!has(raw.id)'
    set:
      id:
        ulid: true
  - if: '!has(raw.created_at)'
    set:
      created_at:
        now: true
---

