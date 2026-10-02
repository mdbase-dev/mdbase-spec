# Seed upgrade examples

Versions of one pack, `example.seed-notes`, whose seed `note` type changes from
v1 (`title`) to v2 (adds `created`) to v3 (adds `tags`). The type-pack
conformance fixtures install them in sequence to exercise `upgrade_from`
baselines, seed origins in the lock, and manifest validation (05A).

- `v1`, `v2`, `v3`: the starter at each version; v2 declares v1 as a single baseline object and v3 lists v2 and v1.
- `v1.5-plain`: ships the v2 starter without `upgrade_from`, so an installed
  seed is preserved and keeps its origin.
- `v3-only-v2`: v3 supporting upgrades only from v2.
- `invalid-*`: manifests (one rule each) that must be rejected with `invalid_type_pack`.

Pack sources are byte-exact; regenerate digests if a document changes.
