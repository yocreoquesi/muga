# ADR-0007: Terms available, not accepted — adopt the uBlock Origin model

**Date**: 2026-08-02
**Status**: Accepted — documents architecture shipped across a 2-PR chain
**Issue**: none tracked separately; replaces the unshipped Phase 3 of the browsewrap chain (#1193, #1194)
**Builds on**: [ADR-0001](./0001-per-device-consent.md) (per-device consent record, which survives this change)
**Supersedes**: the versioned re-acceptance model introduced in #365 / #370
**Milestone**: none (post-2.6.0 maintenance change)

## Context

MUGA shipped a versioned consent engine: a manifest of Terms versions, a clause
list per version, and a policy that compared the user's stored `consentVersion`
against a required one and returned `valid`, `soft-reonboard` or
`hard-reonboard`. The onboarding page rendered a different mode for each, and
`getPrefs()` forced `onboardingDone:false` on a material bump so every feature
gate closed until the user re-accepted.

The browsewrap chain then converted the forced acceptance gate into
acceptance-by-use: #1193 made a fresh install record acceptance implicitly, and
#1194 split shortener resolution by privacy risk. Phase 3 was to be a
"conspicuous browsewrap notice" written across seven locales.

Three things were true when Phase 3 came up for implementation:

1. **The versioning was redundant with the text it protected.** Section 1 of the
   Terms already read *"By installing or using MUGA you agree to be bound by
   these Terms"*. That is browsewrap. The engine sat on top of a document that
   already declared acceptance by use, and what it added was the ability to
   re-prompt.

2. **It was expensive.** `consent-policy.js`, `consent-version-manifest.js` and
   `consent-clauses.js` plus their unit tests came to roughly 1,000 lines whose
   only job was deciding when to interrupt a user about a document change.

3. **`main` was in the worst of both states.** Phase 1 had removed the
   affirmative acceptance step and Phase 3 had not yet added the notice that
   replaces it, so acceptance was implicit with nothing making the Terms
   conspicuous.

The comparison that decided it: **uBlock Origin has no Terms of Use at all.**
Its privacy policy is a wiki page stating "uBO does not collect any data of any
kind"; there is no acceptance flow, no consent step, and no re-prompt. It ships
on the same stores as MUGA and fetches remote filter lists the same way. For an
extension of this shape the model is demonstrably viable.

MUGA's Terms were then read against what they actually contain: sections 2 and 4
describe behaviour, which belongs in a privacy policy and a store listing rather
than a contract; sections 8 and 9 are a warranty disclaimer and a liability
limitation, which GPLv3 sections 15 and 16 largely already provide, MUGA being
GPLv3; section 7 is the GDPR Article 8 age threshold, which is arguably moot for
software that processes no personal data.

## Decision

**The Terms are available and linked. They are never accepted, and changing
them never re-prompts or re-gates an existing user.**

Removed: `consent-policy.js`, `consent-version-manifest.js`,
`consent-clauses.js` and their tests; the `hard-reonboard` gate in `getPrefs()`;
the delta and material re-onboard modes with their banners and e2e spec; the
onboarding acceptance checkbox; and five orphaned i18n keys across all seven
locales.

Kept, and each for a specific reason:

- **`consent-storage.js`.** Despite the name it is not the Terms engine. It is
  the per-device record from ADR-0001 that `prefs.js`, `sync-migration.js` and
  `synced-affiliate-pref-guard.js` read for the preference overlay. Deleting it
  would break preferences, not consent. It gains a `TERMS_VERSION` constant that
  records which wording a user was shown and is read by nothing.
- **`tos.html` and `privacy.html`.** This is where MUGA deliberately stops short
  of uBO, which has no Terms at all. GPLv3 disclaims warranty over the *source
  code*, while section 1 of the Terms scopes the GPL to the code and the Terms
  to use of the extension. Deleting a written liability limitation to save an
  HTML file is not a trade worth making.

Replacing the ceremony, the documents became reachable rather than announced
once: a plain note on the onboarding page stating what happens, a permanent
quiet legal line in the popup, and a Terms link in the Settings footer beside
the Privacy link that was already there.

## Rationale

Acceptance-by-use is only defensible if the documents are genuinely available.
The engine that was removed made them *interruptive*, which is a different
property and a worse one: it trained users to dismiss a dialog, and it bought
nothing that a permanently reachable link does not.

The onboarding checkbox is worth calling out. Phase 1 left it in place as
"informational" after it stopped gating the Start button. A checkbox that gates
nothing and records no decision is worse than no checkbox, because a user who
ticks it reasonably believes something was registered. Half-measures in a
consent surface are the one place where doing less is safer than doing some.

## Consequences

**Accepted, and the significant one.** The weekly signed GET to
`rules.muga.app` was gated on the consent version that disclosed it (#888 review
C1): a user still at stored version `1.0` was blocked until they accepted a
delta re-onboard. That coupling disappears with the engine, and such a user now
makes the request on the next service-worker wake, without having seen that
disclosure.

This was accepted on uBO's own reasoning: the Terms describing the request are
available and linked, the request is Ed25519-signed with credentials omitted and
carries no data about the user, and Settings turns it off, returning MUGA to
making no outbound requests. Two alternatives were considered and declined — a
one-time migration writing a per-device `remoteRulesEnabled:false` for `1.0`
records, and keeping a version floor on this one gate — because both reintroduce
versioning to protect a request that the current Terms already describe.

The decoupling is marked deliberate in a comment on the production gate, and a
test pins the new behaviour so it cannot regress back silently.

**Related finding.** Investigating that gate showed the request was never
permission-gated in the first place: `rules.muga.app` sits in
`optional_host_permissions`, but `host_permissions` declares `<all_urls>`, which
covers it, and `chrome.permissions.contains()` reports coverage rather than
exact declaration. `tests/e2e/remote-rules-fresh-install.spec.mjs` pins this in
a real browser. A comment in `remote-rules-status.js` had claimed the opposite.

**Giving up the ability to re-prompt is the real cost.** If a future change to
the Terms is material enough that existing users genuinely must be told, there
is no longer a mechanism to tell them, and building one back is a deliberate
decision rather than a version bump. The migration-banner path (`#1100`) exists
and is the place to start if that day comes.

**Not legal advice.** This ADR records an engineering decision about where
consent machinery belongs. The judgement that GPLv3 plus available Terms is
adequate for MUGA's position was made without counsel, and is worth revisiting
if the project's user base or jurisdiction exposure changes materially.
