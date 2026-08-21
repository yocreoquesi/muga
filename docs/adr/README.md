# Architecture Decision Records

Decisions that shaped MUGA's architecture, in chronological order. Each ADR is
immutable once accepted; later decisions that change course supersede rather
than edit.

| ADR | Title | Date | Status |
|---|---|---|---|
| [0001](./0001-per-device-consent.md) | Per-device consent state | 2026-04-29 | Accepted |
| [0002](./0002-denoise-pivot-creator-agnostic.md) | Denoise pivot — creator-agnostic positioning (2.1) | — | Accepted |
| [0003](./0003-awin-redirect-model-resolution.md) | Awin redirect-network model resolution | — | Accepted |
| [0004](./0004-decommission-unwrap-server-native-shortener-resolution.md) | Decommission `unwrap.muga.app`, native shortener resolution | 2026-05-27 | Accepted (phases 5-6 pending — #701) |
| [0005](./0005-rule-scaling-pipeline.md) | Self-scaling ruleset — clean-room ingestion + affiliate safety net | 2026-06-03 | Accepted |
| [0006](./0006-remove-own-tag-affiliate-injection.md) | Remove MUGA's own-tag affiliate injection | 2026-07-28 | Accepted |
| [0007](./0007-terms-available-not-accepted.md) | Terms available, not accepted — adopt the uBlock Origin model | 2026-08-02 | Accepted |
| [0008](./0008-host-scoped-facts.md) | Host-scoped facts — may `(param, host)` leave quarantine? | 2026-08-22 | **Proposed** |

New ADRs: copy the structure of the latest entry (Context → Decision →
Consequences), number sequentially, and add a row here in the same PR.
