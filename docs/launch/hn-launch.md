# HackerNews launch: engineering angle

**Audience.** Engineers who appreciate architectural rigor, signed pipelines, and "no JS framework" projects. They will respect MV3-from-day-1, Ed25519-signing, and the deliberate "no build step" stance more than any UX claim.

**Posting window.** Tuesday or Wednesday morning Eastern Time. Avoid Mondays (catch-up traffic), Fridays (low engagement), and weekends.

**Account hygiene.** Use the project owner's HN account with at least 30 days of prior activity. Never seed votes; HN penalizes that severely.

---

## Title (≤80 chars)

```
Show HN: I built an MV3-native URL cleaner with a signed remote-rules pipeline
```

**Alternates:**
- `Show HN: MUGA, a URL cleaner that doesn't break creator affiliate links`
- `Show HN: An MV3 URL cleaner with Ed25519-signed rules and zero telemetry`

Pick the one that lands the wedge fastest. The first option leans into engineering credibility, which is the better fit for HN's audience.

---

## Body

```
MUGA strips tracking from URLs (utm_*, fbclid, gclid, 450+ params) and unwraps
affiliate redirect networks like Awin and Skimlinks so your clicks never touch
the tracker server. Live on the Chrome Web Store and Firefox AMO.

A few architectural notes that I think will land here:

1. MV3 from day 1. No MV2-to-MV3 migration, no shim layer. The service worker
   handles cross-cutting state (badge, stats, optional rules fetch) and the
   content script does the URL work inline. The service worker never sees
   URLs in transit. There is no central pipeline that observes your browsing.

2. Ed25519-signed remote rules pipeline. The 450+ param list is bundled with
   the extension AND can optionally update once a week from a signed feed at
   rules.muga.app. Off by default. Verified fail-closed in the service worker
   before any rule lands. Code: src/lib/remote-rules.js, ~200 lines.

3. Zero telemetry. No analytics. No crash reporting. No A/B framework. No user
   accounts. The popup's "Creator referral preserved" claim is verifiable by
   diffing the published .xpi against the GitHub source. The transparency
   page (rules.muga.app/transparency.html) lists every byte the extension
   stores and what triggers each storage write.

4. Documented, verifiable URL rules. The rule definitions (what gets preserved,
   what gets stripped, and why) live in docs/rules/decision-algorithm.md and
   src/rules/ alongside Ed25519-signed normative artifacts. A CI-gated
   conformance test suite runs on every PR so regressions are caught before
   they ship.

5. No build step beyond a 30-line esbuild bundler. No TypeScript. No Babel,
   no JSX, no Webpack, no Rollup. The cleaning library is plain ES modules.
   The single bundling step exists only because MV3 content scripts can't use
   imports portably across Chrome and Firefox MV2. The bundled output is
   committed and CI fails if it drifts from source.

The wedge: MUGA is, as far as I know, the only URL cleaner that strips tracking
WITHOUT silently stripping the creator's affiliate referral. ClearURLs, AdGuard,
Brave, and Firefox's built-in cleaner all remove the creator's tag along with
the trackers. MUGA preserves it and tells you it did, with a "Creator referral
preserved" badge in the popup. The principle is in the README and the
comparison page (rules.muga.app/comparison.html).

Not affiliated with anyone, no funding, no roadmap meeting at 9am. GPL v3.
Code: https://github.com/yocreoquesi/muga
Install Chrome: https://chromewebstore.google.com/detail/muga-clean-urls-fair-to-e/pjdpeamhcjdhfijpmgamjdoplbnbajoh
Install Firefox: https://addons.mozilla.org/firefox/addon/muga/
Comparison: https://rules.muga.app/comparison.html
Landing: https://muga.app/

Happy to discuss the MV3 architecture, the rule-signing pipeline, or the
verifiable rule design; that's the part I find most interesting. Feedback
welcome.
```

---

## Reply playbook

Pre-draft answers to likely first comments:

### "Why not just use ClearURLs?"

> ClearURLs is a great tool and I run it myself for years. The reason I built MUGA is the affiliate question. ClearURLs strips `tag=`, `aff_id`, `ref_=` etc. across the board, which means when a YouTuber or newsletter writer sends you to Amazon with their referral, ClearURLs removes it before you click. The creator doesn't get paid for the recommendation. MUGA decided that was wrong: we strip the same trackers ClearURLs does, but we keep the creator's tag and tell you we did. The popup shows "Creator referral preserved" so it's never silent. That's the only thing MUGA does that ClearURLs doesn't, but it's the thing I built it for.

### "MV3 cripples ad-blockers, why bother?"

> MV3's `webRequest` blocking restriction is real and is what's hurting uBlock Origin. But MUGA is fundamentally not a request-blocker; it's a URL rewriter that runs at click time and unwraps redirect networks before they get to the tracker. The MV3 `declarativeNetRequest` API is more than enough for parameter stripping; the limitations bite only when you need to block by full request body. So MUGA on MV3 is not a feature compromise.

### "Ed25519 signing for a 450-param list seems overkill"

> Fair. The reason it's there: the optional remote rules feature lets the param list update without a release. If that path were unsigned, a compromised CDN could inject "preserve `gclid`" and break everything for all users at once. With Ed25519 + a pinned pubkey, even a compromised endpoint can only return rejected payloads. Off by default, signed when on, fails closed. Code is in `tools/sign-rules.mjs` and the verification at `src/lib/remote-rules.js` if you want to look.

### "What about Manifest V2 on Firefox?"

> Both targets ship from the same source. Firefox AMO ships MV2 (still supported there) with `webRequest`, Chrome ships MV3 with `declarativeNetRequest`. The `src/manifest.json` and `src/manifest.v2.json` split + `tools/with-firefox-manifest.sh` keep them in sync. The cleaning logic is identical; only the rule engine differs.

### "Where do you make money?"

> I don't. GPL v3, no donations, no Patreon. The affiliate-preservation thing isn't monetization for me, it's the principle. If the project ever needs sustainability funding, that conversation is public-first via Issues, not a quiet inflection.

---

## Self-check before posting

- [ ] Title is under 80 characters and doesn't oversell.
- [ ] Body has no superlatives ("the most", "the only", except verifiable ones).
- [ ] Every link is clickable and resolves to a public page.
- [ ] Numbers (450 params, 3499 tests, etc.) match the version live in stores.
- [ ] No emoji in title or body. HN convention.
- [ ] No "please upvote" or "share if you like". Penalty risk.
- [ ] Replies are drafted but not pasted yet; let them flow naturally.
