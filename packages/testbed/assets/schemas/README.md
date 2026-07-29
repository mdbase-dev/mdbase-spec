# mdbase interoperability testbed schemas

These Draft 2020-12 schemas define portable testbed protocol `0.1`:

- `scenario.schema.json` validates neutral, spec-owned scenario definitions.
- `fixture-catalog.schema.json` validates the shared input catalog.
- `adapter-description.schema.json` validates the capabilities reported by a
  black-box adapter.
- `run-request.schema.json` validates the complete input sent to an adapter.
- `transcript.schema.json` validates deterministic observable results.
- `evidence.schema.json` validates the digest-bound run summary suitable for a
  conformance claim.

The process protocol and conformance rules are defined in
[`testbed/v0.1/README.md`](../../../testbed/v0.1/README.md).
