# ProductHunt launch — UX / wedge angle

**Audience.** Product people, makers, indie hackers, designers. They respond to *story* and *visible UX*, less to architectural detail. The wedge ("creator affiliate preserved") is the lede.

**Posting window.** Same week as HackerNews launch, but on a different day. PH timezone is global; 12:01am PT is the standard "fresh launch" window. Aim for a Tuesday or Thursday post — Monday and Friday are crowded.

**Maker hygiene.** Use the project owner's PH account. Hunter ≠ maker — submit yourself. Pre-launch teaser the day before is fine; "Coming soon" with the wedge tagline.

---

## Tagline (≤60 chars)

```
The first URL cleaner that respects creator affiliate links.
```

**Alternates:**
- `URL cleaner that strips trackers — keeps creator referrals.`
- `Cleans tracking. Keeps the creator paid. Open source.`

Pick the first. It states the wedge, leaves no room for "the most private" / "the best" superlative bait.

---

## Description (≤260 chars per PH limit)

```
Strips utm_*, fbclid, gclid, and 450+ tracking params from every URL. But unlike
every other URL cleaner, MUGA preserves the affiliate tag of the creator who
recommended you — the YouTuber, newsletter, or reviewer who sent you the link.
The popup tells you it did. Open source, zero telemetry.
```

---

## Hero image

The "Creator referral preserved" badge in the popup, captured against a real Amazon affiliate link. **Use a clean macOS-style frame around the popup** (the one in the existing `docs/screenshots/` set). Resolution at least 1270×760. Compressed, ≤500KB.

If using a GIF: 5-second loop. Show the click → URL change → badge appearing → toast confirmation. Optimize with `gifsicle -O3`. Target ≤2MB.

---

## Body / first comment from maker

```
Hi PH — I'm the maker.

Quick story: every URL cleaner I tried strips creator affiliate tags along with
the trackers. ClearURLs, AdGuard, Brave's cleaner, Firefox's built-in cleaner —
all of them remove `tag=`, `ref=`, `aff_id` whenever they remove `utm_source`.

That's a privacy feature for the user, but it's also a quiet pay cut for every
independent reviewer, YouTuber, and newsletter writer whose entire model is
"I recommend something, you click, the merchant sends me a small cut." When
your URL cleaner strips their tag, the merchant attributes the sale to "no
referrer" and the creator who actually sent you there gets nothing.

MUGA strips the SAME trackers as those tools — utm_*, fbclid, gclid, 450+ in
total. But the creator's affiliate tag stays. And the popup tells you so:
"Creator referral preserved". No magic, no judgment from MUGA, you can see
exactly which tag survived and which trackers got stripped.

A few details that might land here:
- Zero telemetry. No analytics, no crash reporting, no user accounts. The
  privacy claim is verifiable by diffing the published extension against the
  GitHub source.
- MV3 native (Chrome) and MV2 (Firefox), shipped from the same source.
- Open source, GPL v3. No funding, no investors. I made the affiliate-respect
  decision because I wanted to use my own URL cleaner without feeling guilty
  about every newsletter creator I clicked through.
- 450+ tracking params, 60+ stores supported, 10+ redirect networks unwrapped.

It's not the most-private cleaner — that depends on what you mean by private.
It's not the most popular — ClearURLs has years of head start. It's the only
one I know of that respects creator referrals without anyone having to ask.
That's the wedge.

Comparison page: <comparison URL>
Source: <github URL>
Install: <CWS> / <AMO>

Feedback welcome — especially from creators reading this. I'd love to hear
whether this matches your model.
```

---

## Hunter / discussion angles

If a hunter (not the maker) lists MUGA, the maker still gets the "Maker" badge by claiming. Reply to early comments quickly — first 4 hours decide rank.

Likely questions + drafted answers:

### "How is this different from ClearURLs?"

> ClearURLs and MUGA strip the same set of trackers — overlap is huge. The difference is one specific decision: when a URL has both a tracker AND a creator affiliate parameter, ClearURLs removes both. MUGA removes the tracker and keeps the affiliate tag. The popup tells you which one was preserved so you can verify. That's the wedge — everything else is overlap.

### "Why should I trust the affiliate-preservation isn't just letting trackers through?"

> Two answers. First: the affiliate-vs-tracker classification is in `src/lib/affiliates.js` — it's a static list, no AI, no inference. You can read it. Second: the popup shows you exactly which params were preserved with the "Creator referral" label. If MUGA ever preserves a tracker by mistake, you can report it via the "Missed tracking parameter" issue template (one click from the popup). It's structurally honest by design.

### "What's the catch? Are you the affiliate?"

> No. MUGA itself isn't an affiliate program — it doesn't inject any tag of its own anywhere. The affiliate tags MUGA preserves are whoever's tag was already on the URL when you clicked. If a YouTuber sent you, their tag survives. If you typed the URL yourself, no tag, nothing to preserve.

### "Does this work for [my favorite store]?"

> The 60+ stores currently supported are listed in the comparison page. If yours isn't on the list and you can paste a documented example of how their direct-injection affiliate system works, the "New affiliate program" issue template will take it from there. Direct-injection only — MUGA refuses programs that route every click through an external tracker (~10 of those exist; they're all rejected on principle).

---

## Self-check

- [ ] Tagline is under 60 chars and states the wedge in active voice.
- [ ] Description fits PH's 260-char limit.
- [ ] Hero image is the popup with the badge, clean macOS frame, ≤500KB.
- [ ] First comment leads with story, not specs.
- [ ] No "please upvote" or asks. PH is allergic to that.
- [ ] Replies are drafted but kept in this file — don't pre-paste.
