# Runtime executor reference

This private package demonstrates the runtime 0.2 boundary. It admits a
standard `runtime_workflow`, pins exact source/provider evidence, and invokes
actions through an `InteropClient`.

It is intentionally non-durable. Conformant production hosts must additionally
implement atomic event/run admission, persistence, leases, retries, recovery,
generation-safe timers, cancellation, cursors, and indeterminate outcomes as
specified in Chapters 13 and 14.
