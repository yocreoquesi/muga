# ADR-0001: Per-device consent state

**Date**: 2026-04-29
**Status**: Accepted
**Issue**: [#348](https://github.com/yocreoquesi/muga/issues/348) (parent PRD), [#355](https://github.com/yocreoquesi/muga/issues/355) (this slice)

## Context

MUGA stores three pieces of consent metadata at onboarding time:

- `onboardingDone` — boolean, gates whether the cleaner is active.
- `consentVersion` — string, identifies which version of the Terms of Service the user accepted.
- `consentDate` — Unix-ms timestamp of acceptance.

Until #355, all three lived in `chrome.storage.sync` alongside the user's behavioural preferences. The browser's sync layer propagates them across every device the same Google profile (Chrome) or Mozilla account (Firefox) is signed into.

That has a real privacy and disclosure consequence:

> A user who completes MUGA's onboarding on Device A — sees the ToS, sees the affiliate disclosure, sees the privacy statement, opts in or declines explicitly — and then installs MUGA fresh on Device B with the same synced profile, **never sees the onboarding flow on Device B**. The synced `onboardingDone: true` arrives via storage sync; the trigger logic in the service worker reads it and skips the onboarding tab. The user receives the same software running with the same accepted-or-not preferences as their other device, but on Device B they were never given the opportunity to read or reject those terms.

This contradicts MUGA's transparency pitch ("the popup tells you, every time"; "off by default and disclosed during onboarding") for any user with more than one device. The contradiction is silent and has shipped since v1.0.0.

The same surface affects ToS evolution: the `consentVersion` field exists explicitly to support re-onboarding when the ToS materially changes (#348 slice 4 / #370). Putting it in sync means a user who declines a re-onboard on Device A would have their decline propagate to Device B, which has not yet seen the new terms — a different but equally wrong outcome.

## Decision

**Consent state is per-device. It lives in `chrome.storage.local`, not `chrome.storage.sync`.**

Concretely:

1. A new `consent-storage` module owns reads and writes of `onboardingDone`, `consentVersion`, and `consentDate`. The module stores a single record under `chrome.storage.local["mugaConsent"]`. No code outside the module references those fields in `chrome.storage.local` directly.
2. A `sync-migration` module performs a one-shot migration on extension upgrade. Existing installs whose consent fields still live in sync are migrated transparently to local; the legacy keys are removed from sync. The migration is idempotent and tolerant of partial state — a half-completed run on first wake completes cleanly on the next.
3. The legacy fields stay in `PREF_DEFAULTS` for the migration window. `getPrefs()` overlays the per-device consent values on top of the sync read so existing call-sites do not change. Callers that explicitly want to write consent (currently: the onboarding page) use `consent-storage.setConsent()` directly. After the migration window closes, the fields can be removed from `PREF_DEFAULTS` entirely (follow-up).

Behavioural preferences (`injectOwnAffiliate`, `remoteRulesEnabled`, `language`, blacklist, whitelist, etc.) **continue to live in `chrome.storage.sync`**. They are user preferences that legitimately should follow the user across devices. The decision here is specifically about *consent state*, not about all preferences.

The follow-up slice #364 closes the cross-device disclosure gap by surfacing explicit per-device confirmation prompts when synced behavioural prefs (specifically `injectOwnAffiliate` or `remoteRulesEnabled`) arrive enabled on a fresh device. That work depends on this ADR's storage split and is filed separately.

## Alternatives considered

**Alternative A — leave consent in sync, add a per-device "device confirmed" flag in local.**
The flag would gate onboarding-skip independently of `onboardingDone`. Less code to write, but the consent model remains conceptually account-scoped ("you accepted on this account") with a device-scoped exception bolted on. ToS version evolution becomes harder to reason about: would the cross-device decline propagate? what happens when the device flag is absent but the version flag is current? Rejected because the conceptual model gets harder, not easier.

**Alternative B — keep consent in sync; require all installs to re-onboard regardless.**
Simplest possible model: any new install always shows onboarding. Sync-stored `onboardingDone` becomes informational only. Rejected because users with multiple devices would be forced to re-accept terms on each one even when nothing has changed — a bad UX trade for a bad reason ("we couldn't decide where consent lives, so we made the user pay every time").

**Alternative C — drop sync entirely; everything in local.**
Loses cross-device behavioural-preference sync, which is a real feature users rely on (a custom blacklist on the laptop should follow to the tablet). Rejected — the trade-off is worse than the problem we are solving.

**Alternative D (chosen) — split: consent local, behavioural prefs sync.**
The conceptually clean answer. Each piece of state lives where its semantics actually fit: consent is an act of acceptance that happens *at* a device with *that* device's user, and behavioural preferences are settings that follow the user.

## Consequences

**Positive:**

- Each device's user explicitly sees and accepts (or declines) the ToS, affiliate disclosure, and privacy statement. The transparency pitch holds for multi-device users.
- ToS version evolution (#348 slice 4 / #370) becomes well-defined per device. A user who declines a re-onboard on Device A does not affect Device B's still-pending re-onboard — Device B asks for the new terms when its user opens the popup or service worker wakes.
- Cleaner mental model: "what ran on this device" is local; "what does the user prefer" is sync.

**Negative:**

- Slightly more storage I/O at startup (`getPrefs()` now reads from sync and from local). The cost is two parallel I/O calls, not sequential, and the consent record is a small object — measured impact is negligible against existing prefs reads.
- One-shot migration code lives in the codebase indefinitely (it must keep running for users who skip many releases before upgrading). Acceptable cost.
- The `injectOwnAffiliate` / `remoteRulesEnabled` cross-device blind spot — users whose sync arrives with these flags enabled — is **not** closed by this ADR alone. #364 closes it by surfacing per-device confirmation prompts during onboarding. This ADR provides the storage split that makes #364 possible; the disclosure fix is its dependent slice.

**Neutral:**

- Behavioural preferences stay synced. No regression for users relying on cross-device pref sync.
- The migration is invisible to existing users: a single startup pass copies their state into local, and they continue using the extension as before.

## Implementation references

- `src/lib/consent-storage.js` — the storage module
- `src/lib/sync-migration.js` — the migration helper
- `src/lib/storage.js:getPrefs` — overlay logic
- `src/onboarding/onboarding.js` — write path post-acceptance
- `src/background/service-worker.js` — migration is invoked on startup
- Tests: `tests/unit/consent-storage.test.mjs`, `tests/unit/sync-migration.test.mjs`
