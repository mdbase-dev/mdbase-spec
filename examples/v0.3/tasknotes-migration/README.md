# TaskNotes Task Type Migration Example

This fixture shows the intended v0.2-to-v0.3 migration shape for TaskNotes'
generated mdbase export.

It is not a TaskNotes implementation. It is a concrete target for migration
tooling and downstream package discussions.

## Files

| Path | Purpose |
| --- | --- |
| `current-v0.2/mdbase.yaml` | representative current generated config |
| `current-v0.2/_types/task.md` | representative old custom-field type |
| `v0.3/mdbase.yaml` | v0.3 config shape |
| `v0.3/_contracts/tasknotes.task.md` | exact TaskNotes data contract |
| `v0.3/_types/meta.md` | v0.3 type wrapper metadata |
| `v0.3/_types/task.md` | migrated v0.3 task type |
| `v0.3/mdbase-pack.yaml` | transactional contract-and-type installation manifest |
| `migration-report.json` | machine-readable explanation of the mapping |

## Important Moves

- `fields.*` becomes JSON Schema `properties`.
- Field-level `required` becomes the JSON Schema root `required` array.
- Static defaults are represented as JSON Schema `default` annotations and
  `collection.read_defaults`.
- `generated` timestamps move to `lifecycle`.
- `type: link` fields become string shapes plus `collection.links`.
- TaskNotes semantic roles move from per-field `tn_role` to the type's
  `implements[].fields` map.
- Reminder variants use JSON Schema `oneOf` and `const`.
- TaskNotes binding semantics validate against the contract's
  `binding_schema`.

## Review Use

This fixture should be used to test migration tooling before touching the
TaskNotes generator. A future migrator should be able to produce the v0.3
contract and type files plus a report very close to `migration-report.json`.
