---
kind: mdbase.type
name: meta
version: 1
description: v0.3 type file wrapper.

match:
  path_glob: "_types/**/*.md"

schema:
  dialect: json-schema-2020-12
  ref: "../schemas/v0.3/type-file.schema.json"
---

# Meta

Validates v0.3 type file frontmatter.
