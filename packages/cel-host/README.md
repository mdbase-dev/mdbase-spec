# @mdbase/cel-host

Prototype host-binding package for the mdbase v0.3 CEL profile.

This package exists to make the CEL boundary concrete. It builds the activation
object that mdbase passes to a CEL engine and evaluates expressions through
`@bufbuild/cel`.

## Activation Shape

Record expressions receive:

- effective frontmatter fields at the top level, for ergonomic filters such as
  `status == "open"`
- `record`: effective frontmatter, including `collection.read_defaults`
- `raw`: persisted frontmatter only
- `note`: alias for `record`
- `present`: boolean presence maps for `raw`, `record`, and `note`
- `file`: file metadata, body, tags, links, and embeds

System bindings shadow same-named frontmatter fields at the top level. Use
`record.<field>` or `raw.<field>` for unambiguous access when a collection has a
frontmatter field named `file`, `raw`, `record`, `note`, or `present`.

Record presence checks use `present`:

- `present.raw.status` is true when `status` exists in persisted frontmatter,
  even if its value is null
- `present.record.status` is true when `status` exists in the effective record,
  including values supplied by `collection.read_defaults`
- `has(event.data.file.path)` checks runtime event payload presence

Bare `has(status)` is not portable CEL and is not part of the mdbase v0.3 profile.
`has(raw.status)` is also insufficient for mdbase record presence because some
CEL engines treat null map values as not present. Tools should materialize
boolean `present.*` entries for all schema-known fields, persisted fields, and
defaulted fields.

Workflow expressions receive:

- `event`
- `steps`
- `vars`
- optional `item`

## Local Verification

```bash
npm test --prefix packages/cel-host
```
