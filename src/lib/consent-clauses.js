/**
 * MUGA: Consent Clauses by Version (#370)
 *
 * Maps each ToS version to the list of i18n keys describing the
 * **clauses introduced in that version**. Consumed by the onboarding
 * page in `delta` mode to surface only what changed since the user's
 * last accepted version.
 *
 * Each entry is a list of i18n keys (the actual translated text lives
 * in `i18n.js`). An empty list means "no surfaceable clauses in this
 * version" — used for the baseline (1.0) where the user accepts the
 * full ToS via the existing fresh-mode flow rather than a delta list.
 *
 * **Append-only**: never delete or edit a published version's clause
 * list. Once a release shipped saying "version 1.1 added clauses X",
 * users upgrading across that boundary need that information to be
 * stable.
 *
 * Adding clauses for a new version:
 *
 *   1. Append a new entry to CONSENT_CLAUSES_BY_VERSION keyed by the
 *      new version string from CONSENT_VERSION_MANIFEST.
 *   2. Add one i18n key per new clause to `i18n.js` covering at least
 *      EN and ES (the official languages per #351).
 *   3. The delta-mode rendering picks them up automatically.
 *
 * **Scope-reducing removal exception (drop-cookie-consent, Slice D of 6)**:
 * the "1.2" entry below was edited (not merely appended past) — its clause
 * disclosing the Cookie Consent Minimizer was removed because the feature
 * itself was deleted entirely (Slices A-C). This is a deliberate, narrow
 * exception to append-only: consent-policy.js's evaluate() decides
 * soft/hard-reonboard status by comparing VERSION NUMBERS only
 * (compareVersions(acceptedVersion, requiredVersion)), never by hashing or
 * diffing a version's clause content. REQUIRED_CONSENT_VERSION stays "1.2"
 * (unchanged), so every user already at consentVersion >= "1.2" reads as
 * "valid" and is never re-evaluated against this clause list at all — no
 * re-onboard, no re-prompt. Emptying the list only changes what a user
 * upgrading THROUGH 1.2 (i.e. still below it) sees in the delta view: they
 * no longer see a clause about a capability that no longer exists, which is
 * strictly more correct than disclosing dead functionality. Use this
 * exception ONLY when the disclosed feature has been fully removed from the
 * codebase, never to quietly retract a still-active disclosure.
 */

/** @type {Readonly<Record<string, ReadonlyArray<string>>>} */
export const CONSENT_CLAUSES_BY_VERSION = Object.freeze({
  // Baseline. The user accepts the full ToS via fresh-mode rendering;
  // no delta clauses to surface for this version itself.
  "1.0": Object.freeze([]),
  // 1.1 (#888): remote rule updates flipped ON by default. Single additive
  // clause disclosing the new weekly signed network egress. The i18n key
  // resolves to the localized clause text rendered in the delta list.
  "1.1": Object.freeze(["ob_clause_remote_rules_default"]),
  // 1.2 (#1027): originally disclosed the opt-in Cookie Consent Minimizer's
  // new capability (calling a page's own reject function). The whole
  // subsystem this clause described — the CMP runtime, the Tier 2
  // remote-rules pipeline, the cookieConsentMode pref and its Settings UI —
  // was removed by drop-cookie-consent (Slices A-D). The clause list is now
  // empty, RETIRED-AFTER-SHIP: unlike "1.3"/"1.4" below (which retired
  // pilots that never reached real users), 1.2's clause DID ship and DID
  // disclose a real, shipped capability at the time. It is emptied here
  // anyway because that capability no longer exists, and REQUIRED_CONSENT_
  // VERSION stays "1.2" — every user already at or past "1.2" reads as
  // `valid` in consent-policy.js (version-number compare only) and is never
  // re-evaluated against this list, so no existing user is re-prompted by
  // this change. See the append-only docblock above for the full rationale.
  "1.2": Object.freeze([]),
  // 1.3 (cookie-consent-accept Slice 2a): originally staged for the
  // accept-when-necessary mode's Didomi-only "minimum consent" pilot. That
  // delivery mechanism was proven non-viable before ever shipping to real
  // users (engram id 1331, "DIDOMI-ACCEPT-NOT-VIABLE") and retired —
  // RETIRED-BEFORE-SHIP, so this version's clause list is empty (no
  // disclosure was ever accurate to surface). See "1.4" below for the
  // clause covering the real, shipped mechanism.
  "1.3": Object.freeze([]),
  // 1.4 (cookie-consent-paywall-accept): originally staged to disclose the
  // accept-when-necessary mode's real mechanism (a DOM click on a
  // consent-or-pay wall's own free "Accept all" button). That mechanism was
  // deleted entirely before it ever shipped to real users — MUGA never
  // ships a capability that accepts cookies on the user's behalf — so, like
  // "1.3" above, this version's clause list is empty (no disclosure was
  // ever accurate to surface).
  "1.4": Object.freeze([]),
});

/**
 * Returns the i18n keys for clauses the user has not yet accepted —
 * i.e. clauses introduced in any version strictly greater than
 * `acceptedVersion` and less than or equal to `requiredVersion`.
 *
 * Pure function. Returns clauses in declared order across versions
 * (versions iterated in the order they appear in
 * CONSENT_VERSION_MANIFEST).
 *
 * @param {object} args
 * @param {string|null} args.acceptedVersion - The user's last accepted version, or null.
 * @param {string} args.requiredVersion - The version the running code requires.
 * @param {ReadonlyArray<{version:string}>} args.manifest - The version manifest (from consent-version-manifest.js).
 * @param {Readonly<Record<string, ReadonlyArray<string>>>} [args.clausesByVersion] - Override (testing). Defaults to CONSENT_CLAUSES_BY_VERSION.
 * @returns {string[]} i18n keys for the new clauses, in order.
 */
export function clausesForDelta({
  acceptedVersion,
  requiredVersion,
  manifest,
  clausesByVersion = CONSENT_CLAUSES_BY_VERSION,
}) {
  if (!Array.isArray(manifest) || manifest.length === 0) return [];
  const requiredIdx = manifest.findIndex(m => m.version === requiredVersion);
  if (requiredIdx === -1) return [];

  // If acceptedVersion is null or not in the manifest, treat as
  // "before everything" — surface all clauses up to and including
  // the required version.
  let acceptedIdx = -1;
  if (acceptedVersion) {
    acceptedIdx = manifest.findIndex(m => m.version === acceptedVersion);
  }

  const out = [];
  for (let i = acceptedIdx + 1; i <= requiredIdx; i++) {
    const v = manifest[i].version;
    const keys = clausesByVersion[v];
    if (Array.isArray(keys)) out.push(...keys);
  }
  return out;
}
