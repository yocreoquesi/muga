# ADR-0006: Remove MUGA's own-tag affiliate injection

**Date**: 2026-07-28
**Status**: Accepted — documents architecture shipped across a 4-PR chain (#1182, #1184, #1185, this PR)
**Issue**: none tracked separately; superseded the injection half of the affiliate model introduced pre-2.1
**Builds on**: [ADR-0002](./0002-denoise-pivot-creator-agnostic.md) (creator-agnostic denoise pivot; preservation of third-party referrals predates and outlives this change)
**Supersedes**: the "MUGA injects its own affiliate tag on supported stores" monetization model described in earlier README/FAQ/privacy revisions
**Milestone**: none (post-2.6.0 maintenance change)

## Context

Since early releases, MUGA has run two independent affiliate behaviors on a small set of supported stores (Amazon, eBay):

1. **Preservation** — if a link already carried a creator's or a third party's affiliate tag, MUGA left it in place by default. This is the "Creator referral preserved" narrative and remains unchanged by this ADR.
2. **Own-tag injection** — if a link arrived with **no** affiliate tag at all on one of those stores, MUGA added its own tag (`OUR_TAGS` / `resolveOurTag()` in `src/lib/affiliates.js`, `injectOwnAffiliate` pref, on by default for new installs) so the maintainer could earn a commission on qualifying purchases. This was disclosed during onboarding and could be turned off in Settings.

Two problems surfaced with behavior 2:

- **Program compliance.** The Amazon Associates Program Operating Agreement prohibits using Associates links "in any software application, browser plug-in, or browser extension" in a way that automatically inserts or substitutes an affiliate tag without the user's own deliberate placement of that specific link (§7(a)), and separately requires that Associates links appear on a site or app the Associate operates, not be injected client-side into arbitrary third-party pages the extension happens to be cleaning (§9). MUGA's own-tag injection, however narrowly scoped and however clearly disclosed, sat on the wrong side of both clauses.
- **Principle collision.** MUGA's stated positioning is that it never hijacks attribution and never decides on the user's behalf who gets credit for a link. Own-tag injection was the one place MUGA itself acted as an affiliate party inserting its own attribution onto a link that had none, which is in tension with that principle even though it never touched an existing third-party tag.

Revenue from this feature was low at MUGA's current scale (a small set of eligible stores, only on links that arrived completely tagless), so the compliance and principle costs were not offset by material sustainability benefit.

## Decision

**MUGA no longer adds any affiliate tag of its own, anywhere, on any store.** The entire own-tag code path is removed, not disabled: `OUR_TAGS` and `resolveOurTag()` are deleted from `src/lib/affiliates.js`, the injection steps in `src/lib/cleaner.js` (extension) and the equivalent logic in the web-tool adapters (`web/engine/adapter.js`, `landing/clean/engine/adapter.js`) are gone, the `injectOwnAffiliate` preference and its onboarding/Settings UI are deleted (with a storage migration removing the stored key), and every user-facing surface (extension UI strings, privacy policy, terms of service, FAQ, README, web tool copy, landing page) now describes the current, present-tense behavior instead of the retired one.

The removal shipped as a 4-PR chain to keep each review scoped:

1. **PR 1a** (#1182) — core removal from the cleaning engine (`affiliates.js`, `cleaner.js`, content script, service worker, rule schema).
2. **PR 1b** (#1184) — removal of the `injectOwnAffiliate` preference, its onboarding confirmation step, and the storage migration that drops the stored key from existing installs.
3. **PR 2** (#1185) — removal of the now-dead own-tag scaffolding in the web-tool adapters.
4. **PR 3** (this PR) — the narrative layer: every doc, legal page, locale string, and web-tool disclosure UI element that referenced the retired feature is rewritten or removed so no surface still describes MUGA as adding its own tag.

What MUGA keeps unchanged: **preservation stays the default.** If a link already carries a creator's or a third party's affiliate tag on a supported store, MUGA leaves it in place, so that person keeps their credit. Stripping third-party tags remains available as an explicit, off-by-default opt-in ("Remove all affiliate tags from other sources"), and it no longer has any own-tag side effect to interact with, since there is no own tag left to add back.

## Rationale

- **Compliance first.** Removing own-tag injection entirely, rather than reworking it, is the only way to be unambiguously clear of Amazon Associates Operating Agreement §7(a)/§9 concerns. A narrower fix (e.g. gating injection further) would still leave MUGA as a browser extension automatically inserting an affiliate tag, which is the exact pattern §7(a) addresses.
- **Principle consistency.** MUGA's brand promise is "never hijack attribution, always respect who a creator's referral belongs to." A feature where MUGA itself becomes the party benefiting from an untagged link is inconsistent with that promise even when scoped and disclosed.
- **Low opportunity cost.** The feature only ever fired on a couple of programs and only on links that arrived with zero existing tag, a narrow slice of traffic. Removing it trades a small, legally fragile revenue stream for a simpler, fully defensible affiliate story.
- **Full removal over a flag flip.** Deleting the code (rather than defaulting the pref off) avoids leaving dead, exploitable, or confusing logic in the codebase, and lets every doc and locale string be rewritten in present tense without hedging about a disabled-but-present feature.

## Consequences

- **No passive affiliate revenue from MUGA's own tag.** The maintainer no longer earns a commission on tagless links to supported stores. Sustainability continues to rely on voluntary support (GitHub Sponsors, Ko-fi) and the low operating cost of a client-side-only extension.
- **Preservation and cleaning are unaffected.** Every other affiliate behavior (creator-tag preservation, third-party stripping opt-in, redirect-network pass-through) is unchanged; this ADR only removes the injection half.
- **Simpler affiliate story going forward.** MUGA's affiliate model is now a single sentence: it never adds a tag of its own, and by default it respects whatever referral a link already carries. Any future monetization must be explicit, opt-in, and independently reviewed for program compliance before it ships; it can no longer piggyback on the retired injection path.
- **Storage migration required for existing installs.** The `injectOwnAffiliate` key is actively removed from `chrome.storage.sync` on upgrade (PR 1b) rather than merely ignored, so no stale, unreadable preference lingers in user storage.
