# ADR-0002: Denoise pivot — creator-agnostic, attribution-model-agnostic

**Date**: 2026-05-24
**Status**: Accepted
**Issue**: [#645](https://github.com/yocreoquesi/muga/issues/645) (this ADR), [milestone v2.1.0: Denoise pivot](https://github.com/yocreoquesi/muga/milestone/5) (full campaign)
**Engram refs**: decision id 710 (pivot call), id 711 (2.0 → 2.1 framing), discovery id 709 (Chrome rejection root cause)

## Context

MUGA 2.0 (shipped 2026-05) redefined the product's north as "denoise URLs without taking credit from the creators who recommended you." That north explicitly excluded redirect-based affiliate networks: MUGA rejected joining AliExpress, CJ Affiliate, Awin, Impact Radius, Partnerize, Admitad and similar programs because their attribution model requires routing the user's click through an external server. The store-listing copy, onboarding, privacy page, FAQ, and launch posts all framed this exclusion as a virtue ("we refuse to route your clicks through external attribution servers just to earn a commission").

Two facts forced a re-examination of that stance:

1. **Chrome Web Store rejected the 2.0 submission** (item ID `pjdpeamhcjdhfijpmgamjdoplbnbajoh`, routing ID FZSL, 2026-05) for **keyword spam**. The triggering text enumerated brand names ("Zalando, SHEIN, MediaMarkt, Walmart, Target, AliExpress") inside the "rejected programs" paragraph. The reviewer reads the brand list as keyword stuffing irrespective of editorial intent — the policy treats the structural pattern, not the argument around it.

2. **The exclusion was an implementation choice driven by privacy ideology, not by the headline goal.** The 2.0 headline goal is *denoise + fair to creators*. Refusing redirect networks does **not** serve that goal — it actively works against it: creators who use AliExpress, CJ, or Awin (i.e., most creators on the long tail of e-commerce) are silently excluded from MUGA's "fair to creators" promise. The product was self-limiting on the very wedge it claimed to own. Internal contradiction made visible: `unwrap.muga.app` (Privacy Proxy) actively *kills* attribution for creators on these networks while the rest of the product promises fairness to creators.

Additionally: the 2.0 "denoise" pitch had been live for days when the rejection landed. Backing out of the pitch entirely would feel like flip-flopping; doubling down by re-submitting with a brand-list fix would preserve a position that is technically and strategically incoherent.

## Decision

**MUGA 2.1 drops the redirect-network exclusion. Fairness no longer depends on attribution model — it depends on whether someone earned the click.**

Narrative arc, public-facing:
- **2.0** redefined the north: denoise URLs without harming whoever recommended the link.
- **2.1** extends that north: now also covers creators whose programs require redirect-based attribution — because fairness doesn't depend on the attribution model.

This is **continuation**, not correction. The 2.0 north was *denoise + fair to creators*; the redirect exclusion was an implementation choice that contradicted the north. Removing the exclusion makes the product consistent with its own headline.

Concrete product changes:

1. **`OPAQUE_NETWORKS` splits into two arrays** (P2.1 / #653):
   - `GENERIC_SHORTENERS` — bit.ly, tinyurl.com, t.co, link.medium.com, lnkd.in, fb.me, ebay.to (amzn.to pending P4.2 verdict). These still get unwrapped — there is no creator commission to harm, only analytics on the shortener side.
   - `AFFILIATE_REDIRECT_NETWORKS` — s.click.aliexpress.com, CJ domains, ad.admitad.com, prf.hn, px.a8.net. These are **passed through**. The redirect executes in-browser, the attribution cookie fires, the creator earns the commission.

2. **Cleaner gets a per-landing policy** (P3.1 / #656): once the user lands on the destination after a redirect, `getLandingPolicy(hostname, referrer)` returns a network-specific instruction about which params are safe to strip and which must be preserved (because the conversion pixel re-reads them at checkout). This is driven by a per-network attribution matrix (P1.1–P1.4 / #646–#649), maintained quarterly.

3. **Privacy Proxy rebrands to URL Unwrapper** (P4.1 / #658, P4.2 / #659). The feature was misnamed: it was always a URL unwrapper, the "privacy" framing was a positioning choice. With the redirect exclusion gone, the scope reduces to generic shorteners only — affiliate redirects must not be unwrapped (it would kill the cookie). `unwrap.muga.app` server-side enforces the reduced allowlist.

4. **Privacy claims demote from headline to verified fact.** "No analytics, no telemetry, local cleaning" remain absolutely true and remain in the privacy policy and a footer-level section of the store listing. They are no longer the headline differentiator. The headline is product-shaped: "shorter, cleaner URLs — fair to any creator."

5. **Synthetic test harness replaces the lack of telemetry** (P1.5 / #650). Because MUGA has no client telemetry (by deliberate choice — see Consequences), broken attribution would otherwise only surface weeks later via creator payout complaints. A CI harness simulates `redirect → landing → checkout` per network on every PR and weekly against `rules.muga.app`, failing loudly when the per-network matrix is violated.

6. **Unwrap aggregate observability** (P1.6a / #651, P1.6b / #652) — the unwrap server already sees the URLs it processes (necessarily; it cannot resolve without reading). Aggregate, non-PII metrics on volume, fail rate, and coarse destination categorization will be retained and exposed via a public transparency endpoint. This data covers gaps the synthetic harness cannot (real-world shortener distribution).

## Alternatives considered

**Alternative A — positioning only.** Rewrite the store listing to remove brand names and soften the redirect rhetoric, but leave product behavior unchanged. Low effort. Rejected because the inconsistency between what the product *does* (excludes redirect networks via Privacy Proxy + aggressive `aff_trace_key` stripping) and what the description *says* would remain — and would surface in any technical review that compared the two.

**Alternative B — appeal the Chrome rejection.** Argue that the brand list is editorial, not keyword spam. Rejected because: (a) keyword-spam appeals with objective brand-list evidence typically fail, costing 5–10 days for no gain; (b) winning the appeal would leave the strategic incoherence in place; (c) the right time to fix the strategic incoherence is *now*, before 2.0 reaches a wider audience and the obsolete framing becomes harder to walk back.

**Alternative C — full pivot to a different product category** (e.g., "the ethical affiliate manager"). Larger surface change, would compete in a different market. Rejected as out of scope for 2.1 — denoise is the wedge, and the wedge works once the redirect exclusion is removed.

**Alternative D (chosen) — full pivot of the product to creator-agnostic denoise, with 2.1 framed as evolution of 2.0.** Eliminates the strategic incoherence, removes the keyword-spam trigger, preserves the wedge, and uses the rejection as a forcing function to fix a deeper problem rather than only its surface.

## Consequences

**Positive:**

- Product internally coherent: the cleaner and the discourse align. "Fair to any creator" is true for AliExpress, CJ, Awin and the others now, not only Amazon and eBay.
- Wider creator coverage opens the addressable user base: anyone whose creator-of-choice uses an affiliate network at all benefits.
- Removes the keyword-spam trigger structurally (the rejected-programs paragraph no longer exists; there is nothing to enumerate).
- Privacy claims become *more* credible by being demoted: making "no telemetry" a footer-level fact rather than the headline cures the temptation to read every product change through the privacy lens. The product is allowed to be a denoise tool first.
- 2.1 framing as evolution of 2.0 (not rectification) avoids the optics of a flip-flop on the days-old launch.

**Negative:**

- Per-network attribution research is ongoing work, not a one-time table. AliExpress in particular changes its attribution model frequently; the matrix needs quarterly review (built into P1.4 / #649).
- No client telemetry remains a deliberate constraint. Broken attribution on a network would otherwise be invisible until creators complain weeks later. Mitigated by the synthetic harness (P1.5) and the aggregate unwrap observability (P1.6) — neither replaces telemetry, but together they cover the highest-risk failure modes.
- Re-submission to Chrome Web Store and Firefox AMO re-starts review queues. Roughly 5–10 day delay before 2.1 is live, on top of whatever calendar cost the rejection already imposed.
- Implementation surface is large: cleaner.js, affiliates.js, opaque-networks.js, privacy policy, ToS, store listings, public landing, public docs, launch posts, README, CONTRIBUTING, i18n strings in 7 languages, design bundle mockups, onboarding HTML, popup. See the surface inventory below.

**Neutral:**

- No analytics / no telemetry / local cleaning: unchanged. These remain absolutely true.
- The 6 direct-injection affiliate programs MUGA already supports (Amazon, eBay, Vercel, DigitalOcean, Lemon Squeezy, Apple Performance Partners) are unaffected — preservation and injection work exactly as before for those.
- Per-device consent model (ADR-0001) is unchanged. The 2.1 changes are about cleaner behavior and copy, not consent.

## Surface inventory for Fase 5 (text changes required downstream)

This inventory is the source of truth for [#660 store-listing rewrite](https://github.com/yocreoquesi/muga/issues/660), [#661 privacy policy + ToS update](https://github.com/yocreoquesi/muga/issues/661), [#662 i18n sweep](https://github.com/yocreoquesi/muga/issues/662) and [#658 URL Unwrapper rebrand](https://github.com/yocreoquesi/muga/issues/658). Reviewed 2026-05-24 against the working tree.

### Extension (in-browser) surfaces

- `src/lib/i18n.js`
  - `ob_tagline_sub` (line ~527): "Fair to creators · nice to you · honest about both." — 7 locales. Re-cast around new headline.
  - `ob_affiliate_desc` (line ~535): contains "We deliberately rejected 10+ stores whose attribution methods require routing your clicks through external servers" — 7 locales. **Highest-priority i18n change**: this is what users see during onboarding. Reframe to creator-agnostic; never enumerate stores.
  - "Privacy Proxy" section starting ~line 558 (`// ── Privacy Proxy (#453, B20) ──`): rebrand all keys to URL Unwrapper, update descriptions to reflect generic-shorteners-only scope, in 7 locales.
- `src/onboarding/onboarding.html`
  - Line 261: `<span data-i18n="ob_tagline_sub">Fair to creators · nice to you · honest about both.</span>` — fallback English literal alongside the i18n key; update both.
- `src/popup/popup.js`
  - Line ~548: comment referencing "fair to creators" promise. Update comment to reflect creator-agnostic framing.
- `src/privacy/privacy.html` (extension privacy page)
  - Lines 95–97: full "we rejected 10+ programs" paragraph. Rewrite per P5.2.
- `src/rules/domain-rules.json`
  - Line 3186 (and any similar): notes mentioning "redirect-based networks actively stripped". Update to reflect new policy (preserved by default, stripped per matrix).
- `src/lib/affiliates.js`
  - Line 65: comment `"awc",  // Awin click ID (redirect-based network, incompatible with MUGA privacy model)`. The comment becomes false once `awc` is restored per matrix; update or remove.

### Public marketing/docs surfaces

- `docs/store-listing.md` — full rewrite per P5.1 / #660. Chrome detailed description AND Firefox AMO detailed description both contain the rejected-programs paragraph (lines ~93–115 and ~223–232).
- `docs/privacy-page.html` — mirror of `src/privacy/privacy.html`; same rewrite per P5.2.
- `docs/transparency.html` line 148: "No server-side redirect for affiliate links. Creators come first — we evaluated 10+ affiliate programs that require routing your click through an external tracking server. We rejected every one of them." — rewrite.
- `docs/index.html` line 187: `<h3>Fair to creators</h3>` — rename the section to reflect new framing (e.g. "Fair to every creator").
- `docs/faq.md`
  - Lines 60–61: "refuses to collaborate with [redirect networks] — the click is unwrapped to the destination". Rewrite — under 2.1 these clicks are *not* unwrapped.
  - Line 247: "By design, MUGA refuses to participate in affiliate programs whose model…" — rewrite.
- `docs/launch/README.md` line 8: "fair to creators" wedge reference in the launch index. Update to new wedge wording.
- `docs/launch/reddit-launch.md` lines 27, 34: rewrite around new wedge.
- `docs/launch/producthunt-launch.md`: same family of changes; verify line-by-line during P5.1.
- `landing/index.html` line 428: `<b>Fair to creators · nice to you · honest about both.</b>` — update tagline.
- `OBJECTIVES.md`: verify the strategic objectives section reflects the 2.1 north; add a note pointing to this ADR.
- `README.md`: covered by this PR (see implementation references).
- `CHANGELOG.md`: 2.1.0 entry will be written in P7.1 — frame as evolution of 2.0, not rectification.

### Design bundle mockups (`.muga-design-bundle/`)

These are reference designs, not production. They should be updated to keep the bundle internally consistent so future redesigns inherit the correct framing. **No user-visible impact** — fixing them is optional polish, not a release-blocker.

- `muga/project/components/App.jsx` lines 76, 264, 293: "fair to creators" / "Fair to creators. Nice to you." / "Fair to creators, not just users."
- `muga/project/components/Onboarding.jsx` line 79: "Fair to creators · nice to you · honest about both"
- `muga/project/components/Options.jsx` line 189: "we don't take credit from people who earned it" (this line is still *true* under 2.1 — preservation of creator tags is unchanged. Keep or refine, no rewrite required.)
- `muga/chats/chat1.md`: historical conversation transcript. Do not edit — it is a snapshot, not a live artifact.

### Tests

- 4 test files contain "privacy proxy" in name or content: `tests/unit/service-worker-privacy-proxy.test.mjs`, `tests/e2e/privacy-proxy.spec.mjs`, `tests/unit/wrapper-engine-privacy-proxies.test.mjs`, `tests/unit/proxy-navigate.test.mjs`. Rename/update in P4.1 / #658 as part of the URL Unwrapper rebrand.

## What is explicitly out of scope for this ADR

- Direct partnerships with AliExpress, CJ, Awin, or others (MUGA opening its own accounts on redirect networks for optional injection): a roadmap question for 2.2+, deliberately not bundled here.
- Adding telemetry of any kind on the client: not on the table. The synthetic harness and the aggregate unwrap observability cover the highest-risk gaps without compromising the no-client-telemetry stance.
- Changes to the per-device consent model (ADR-0001): no impact from this pivot.
- Rebranding the extension name in Chrome/AMO listings: name stays "MUGA: The denoise extension for the web."

## Implementation references

The campaign is broken into 23 issues under [milestone v2.1.0: Denoise pivot](https://github.com/yocreoquesi/muga/milestone/5). The critical path that blocks the Chrome/AMO resubmit is:

#645 → #646 → #649 → (#653, #654, #655) → #656 → #657 → #660 → #663 → #664 → #665 → #666

Parallelizable once this ADR is merged: #647, #648, #650, #651, #652, #658, #661, #662.

PR for this ADR ships alongside small targeted edits to `README.md` (line 18: drop "we refuse to collaborate") and `CONTRIBUTING.md` (line 11: drop "We only support direct-injection programs" — that becomes false in P2.2).
