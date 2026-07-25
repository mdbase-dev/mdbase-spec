---
type: chapter
id: 12-operations
title: "Operations"
description: "Create, Read, Update, Delete, Rename, batch operations, and initialization"
section: 12
conformance_levels: [1, 6]
test_categories: [operations, references, concurrency]
depends_on:
  - "[[09-validation]]"
  - "[[03-frontmatter]]"
  - "[[05-types]]"
---

# 12. Operations

This section defines the behavior of Create, Read, Update, Delete, and Rename operations on collection files.

---

## 12.1 Create

Creates a new file in the collection.

### Input

| Parameter | Required | Description |
|-----------|----------|-------------|
| `type` | No | Type name(s) for the file |
| `frontmatter` | Yes | Field values (may be partial) |
| `body` | No | Markdown body content |
| `path` | No | Target file path (may be derived) |

### Behavior

1. **Determine type(s)**: Use provided type, or infer from frontmatter if explicit type keys are present
   - Explicit type keys are defined by `settings.explicit_type_keys`
   - If `settings.explicit_type_keys` is empty, type inference relies solely on match rules

2. **Apply defaults**: For each missing field with a `default` value, apply the default to the **effective** record used for validation and output

3. **Generate values**: For fields with `generated` strategy:
   - `ulid`: Generate ULID
   - `uuid`: Generate UUID v4
   - `{random: N}`: Generate random string
   - `sequence`: Generate auto-incrementing integer
   - `now`: Set to current datetime
   - `{from, transform}`: Derive from source field

4. **Validate**: If validation level is not `off`:
   - Validate against all matched type schemas
   - If level is `error` and validation fails, abort

5. **Determine path**:
   - If `path` provided, use it
   - If type has `path_pattern` (or `filename_pattern` alias), derive from the **effective** frontmatter (including defaults and generated values)
   - Otherwise, require explicit path
   - If any pattern variable is unresolved (null/undefined/empty), fail with `path_required`

6. **Check match rules** (explicit type only, Level 2+):
   - If the type was specified explicitly (via input `type` or explicit type keys), the final record MUST satisfy that type's match rules (§6.3–§6.4) **when match rules are supported**
   - This check uses the **effective** frontmatter and the final path
   - If the record does not satisfy the match rules, abort with `match_failed`
   - Level 1 implementations MAY skip this step because match rule evaluation is a Level 2 capability

7. **Check existence**: If file already exists at path, abort with error

8. **Write file**:
   - Serialize frontmatter to YAML
   - If `settings.explicit_type_keys` is non-empty and no explicit type key is present in the frontmatter, implementations MUST write the type using the first key in `settings.explicit_type_keys`
   - If `settings.explicit_type_keys` is empty, implementations MUST NOT write any type declaration field
   - MUST include all explicitly provided fields and all generated fields
   - MUST write fields filled solely by defaults when `settings.write_defaults` is true (default); SHOULD omit them when `settings.write_defaults` is false
   - Ensure parent directories exist for the final path (create as needed)
   - Combine with body
   - Write atomically (temp file + rename)

### Output

The output MUST include the `path` field containing the final file path relative to the collection root.

```yaml
path: "tasks/task-001.md"
frontmatter:
  id: "01ARZ3NDEKTSV4RRFFQ69G5FAV"
  title: "Fix the bug"
  status: open
  created_at: "2024-03-15T10:30:00Z"
  # ... all fields including generated
```

### Errors

| Code | Description |
|------|-------------|
| `unknown_type` | Specified type doesn't exist |
| `validation_failed` | Validation errors (with details) |
| `path_conflict` | File already exists at target path |
| `path_required` | Cannot determine path |
| `match_failed` | Created record does not satisfy the specified type's match rules |

### Example

```bash
mdbase create task \
  --field title="Fix login bug" \
  --field priority=4 \
  --field "assignee=[[alice]]"
```

---

## 12.2 Read

Reads a file and returns its parsed content.

### Input

| Parameter | Required | Description |
|-----------|----------|-------------|
| `path` | Yes | File path relative to collection root |
| `validate` | No | Whether to validate (default: per settings) |
| `include_body` | No | Include body content (default: true) |

### Behavior

1. **Load file**: Read from filesystem
   - Reads respect collection scanning rules (`settings.include_subfolders`, `settings.exclude`, and `settings.types_folder`). If a path is excluded from the record set, read MUST return `file_not_found`.

2. **Parse frontmatter**: Extract YAML frontmatter and body

3. **Determine types**:
   - Check for explicit `type`/`types` field
   - If match rules are supported (Level 2+), evaluate match rules for all types
   - Collect matched types

4. **Validate** (if enabled):
   - Validate against all matched types
   - Collect validation issues

5. **Return record**: Structured representation
   - `frontmatter` is the **effective** frontmatter (defaults applied, computed fields excluded)
   - `file.properties` (see [Querying §10.5](./10-querying.md)) provides raw persisted frontmatter when needed

### Output

```yaml
path: "tasks/task-001.md"
types: [task]
frontmatter:
  id: "task-001"
  title: "Fix the bug"
  status: open
  # ... all fields
file:
  name: "task-001.md"
  folder: "tasks"
  display_name: "Fix the bug"
  mtime: "2024-03-15T10:30:00Z"
  size: 1234
body: "## Description\n\nThe login form..."
validation:
  valid: true
  issues: []
```

### Errors

| Code | Description |
|------|-------------|
| `file_not_found` | File doesn't exist |
| `invalid_frontmatter` | YAML parse error |

---

## 12.3 Update

Modifies an existing file's frontmatter and/or body.

### Input

| Parameter | Required | Description |
|-----------|----------|-------------|
| `path` | Yes | File path |
| `fields` | No | Field updates (partial) |
| `body` | No | New body content (null = no change) |

### Behavior

1. **Read existing file**: Load current content

2. **Merge fields**: Apply field updates to existing frontmatter
   - New fields are added
   - Existing fields are replaced
   - Explicit null removes the field (if `write_nulls: omit`) or writes null
   - If a required field is removed via null, validation MUST treat it as missing

3. **Determine types**: Use explicit type keys (per `settings.explicit_type_keys`) and match rules, including path-based matching
   - Updates MAY change match-relevant fields; reclassification is allowed and MUST NOT be treated as an error

4. **Update generated fields**: For fields with `generated: now_on_write`, update to current time

5. **Apply defaults**: For each missing field with a `default`, apply the default to the **effective** record used for validation and output

6. **Validate**: If enabled, validate merged frontmatter (using effective values for required checks)

7. **Write file**:
   - Preserve field order where possible
   - Preserve body if not provided
   - Write atomically

### Null Handling on Update

When updating a field to null:

| `write_nulls` setting | Behavior |
|-----------------------|----------|
| `"omit"` (default) | Remove the field from frontmatter |
| `"explicit"` | Write `field: null` |

**Important**: Never write the empty-value form `field:` (see [Frontmatter](./03-frontmatter.md)).

### Output

```yaml
path: "tasks/task-001.md"
frontmatter:  # Effective frontmatter (defaults applied, computed excluded)
  # ... updated frontmatter
previous:
  status: open
updated:
  status: done
```

### Errors

| Code | Description |
|------|-------------|
| `file_not_found` | File doesn't exist |
| `validation_failed` | Validation errors |

### Example

```bash
# Update single field
mdbase update tasks/task-001.md --field status=done

# Update multiple fields
mdbase update tasks/task-001.md \
  --field status=done \
  --field "completed_at=$(date -Iseconds)"

# Clear a field
mdbase update tasks/task-001.md --field assignee=null
```

---

## 12.4 Delete

Removes a file from the collection.

### Input

| Parameter | Required | Description |
|-----------|----------|-------------|
| `path` | Yes | File path |
| `check_backlinks` | No | Warn about incoming links (default: true) |

### Behavior

1. **Check existence**: Verify file exists

2. **Check backlinks** (if enabled):
   - Find files that link to this file
   - Warn user about potential broken links

3. **Delete file**: Remove from filesystem

### Output

```yaml
path: "tasks/task-001.md"
deleted: true
broken_links:
  - path: "tasks/parent.md"
    field: "subtasks"
```

### Errors

| Code | Description |
|------|-------------|
| `file_not_found` | File doesn't exist |

### Example

```bash
# Delete with confirmation
mdbase delete tasks/task-001.md

# Delete without backlink check
mdbase delete tasks/task-001.md --no-check-backlinks

# Force delete
mdbase delete tasks/task-001.md --force
```

---

## 12.5 Rename (and Move)

Renames or moves a file, optionally updating references across the collection.

### Input

| Parameter | Required | Description |
|-----------|----------|-------------|
| `from` | Yes | Current file path |
| `to` | Yes | New file path |
| `update_refs` | No | Update references (default: per settings) |

### Behavior

1. **Validate paths**: Ensure source exists and target doesn't

2. **Rename file**: Move file to new path atomically

3. **Update references** (if `rename_update_refs` is true):

   **Frontmatter links**: Update link fields in all files that reference the renamed file
   
   ```yaml
   # Before: links to tasks/old-name.md
   parent: "[[old-name]]"
   
   # After: file renamed to tasks/new-name.md
   parent: "[[new-name]]"
   ```

   **Body links**: Update link syntax in markdown body content
   
   ```markdown
   <!-- Before -->
   See [[old-name]] for details.
   Check [the task](./old-name.md).
   
   <!-- After -->
   See [[new-name]] for details.
   Check [the task](./new-name.md).
   ```

### Reference Update Rules

1. **Preserve link style**: 
   - Wikilinks stay as wikilinks
   - Markdown links stay as markdown links
   - Relative links stay relative when possible

2. **Update all matching references**:
   - By resolved path (most reliable)
   - By name when unambiguous

3. **ID-based links**:
   - If a simple-name link (`[[name]]`) resolves via `id_field` and the target file's
     `id_field` value did not change, implementations SHOULD NOT rewrite the link
     during rename (to avoid unnecessary churn).

4. **Handle ambiguity**:
   - If a link could refer to multiple files, don't update
   - Emit warning for manual review

5. **Scope**: Update references in ALL collection files, not just same folder

### Output

```yaml
from: "tasks/old-name.md"
to: "tasks/new-name.md"
references_updated:
  - path: "tasks/parent.md"
    field: "subtasks[0]"
    old_value: "[[old-name]]"
    new_value: "[[new-name]]"
  - path: "notes/meeting.md"
    location: "body"
    old_value: "[[old-name]]"
    new_value: "[[new-name]]"
warnings:
  - path: "archive/legacy.md"
    message: "Ambiguous link '[[name]]' not updated"
```

### Partial Reference Update Failure

When `update_refs` is enabled and some reference updates fail (e.g., due to concurrent modification or I/O errors on individual files), the rename operation returns a **partial success** response:

```yaml
from: "tasks/old-name.md"
to: "tasks/new-name.md"
references_updated:
  - path: "tasks/parent.md"
    field: "subtasks[0]"
    old_value: "[[old-name]]"
    new_value: "[[new-name]]"
ref_update_errors:
  - path: "notes/meeting.md"
    code: concurrent_modification
    message: "File was modified during reference update"
  - path: "docs/index.md"
    code: permission_denied
    message: "Cannot write to file"
error:
  code: rename_ref_update_failed
  message: "Rename succeeded but 2 reference updates failed"
```

The `rename_ref_update_failed` error code is returned alongside the successful rename result (`from`/`to`). The renamed file is at its new path. The `ref_update_errors` array provides per-file failure details including the file path and error code.

### Errors

| Code | Description |
|------|-------------|
| `file_not_found` | Source file doesn't exist |
| `path_conflict` | Target path already exists |
| `rename_ref_update_failed` | Rename succeeded but one or more reference updates failed (see above) |

### Example

```bash
# Simple rename
mdbase rename tasks/old.md tasks/new.md

# Move to different folder
mdbase rename tasks/task.md archive/task.md

# Rename without updating references
mdbase rename tasks/old.md tasks/new.md --no-update-refs

# Dry run (show what would change)
mdbase rename tasks/old.md tasks/new.md --dry-run
```

---

## 12.6 Atomicity

All write operations (Create, Update, Delete, Rename) SHOULD be atomic:

1. **Create/Update**: Write to temporary file, then rename
2. **Delete**: Single filesystem delete
3. **Rename**: Filesystem rename (atomic on most systems)

For Rename with reference updates, atomicity across multiple files is not guaranteed. Implementations SHOULD:
- Complete the rename first
- Update references file by file
- Report partial failures clearly

---

## 12.7 Batch Operations

Implementations MAY support batch operations for efficiency:

```bash
# Bulk update
mdbase update --where 'status == "open"' --field status=in_progress

# Bulk delete
mdbase delete --where 'tags.contains("archive")' --confirm

# Bulk move
mdbase move 'tasks/*.md' archive/
```

### Validation Phase

Before applying any changes, implementations MUST validate ALL affected files. If any file fails validation and `default_validation` is `error`, the entire batch MUST be aborted with no files modified.

### Execution Phase

After validation passes, apply changes file by file.

### Partial Failure

If a file write fails during execution (I/O error, concurrent modification):

- Implementations MUST NOT roll back already-written files (filesystem operations are not transactional)
- Implementations MUST continue processing remaining files (best-effort)
- Implementations MUST report per-file results: success, failure (with error code), or skipped

### Result Format

```yaml
batch_result:
  total: 50
  succeeded: 47
  failed: 2
  skipped: 1
  details:
    - path: "tasks/task-001.md"
      status: "success"
    - path: "tasks/task-002.md"
      status: "failed"
      error: { code: "concurrent_modification", message: "..." }
    - path: "tasks/task-003.md"
      status: "skipped"
      reason: "Depends on failed task-002.md"
```

### Dry-Run Mode

Batch operations MUST support `--dry-run` which validates all changes and reports what would happen without modifying any files.

---

## 12.8 Backfill (Level 6)

Backfill applies defaults and/or generated values to **missing** fields across many files. It is intended for schema evolution and migration workflows (see [§5.11.1](./05-types.md#5111-migration-manifests-level-6)).

### Input

| Parameter | Required | Description |
|-----------|----------|-------------|
| `type` | No | Type name to target (optional if `where` is provided) |
| `where` | No | Query filter expression to select files |
| `fields` | No | Specific fields to backfill (default: all fields with defaults/generated values) |
| `apply.defaults` | No | Apply default values to missing fields (default: true) |
| `apply.generated` | No | Apply generated values to missing fields (default: true) |
| `dry_run` | No | Validate and report changes without writing files |

### Behavior

1. **Select candidates**:
   - If `type` is provided, include files matching that type
   - If `where` is provided, filter candidates using the query expression
   - If neither is provided, the operation MUST fail with `invalid_request`

2. **Compute changes**:
   - Only **missing** fields are eligible for backfill
   - Explicit `null` values are considered present and are NOT backfilled
   - If `fields` is provided, only those fields are considered
   - If `apply.defaults` is true, apply defaults for missing fields
   - If `apply.generated` is true, apply generated values for missing fields (including `ulid`, `uuid`, `{random: N}`, `sequence`, `now`, `{from, transform}`)
   - If a file has no eligible missing fields, it MUST be reported as `skipped`

3. **Validate**:
   - Apply the backfill changes to the **effective** frontmatter
   - If `default_validation` is `error` and any file fails validation, abort the entire operation with no files modified

4. **Write** (unless `dry_run`):
   - Persist fields that were filled by backfill
   - Honor `settings.write_defaults` when writing default-filled fields
   - Preserve formatting per §12.9

### Output

Returns a batch-style result (same `batch_result` structure as §12.7, including `skipped` and per-file `details`):

```yaml
batch_result:
  total: 12
  succeeded: 10
  failed: 1
  skipped: 1
  details:
    - path: "tasks/a.md"
      status: "success"
      changed_fields: [status, id]
    - path: "tasks/b.md"
      status: "skipped"
      reason: "No missing fields to backfill"
    - path: "tasks/c.md"
      status: "failed"
      error: { code: "validation_failed", message: "..." }
```

### Errors

| Code | Description |
|------|-------------|
| `invalid_request` | Missing `type` and `where` |
| `validation_failed` | Validation errors (with details) |

---

## 12.9 Formatting Preservation

When writing files, implementations SHOULD preserve:

### MUST Preserve
- Body content (unless explicitly changed)
- Line ending style (LF vs CRLF)

### SHOULD Preserve
- Frontmatter field order
- String quoting style
- Multi-line string format (literal vs folded)
- Comments (if YAML parser supports it)

### MAY Normalize
- Indentation (recommend 2 spaces)
- Trailing whitespace
- Final newline (files SHOULD end with newline)

---

## 12.10 Hooks (Optional)

Implementations MAY support hooks for custom logic:

| Hook | When |
|------|------|
| `beforeCreate` | Before validation and write |
| `afterCreate` | After successful write |
| `beforeUpdate` | Before validation and write |
| `afterUpdate` | After successful write |
| `beforeDelete` | Before deletion |
| `afterDelete` | After successful deletion |
| `beforeRename` | Before rename |
| `afterRename` | After successful rename and ref updates |

Hooks receive operation context and can:
- Modify values (before hooks)
- Perform side effects (after hooks)
- Abort operation (before hooks, by throwing)

This is an OPTIONAL feature; implementations need not support hooks.

---

## 12.11 Concurrency

### Read-Modify-Write Cycle

When updating a file, implementations MUST detect concurrent modifications. The recommended approach is optimistic concurrency using file mtime:

1. Read file, record mtime
2. Apply changes in memory
3. Before writing, check that file mtime has not changed
4. If mtime changed, abort with `concurrent_modification` error
5. Write atomically (temp file + rename)

Implementations MAY use content hashing instead of mtime for more reliable conflict detection.

### Conflict Behavior

On detecting a concurrent modification, implementations MUST abort the operation and report `concurrent_modification`. Implementations MUST NOT silently overwrite concurrent changes.

Implementations MAY offer a retry mechanism (re-read, re-apply, re-check) but MUST NOT retry automatically without user/caller consent.

### Cross-File Operations

Rename with reference updates touches multiple files. These are NOT atomic across files. Implementations MUST:

1. Complete the primary rename first
2. Update references file by file
3. Use mtime checking on each referenced file before updating
4. Report partial failures — which files were updated and which were skipped due to conflicts

### File Locking

Implementations MAY use advisory file locks for write operations. If used:

- Locks MUST be released on operation completion (including error paths)
- Lock timeouts SHOULD be documented
- Implementations MUST NOT require locking for read operations

---

## 12.12 Init

Initializes a new collection in a directory.

### Input

| Parameter | Required | Description |
|-----------|----------|-------------|
| `path` | No | Directory to initialize (default: current working directory) |
| `config` | No | Configuration object or YAML string to write as `mdbase.yaml` |

If `config` is omitted, implementations MUST write a minimal configuration containing only `spec_version`.

### Behavior

1. Create `mdbase.yaml` at the collection root
2. Create the types folder (`settings.types_folder`, default `_types/`)
3. Create the meta type file in the types folder (see [§5.8](./05-types.md))

Init MUST be atomic with respect to other init operations. If another process has already initialized
the collection (or does so concurrently), init MUST fail with `path_conflict` rather than partially
overwriting existing files.

### Output

```yaml
path: "/path/to/collection"
config_path: "mdbase.yaml"
types_folder: "_types"
meta_type_path: "_types/meta.md"
```

### Errors

| Code | Description |
|------|-------------|
| `path_conflict` | Collection already exists at target path |
| `invalid_path` | Path is malformed |

---

## 12.13 Migrate (Level 6)

Applies a migration manifest in order. Migration manifests are defined in [§5.11.1](./05-types.md#5111-migration-manifests-level-6).

### Input

| Parameter | Required | Description |
|-----------|----------|-------------|
| `id` | No | Migration manifest ID (from manifest frontmatter) |
| `path` | No | Explicit path to a migration manifest file |
| `dry_run` | No | If true, execute backfill steps in dry-run mode |

Exactly one of `id` or `path` MUST be provided.

### Behavior

1. **Load manifest**:
   - If `path` is provided, load that file
   - If `id` is provided, search `settings.migrations_folder` for a manifest with matching `id`

2. **Validate manifest**:
   - Manifest frontmatter MUST contain `steps` as a list
   - Each step MUST include `id` and `op`
   - Unknown `op` values MUST fail with `invalid_migration`

3. **Execute steps in order**:
   - For `backfill` steps, run the Backfill operation (§12.8) with the step’s parameters
     - If `dry_run` is true on the migrate operation, it overrides the step’s `dry_run` to true
   - For schema-only steps (`add_field`, `rename_field`, `change_type`, `rename_type`, `move_path`), record the step as `manual` and continue
   - If any backfill step fails, stop execution and return `migration_failed`

### Output

The output MUST include:
- `migration_result.id`
- `migration_result.steps[]` with `id`, `op`, and `status`
- For `backfill` steps, `steps[].result.batch_result`

```yaml
migration_result:
  id: "2026-02-03-migrate-tasks"
  steps:
    - id: "add-status-field"
      op: add_field
      status: manual
    - id: "backfill-status"
      op: backfill
      status: success
      result:
        batch_result:
          total: 12
          succeeded: 12
          failed: 0
```

### Errors

| Code | Description |
|------|-------------|
| `invalid_request` | Missing or conflicting `id`/`path` |
| `invalid_migration` | Manifest is malformed or contains invalid steps |
| `migration_failed` | A step failed during execution (see details) |
