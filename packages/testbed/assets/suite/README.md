# mdbase interoperability testbed 0.1

The testbed verifies observable behavior through a small process boundary. It
does not require implementations to share a language, runtime, database, or
plugin host, and it does not make fixture code authoritative.

## The three rings

1. **Contract** — load one record contract and type implementation, project one
   record, and prove that multiple independent consumers receive the same
   contract view.
2. **Interop** — register live sources, consumers, callers, and providers; then
   verify CloudEvents multicast, exact action admission, ambiguity, unload,
   validation, authorization, and replay behavior.
3. **Runtime** — exercise a durable store through crash recovery and competing
   workers, including invocation reuse and lease fencing.

Scenario JSON, not a particular implementation, defines the oracle. Every
scenario names neutral fixtures from `fixtures/catalog.json` and contains its
complete expected transcript. Volatile implementation details such as database
keys, wall-clock time, and generated IDs are reduced to stable facts before
comparison.

## Adapter process protocol

An adapter is an executable supporting two commands:

```text
adapter describe
adapter run
```

`describe` writes one JSON document conforming to
`adapter-description.schema.json`. For `run`, the testbed writes this JSON
request to standard input:

```json
{
  "kind": "mdbase.testbed.run",
  "protocol_version": "0.1",
  "scenario": {},
  "fixtures": {}
}
```

The adapter writes one transcript conforming to `transcript.schema.json`.
Diagnostic logging belongs on standard error; standard output contains only the
protocol document. Each `run` command is a fresh process, so scenarios cannot
pass because of hidden state left by another scenario.

Adapters MUST exercise public or documented implementation boundaries. They
MUST NOT copy the expected transcript without observing the behavior it
describes. A transcript is evidence of a named scenario, not authority to read,
write, publish, subscribe, invoke, or provide.

## Running

From this repository:

```bash
npm test --prefix packages/testbed
npm exec --prefix packages/testbed mdbase-testbed -- run --adapter reference
```

Against another implementation:

```bash
mdbase-testbed run --adapter ./path/to/adapter
```

If the adapter is launched through a language tool, use `command:NAME` and pass
its fixed arguments separately. The runner never invokes a shell:

```bash
mdbase-testbed run --adapter command:cargo \
  --adapter-arg run --adapter-arg --quiet \
  --adapter-arg -p --adapter-arg my-testbed-adapter --adapter-arg --
```

Use `mdbase-testbed list` to inspect the portable scenario inventory and
`mdbase-testbed validate` to validate every schema, fixture, scenario, and
canonical expected transcript.

Passing the testbed supplements the full v0.3 conformance suites. It does not by
itself establish a complete profile claim: implementations still run every
normative test for the profile they claim and attach the testbed transcript as
machine-readable evidence.
