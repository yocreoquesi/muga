# moat-expansion — affiliate param discovery report

Weekly clean-room pipeline that discovers potential gaps in muga's affiliate moat by
diffing ClearURLs `referralMarketing` signals against the current affiliate parameter
coverage. Produces a human-review Markdown report; never auto-edits `manifest.data.js`
or any `src/` file.

---

## Purpose

The ClearURLs `referralMarketing` database lists affiliate-specific parameters that
tracking-removal tools should preserve. muga's affiliate moat (`CAPS_DIRECT_INJECTION_PROGRAMS`,
`REDIRECT_NETWORK_PATTERNS`, `AFFILIATE_PARAM_GUARD`) already covers many of these, but
new programs and params emerge over time. This pipeline surfaces the gaps weekly so a human
reviewer can decide whether to extend the moat.

This is the **semantic inverse** of `tools/rule-ingestion/`: rule-ingestion *excludes*
`referralMarketing` params from tracking removal; moat-expansion *extracts* them as
affiliate signal.

### Clean-room / LGPL posture

ClearURLs rules are licensed under **LGPL-3.0**. This pipeline extracts only `referralMarketing`
tuples as facts ("signals-not-copies"). The raw rules file is quarantined at
`tools/moat-expansion/quarantine/` (gitignored) and **never committed**. See
`tools/rule-ingestion/PROVENANCE.md` for the full license ledger entry.

---

## Pipeline

```
ClearURLs data.min.json
        │
        ▼  fetchRaw (injectable fetch)
quarantine/clearurls.raw   (gitignored — raw bytes, never committed)
        │
        ▼  extractReferralSignals (PURE)
[{provider, urlPattern, referralMarketing[]}]
        │
        ▼  loadMoatSnapshot (reads src/lib read-only)
snapshot {coveredByDomain, guardParams, knownByProgramId, landingParamSet}
        │
        ▼  diffMoat (PURE) + KNOWN_PROGRAMS lookup table
{newOnKnown[], unknownProvider[], alreadyCoveredCount}
        │
        ▼  renderReport (PURE)
tools/moat-expansion/reports/report-<YYYY-MM-DD>.md
        │
        ▼  Weekly GitHub Actions workflow
Human-review PR (#needs-triage)
```

Coverage sources checked by the differ:

| Source | What it checks |
|--------|---------------|
| (a) `CAPS_DIRECT_INJECTION_PROGRAMS` | param + domain overlap for known affiliate programs |
| (b) `REDIRECT_NETWORK_PATTERNS` landingParams | param membership in redirect-network landing params |
| (c) `AFFILIATE_PARAM_GUARD` | case-insensitive global param blocklist |

A param is a **gap** only if it is not covered by any of (a), (b), or (c).

---

## How to run locally

```bash
npm run moat:report
```

Or directly:

```bash
node tools/moat-expansion/cli.mjs
```

The CLI:
1. Fetches `data.min.json` from ClearURLs upstream.
2. Writes the raw file to `tools/moat-expansion/quarantine/clearurls.raw` (gitignored).
3. Extracts `referralMarketing` tuples.
4. Diffs them against the current affiliate moat.
5. Writes a Markdown gap report to `tools/moat-expansion/reports/report-<YYYY-MM-DD>.md`.
6. Prints a one-line JSON summary to stdout.

Exit codes: `0` success · `1` bad JSON/shape · `2` fetch/network failure · `3` I/O error.

---

## How the weekly PR works (PR 6/6 — workflow)

The GitHub Actions workflow (`.github/workflows/moat-expansion.yml`, added in PR 6/6) runs
on a weekly schedule (Sunday 06:00 UTC) and on manual dispatch. When the pipeline finds new
gaps or unknown providers, it commits the report file to a dated branch and opens a
`needs-triage` PR for human review.

**Human-review contract:**

- The bot commits only `tools/moat-expansion/reports/report-<date>.md`.
- The bot **NEVER** edits `src/rules/manifest.data.js`, `src/lib/affiliates.js`, or any
  other `src/` file. That decision belongs to the human reviewer.
- The PR is never auto-merged. A reviewer must inspect the gap report and manually copy
  any draft manifest entries they want to add to the moat.
- If there are no gaps and no unknown providers, the workflow exits early and no PR is opened.

---

## Lookup-table maintenance

`tools/moat-expansion/lookup-table.mjs` maps ClearURLs provider keys to muga's canonical
program IDs and domain arrays. This is **muga-authored** content — not derived from or
copied from ClearURLs files.

Add a new entry when a ClearURLs provider key appears repeatedly in the
`unknown-provider` report section and you can identify the corresponding affiliate program:

```js
// In lookup-table.mjs → KNOWN_PROGRAMS object:
newprovider: {
  programId: "my-program-id",   // must match id in CAPS_DIRECT_INJECTION_PROGRAMS or REDIRECT_NETWORK_PATTERNS
  domains: ["example.com", "www.example.com"],
  note: "Example Affiliate Program. ClearURLs provider key 'newprovider'.",
},
```

The `programId` value is used by the differ to check source-(a) coverage (param + domain
overlap with `CAPS_DIRECT_INJECTION_PROGRAMS`). If the program is not yet in
`CAPS_DIRECT_INJECTION_PROGRAMS`, the param will surface as a gap in
`new-param-on-known-program` with a copy-pasteable draft manifest entry.

---

## File layout

```
tools/moat-expansion/
  adapters/
    clearurls-moat.mjs      fetchRaw + extractReferralSignals (I/O + pure parse)
  cli-error.mjs             CliError(message, exitCode) — shared within moat-expansion
  cli.mjs                   runMoatExpansionCli() — thin I/O orchestrator
  differ.mjs                diffMoat() — pure classification
  lookup-table.mjs          KNOWN_PROGRAMS — muga-authored provider→program map
  moat-snapshot.mjs         loadMoatSnapshot() — reads src/lib read-only
  quarantine/               gitignored — raw fetch zone
  report.mjs                renderReport() — pure Markdown renderer
  reports/                  committed report output (.gitkeep; reports added by CI)
  README.md                 this file
```

Tests:

```
tests/unit/
  moat-expansion-lookup.test.mjs     lookup table shape assertions
  moat-expansion-extract.test.mjs    adapter + snapshot unit tests
  moat-expansion-differ.test.mjs     differ classification + dedupe tests
  moat-expansion-report.test.mjs     report renderer snapshot tests
tests/integration/
  moat-expansion-cli.test.mjs        end-to-end CLI test (injected fetch + temp dirs)
tests/fixtures/moat-expansion/
  clearurls-mini.json                muga-authored miniature fixture (4 providers)
```
