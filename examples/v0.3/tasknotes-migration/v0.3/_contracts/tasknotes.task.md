---
kind: mdbase.contract
contract_type: record
id: tasknotes.task
version: 0.2.0
name: TaskNotes task
description: Portable task fields and binding semantics used by TaskNotes.

record_schema:
  dialect: json-schema-2020-12
  value:
    $schema: "https://json-schema.org/draft/2020-12/schema"
    type: object
    required: [title, status, dateCreated]
    additionalProperties: false
    properties:
      title: { type: string, minLength: 1 }
      status: { type: string, minLength: 1 }
      priority: { type: string }
      due: { type: string, format: date }
      scheduled: { type: string, format: date }
      completedDate: { type: string, format: date }
      tags:
        type: array
        items: { type: string }
      contexts:
        type: array
        items: { type: string }
      projects:
        type: array
        items: { type: string }
      timeEstimate: { type: integer, minimum: 0 }
      dateCreated: { type: string, format: date-time }
      dateModified: { type: string, format: date-time }
      recurrence: { type: string }
      recurrenceAnchor: { type: string }
      recurrenceParent: { type: string }
      occurrenceDate: { type: string, format: date }
      occurrenceMaterialization: { type: string }
      occurrenceNextTrigger: { type: string }
      occurrenceTemplate: { type: string }
      occurrencePastHorizon: { type: string }
      occurrenceFutureHorizon: { type: string }
      completeInstances:
        type: array
        items: { type: string, format: date }
      skippedInstances:
        type: array
        items: { type: string, format: date }
      timeEntries:
        type: array
        items: { type: object }
      blockedBy:
        type: array
        items: { type: object }
      reminders:
        type: array
        items: { type: object }

binding_schema:
  dialect: json-schema-2020-12
  value:
    $schema: "https://json-schema.org/draft/2020-12/schema"
    type: object
    required: [status]
    additionalProperties: false
    properties:
      status:
        type: object
        required: [completed_values, default]
        additionalProperties: false
        properties:
          completed_values:
            type: array
            minItems: 1
            uniqueItems: true
            items: { type: string }
          default: { type: string }
      priority:
        type: object
        required: [default]
        additionalProperties: false
        properties:
          default: { type: string }
      archive:
        type: object
        required: [archived_tag]
        additionalProperties: false
        properties:
          archived_tag: { type: string, minLength: 1 }
---

# TaskNotes task

This example contract is packaged with the migrated type. The TaskNotes
specification owns the complete production contract.
