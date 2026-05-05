Competitor adapter contract — A6 phase 2 (#506)
=================================================

This directory hosts adapters that mimic external URL-cleaning tools so
the benchmark can compare MUGA against ClearURLs, AdGuard URL Tracking
Protection, Brave Shields, and Firefox built-in cleaner.

Each adapter MUST conform to:

  {
    name:    string,    // short stable id (used in report keys)
    label:   string,    // human-readable name
    source:  string,    // URL of the rule set's official source (for
                        // audit; adapters MUST NOT fetch at runtime)
    version: string?,   // version of the rule snapshot
    clean(rawUrl: string): string  // returns cleaned URL or rawUrl
                                   // unchanged when the adapter has
                                   // no opinion. Errors must NOT throw
                                   // — return rawUrl on parse failure.
  }

The adapter runs PURELY ON THE CORPUS URL. It does not see MUGA's prefs,
domain rules, or wrapper engine. That isolation is what makes the
comparison meaningful: each adapter shows what its own rule set would
have done on the URL the user landed on.

Real adapters (ClearURLs / AdGuard / Brave / Firefox) ship as separate
slices (phase 2a / 2b / 2c / 2d). Each will:
  1. Vendor a rule snapshot under tests/benchmark/competitors/data/
     so the benchmark stays reproducible offline.
  2. Implement a thin adapter that consumes the snapshot.
  3. Document the snapshot's source URL + capture date in this file.

This phase (2 scaffold) ships only:
  - The contract above (this file)
  - Runner support for an array of adapters
  - Report extension with a `competitorResults` field per entry plus
    a `byCompetitor` summary in the top-level report
  - A trivial "identity" adapter used by the test suite to prove the
    integration shape end-to-end. The identity adapter is NOT a real
    competitor — it returns rawUrl unchanged. The benchmark runner
    does NOT load it; it lives only in the test suite.

When phase 2a/2b/etc. ship, append their adapters' source snapshot
metadata to a "Snapshots" section appended below this contract.

----- Snapshots ------------------------------------------------------

Each entry pins WHEN the snapshot was captured + the upstream URL it
came from + the SHA-256 of the file at capture time. Reviewers can
compare hashes against a known upstream commit when auditing the
diff. Refresh via `npm run benchmark:refresh-competitors`.

ClearURLs — phase 2b (#506)
  source:    https://rules2.clearurls.xyz/data.minify.json
  file:      data/clearurls.json
  captured:  2026-05-05
  bytes:     37176
  sha256:    df97eb5c1aeeb9f96d0c28a6a60604f3cb2b1f9e7776eee228258e1b2bae1424
  adapter:   clearurls.mjs (clearurlsAdapter)

AdGuard URL Tracking Protection (filter #17) — phase 2c (#506)
  source:    https://filters.adtidy.org/extension/chromium/filters/17.txt
  file:      data/adguard.txt
  captured:  2026-05-05
  bytes:     165456
  sha256:    1e874321b5610c693e2f3006d8ba84781c6ca1f60a36f08bf68cccd1a3057d27
  adapter:   adguard.mjs (adguardAdapter)
