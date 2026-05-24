# Unwrap aggregate observability — design

**Version**: 1.0 (initial design)
**Last updated**: 2026-05-24
**Owner**: Antonio Rodriguez ([@yocreoquesi](https://github.com/yocreoquesi))
**Issues**: closes [#651](https://github.com/yocreoquesi/muga/issues/651) (design) · feeds [#652](https://github.com/yocreoquesi/muga/issues/652) (implementation) and [#661](https://github.com/yocreoquesi/muga/issues/661) (privacy policy delta)
**Reads**: [ADR-0002 — denoise pivot](adr/0002-denoise-pivot-creator-agnostic.md) · [affiliate networks matrix](affiliate-networks-matrix.md)

## Why this exists

MUGA has no client-side telemetry, by deliberate choice. Under the 2.1 pivot, the synthetic test harness ([#650](https://github.com/yocreoquesi/muga/issues/650)) detects per-network attribution regressions, but it cannot tell us:

- Which shorteners users actually encounter (so we know which patterns to prioritize).
- Whether `unwrap.muga.app` is silently failing at a rising rate.
- Whether destinations after unwrap are matching MUGA's existing cleaner rules, or whether the long tail keeps growing in places we don't cover.

The unwrap server **already sees** every URL it processes — it is a structural necessity of the work. The design choice in 2.0 was to "process and forget" by never persisting. **Aggregating non-PII counts does not add a new privacy surface**: it persists, in bucketed form, statistics about what was already, briefly, in the request handler.

This document specifies what is aggregated, what is explicitly NOT aggregated, how it is exposed for audit, and how the privacy policy describes it.

## Design constraints

These are non-negotiable. Any implementation choice in [#652](https://github.com/yocreoquesi/muga/issues/652) that violates one of these constraints must be rejected, not worked around.

1. **Zero IP addresses.** The request handler must drop the source IP before any logging path runs. The server-side framework MUST be configured so that no transport-layer log (access log, error log, crash dump) retains IPs either.
2. **Zero User-Agent strings.** Same as IPs. UA strings can fingerprint a user.
3. **Zero user identifiers of any kind.** No `X-Muga-Install-Id`, no installation UUID, no auth token. The client (the extension) MUST NOT send any header that could be used to correlate requests.
4. **Zero destination URLs.** The destination of any unwrap is computed, returned to the client, and immediately discarded. No persistence of the destination string or any substring of it (no domain, no path, no query, no fragment).
5. **Zero source URLs.** The full source URL the client sent is also discarded. Only the **source host** (e.g. `bit.ly`) is extracted and counted.
6. **Source host MUST be in `GENERIC_SHORTENERS`.** Defense in depth: even if the server logic regresses and accepts a non-shortener host, the metrics layer rejects logging it. This way an accidentally-accepted affiliate redirect (e.g. `s.click.aliexpress.com`) would never have its volume counted — and the gap would surface as "0 entries for X" in the public endpoint, which is the audit signal.
7. **Aggregates only.** No raw request log. The smallest persisted unit is the per-day per-host counter row.
8. **Public transparency.** Every counter that is persisted is also exposed via a public read-only endpoint. There is no private dashboard with finer-grained data than what is public. This makes the privacy policy enforceable by inspection rather than by trust.

## What gets aggregated

One row per (date, source_host). All counters are integers, monotonically incremented within the day, then frozen.

```
unwrap_metrics_daily {
  date:                                       string  (YYYY-MM-DD, UTC)
  source_host:                                string  (must be in GENERIC_SHORTENERS)
  total_requests:                             integer
  successful_unwraps:                         integer (resolved, returned a destination)
  failed_unwraps:                             integer (timeout, 4xx/5xx upstream, malformed)
  destination_matched_known_cleaner_rule:     integer (count where the resolved destination
                                                       hostname matched ANY rule in MUGA's
                                                       domain-rules.json — boolean roll-up only)
  destination_unknown_to_cleaner:             integer (count where it did not)
}
```

That is the entire schema. Six counter columns plus the two key columns.

### Why each column

- **`total_requests`** — base volume. Capacity planning, abuse detection (e.g. one shortener host suddenly receives 100x normal traffic).
- **`successful_unwraps` / `failed_unwraps`** — quality signal. A rising fail rate on `bit.ly` indicates either a bit.ly outage, a rate-limit hitting the Worker, or our resolution logic regressing.
- **`destination_matched_known_cleaner_rule` / `destination_unknown_to_cleaner`** — coverage signal. The split tells us how often unwrapped URLs are destinations MUGA already knows how to clean vs. destinations we have never seen. **Critically, only the boolean is persisted — the destination itself is discarded immediately after the matcher runs.** A rising "unknown" count on a given source host means the long tail is growing in a category we don't cover; the operator response is "investigate which categories to add rules for," NOT "look at which URLs users sent."

### What is NOT computed

- **Destination domain** — even at the host level, persisting "bit.ly mostly unwraps to news sites" would let an operator infer a user's interests. The boolean known/unknown roll-up is the cap on resolution.
- **Time-of-day buckets** — could be used to fingerprint timezone of a low-traffic shortener. Daily-only buckets prevent this.
- **Referrer** — even if the unwrap server received an HTTP `Referer` header, the metrics layer drops it before counting.
- **Geo information** — IP is dropped, so geo is structurally impossible.
- **Per-extension-version counters** — would let an operator correlate "new version released" with "X new users". If we ever want adoption metrics, that is a separate design discussion with a separate consent surface.

## Public transparency endpoint

```
GET https://unwrap.muga.app/public/metrics
```

- **Auth**: none (fully public, read-only)
- **CORS**: `Access-Control-Allow-Origin: *`
- **Rate limit**: cached at the edge (Cloudflare cache) for 1h; underlying read is at most 1/h
- **Response**: JSON, shape below

### Response shape

```json
{
  "generated_at": "2026-05-24T18:00:00Z",
  "schema_version": 1,
  "retention": {
    "raw_aggregates_days": 30,
    "monthly_rollup_months": "perpetual"
  },
  "allowlist_source_hosts": [
    "bit.ly", "tinyurl.com", "t.co", "link.medium.com", "lnkd.in", "fb.me", "ebay.to"
  ],
  "daily": [
    {
      "date": "2026-05-23",
      "source_host": "bit.ly",
      "total_requests": 142,
      "successful_unwraps": 140,
      "failed_unwraps": 2,
      "destination_matched_known_cleaner_rule": 98,
      "destination_unknown_to_cleaner": 42
    }
  ],
  "monthly": [
    {
      "month": "2026-04",
      "source_host": "bit.ly",
      "total_requests": 4310,
      "successful_unwraps": 4287,
      "failed_unwraps": 23,
      "destination_matched_known_cleaner_rule": 2944,
      "destination_unknown_to_cleaner": 1343
    }
  ]
}
```

`daily` holds the last 30 days. `monthly` holds all historical rollups (one row per month per host). The `allowlist_source_hosts` array MUST match the production `GENERIC_SHORTENERS` array; a mismatch is a CI-detectable bug (the public endpoint becomes the contract, and any host that appears in `daily` but not in `allowlist_source_hosts` is a violation of constraint #6 above).

## Retention

- **In request handler (in-flight)** — source URL, destination URL, headers, IP, UA: held only for the duration of the request. Cleared on response (or on exception).
- **Daily aggregates** (`unwrap_metrics_daily`) — retained for **30 days** as raw daily rows.
- **Monthly rollups** — at day 31, the 30 oldest daily rows are summed into a single per-month row per host. Monthly rollups are retained **perpetually** (they are small: ~7 hosts × 12 months/year × ~30 bytes/row = a few KB/year).
- **Backups** — daily DB backups MUST honor the same retention. A backup older than the source row's retention window must not be restorable for metrics purposes (operational hygiene; out of scope for this design but documented as a constraint for `#652`).

## Implementation notes for #652

These are starting hints, not prescriptions. Final shape is implementation territory.

- **Storage**: a single Cloudflare D1 table (or KV with date-prefixed keys; D1 is preferred for the rollup query). Total row count is bounded: ~7 hosts × 30 days = 210 daily rows + tiny monthly table. KV would also work and may be cheaper if the rollup is server-side at endpoint-render time.
- **Increment path**: per request, after the unwrap completes (success OR fail), the worker performs ONE write — an `UPSERT … ON CONFLICT … DO UPDATE counter = counter + 1` keyed on `(date, source_host)`. No per-request log row.
- **Coverage matcher**: the worker can ship a pre-compiled list of "known cleaner rule" hostname patterns derived from `src/rules/domain-rules.json`. At request time, after resolving the destination, compute `domain_rules_matcher(destination_hostname) → boolean`, increment the appropriate counter, discard the destination.
- **Defense-in-depth allowlist check**: BEFORE any counter is incremented, the source host MUST pass `GENERIC_SHORTENERS.includes(source_host)`. If false, no counter increments. (The request itself should already have been rejected before this point, but defense in depth.)
- **Drop transport-layer logs**: Cloudflare Workers' default request logging includes IP and UA. The Worker MUST be configured with `logpush` disabled for this service, or with a redaction transformer that strips these fields before any log is emitted.

## Privacy policy delta (drafted for #661 / P5.2)

The following paragraph is to be inserted into the privacy policy under the "What `unwrap.muga.app` retains" section. This wording is what the user reads — it is the source-of-truth disclosure that the implementation must match.

> **What `unwrap.muga.app` retains**
>
> `unwrap.muga.app` runs a server-side URL unwrapper for a small list of known generic shorteners (such as bit.ly, tinyurl.com, t.co). When the extension's URL Unwrapper feature is enabled and you encounter one of these shorteners, the extension sends the shortener URL to the server, which resolves the destination and returns it. The server processes the URL in memory and **never persists** the source URL, the destination URL, your IP address, your User-Agent, or any user identifier.
>
> The server **does** maintain aggregated, non-personal daily counters for operational quality and coverage analysis: per shortener host, the number of requests received, the number of successful resolutions, the number of failures, and a non-identifying boolean roll-up of how often the resolved destination was a domain MUGA already has cleaning rules for. These counters are exposed publicly and read-only at `https://unwrap.muga.app/public/metrics` — what we keep, you can see.
>
> Daily aggregates are retained for 30 days, then summarized into monthly per-host rollups retained perpetually. The aggregates contain no information that can be tied back to any specific request, user, install, or destination URL.

## Verification: how do we prove no PII is logged?

The constraints above are policy. Verification is what makes them load-bearing.

1. **Public endpoint IS the contract.** Anyone — a curious user, a security researcher, a journalist — can fetch `/public/metrics` and see the complete set of what is persisted. If a future PR added a sensitive column, it would appear here too. The endpoint is the public review surface.
2. **Implementation test (P1.6b acceptance criterion)**: a server-side test posts ~100 synthetic unwrap requests with deliberately-distinctive IPs, UAs, source URLs, destination URLs, and headers. After the requests complete, the test:
   - Queries the daily aggregates table directly.
   - Asserts NO row contains any substring of the deliberately-distinctive values.
   - Asserts the only columns present are the schema defined in this doc.
   - Asserts every `source_host` value matches the production `GENERIC_SHORTENERS` array.
3. **Transport-log audit**: a manual verification step (re-run quarterly) confirms Cloudflare's transport logs do not retain IPs or UAs for this service. This is a configuration check, not a code check — it lives in the [quarterly review checklist](#quarterly-review).
4. **Public-endpoint contract test**: a test fetches `/public/metrics` against the production deployment and asserts the response shape conforms to the schema. Schema drift is a release-blocker.

## Quarterly review

Aligned with the matrix's quarterly review cadence (next: **2026-08-24**):

1. Re-run the IP/UA transport-log audit. Confirm no PII leaks through the platform layer.
2. Diff the `allowlist_source_hosts` field in the live `/public/metrics` against the production `GENERIC_SHORTENERS` array. Any divergence is investigation-grade.
3. Audit any new columns added to the metrics table since the last review. Each new column requires this design doc to be updated and the privacy policy delta to be re-reviewed.
4. Sanity-check the destination-coverage signal: high "destination_unknown_to_cleaner" counts on any host are signal to investigate adding new cleaner rules (NOT to look at the destinations — they were not retained).

## What is explicitly out of scope

- **Per-user opt-in telemetry on the client.** Not on the table for 2.1 or any reasonable foreseeable horizon. The "no client telemetry" stance is preserved exactly.
- **Adoption / install counts.** Would require some form of user identifier and a separate consent surface. Out of scope.
- **Affiliate redirect networks** (`s.click.aliexpress.com`, `prf.hn`, etc.) — these MUST NOT pass through the unwrap server under 2.1 (covered by [#659](https://github.com/yocreoquesi/muga/issues/659)). The metrics design above only ever sees `GENERIC_SHORTENERS` traffic by construction.
- **Per-rule-pattern coverage metrics.** Telling the operator "rule #142 matched 30% of bit.ly unwraps last week" would be useful but requires per-rule counters, expanding the table substantially. Deferred to a future quarter if the boolean known/unknown roll-up proves insufficient.
