# `mdbase-interop`

Rust models and boundary validation for mdbase event/action interoperability
profile `0.1`.

The crate embeds release copies of the canonical schemas, validates
CloudEvents, action envelopes, source/provider declarations, cancellation, and
conformance claims, validates first-class contract artifacts, computes exact
contract digests, and validates event data against the resolved event contract.

It is not a bridge, workflow engine, transport, or authorization system.

```bash
cargo test --manifest-path packages/interop-rs/Cargo.toml
```
