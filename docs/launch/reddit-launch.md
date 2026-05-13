# Reddit launch: alternative-to-incumbent angle

**Audience.** Privacy enthusiasts in `/r/firefox`, `/r/chrome`, `/r/privacy`, `/r/privacytools`. They already use ClearURLs / AdGuard / Brave's cleaner. The pitch is **alternative**, not "everything else is broken".

**Timing.** Post 24 hours after the ProductHunt launch so the PH ranking can echo into Reddit. Stagger the four subs by ~6 hours each; don't crosspost simultaneously, the spam filters dislike that.

**Account hygiene.** The posting account needs prior activity in those subs (comments, not just submissions). Brand-new accounts get auto-removed by AutoModerator on most privacy subs. Use a real account.

---

## Suggested order + 24h offsets

1. **`/r/firefox`.** First. Most active about extensions. Use the AMO link as primary.
2. **`/r/chrome`.** +6h. Use the CWS link.
3. **`/r/privacy`.** +12h. Use the GitHub link as primary; stores secondary. This sub respects open source.
4. **`/r/privacytools`.** +24h. Smaller, more critical. Be ready for a deep architectural Q&A.

Don't post in `/r/browsers` or `/r/internetisbeautiful` (wrong audience, will be downvoted as off-topic).

---

## Title: Reddit (≤300 chars per sub)

**Single canonical title:**

```
MV3-ready ClearURLs alternative with signed remote rules and a "fair to creators" affiliate policy
```

This title earns its keep:
- "MV3-ready" engages the "is X dead under MV3?" anxiety.
- "ClearURLs alternative" sets expectations, anchors to the incumbent.
- "signed remote rules" earns engineering trust without going into Ed25519 detail.
- "fair to creators affiliate policy" is the wedge, in scare quotes for honesty.

**Per-sub variants** (only if the canonical doesn't fit the sub's tone):

- `/r/firefox`: `MUGA: MV3/MV2-compatible URL cleaner with signed rules + creator-friendly affiliate handling`
- `/r/chrome`: `Open-source MV3 URL cleaner that strips trackers but keeps creator affiliate tags`
- `/r/privacy`: `MUGA: open-source URL cleaner with zero telemetry, signed remote rules, GPL v3`
- `/r/privacytools`: same as canonical.

---

## Body: Reddit

```
TL;DR: I built an open-source URL cleaner that strips the same trackers
ClearURLs / AdGuard / Brave do (utm_*, fbclid, gclid, 450+ params), but
preserves the creator's affiliate tag instead of stripping it along with the
trackers. Source, stores, comparison page below.

Why this exists: every URL cleaner I tried treats `?tag=YouTuberX` the same
way as `?utm_source=newsletter`. They both get stripped. That makes the user's
URL cleaner-looking, but it also silently zeroes out the YouTuber, newsletter
writer, or independent reviewer who recommended the link in the first place.
Their affiliate tag is how they get paid for the recommendation.

MUGA strips the trackers, keeps the creator tag, and tells you it did with a
"Creator referral preserved" badge in the popup. You can verify which one was
preserved on every click.

How it compares (full table on the comparison page, this is the short
version):

| | MUGA | ClearURLs | AdGuard | Brave |
|---|---|---|---|---|
| Strips utm_*, fbclid, gclid, 450+ params | yes | yes | yes | yes |
| Unwraps Awin / Skimlinks / etc. before tracker contact | yes | partial | partial | no |
| Preserves creator affiliate tag | YES | no | no | no |
| MV3 native | yes | partial | yes | yes |
| Zero telemetry | yes | yes | partial | partial |
| Open source | yes (GPL v3) | yes | partial | partial |
| Signed remote rules pipeline | yes (Ed25519) | no | no | no |

Not trying to dunk on the others; I run ClearURLs myself and have for years.
This is one specific decision they all made the same way; MUGA made it
differently. If you don't care about creator referrals, ClearURLs is great
and you should keep using it. If you do, this is for you.

Architecture notes for the curious:
- MV3-native on Chrome (declarativeNetRequest), MV2 on Firefox AMO. Same
  source, both ship from the repo.
- Service worker handles badge + stats + optional weekly rules update. URL
  cleaning runs in the content script. The SW never sees the URL.
- Optional remote rules signed with Ed25519, verified fail-closed in the SW.
  Off by default. The pinned public key is in the source.
- Zero telemetry. No analytics, no crash reporting. The transparency page
  enumerates every storage write the extension makes.

Stores:
- Firefox: https://addons.mozilla.org/firefox/addon/muga/
- Chrome: https://chromewebstore.google.com/detail/muga-clean-urls-fair-to-e/pjdpeamhcjdhfijpmgamjdoplbnbajoh

Source: https://github.com/yocreoquesi/muga (GPL v3)
Comparison page: https://rules.muga.app/comparison.html
Landing: https://muga.app/

Happy to answer anything: wedge, architecture, or "why didn't you just PR
this into ClearURLs". Spoiler on the last: I tried, it's a different design
philosophy and would have meant introducing the affiliate concept into a
project that has explicitly chosen not to engage with it. Different goals,
both valid.

Open to feedback. If you spot a tracker MUGA missed, there's a one-click
report button in the popup that opens a structured GitHub issue (names only;
no values, no full URLs).
```

---

## Reply playbook

### "AdGuard is also open source, the table is wrong."

> Fair point: AdGuard's core engine is open source (GPL); the desktop app is mixed. Updated the table to "partial" for that row. Will fix on the comparison page too. Thanks for the correction. *(Then actually open a PR fixing comparison.html.)*

### "Why not contribute to ClearURLs instead of forking?"

> Tried. The affiliate-preservation principle is a foundational design choice, not a feature flag; ClearURLs's stated philosophy is "all params equal, all suspicious". Adding a "preserve this category" code path would require the project to take a position on affiliate ethics, which they've explicitly chosen not to do. So a separate project made more sense than fighting that. Both can exist.

### "Is this another Brave-style 'affiliate hijacking'?"

> The distinction matters. Brave's controversy was about INJECTING their own affiliate tag onto links that didn't have one. MUGA has a setting for that (auto-injection of MUGA's own tag on a small set of supported stores when the URL arrives with NO tag at all), but it's OFF by default and there's a per-device confirmation flow before any tag is ever injected, disclosed during onboarding and documented on the transparency page. The default behaviour is: if a creator's tag is already on the URL, keep it. If no tag, no tag. MUGA never replaces a creator's tag with its own.

### "How do you classify what's an affiliate tag vs a tracker?"

> Static lookup table in `src/lib/affiliates.js` plus per-domain rules in `src/rules/domain-rules.json`. No ML, no inference, no remote service. You can read every classification and PR a fix if any of them is wrong. The decision algorithm and its test vectors are published in `docs/rules/decision-algorithm.md` and `tests/rules-vectors/` so the classification is auditable against a written contract.

### "What's stopping you from going closed-source after I install?"

> GPL v3 license terms: every published version IS the open-source version. Each release `.zip` on AMO and CWS can be diffed against the corresponding tag in the GitHub repo (CWS doesn't make this trivial; on Firefox the .xpi is just an extracted-archive). There's a transparency page in the extension that explains how to verify this yourself. If a future version were closed-source, GPL would be violated and that would be public news fast.

---

## AutoModerator survival kit

Some of these subs auto-remove "Show off" / promo posts unless they meet thresholds. Mitigations baked into the body above:

- ✅ Concrete comparison table (not "we are the best").
- ✅ Acknowledges the incumbent positively.
- ✅ Open source + free + no upsell.
- ✅ Architecture details, not just feature claims.
- ✅ Account has prior comment history in the sub (PRECONDITION: verify before posting).

If a post gets auto-removed, message the mods (NOT in the post; modmail). Do not repost: the duplicate-detection on most privacy subs is harsh.

---

## Self-check

- [ ] Title fits each sub's character limit.
- [ ] Comparison table is accurate as of the day of posting (re-verify each row).
- [ ] No superlatives, no "the only", no "the best".
- [ ] Account has prior comment activity in the sub (NOT just submissions).
- [ ] Comparison-page URL is reachable (Wave 1 prerequisite).
- [ ] Don't crosspost simultaneously to all four subs. 6h staggered.
- [ ] Replies are drafted but live in this file; don't pre-paste.
