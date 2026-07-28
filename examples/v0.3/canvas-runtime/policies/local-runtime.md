---
type: runtime_policy
id: local.canvas-runtime.policy
version: 1.0.0
name: Local canvas runtime policy
enabled: true

executors:
  default: obsidian
  workflows:
    canvas.zone.set-status: obsidian

provider_selections:
  - contract:
      id: mdbase.record.patch
      version: ^2.0.0
    selector:
      application: mdbase
      implementation: core

grants:
  - capability: mdbase.record.write
    mode: allow
    actions:
      - id: mdbase.record.patch
        version: ^2.0.0
    providers:
      - application: mdbase
        implementation: core
    max_records_per_run: 1
---

# Local canvas runtime policy

This policy allows the local canvas runtime to patch one record per drop event.
