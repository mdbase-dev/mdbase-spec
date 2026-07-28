# 17. Promotion Plan

> **Status:** Completed locally on 2026-07-16. The v0.3 chapters are now the
> root specification, the complete v0.2 specification is archived under
> `v0.2/`, and the site builds both current and archived specifications. See
> `release/v0.3.0.md` for release qualification status.

## Purpose

This document records the promotion procedure used to replace the published
v0.2.x root specification with v0.3 while preserving the earlier contract.

Promotion is the process that turns the side-folder draft into the repository's
published specification while preserving the v0.2.x contract for existing
implementers.

## Promotion Principle

Do not mix v0.2.x and v0.3 chapters in the same numbered root spec.

At promotion time the repository should have one obvious current spec and one
obvious archived legacy spec. Root-level numbered chapters should describe the
published current version only.

## Recommended Repository Shape

Before promotion:

```text
00-overview.md ... 16-runtime-profile.md   # published v0.2.x
v0.3/00-overview.md ... v0.3/16-conformance.md # draft v0.3
schemas/v0.3/
examples/v0.3/
tests/v0.3/
packages/
```

After promotion:

```text
00-overview.md ... 16-conformance.md       # published v0.3
v0.2/00-overview.md ...                    # archived v0.2.x
schemas/v0.3/
examples/v0.3/
tests/v0.3/
packages/
```

The old `16-runtime-profile.md` should move into the v0.2 archive. The v0.3
runtime model is split across the runtime contract and workflow chapters.

## Promotion Gates

Promotion should not happen until all of these are true:

- `schemas/v0.3/type-file.schema.json` validates the canonical v0.3 type wrapper.
- all schemas under `schemas/v0.3/runtime/` validate as Draft 2020-12.
- all example v0.3 type files and runtime records validate against those schemas.
- embedded JSON Schemas in v0.3 type files, action contracts, and event contracts
  validate as Draft 2020-12.
- `examples/v0.3/canvas-runtime/` loads and preflights without diagnostics.
- `examples/v0.3/tasknotes-migration/` has a checked migration report produced by
  the prototype migration logic.
- the v0.3 conformance suite under `tests/v0.3/` passes its artifact checks.
- runtime contract helper tests pass.
- CEL host helper tests pass.
- the public site can build from the promoted file layout.

Current local command set:

```bash
python3 scripts/check_v03_tests.py
python3 scripts/prototype_tasknotes_v03_migration.py --check-fixture
npm test --prefix packages/runtime-contracts
cargo test --manifest-path packages/runtime-contracts-rs/Cargo.toml
npm test --prefix packages/cel-host
npm run build --prefix site
```

## File Promotion Steps

1. Create `v0.2/` and move the current root numbered spec files and appendices
   into it.
2. Move the v0.3 chapters from `v0.3/` to the root numbered spec location.
3. Decide whether the root chapter sequence keeps the v0.3 names or uses the old
   v0.2 names for compatible topics. The recommended current sequence is the
   v0.3 sequence, because it reflects the new architecture:
   `00-overview` through `16-conformance`.
4. Update root `README.md` to say the repository is `0.3.0` or `1.0.0`,
   depending on release status, and point legacy implementers to `v0.2/`.
5. Update `site/build.mjs` so the spec page reads the promoted v0.3 root files
   and either links to the v0.2 archive or omits it from the main sidebar.
6. Update any docs, release notes, and npm package metadata that name v0.2.x as
   the current version.
7. Keep `tests/level-*` as `tests/v0.2/` or clearly label them legacy. Keep
   `tests/v0.3/` as the current v0.3 suite until it is ready to become the default
   reference runner input.
8. Keep `schemas/v0.3/`, `examples/v0.3/`, and the prototype packages under their
   existing paths unless package publishing requires a separate workspace
   layout.

## Compatibility Position

v0.3 is source-level incompatible with v0.2.x type files. The migration story is
not automatic silent conversion. Tools should:

- continue to read v0.2.x collections during the transition where practical;
- detect v0.2.x type files by the old `fields` grammar;
- offer dry-run migration reports before writes;
- rewrite generated type files only when generated-file detection or explicit
  user approval is present;
- preserve unknown private domain metadata as `x-*`; portable interfaces use
  first-class data contracts and type-local `implements` entries.

## Site Promotion Notes

The current site builder has a hardcoded `SPEC_FILES` list. Promotion needs a
small site change, not just file moves.

The least surprising site behavior is:

- `/spec.html` shows the promoted v0.3 spec.
- the homepage names v0.3 as current and links to the v0.2 archive.
- legacy v0.2 docs remain reachable from a stable archive URL.
- the runtime page points at the v0.3 runtime contract and workflow chapters, not
  the old draft `16-runtime-profile.md`.

## Completion Criteria

Promotion is complete when:

- the repository root contains only the current v0.3 numbered spec;
- the v0.2.x spec is archived and linked;
- the site builds from the promoted layout;
- all commands in the promotion gate list pass;
- README, changelog/release notes, schemas, examples, and tests agree about the
  current version and migration status.
