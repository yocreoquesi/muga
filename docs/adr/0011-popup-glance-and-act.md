# ADR-0011: The popup is "glance + act" — what it carries, and every pref classified

**Date**: 2026-09-12
**Status**: **Accepted** — the decision is the deliverable. The panel moves it authorises are downstream and unstarted.
**Issue**: [#1340](https://github.com/yocreoquesi/muga/issues/1340) (and [#1271](https://github.com/yocreoquesi/muga/issues/1271) item 3, the popup half of the same question)
**Builds on**: [ADR-0001](./0001-per-device-consent.md) (per-device consent, which is why three consent fields sit in `PREF_DEFAULTS` without being preferences), [ADR-0004](./0004-decommission-unwrap-server-native-shortener-resolution.md) (native shortener resolution, later split into the two prefs classified below), [ADR-0007](./0007-terms-available-not-accepted.md) (no re-acceptance gate)
**Amends**: nothing structurally — no code, markup, or locale changes ship with this ADR
**Milestone**: 3.2.0 for the moves; the decision itself lands now

## Context

#1271 item 3 asked what a browser-action popup exists to show in the two
seconds it is open, and what belongs one click away. It said plainly that it
*"exists to force that decision to be made rather than accumulated."* #1340
restated the same question one level up with the surface measured, and was
equally explicit about the deliverable: *"Removing anything is downstream of
that; the decision is the deliverable."*

So this ADR decides. It moves nothing and removes nothing.

Two of #1271's four items have shipped since it was filed, which narrows what
is left to decide. Item 1 is done: `devToolsMode` is now its own device-local
flag independent of `devMode` (`src/lib/storage.js:183`,
`src/options/options.js:407-420`), so the QA panel is separately gated. Item 2
is done: all four labels now name the outcome rather than the mechanism
("Keep cleaning after the page loads", `src/options/options.html:227`; "Block
click tracking beacons", `:248`; "Experimental: strip params that look like
trackers", `:287`; "Find the real destination when a wrapper hides it",
`:318`). Item 4 is done: the locally-stripped list is ungated, and
`src/options/options.js:585` says so in a comment naming the item. **Item 3 is
the only one still open, and it is the one this ADR closes.**

## The surface, measured against the code

The measurements in #1340 were re-taken against `52545d8`, and two of them
have moved:

| Claim | Issue says | Code says |
|---|---|---|
| Synced prefs in `PREF_DEFAULTS` | 36 | **36** (`src/lib/prefs.js:19-176`) |
| Device-local flags | 2 | **2** — `devMode`, `devToolsMode` (`src/lib/storage.js:135`, `:183`) |
| Controls on the options page | 28 | **28** — 26 checkboxes + 2 selects |
| `src/options/options.js` | 1996 | **1996** |
| `src/popup/popup.js` | 1640 / 1615 | **1638** |
| Lifetime stat tiles in the popup | 3 | **2** — `#1339` removed the third, which could only ever read 0 (`src/popup/popup.html:45-54`, and the comment at `:57-62` records the removal) |

The stat-tile count is the one substantive correction: both issues predate
#1339, and this ADR is written against two tiles.

Everything else #1271 item 3 described is exactly where it said. The popup is
a single scrolling column at roughly 380 px:

- enable/pause toggle — `src/popup/popup.html:23`
- migration banner — `:32-43`
- two lifetime stat tiles plus a zero state — `:45-64`
- **domain-stats collapsible** — `:66-73`, rendered by `showDomainStats`
  (`src/popup/popup.js:920-982`)
- **suspicious-params collapsible** — `:75-81`, rendered by
  `showSuspiciousParams` (`popup.js:983-1147`) plus its four helpers
  `_appendStripLocallyButton` (`:1148`), `_appendReportUpstreamButton`
  (`:1243`), `_renderStripLocallyCount` (`:1330`) and
  `_flashStripLocallyMessage` (`:1371`)
- **"This session" collapsible** — `:83-86`, rendered by `showHistory`
  (`popup.js:1509-1636`)
- per-page preview: pause control, before/after, length bar, unwrap note,
  badges — `:88-120`
- **report flow** — `:121-127`, wired inside `showUrlPreview`
  (`popup.js:636-645`, `:844-912`)
- **recent-activity ledger** — `:137-143`, rendered by `showRecentActivity`
  (`popup.js:1398-1508`)
- rating nudge — `:145-147`
- footer with a Settings link — `:152-154`

The four panel renderers occupy `popup.js:920-1636` without a break: **717 of
1638 lines, 44% of the file, is panels that are not the glance.** That is the
measurement that settles the question.

#1271's evidence for "the popup absorbed Settings content" was that
`report-include-url-row` appears in both surfaces. That is true as a **CSS
class** (`src/popup/popup.css:431`, `src/options/options.css:623`) and as a
duplicated flow, but the two element ids differ — `report-include-url-row` in
the popup (`popup.html:122`) against `url-report-include-url-row` in Settings
(`options.html:534`). The duplication is real and worse than the issue
implies in one respect and better in another: the Settings copy lives *inside
the Developer tools card*, bound to the raw URL tester
(`options.html:522-541`, `options.js:1483`, `:1528`), so it is reachable only
behind `devToolsMode`. There is therefore **no user-reachable report flow in
Settings today** — only a QA one.

## Decision 1 — the popup is "glance + act"

**The popup exists to answer, in about two seconds, two questions: did MUGA
clean this page, and do I want it on here.** Everything that is a record or
an analysis rather than a glance belongs in Settings.

The two-second budget is not a style preference, it is the medium. A
browser-action popup is dismissed by the next click anywhere on the page; it
has no scroll position to return to, no URL, no back button, and no history.
A panel a user has to expand, read, and reason about is a panel they will
expand at most once, because next time the popup opens it is collapsed again
and the data has changed. Settings is the surface with a stable address and
an unbounded viewport. Content whose value depends on being *studied* is
mis-housed in a surface that cannot be returned to.

"Act" is deliberately narrow: the only action the popup owes the user is the
one that needs no thought — on/off, here or everywhere. Actions that require
a decision (promote a param to a permanent strip rule, file an upstream
report) are not glance actions, whatever their widget size.

## Decision 2 — what the popup keeps

| Keeps | Why it is a glance or an act |
|---|---|
| Enable / pause toggle (`popup.html:23`, `:96-98`) | The act. This is the whole reason the popup has a button rather than being a badge. |
| This page's result: before → after (`:99-100`) | The answer to "did MUGA clean this page", in the most direct form available. |
| Length bar (`:103-108`) | The same answer, pre-read. A user takes it in without reading a number. |
| Unwrap note (`:109`) | A one-line statement that the destination changed, which is the one cleaning outcome a user cannot infer from the URL diff alone. |
| Badges: removed / preserved / honored (`:110-119`) | Each is a single fact about *this* page, already computed. |
| Two lifetime stat tiles (`:45-54`) | A glance at a running total, not an analysis. Two numbers with no interaction. Deliberately *not* the per-domain breakdown, which is the same data turned into an analysis. |
| Zero state (`:62-64`) | Makes the glance legible on a fresh install, where bare zeros read as "broken" (#1260). |
| Migration banner (`:32-43`) | Transient and important. It is an act, it expires, and it is the one thing that earns an interruption. |
| Rating nudge (`:145-147`) | Not a glance, but it is not content either: it is a single dismissible ask that does not compete with the answer. Kept on that basis, not on the glance test. |
| A link through to the detail in Settings (`:152`) | The escape hatch that makes everything below affordable to remove. |

## Decision 3 — what moves to Settings

All of it moves. None of it is deleted.

| Moves | Why it is not a glance |
|---|---|
| Domain-stats collapsible (`popup.html:66-73`, `popup.js:920-982`) | A ranked table answering "where does the noise come from over time". That is a question about history, asked deliberately, and the answer rewards study. |
| Suspicious-params collapsible (`popup.html:75-81`, `popup.js:983-1397`) | Two heuristic breakdowns plus two decision-bearing actions (strip locally, report upstream). Promoting a param to a permanent global strip rule is the single highest-consequence thing a user can do in MUGA (it writes `userCustomRules`, which applies on every host) and it is currently two clicks deep in a surface tuned for two seconds. |
| "This session" collapsible (`popup.html:83-86`, `popup.js:1509-1636`) | A ledger. By definition a record, not a glance. |
| Recent-activity ledger (`popup.html:137-143`, `popup.js:1398-1508`) | The same, persisted across service-worker restarts. Two ledgers in one popup is the clearest symptom of accumulation rather than decision. |
| Report flow (`popup.html:121-127`, `popup.js:844-912`) | A form with a confirmation checkbox about sending a full URL. A user should be reading that carefully, which is the opposite of the popup's budget — and Settings already hosts the flow, if only behind `devToolsMode`. |

**Where they land is not decided here.** Settings today has the *toggles* that
gate these panels but none of the views: `options.html` contains no
domain-stats table, no suspicious-params list, no session history and no
ledger. Only `#user-custom-rules` (`options.html:109-115`) is a real mirror of
popup state today. Building the destination is the downstream work.

## Decision 4 — every pref, classified

All 36 keys in `PREF_DEFAULTS` (`src/lib/prefs.js:19-176`), verified by
reading the object rather than trusting the issue's count.

**user choice** — a genuine preference a user might reasonably want set
differently. **internal-with-a-default** — grew a toggle because a toggle was
the easy way to make something testable or reversible; a candidate for a sane
default and no control. **trust-critical** — must stay visible whatever else
is simplified, because a user might reasonably want to check it before
trusting the extension.

| Pref | Bucket | Reasoning |
|---|---|---|
| `enabled` | user choice | The act itself. The one control the glance exists to reach. |
| `notifyForeignAffiliate` | user choice | Whether an interruption fires when another party's tag is seen. A taste preference about notifications. |
| `stripAllAffiliates` | **trust-critical** | Named by #1340. Decides whether MUGA removes every affiliate tag or preserves the creator's. A user cannot evaluate MUGA's affiliate posture without seeing this. |
| `blacklist` | user choice | Per-host opt-out data the user authored. |
| `whitelist` | user choice | Per-host preserve data the user authored. |
| `customParams` | user choice | A user-authored always-strip list. |
| `dnrEnabled` | internal-with-a-default | Selects which of two matchers strips: the declarative network layer or the runtime cleaner. Both implement the same predicate, and `tests/unit/dnr-runtime-parity.test.mjs` exists precisely to keep them from diverging. A user has no basis on which to prefer one, and its honest label would be "clean slightly later, same result". |
| `activeDefenseEnabled` | user choice | Its own comment (`prefs.js:27-33`) states the user need: "users can opt out if these scripts break a site (e.g. rt.com comments, #1006)". A real breakage escape hatch. |
| `contextMenuEnabled` | user choice | Whether MUGA adds an entry to the browser context menu. Visible clutter the user owns. |
| `blockPings` | user choice | DOM-layer beacon defusing, on by default, with genuine breakage potential on click-tracked navigation. |
| `suppressReferer` | user choice | Opt-in aggressive privacy that can break referrer-gated sites. The tradeoff is the user's to make. |
| `blockBeacons` | user choice | Same shape, network layer. Distinct from `blockPings` and correctly so. |
| `ampRedirect` | user choice | Some users prefer AMP pages. Where you land is a preference. |
| `unwrapRedirects` | user choice | One of MUGA's two identity behaviours, but it rewrites destinations, so the opt-out is legitimate. |
| `language` | user choice | Seven locales ship. Plainly a choice. |
| `onboardingDone` | internal-with-a-default | Not a preference: a consent record. Its canonical home is `chrome.storage.local` via `consent-storage.js` (ADR-0001), and `getPrefs` overlays it over the sync read (`prefs.js:220`). It sits in `PREF_DEFAULTS` only as the shape of a read that is then discarded. |
| `consentVersion` | internal-with-a-default | Same: state, not a control. Live and load-bearing (it gates remote-rules egress, `src/background/remote-rules-wake.js:83`) but never user-set. Its `prefs.js:52` comment "Bump to re-trigger onboarding on ToS changes" is stale — ADR-0007 removed that engine, as `prefs.js:224-229` says. |
| `consentDate` | internal-with-a-default | Same: a timestamp written once (`service-worker.js:1479`). |
| `disabledCategories` | user choice | #1340 names it as already the right shape. Rendered as a dynamic card (`options.html:297`, `options.js:788`), it scales with the rule set instead of adding a pref per category. |
| `toastDuration` | user choice | How long a notification stays up. An accessibility and taste preference. |
| `paramBreakdown` | internal-with-a-default | A display sub-toggle whose label says "in the popup". Under Decision 1 the breakdown of what was removed from *this page* is the glance, so a toggle for it is a leftover from when the popup was a report. |
| `showReportButton` | internal-with-a-default | A display sub-toggle for one button. Decision 3 moves that button out of the popup, which retires the pref's stated job. |
| `domainStats` | user choice | Reads as display but is not: it gates *recording* (`src/background/process-url.js:375`, `src/background/service-worker.js:352`) as well as the panel (`popup.js:921`). Its label, "Record per-domain statistics", is accurate, and a record-keeping opt-out is a real choice. |
| `showBadge` | user choice | Visual noise on the toolbar icon. Taste. |
| `remoteRulesEnabled` | **trust-critical** | Named by #1340. The only recurring outbound request MUGA makes. Non-negotiably visible. |
| `honorCreatorMode` | **trust-critical** | Named by #1340. Its own comment (`prefs.js:73-78`) gives the reason: honoring referral chains "may route through redirect networks the user did not consent to contact otherwise". |
| `creatorAllowlist` | **trust-critical** | The data `honorCreatorMode` acts on. A user auditing which creators may route them through a redirect network needs the list, not just the switch. Classified here on that evidence, not by #1340's naming. |
| `canonicalExtractorEnabled` | internal-with-a-default | Its own comment (`prefs.js:86-91`) describes the control's purpose as "Disable here to bypass that tier entirely without uninstalling content scripts" — a reversibility affordance for whoever is debugging the wrapper engine, expressed as a user setting. |
| `crossSiteFrequencyEnabled` | **trust-critical** | The code itself makes the case: "Privacy-sensitive enough to deserve its own toggle even though the data never leaves the device" (`prefs.js:92-98`). That is the trust test in the codebase's own words. |
| `attributionLedgerEnabled` | **trust-critical** | Same, and stronger: "Privacy-sensitive (it carries URLs), so we expose it as its own toggle even though the data is local-only" (`prefs.js:99-106`). |
| `experimentalParamClassesEnabled` | internal-with-a-default | A feature flag that shipped. Default off, warns it may break sites, and exists so a risky heuristic could land reversibly (`prefs.js:107-116`). Its honest end state is promotion to always-on once false-positive evidence supports it, or removal — a permanently-experimental toggle is exactly the accumulation #1340 objects to. Listed here even though its label is clear, because the label is not the problem. |
| `userCustomRules` | user choice | User-authored strip rules, written by explicit click. Data, and the highest-consequence data in the bag. |
| `hoverPreviewEnabled` | user choice | A desktop-only tooltip that appears on a hold. Unobtrusive, but visible behaviour a user may not want. |
| `hoverPreviewDelayMs` | internal-with-a-default | The clearest case in the table. It has **no control anywhere**, it is deliberately excluded from export (`src/lib/settings-schema.js:152-156`), and its only two readers apply a hardcoded fallback anyway: `(_prefs && _prefs.hoverPreviewDelayMs) \|\| 2500` (`src/content/hover-preview.js:439`, `:481`). It is a constant paying sync-quota, migration and import/export costs as if it were a preference. |
| `resolveShortenersOnClick` | **trust-critical** | Named by #1340. Half of the resolution split; performs a network request to a third party. |
| `resolveShortenersOnHover` | **trust-critical** | Named by #1340, and the more sensitive half: it leaks "the user saw this link" for a link never clicked (`prefs.js:143-166`). Default off for that reason. |

**Totals: 19 user choice, 9 internal-with-a-default, 8 trust-critical.**

#1340 named four trust-critical items by definition; counting the shortener
split as the two keys it actually is, that is five. The other three
(`creatorAllowlist`, `crossSiteFrequencyEnabled`,
`attributionLedgerEnabled`) are classified on evidence found in the code,
and in the last two cases on comments that already state the trust argument
in full.

A cross-check that supports the shape of this table: 32 of the 36 prefs
round-trip through export/import (`SETTINGS_FIELDS`, 33 entries, of which
`devMode` is device-local and not a pref). The four that do not are the three
consent fields and `hoverPreviewDelayMs` — the same four this table places in
internal-with-a-default for being state or a constant rather than a
preference. The export schema had already reached the same conclusion
informally; this ADR states it.

## Decision 5 — the classification is not a removal plan

The buckets say what each pref *is*, not what happens to it. Nothing is
removed by this ADR, and a pref landing in internal-with-a-default is not
thereby scheduled for deletion. Each one needs its own decision about whether
the default is genuinely safe for every user, and `#1336` is the standing
reminder that two identically-shaped flags can disagree about something as
basic as whether they travel in an export. The value of the bucket is that a
future change no longer has to re-litigate whether a given toggle was ever
meant to be a user-facing promise.

## Alternatives considered

**A — Gate rule coverage behind more settings. Rejected.** This came up while
measuring the global strip list, and #1340 asks for it to be recorded as
rejected. Coverage is bounded by **evidence of scope, not by user options**: a
param is stripped where an upstream source anchors it, and a setting cannot
manufacture that evidence. Offering the user a switch in place of a fact moves
a judgement MUGA is equipped to make onto someone with strictly less
information. And per-setting granularity grows the surface it is meant to
shrink — the failure mode is precisely #1340's opening measurement, where 36
prefs is already the problem being described. `disabledCategories` and
per-host `preserveParams` already exist and are the right shape: both scale
with the rule set rather than with the number of decisions, so neither adds a
pref when coverage grows.

**B — Keep the panels in the popup but collapse them by default.** This is
the status quo, and it is what the measurement indicts: they already are
collapsed (`<details>` at `popup.html:66`, `:75`, `:83`, `:137`), and 44% of
`popup.js` still exists to fill them. Collapsing hides cost from the user's
eye without removing it from the surface a maintainer has to keep correct in
seven locales.

**C — Move the panels and delete them rather than rehousing them.** Rejected.
The data has real value to the user who wants it, and #1340 is explicit that
removal is downstream of the decision, not part of it. A decision that
silently loses features is not the decision that was asked for.

**D — Make the popup configurable, so each user chooses which panels appear.**
Rejected on the same reasoning as A, applied to layout instead of coverage: it
answers "what is the popup for" with "whatever you set it to", which is the
absence of a decision, and it would add a pref per panel to a document whose
purpose is to stop that.

## Consequences

**Positive.**
- #1271 item 3 and #1340's closing condition are both satisfied by a written
  statement plus a per-pref classification, with nothing shipped that has to
  be reviewed for behaviour.
- A future popup change has a test to apply: is this a glance, or an act? The
  measured version of the same test is that `popup.js` should be getting
  smaller, not larger.
- The 9 prefs in internal-with-a-default are now a named list rather than an
  intuition, so the work of removing a control can be scoped without
  re-deriving which controls were ever really promises.

**Negative / costs.**
- Three pref labels go stale the moment Decision 3 is implemented.
  `showReportButton` ("Show the report button in the popup") and
  `paramBreakdown` ("Lists which tracking parameters were removed ... in the
  popup") both name a surface the content is leaving, in seven locales each.
  `domainStats` survives because it gates recording, not display.
- Settings has no home for any of the four panels today, so the downstream
  work is genuinely new UI in a 1996-line file and a 581-line document, not a
  relocation. `options.html` already uses `id="domain-stats"` for the *gating
  checkbox* (`:387`) while `popup.html` uses the same id for the *panel*
  (`:66`); the two do not collide today because they are separate documents,
  but moving the panel into `options.html` will force a rename.
- The report flow does not move as a clean unit: it is wired inline inside
  `showUrlPreview` (`popup.js:844-912`) rather than living in its own
  function, and the Settings copy it would merge with is bound to the dev URL
  tester. That merge is the fiddliest part of the downstream work, and the
  duplication it resolves is the evidence that motivated the decision.
- This ADR leaves MUGA in a knowingly inconsistent state until 3.2.0: the
  stated position and the shipped popup disagree. That is the accepted cost
  of making the decision reviewable on its own.

**Neutral.**
- No pref is added, removed, renamed or re-defaulted here, so no migration,
  no export/import change, and no locale change.
- The rating nudge is kept on an explicit exception rather than by passing the
  glance test, which is recorded so a future reader does not mistake it for
  precedent.
- #1271 items 1, 2 and 4 were already implemented before this ADR and are
  unaffected by it.

## Verification

This is a document-only change, so verification is that the repository's
existing guards still hold and that the ADR is indexed:

1. **ADR index completeness and status agreement** —
   `tests/unit/context-map.test.mjs` (c4) requires every numbered file in
   `docs/adr/` to have a row in `docs/adr/README.md` whose status cell starts
   with the first word of the ADR's own `**Status**:` line. This ADR's status
   begins "Accepted" and its index row reads "Accepted".
2. **Every claim above is a file:line read at `52545d8`**, and the three that
   disagreed with the issues are corrected in the table under "The surface,
   measured against the code" rather than repeated.
3. **`npm test`, `npm run typecheck`, `npm run lint:js`** — all green, with
   the one pre-existing skipped test.
