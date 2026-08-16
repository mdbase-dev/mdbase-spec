---
type: appendix
id: appendix-c-error-codes
title: "Error Codes"
description: "Standard error codes for validation issues and operation errors"
letter: c
normative: false
depends_on:
  - "[[09-validation]]"
  - "[[12-operations]]"
---

# Appendix C: Error Codes

This appendix defines standard error codes for validation issues and operation errors.

---

## C.1 Validation Error Codes

### Field Errors

| Code | Description | Example |
|------|-------------|---------|
| `missing_required` | Required field is absent or null | Field `title` is required |
| `type_mismatch` | Value doesn't match declared type | Expected integer, got string |
| `constraint_violation` | Value violates min/max/pattern/etc | Value 7 exceeds max of 5 |
| `invalid_enum` | Value not in enum options | "pending" not in [open, done] |
| `unknown_field` | Field not in schema (strict mode) | Unknown field "custom" |
| `deprecated_field` | Field is marked deprecated | Field "old_name" is deprecated |
| `duplicate_id` | `id_field` value is not unique in collection | `id: task-001` appears in multiple files |
| `duplicate_value` | Field value violates cross-file `unique` constraint | `slug: "my-post"` appears in multiple files |

### List Errors

| Code | Description | Example |
|------|-------------|---------|
| `list_too_short` | List has fewer than min_items | Minimum 1 item required |
| `list_too_long` | List has more than max_items | Maximum 10 items allowed |
| `list_duplicate` | Duplicate in list with unique=true | Duplicate value "a" |
| `list_item_invalid` | List item fails `items` validation (item-level cause may be included) | Item [2] type mismatch |

### String Errors

| Code | Description | Example |
|------|-------------|---------|
| `string_too_short` | String shorter than min_length | Minimum 1 character required |
| `string_too_long` | String longer than max_length | Maximum 200 characters allowed |
| `pattern_mismatch` | String doesn't match pattern | Must match "^[A-Z].*" |

### Number Errors

| Code | Description | Example |
|------|-------------|---------|
| `number_too_small` | Number below min | Value -1 below min of 0 |
| `number_too_large` | Number above max | Value 100 above max of 10 |
| `not_integer` | Expected integer, got float | 3.5 is not an integer |

### Link Errors

| Code | Description | Example |
|------|-------------|---------|
| `invalid_link` | Link cannot be parsed | Malformed wikilink |
| `link_not_found` | Link target doesn't exist | Target "[[missing]]" not found |
| `link_wrong_type` | Target is wrong type | Expected person, found task |
| `ambiguous_link` | Multiple candidates exist at the first populated simple-name lookup priority; resolution fails closed | "[[note]]" matches notes/note.md and archive/note.md |

### Date/Time Errors

| Code | Description | Example |
|------|-------------|---------|
| `invalid_date` | Cannot parse as date | "tomorrow" is not ISO date |
| `invalid_datetime` | Cannot parse as datetime | Invalid datetime format |
| `invalid_time` | Cannot parse as time | Invalid time format |

---

## C.2 Type System Errors

| Code | Description | Example |
|------|-------------|---------|
| `unknown_type` | Type name not defined | Type "taks" not found |
| `circular_inheritance` | Type inheritance forms cycle | task → base → task |
| `missing_parent_type` | Parent type doesn't exist | Parent "base" not found |
| `type_conflict` | Multi-type field incompatibility | "status" defined as string and enum |
| `invalid_type_definition` | Type file has invalid schema | Missing required "name" field |
| `circular_computed` | Circular dependency between computed fields | `full_name` depends on `display` depends on `full_name` |

---

## C.3 Operation Errors

### File Operations

| Code | Description | Example |
|------|-------------|---------|
| `file_not_found` | File doesn't exist | tasks/missing.md not found |
| `path_conflict` | File already exists at target path (on create or rename) | tasks/task.md already exists |
| `path_required` | Cannot determine file path | No path provided or derivable |
| `invalid_path` | Path is malformed (e.g., null bytes, control characters) | Path contains invalid characters |
| `invalid_frontmatter` | Frontmatter YAML cannot be parsed | YAML syntax error in frontmatter |
| `validation_failed` | Frontmatter fails validation against type schema(s) | Contains individual validation issues (see §C.1) |
| `invalid_request` | Operation input is missing required parameters or is otherwise invalid | Backfill requires `type` or `where` |
| `invalid_migration` | Migration manifest is malformed or contains invalid steps | Missing `steps` array |
| `migration_failed` | Migration step failed during execution | Backfill step failed validation |
| `permission_denied` | Filesystem permission error | Cannot write to file |
| `concurrent_modification` | File was modified by another process during operation | File mtime changed between read and write |
| `path_traversal` | Path resolution would escape collection root. Applies to any path resolution — link resolution, operation input paths, computed paths | `[[../../../etc/passwd]]` escapes root |
| `match_failed` | Created record does not satisfy explicit type match rules | Type match rules not satisfied by final record |

### Rename Operations

| Code | Description | Example |
|------|-------------|---------|
| `rename_ref_update_failed` | Reference update failed for one or more files | Could not update links in X |

### Configuration Errors

| Code | Description | Example |
|------|-------------|---------|
| `invalid_config` | Config file malformed | YAML parse error |
| `missing_config` | No mdbase.yaml found | Not a collection |
| `unsupported_version` | spec_version not supported | Version 0.3.0 not supported |

---

## C.4 Expression Errors

| Code | Description | Example |
|------|-------------|---------|
| `invalid_expression` | Expression syntax error | Unexpected token |
| `unknown_function` | Function doesn't exist | Unknown function "foo" |
| `wrong_argument_count` | Wrong number of arguments | if() requires 3 arguments |
| `type_error` | Type error in expression | Cannot add string and number |
| `expression_depth_exceeded` | Expression nesting or traversal exceeded maximum depth | General expression nesting exceeds 64-level limit (see [§11.18.1](./11-expressions.md#11181-general-expression-nesting-limit)), or chained `asFile()` calls exceed 10-hop limit (see [§8.7](./08-links.md)) |

---

## C.5 Formula Errors

| Code | Description | Example |
|------|-------------|---------|
| `circular_formula` | Formula references form cycle | a refs b refs a |
| `invalid_formula` | Formula expression invalid | Parse error in formula |
| `formula_evaluation_error` | Runtime error in formula | Division by zero |

---

## C.6 Error Response Format

Errors SHOULD be returned in a consistent format:

### Single Error

```json
{
  "error": {
    "code": "file_not_found",
    "message": "File 'tasks/missing.md' not found",
    "path": "tasks/missing.md"
  }
}
```

### Validation Errors

```json
{
  "valid": false,
  "errors": [
    {
      "path": "tasks/task-001.md",
      "field": "priority",
      "code": "constraint_violation",
      "message": "Value 7 exceeds maximum of 5",
      "severity": "error",
      "expected": { "max": 5 },
      "actual": 7,
      "type": "task",
      "line": 5,
      "column": 11,
      "end_line": 5,
      "end_column": 12
    },
    {
      "path": "tasks/task-001.md",
      "field": "custom_field",
      "code": "unknown_field",
      "message": "Field 'custom_field' is not defined in type 'task'",
      "severity": "warning",
      "type": "task",
      "line": 8,
      "column": 1,
      "end_line": 8,
      "end_column": 27
    }
  ],
  "warnings": 1,
  "errorCount": 1
}
```

---

## C.7 Error Severity

| Severity | Description | Effect |
|----------|-------------|--------|
| `error` | Definite problem | Fails validation at error level |
| `warning` | Potential problem | Reported but doesn't fail |
| `info` | Informational | Logged, no effect |

---

## C.8 Human-Readable Messages

Error messages SHOULD be:

1. **Clear**: State what went wrong
2. **Specific**: Include relevant values
3. **Actionable**: Suggest how to fix

**Good example:**
```
Field 'priority' has value 7, but maximum allowed is 5.
Change the value to 5 or less.
```

**Bad example:**
```
Constraint violation on priority.
```

---

## C.9 Exit Codes (CLI)

For CLI implementations:

| Code | Description |
|------|-------------|
| 0 | Success |
| 1 | General error |
| 2 | Validation error(s) |
| 3 | Configuration error |
| 4 | File not found |
| 5 | Permission denied |
