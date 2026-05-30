# `tools/rule-ingestion/` — clean-room ingestion pipeline (EPIC B/C)

In-repo tooling that scales MUGA's `TRACKING_PARAMS` list **without depending on
active user reports**, while preserving the CAPS affiliate moat. Tracking issue:
[#785](https://github.com/yocreoquesi/muga/issues/785).

This directory is the **scaffold** (B1, [#772](https://github.com/yocreoquesi/muga/issues/772)).
Fetch/normalize adapters (B2, #773), provenance discipline (B3, #774) and the
gate stack (EPIC C) land on top of it.

## Core principle — signals, not copies

Upstream tracker lists are used as **signals only**. A candidate parameter is
*corroborated* by upstream presence, then **independently re-derived** against
MUGA's own data — it is never copied verbatim into the distributed ruleset.

**Legal posture (verified):** individual param facts are not copyrightable
(Feist v. Rural); the EU sui generis right is limited to *obtaining* data
(BHB v. William Hill). DuckDuckGo's list (CC BY-NC-SA, NonCommercial) is
**off-limits** and excluded from every adapter.

## Asymmetric risk → asymmetric automation

Stripping a tracker by mistake is cheap; stripping an affiliate/functional
param is catastrophic. The pipeline is **aggressive toward _preserve_** and
**conservative toward _strip_**. The human leaves the critical path, replaced by
deterministic gates — never by accepting affiliate-deletion risk.

## Quarantine zone — raw upstream NEVER lands in the repo or the bundle

```
tools/rule-ingestion/
├── README.md              # this file
├── verify-quarantine.mjs  # CI gate (see below)
└── quarantine/            # gitignored working dir, created at runtime
    └── …                  # raw upstream downloads — ephemeral, never committed
```

Raw upstream data (the literal bytes of an upstream list) lives ONLY in
`quarantine/`, which is:

1. **Gitignored** — `tools/rule-ingestion/quarantine/` is in `.gitignore`, so
   raw bytes are never committed.
2. **Outside `src/`** — the extension bundle is built exclusively from `src/`
   (`web-ext build --source-dir src/`), so quarantined raw data physically
   cannot reach `dist/`.
3. **Ephemeral in CI** — adapters `mkdir -p` it at runtime; the scheduled
   action discards it after deriving candidates.

What may be committed is the *derived, re-authored* candidate set with its
provenance metadata — never the raw source.

## CI gate

`verify-quarantine.mjs` runs in CI ([`ci.yml`](../../.github/workflows/ci.yml))
and fails the build if the quarantine invariants are violated:

- no tracked files exist under `quarantine/`,
- the quarantine path is listed in `.gitignore`,
- the quarantine path lives outside `src/`.

Run it locally with `npm run verify:quarantine`.
