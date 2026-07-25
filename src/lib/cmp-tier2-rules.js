/**
 * MUGA: Cookie Consent Minimizer — Tier 2 declarative reject-only click-rule
 * data (#1027, Slice 1)
 *
 * Pure data module. NOT loaded as a content script — see AGENTS.md (content
 * scripts cannot use ES module imports). Consumed by src/lib/cmp-adapters.js
 * (`makeTier2Adapter` maps each entry here to a `TIER2` adapter) and, from a
 * later slice (Phase 3), hand-copied into content/cookie-noise.js for the
 * isolated-world DOM click dispatcher.
 *
 * ── Reject-only vocabulary, closed shape ───────────────────────────────────
 *
 * Each rule has EXACTLY three fields: `present` (banner-anchor selectors,
 * OR-matched — confirms the banner is actually on the page before anything
 * else happens), `reject` (confirmed reject/necessary-only control
 * selectors — the ONLY thing this file is ever allowed to identify
 * positively), and `openSettings` (optional single hop to reveal a deeper
 * reject control; `[]` means no two-step path is used). There is
 * intentionally NO field capable of expressing the broad-consent-granting
 * path this project's structural guard forbids naming (see
 * src/lib/cmp-adapters.js's file docblock for the naming convention this
 * follows) — the never-auto-consent-away rule holds here structurally, by
 * construction, not by convention: a future edit cannot add such a
 * selector without inventing a new field name, which the dedicated
 * structural guard in tests/unit/cmp-adapters.test.mjs scans this file for.
 *
 * A "confirmed reject control" is identified POSITIVELY, by a curated
 * `reject` selector for that specific rule — never by scanning for or
 * vetoing a broad-consent-granting control. See `resolveTier2Reject` in
 * src/lib/cmp-adapters.js for the fail-closed matching contract this data
 * feeds.
 *
 * ── Seed candidates verified 2026-07 (Task 1.1 spike) ──────────────────────
 *
 * Three API-less bespoke-banner candidates were considered for this Slice 1
 * seed; only two shipped:
 *
 * - Axeptio: DROPPED. Confirmed API-less, but its banner renders inside a
 *   CLOSED Shadow DOM behind a randomized custom-element host name on every
 *   page load — a content script cannot reliably reach into a closed shadow
 *   root at all, let alone with a stable selector. No rule is added for it.
 * - Complianz (cmplz): SEED — see the rule below.
 * - Cookie Notice (dFactory): SEED — see the rule below.
 *
 * Coverage claimed here is a modest, honest long-tail increment — two
 * genuinely API-less bespoke banners, verified against real production
 * markup, neither overlapping any of the 10 Tier 1 vendor-API adapters.
 *
 * @typedef {object} Tier2Rule
 * @property {string} id - Stable identifier, used as the `TIER2` adapter id
 *   and the `signals.tier2Confirmed` map key.
 * @property {ReadonlyArray<string>} present - OR-matched banner-anchor
 *   selectors; the banner must be confirmed present before any reject
 *   candidate is considered.
 * @property {ReadonlyArray<string>} reject - Curated reject/necessary-only
 *   control selectors. Fail-closed: 0 matches or more than 1 (ambiguous) is
 *   a no-op; exactly 1 is the confirmed target.
 * @property {ReadonlyArray<string>} openSettings - Optional single hop to
 *   open a settings panel before re-resolving `reject` in the revealed
 *   panel. `[]` when no two-step path is used.
 */

// @sync:cmp-tier2-rules:start
export const TIER2_RULES = Object.freeze([
  /**
   * Complianz (cmplz) — API-less, WordPress plugin. Real-site verification
   * (doaj.org, 2026-07) confirmed a direct first-layer reject control:
   * `.cmplz-deny` inside `#cmplz-cookiebanner-container`.
   *
   * Complianz's "manage options" / "save preferences" panel was
   * DELIBERATELY NOT modeled as an `openSettings` two-step hop: that panel's
   * save action commits whatever categories are CURRENTLY checked, which is
   * not guaranteed to be reject/necessary-only — the toggles' default state
   * is theme/installation-dependent, so clicking "save" there could commit
   * an unknown consent state. That is not an unambiguous reject path, so
   * this rule stays single-layer for Slice 1 and relies solely on the
   * direct `.cmplz-deny` control (fail-closed no-op if that control is
   * absent on a given installation).
   */
  Object.freeze({
    id: "complianz",
    present: Object.freeze(["#cmplz-cookiebanner-container"]),
    reject: Object.freeze([".cmplz-deny"]),
    openSettings: Object.freeze([]),
  }),

  /**
   * Cookie Notice (dFactory) — API-less, WordPress plugin. Refuse control:
   * `#cn-refuse-cookie` (also reachable via
   * `.cn-set-cookie[data-cookie-set="refuse"]`, kept as a single curated
   * selector for now — see the id-selector precedent above). The refuse
   * button is an admin-optional setting: not every installation renders it.
   * That is fine — the fail-closed 0-match branch already no-ops gracefully
   * when it is absent, exactly like every other rule here.
   */
  Object.freeze({
    id: "cookie-notice",
    present: Object.freeze(["#cookie-notice"]),
    reject: Object.freeze(["#cn-refuse-cookie"]),
    openSettings: Object.freeze([]),
  }),
]);
// @sync:cmp-tier2-rules:end
