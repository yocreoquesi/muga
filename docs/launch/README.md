# Launch drafts

Platform-specific launch posts for MUGA's Wave 2 distribution push (closes #332).

These are **drafts**, not yet posted. The launch sequence is:

1. **HackerNews** — Tuesday or Wednesday morning ET (engineering angle, see [`hn-launch.md`](hn-launch.md)).
2. **ProductHunt** — same week as HN (UX / "fair to creators" wedge, see [`producthunt-launch.md`](producthunt-launch.md)).
3. **Reddit** — 24h after ProductHunt for echo (alternative-to-incumbent angle, see [`reddit-launch.md`](reddit-launch.md)).

## Pre-launch checklist (must be true before posting any of the above)

- [ ] **Domain live.** `muga.app` resolves and serves a landing page (#481).
- [ ] **Comparison page live.** [`docs/comparison.html`](../comparison.html) is reachable from the landing page (#329).
- [ ] **Store listings up to date.** Both Chrome Web Store and Firefox AMO show the latest version with the current screenshots and copy (#328).
- [ ] **Wedge UI present.** The "Creator referral preserved" badge is visible in the popup on a real affiliate link (#327).
- [ ] **Counter live.** The popup shows a non-zero "URLs cleaned" count after a brief test session (#326).
- [ ] **Screenshots refreshed.** All four locales captured with `npm run screenshots`. Compressed and committed under `docs/screenshots/`.
- [ ] **Press kit ready.** Brand assets (logo SVG/PNG, color tokens) reachable from the landing page or this directory.

If any item is unchecked, **do not launch**. First impressions are the launch.

## Post-launch metrics capture

Track the following deltas at +24h, +7d, +30d after EACH platform post:

- Chrome Web Store install count (visible on the developer dashboard).
- Firefox AMO install count + ADU (active daily users) on `addons.mozilla.org/api/v5/addons/addon/muga/` weekly stats.
- GitHub repo: stars, forks, issues opened, PRs opened.
- `muga.app` traffic: unique visitors, top referrer, top landing path. (Plausible / GoatCounter — never GA.)
- Issue-template intake: count of `unclean-url` and `broken-site` issues opened by users (signal that the popup buttons + #333 templates are working).

Snapshot the numbers in a single follow-up issue (or in `docs/launch/postmortem-YYYY-MM-DD.md`) so the comparison is reviewable.

## Launch principles (do not break)

- **Honesty.** No "the most private", "the only", "the best" — the data does not support superlatives. Use "the first URL cleaner that respects creator affiliate links" because that one IS true and verifiable.
- **No trash talk.** ClearURLs, AdGuard, Brave, and Firefox's built-in cleaner are valid tools with different trade-offs. Position MUGA against them by what MUGA does differently — not by what they do wrong.
- **Show, don't tell.** Every claim ("zero telemetry", "Ed25519-signed pipeline", "MV3-native") must be a clickable link to either the source code or a public artifact.
- **No metrics inflation.** Test count, params stripped, supported networks — quote the number that is true at launch time, with a link to the file. Do not round up. Do not use future numbers.
- **Wave 1 first.** Domain, wedge UI, counter, comparison page, store listings. None of these drafts go live until those landed.
