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
  // 1.2 (#1027): the opt-in Cookie Consent Minimizer. Single additive
  // clause disclosing the new capability (calling a page's own reject
  // function). The feature itself stays OFF until the user opts in from
  // Settings; this clause is disclosure, not an activation.
  "1.2": Object.freeze(["ob_clause_cookie_consent_minimizer"]),
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
