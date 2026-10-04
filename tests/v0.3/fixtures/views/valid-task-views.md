---
type: view
id: tasknotes.tasks
version: 1
name: Task views
description: Portable task queries with optional TaskNotes presentation.

query:
  types: [task]
  context:
    this:
      on_missing: view
  projections:
    urgency:
      expr: 'priority + (due != null && due < today() ? 10 : 0)'

properties:
  title:
    label: Task
  projection.urgency:
    label: Urgency

summary_functions:
  completion_rate:
    expr: 'values.size() == 0 ? 0 : values.filter(v, v).size() * 100 / values.size()'

views:
  - id: all
    name: All tasks
    select: [title, status, due, projection.urgency]
    order_by:
      - field: due
        direction: asc
    presentation:
      type: tasknotes.task-list
      fallback: mdbase.table
      options:
        show_actions: true

  - id: subtasks
    name: Subtasks
    context:
      this:
        on_missing: error
        types: [project]
    where: 'projects.exists(p, p == this.file.asLink())'
    select: [title, status, projection.urgency]
    group_by:
      - field: status
        direction: asc
    summaries:
      - field: title
        function: count
        name: task_count
    presentation:
      type: tasknotes.kanban
      fallback: mdbase.table
      mappings:
        title: title
        group: status

x-obsidian:
  source_format: base
---

# Task views

Shared task views for query tools and supporting renderers.
