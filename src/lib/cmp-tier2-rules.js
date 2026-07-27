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
 * @property {ToggleScopeConfig} [toggleScope] - Optional multi-step
 *   reject-and-save descriptor (cookie-consent-toggle-reject, PR 2 —
 *   design.md ADR-1/ADR-5). When present AND the panel opened by
 *   `openSettings` is confirmed open, the dispatcher enumerates every
 *   toggle inside `container`, sweeps it reject-only, and — ONLY when the
 *   post-sweep save invariant (src/lib/cmp-tier2-save-invariant.js) is
 *   satisfied AND the single resolved `save` candidate clears the `"save"`
 *   click-veto role (src/lib/cmp-tier2-veto.js) — clicks the confirmed Save
 *   control. No bundled rule uses this field (Complianz, Cookie Notice, and
 *   Osano all rely on a direct single-layer `reject` control instead — a
 *   live probe found Osano exposes a genuine one-click reject and defaults
 *   non-essential categories to OFF under GDPR, so the toggle-and-save
 *   machinery this field describes was deliberately NOT used for it; see
 *   the Osano rule's own comment below). Carries NO field capable of
 *   expressing the broad-consent-granting path this project's structural
 *   guard forbids naming (see the file docblock above) — same closed-vocabulary
 *   guarantee as the rest of this shape; the structural guard in
 *   tests/unit/cookie-noise-sync.test.mjs scans this field's values for the
 *   same forbidden pattern.
 *
 * @typedef {object} ToggleScopeConfig
 * @property {string} container - CSS selector scoping the settings-panel
 *   root that toggle enumeration and the CMP-selector-independent backstop
 *   scan (`countCheckedControls`) both operate within.
 * @property {string} toggle - CSS selector enumerating EVERY category
 *   toggle control inside `container` — native `input[type=checkbox]` or an
 *   ARIA `role=switch`/`role=checkbox` control. Every match is included in
 *   the readout (locked or not); only non-locked, readable entries are ever
 *   planned for actuation (see `planToggleActuation`).
 * @property {string} lockedOn - CSS selector identifying the
 *   necessary/locked category control(s) inside `container`. A locked entry
 *   is excluded from actuation and from the off-check, but at least one
 *   locked entry must be present in the readout for the save invariant to
 *   ever be satisfied.
 * @property {ReadonlyArray<string>} save - Curated Save/confirm control
 *   selector(s) inside `container`, OR-matched exactly like `reject`. Fail-
 *   closed: 0 or more than 1 actionable match is a NOOP; exactly 1 is the
 *   confirmed Save target, still gated by the `"save"` click-veto role.
 */

// @sync:cmp-tier2-rules:start
export const TIER2_RULES = Object.freeze([
  /**
   * Complianz (cmplz) — API-less, WordPress plugin. Real-site verification
   * (steuck-aachen.de, 2026-07) confirmed a direct first-layer reject
   * control: `.cmplz-deny` inside `#cmplz-cookiebanner-container`.
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

  /**
   * Osano — API-less, self-hosted CMP widget. Live-probe-confirmed on
   * osano.com (2026-07, EU vantage): a direct first-layer reject control,
   * `.osano-cm-denyAll` ("Reject Non-Essential"), inside the bottom-bar
   * banner anchor `.osano-cm-dialog--type_bar` (`role=dialog`,
   * `aria-label="Cookie Consent Banner"`; the banner's own `id` is a random
   * UUID per page load, so it is deliberately NOT used as a selector here).
   * `.osano-cm-denyAll` is locale-independent (the full class also carries
   * an equivalent `denyAll`-suffixed type modifier); its accessible name is
   * localized (EN "Reject Non-Essential", DE "Nicht wesentliche Cookies
   * ablehnen"), but every observed locale carries a reject-family word, and
   * the structurally distinct opt-in control lives under its own,
   * completely disjoint class name, so there is no selector collision risk.
   *
   * Deliberately NOT modeled with the multi-step toggle-sweep-and-save
   * descriptor: Osano exposes a genuine one-click first-layer reject and,
   * under GDPR, defaults its non-essential categories to OFF — there is no
   * ambiguous currently-checked panel state to sweep or verify here, so
   * that multi-step machinery is the wrong tool for this CMP.
   * `openSettings` stays empty: the Manage drawer is never opened, this is
   * a genuine single-hop reject (fail-closed no-op if `.osano-cm-denyAll`
   * is absent on a given installation).
   */
  Object.freeze({
    id: "osano",
    present: Object.freeze([".osano-cm-dialog--type_bar"]),
    reject: Object.freeze([".osano-cm-denyAll"]),
    openSettings: Object.freeze([]),
  }),

  /**
   * cookieconsent.js (Osano/Insites) — API-less, self-hosted widget.
   * Live-probe-confirmed across 11+ real deployments (2026-07, EU vantage):
   * `.cc-window` is the stable banner root; `.cc-deny` is the confirmed
   * reject control, present only in the opt-in/opt-out variants (roughly
   * 18% of probed deployments). The library's common "info" variant ships
   * only a `.cc-dismiss` ("Got it") acknowledgement button and NO `.cc-deny`
   * at all — `present` still matches, but the fail-closed 0-match branch in
   * `resolveTier2Reject` already no-ops gracefully, exactly like every
   * other rule here whose reject control is admin-optional. The
   * structurally distinct opt-in control (`.cc-allow`) lives under its own,
   * completely disjoint class name, so there is no selector collision risk.
   * No shadow DOM or iframe was observed in any probed deployment. A clone
   * library, "DPCookieConsent", reuses the same `.cc-*` class names and is
   * covered for free by this rule. `openSettings` stays empty: this is a
   * genuine single-hop reject, no settings panel is ever opened.
   */
  Object.freeze({
    id: "cookieconsent",
    present: Object.freeze([".cc-window"]),
    reject: Object.freeze([".cc-deny"]),
    openSettings: Object.freeze([]),
  }),
]);
// @sync:cmp-tier2-rules:end
