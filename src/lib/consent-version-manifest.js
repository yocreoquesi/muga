/**
 * MUGA: Consent Version Manifest (#365)
 *
 * Append-only declarative list of all known Terms of Service versions.
 * Each entry describes one version and whether the change since the
 * prior version was *additive* (new clauses on top of existing ones,
 * eligible for soft re-onboard) or *material* (changes existing terms,
 * requires hard re-onboard).
 *
 * **Append-only invariant**: never delete or edit a published entry.
 * Once shipped in a release, an entry must remain so a user upgrading
 * across many versions encounters a coherent history of decisions.
 *
 * Adding a new version:
 *
 *   1. Append a new entry at the end with the next version string.
 *   2. Set `additive: true` if the change only adds clauses; `false` if
 *      it modifies or removes existing terms (material change).
 *   3. Bump REQUIRED_CONSENT_VERSION below to match the new entry.
 *   4. Update the onboarding page's CONSENT_VERSION constant to match.
 *   5. Update the user-visible ToS document.
 *
 * Once REQUIRED_CONSENT_VERSION points at the new entry, ConsentPolicy
 * will fire `soft-reonboard` or `hard-reonboard` on the next service
 * worker wake for users who accepted an earlier version.
 *
 * **Staged entries** (cookie-consent-modes redesign, Slice 1): a manifest
 * entry MAY exist without REQUIRED_CONSENT_VERSION pointing at it yet —
 * i.e. it is appended but not yet "active". This is a deliberate
 * exception to the normal "bump REQUIRED_CONSENT_VERSION to match"
 * instruction above, used when a bump's disclosure is scoped to NEW
 * installs only (surfaced through the ordinary fresh-onboarding flow, not
 * the version-clause delta system) and existing users' capabilities have
 * not changed at all, so no soft-reonboard is warranted for them yet. See
 * the "1.3" entry below for the concrete case. When a later slice needs to
 * disclose something to existing users too, bump REQUIRED_CONSENT_VERSION
 * to the staged version and add its CONSENT_CLAUSES_BY_VERSION entry at
 * that time.
 */

/**
 * @typedef {Object} ConsentVersionEntry
 * @property {string} version - Semver-like "x.y.z" version string.
 * @property {boolean} additive - True if the change since the prior
 *   entry only added new clauses (eligible for soft re-onboard); false
 *   if existing terms were modified or removed (hard re-onboard).
 *   The first (baseline) entry's value is meaningless and conventionally
 *   set to `false` so a missing manifest cannot accidentally trigger
 *   soft re-onboard.
 */

/** @type {ReadonlyArray<ConsentVersionEntry>} */
export const CONSENT_VERSION_MANIFEST = Object.freeze([
  Object.freeze({
    version: "1.0",
    additive: false, // baseline; flag is meaningless for the first entry
  }),
  Object.freeze({
    // #888: remote rule updates (weekly Ed25519-signed GET to rules.muga.app,
    // no personal data) flipped ON by default. Purely ADDITIVE — no existing
    // term is modified or removed — so users who accepted 1.0 get a SOFT
    // re-onboard (delta review) surfacing the new clause, not a hard gate.
    version: "1.1",
    additive: true,
  }),
  Object.freeze({
    // #1027: the opt-in Cookie Consent Minimizer can, when enabled, call a
    // page-authored global (`window.OneTrust.RejectAll()`) directly — a new
    // capability class the extension did not have before. The feature ships
    // OFF by default (no behaviour change until the user opts in), and it
    // never invokes a consent-granting action, but calling a site's own
    // function at all is new enough to disclose. Purely ADDITIVE — no
    // existing term is modified or removed — so users who accepted an
    // earlier version get a SOFT re-onboard (delta review) surfacing this
    // one new clause, not a hard gate.
    version: "1.2",
    additive: true,
  }),
  Object.freeze({
    // Originally staged inert by the cookie-consent-modes redesign Slice 1
    // (the boolean cookieConsentMinimizerEnabled became a 3-state
    // cookieConsentMode: "off" | "reject-only" | "accept-when-necessary").
    // That part alone changed no existing user's capability (migrated to
    // "off"), so it did not warrant a forced re-consent on its own.
    //
    // cookie-consent-accept Slice 2a ACTIVATES this entry: the
    // accept-when-necessary mode now has a real, working pilot (Didomi
    // only) that lets MUGA submit a minimum-consent payload on a genuine
    // hard wall — a new capability class worth disclosing, even though it
    // stays off until the user opts in from Settings AND completes a
    // dedicated, explicit consent gesture (see
    // src/lib/cmp-accept-adapters.js's L2 double-gate). Purely ADDITIVE —
    // no existing term is modified or removed — so users who accepted an
    // earlier version get a SOFT re-onboard (delta review) surfacing this
    // one new clause, not a hard gate.
    version: "1.3",
    additive: true,
  }),
]);

/**
 * The version of the ToS the running code requires. Set during release
 * to the latest entry in CONSENT_VERSION_MANIFEST. ConsentPolicy uses
 * this to decide whether a stored consent record is still current.
 */
export const REQUIRED_CONSENT_VERSION = "1.3";
