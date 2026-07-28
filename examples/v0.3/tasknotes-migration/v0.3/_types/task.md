---
kind: mdbase.type
name: task
version: 1
description: A task managed by TaskNotes for Obsidian.

match:
  fields_present: [title]

schema:
  dialect: json-schema-2020-12
  value:
    $schema: "https://json-schema.org/draft/2020-12/schema"
    type: object
    required: [title, status, dateCreated]
    additionalProperties: true
    properties:
      type:
        const: task
      title:
        type: string
        minLength: 1
        description: Short summary of the task.
      status:
        enum: [open, in-progress, done, cancelled]
        default: open
      priority:
        enum: [low, normal, high, urgent]
        default: normal
      due:
        type: string
        format: date
      scheduled:
        type: string
        format: date
      completedDate:
        type: string
        format: date
      tags:
        type: array
        items:
          type: string
      contexts:
        type: array
        items:
          type: string
      projects:
        type: array
        items:
          type: string
        description: Wikilinks to related project notes.
      timeEstimate:
        type: integer
        minimum: 0
        description: Estimated time in minutes.
      dateCreated:
        type: string
        format: date-time
      dateModified:
        type: string
        format: date-time
      recurrence:
        type: string
      recurrenceAnchor:
        enum: [scheduled, completion]
        default: scheduled
      recurrenceParent:
        type: string
      occurrenceDate:
        type: string
        format: date
      occurrenceMaterialization:
        enum: [manual, on_completion, rolling]
        default: manual
      occurrenceNextTrigger:
        enum: [completion, completion_or_skip]
        default: completion
      occurrenceTemplate:
        type: string
      occurrencePastHorizon:
        type: string
      occurrenceFutureHorizon:
        type: string
      completeInstances:
        type: array
        items:
          type: string
          format: date
      skippedInstances:
        type: array
        items:
          type: string
          format: date
      timeEntries:
        type: array
        items:
          type: object
          additionalProperties: false
          properties:
            startTime:
              type: string
              format: date-time
            endTime:
              type: string
              format: date-time
            description:
              type: string
            duration:
              type: integer
              minimum: 0
      reminders:
        type: array
        items:
          oneOf:
            - type: object
              required: [id, type, absoluteTime]
              additionalProperties: false
              properties:
                id: { type: string }
                type: { const: absolute }
                description: { type: string }
                absoluteTime: { type: string, format: date-time }
            - type: object
              required: [id, type, relatedTo, offset]
              additionalProperties: false
              properties:
                id: { type: string }
                type: { const: relative }
                description: { type: string }
                relatedTo: { enum: [due, scheduled] }
                offset: { type: string }
      blockedBy:
        type: array
        items:
          type: object
          required: [uid]
          additionalProperties: false
          properties:
            uid:
              type: string
            reltype:
              type: string
            gap:
              type: string

collection:
  display:
    name_field: title
  read_defaults:
    status: open
    priority: normal
    recurrenceAnchor: scheduled
    occurrenceMaterialization: manual
    occurrenceNextTrigger: completion
  links:
    projects[]:
      target_type: any
      validate_exists: false
    recurrenceParent:
      target_type: task
      validate_exists: false
    occurrenceTemplate:
      target_type: any
      validate_exists: false
    blockedBy[].uid:
      target_type: task
      validate_exists: false
  path:
    runtime: tasknotes
    template: "{{title}}"
    folder: "TaskNotes/Tasks"
    generated_by: tasknotes.filename.create

lifecycle:
  on_create:
    set:
      dateCreated: { now: true }
      dateModified: { now: true }
  on_update:
    set:
      dateModified: { now: true }

implements:
  - contract: tasknotes.task
    version: 0.2.0
    fields:
      title: title
      status: status
      priority: priority
      due: due
      scheduled: scheduled
      completedDate: completedDate
      tags: tags
      contexts: contexts
      projects: projects
      timeEstimate: timeEstimate
      dateCreated: dateCreated
      dateModified: dateModified
      recurrence: recurrence
      recurrenceAnchor: recurrenceAnchor
      recurrenceParent: recurrenceParent
      occurrenceDate: occurrenceDate
      occurrenceMaterialization: occurrenceMaterialization
      occurrenceNextTrigger: occurrenceNextTrigger
      occurrenceTemplate: occurrenceTemplate
      occurrencePastHorizon: occurrencePastHorizon
      occurrenceFutureHorizon: occurrenceFutureHorizon
      completeInstances: completeInstances
      skippedInstances: skippedInstances
      timeEntries: timeEntries
      blockedBy: blockedBy
      reminders: reminders
    binding:
      status:
        completed_values: [done, cancelled]
        default: open
      priority:
        default: normal
      archive:
        archived_tag: archived
---

# Task

Generated from TaskNotes settings. The JSON Schema section describes persisted
frontmatter shape. The `collection` section describes mdbase-aware behavior.
The `lifecycle` section describes managed writes. The `implements` section maps
the exact local `tasknotes.task` contract and carries schema-validated TaskNotes
binding semantics.
