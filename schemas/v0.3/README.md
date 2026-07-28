# mdbase v0.3 Schemas

Draft canonical JSON Schemas for the side-by-side v0.3 rewrite.

These schemas validate frontmatter payloads and runtime envelopes. They are not
yet published package artifacts.

## Files

| Schema | Purpose |
| --- | --- |
| `type-file.schema.json` | frontmatter of `_types/*.md` v0.3 type files |
| `data-contract.schema.json` | first-class record, event, and action contract frontmatter in `_contracts/*.md` |
| `type-pack.schema.json` | transactional type-pack manifests |
| `query.schema.json` | portable query input objects |
| `query-result.schema.json` | query results plus optional context, view, grouping, and summary metadata |
| `record-document.schema.json` | complete authoritative record documents returned by read and successful mutations |
| `view.schema.json` | ordinary `type: view` record frontmatter |
| `conformance-claim.schema.json` | machine-readable implementation profile claims and evidence |
| `runtime/provider.schema.json` | provider contract records |
| `runtime/workflow.schema.json` | workflow records |
| `runtime/action.schema.json` | action contract records |
| `runtime/event.schema.json` | event contract records |
| `runtime/capability.schema.json` | capability contract records |
| `runtime/runtime-policy.schema.json` | runtime policy records |
| `runtime/run.schema.json` | materialized run records |
| `runtime/checkpoint.schema.json` | materialized checkpoint records |
| `runtime/timer.schema.json` | materialized generation-safe one-shot timers |
| `runtime/diagnostic.schema.json` | materialized runtime diagnostic records |
| `runtime/event-envelope.schema.json` | delivered runtime event envelopes |

The schemas are intentionally self-contained. Runtime contract record schemas
are strict about known fields and accept local/provider metadata through `x-*`
extension keys. Later package generation can factor common `$defs` into shared
files if that helps TypeScript/Rust codegen.
