# MUGA — ProductHunt Launch

> Version: 1.7.0
> Created: 2026-03-22

---

## Taglines

**Primary:**
435 trackers stripped. Automatically. Before the page loads.

**Alternative 1:**
Your links arrive dirty. MUGA cleans them.

**Alternative 2:**
Clean URLs. Before the page loads. Never replaces a creator's tag.

---

## 240-char description (ProductHunt)

Every URL you click is packed with trackers — UTMs, fbclid, gclid, Amazon noise, YouTube tokens. MUGA strips 435 of them before the page loads. AMP redirect, ping blocking, redirect unwrapping. Affiliate injection is opt-in and never replaces another creator's tag.

*(264 chars — trim to fit if needed:)*

Every URL you click is packed with trackers. MUGA strips 435 automatically — UTMs, fbclid, gclid, AMP links, ping beacons. Affiliate injection is opt-in, transparent, and never replaces another creator's tag. Open source.

*(222 chars — use this one)*

---

## Maker comment (launch day)

---

Hey PH — I'm Isabela, one of the people behind MUGA.

The short version: we built this because too many extensions manipulate your links without telling you. Affiliate tags get swapped, tracking params pile up, and nobody asks permission. We wanted to prove you can build a useful tool without being shady about it.

We wanted to build the opposite of that.

MUGA strips 435 tracking parameters from every URL you visit — automatically, before the page loads. UTMs, fbclid, gclid, Amazon session noise, YouTube share tokens — gone. You get the clean URL, the page loads normally, and nothing gets logged about where you came from.

The affiliate model works like this: when you navigate to one of 18 supported stores and your link has no affiliate tag, we quietly add ours. You pay the exact same price. The store just knows you arrived via MUGA. That's how the project stays free and maintained.

What we will never do: replace someone else's tag. Not silently, not ever. Enabling that behavior requires a separate, deliberate opt-in that is off by default — and even then, you're shown a toast notification asking you to confirm. The whole thing is disclosed during onboarding, in the Terms of Service, in the privacy policy, and in the source code. GPL v3. Read it.

A few things that might surprise you:

- AMP redirect is built in — Google AMP links go to the real article, automatically
- Right-click any link to copy the clean version without visiting it
- Alt+Shift+C copies the current tab's clean URL to clipboard
- Export / import your full settings as JSON
- MUGA never acts behind your back — no data collected, no account, no telemetry

Happy to answer anything in the comments. If you find a tracking param we're missing, open an issue — we usually ship fixes within 24 hours.

---

## Launch checklist

### T-7 days
- [ ] Confirm extension is published on Chrome Web Store and Firefox AMO
- [ ] Final review of store listing copy (docs/store-listing.md)
- [ ] Screenshots current and sharp (see README for which need retake)
- [ ] Promo tile 1400x560 uploaded to PH gallery
- [ ] ProductHunt profile is set up and linked to GitHub

### T-3 days
- [ ] Schedule launch for 00:01 PST (ProductHunt resets at midnight)
- [ ] Prepare DM list: supporters, friends, people who follow privacy tools
- [ ] Draft the "we're live" tweet / post for X, Mastodon, LinkedIn, Reddit (r/privacy, r/chrome, r/firefox)
- [ ] Notify any influencers or YouTubers who tested the extension early

### Launch day (T-0)
- [ ] Post goes live at 00:01 PST
- [ ] Post maker comment immediately (copy from above, personalize if needed)
- [ ] Share on all channels (X, Mastodon, LinkedIn, Reddit, HN if relevant)
- [ ] Monitor comments — respond to every question within 1 hour
- [ ] DM supporters asking for upvotes and honest feedback
- [ ] Check that Chrome Web Store and Firefox AMO links in the listing are working

### Post-launch
- [ ] Thank everyone who commented
- [ ] File GitHub issues for every bug or feature request mentioned
- [ ] Write a short retrospective (what worked, what didn't)
- [ ] Update CHANGELOG.md with launch date

---

## Suggested hunters

1. **Chris Messina** (@chrismessina) — invented the hashtag, prolific hunter of productivity and developer tools. Hunted many privacy-adjacent products. High reach, credible.

2. **Benedikt Deicke** (@benediktdeicke) — co-founder of Userlist, active in indie hacker / privacy tooling space. Hunted several open-source developer utilities.

3. **Fabian Maume** (@fabian_maume) — growth consultant who hunts frequently and has a track record with privacy, productivity, and browser extension launches. High volume hunter, responsive to outreach.

> Reach out via Twitter DM or LinkedIn at least 5 days before planned launch. Include: what the product does (2 sentences), why it fits their hunting history, and a direct install link for them to try it.
