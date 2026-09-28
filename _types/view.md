---
kind: mdbase.type
name: view
version: 1
description: A portable named collection of executable mdbase views.

match:
  where:
    type: view

schema:
  dialect: json-schema-2020-12
  ref: "../schemas/v0.3/view.schema.json"

implements:
  - contract: mdbase.view
    version: 1.0.0
    fields:
      id: id
      version: version
      name: name
      description: description
      query: query
      properties: properties
      summary_functions: summary_functions
      views: views

collection:
  display:
    name_field: name
---

# View

A view record stores shared query scope and one or more stable named views.
Each named view resolves to the query model in Chapter 11. Optional
`presentation` metadata is advisory and does not alter headless query results.

View records are ordinary Markdown records. This canonical type makes them
discoverable through the `mdbase.view` record contract. A collection may use a
different type name, match rule, or field names by declaring its own
implementation of that contract.
