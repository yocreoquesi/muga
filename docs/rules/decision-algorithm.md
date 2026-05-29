# MUGA URL Decision Algorithm

This is MUGA's authoritative internal definition of the URL processing rules: what it preserves for creators and what it strips for privacy.

## Scope

MUGA applies a layered decision algorithm to every URL it encounters. The layers
run in priority order; the first layer that matches governs the outcome.

1. **Wrapper layer** — detect and unwrap redirect networks
2. **Contextual bounded-scope layer** — strip PARAM_PAIRS entries when the URL
   host is a direct-injection affiliate landing page
3. **Direct-injection affiliate layer** — preserve or inject affiliate tags

## Wrappers

MUGA maintains a table of redirect-network wrapper entries under
`src/rules/wrappers.json`. Each entry declares:

- `hostPatterns` — literal host strings or anchored regex patterns that
  identify the redirect network's domain(s)
- `pathPrefix` (optional) — restricts matching to a URL path prefix
- `extractor.kind` — one of `fromParam`, `fromAnyParam`, `fromUrlAfterQuery`

When a URL's host matches a wrapper entry, MUGA extracts the destination URL
and continues processing the destination rather than the wrapper URL. The
Ed25519 signature over `wrappers.json` (verified against `worker-pubkey.txt`)
proves artifact authenticity. The `wrappers.data.js` ESM module is the runtime
form; it must mirror `wrappers.json` byte-for-byte.

MUGA-side exclusions (see `src/lib/wrapper-engine.js` — `MUGA_EXCLUDED_IDS`):
redirect networks where the attribution context is established at the 30x step
(currently: `awin`, `impact`, `rakuten`, `tradetracker`) are passed through
rather than locally unwrapped.

## Contextual Bounded-Scope

For URLs that land on a direct-injection affiliate program domain, MUGA strips
parameters listed in `PARAM_PAIRS` (a fixed set of contextual tracking keys)
from the URL. This is the "bounded-scope strip contract" tested by the
conformance vectors in `tests/rules-vectors/contextual.json`.

Short-circuit (step 6): when the URL host is itself a wrapper (redirect network),
the contextual layer MUST NOT fire — the wrapper layer takes precedence. The
conformance vector `network-redirect-host-bypasses-contextual` covers this case.

## Direct-Injection Affiliate

The `src/rules/manifest.data.js` module exports `CAPS_DIRECT_INJECTION_PROGRAMS`,
the roster of affiliate programs that MUGA recognizes for tag preservation and
injection. Each entry declares:

- `id` — stable kebab-case identifier (e.g. `amazon-associates`)
- `programType` — always `direct-injection` in this roster
- `domains` — host strings the program covers
- `param` — URL query parameter that carries the affiliate tag

MUGA's per-host tag values (`ourTag`) live in `src/lib/affiliates.js` and are
intentionally outside the rule artifact — they are implementer-specific and
not part of the algorithm definition.
