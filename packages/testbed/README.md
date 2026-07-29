# `@callumalpass/mdbase-testbed`

This package runs the portable mdbase interoperability testbed through a
black-box process adapter. The same JSON scenarios and canonical transcripts
are used for TypeScript, Rust, desktop, server, and plugin integrations.

```bash
npx @callumalpass/mdbase-testbed validate
npx @callumalpass/mdbase-testbed run --adapter reference
npx @callumalpass/mdbase-testbed run --adapter ./my-adapter
```

Language launchers are supported without a shell. For example:

```bash
mdbase-testbed run --adapter command:cargo \
  --adapter-arg run --adapter-arg --quiet \
  --adapter-arg -p --adapter-arg mdbase-testbed-adapter --adapter-arg --
```

An adapter implements `describe` and `run`, reads a run request from standard
input, and writes one validated transcript to standard output. See the
[testbed protocol](https://mdbase.dev/testbed/v0.1/README.md). The
`mdbase-testbed-reference` binary is a bundled executable example.

The runner:

- validates every scenario, fixture, adapter description, request, transcript,
  and evidence document against Draft 2020-12 JSON Schema;
- starts a fresh adapter process for each scenario;
- compares only stable observable transcript entries;
- can emit digest-bound evidence with `--evidence <path>`.

Passing these scenarios is supplemental evidence. A complete profile claim
still requires every normative conformance test named by that profile.
