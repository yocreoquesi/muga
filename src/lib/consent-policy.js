/**
 * MUGA: Consent Policy (#365)
 *
 * Pure function. Given the user's stored consent record and the
 * current required version (with its manifest), returns one of four
 * statuses describing what onboarding flow (if any) the user should
 * see.
 *
 * No I/O. No storage access. The caller (typically the service
 * worker's onboarding-trigger logic) reads the consent record from
 * `consent-storage` and passes it in.
 *
 * Statuses:
 *
 *   never-accepted  — onboarding was never completed on this device.
 *                     Show the full onboarding flow (`fresh` mode in #370).
 *   valid           — accepted version >= required version. No prompt.
 *   soft-reonboard  — accepted version is older than required, AND every
 *                     intermediate version (after accepted, up to and
 *                     including required) is `additive: true`. Show
 *                     the delta clauses only (#370).
 *   hard-reonboard  — accepted version is older than required, AND at
 *                     least one intermediate version is `additive: false`
 *                     (material change). Gate features and show full
 *                     re-acceptance flow (#370).
 *
 * Edge cases:
 *
 *   - A consent record with `onboardingDone: true` but no
 *     `consentVersion` is treated as `valid`. Such records may exist
 *     from before consentVersion was wired (legacy, pre-#355).
 *   - If `requiredVersion` is not present in the manifest, the policy
 *     fails open to `valid` rather than locking the user out — a
 *     malformed manifest must not break the extension.
 *   - If `acceptedVersion` is not present in the manifest (e.g. user
 *     accepted a version that has since been retired), the policy
 *     fails open to `valid`.
 */

import { compareVersions } from "./migration-evaluator.js";
import {
  CONSENT_VERSION_MANIFEST,
  REQUIRED_CONSENT_VERSION,
} from "./consent-version-manifest.js";

/**
 * @typedef {"never-accepted" | "valid" | "soft-reonboard" | "hard-reonboard"} ConsentStatus
 */

/**
 * Evaluates whether the user's stored consent matches what the running
 * code requires.
 *
 * @param {object} args
 * @param {object} args.stored - Consent record from consent-storage.
 *   Expected shape: `{ onboardingDone, consentVersion, consentDate }`.
 *   Missing fields are tolerated.
 * @param {string} [args.requiredVersion] - Override the required version
 *   (testing). Defaults to REQUIRED_CONSENT_VERSION.
 * @param {ReadonlyArray<object>} [args.manifest] - Override the manifest
 *   (testing). Defaults to CONSENT_VERSION_MANIFEST.
 * @returns {{
 *   status: ConsentStatus,
 *   requiredVersion: string,
 *   acceptedVersion: string | null,
 * }}
 */
export function evaluate({
  stored,
  requiredVersion = REQUIRED_CONSENT_VERSION,
  manifest = CONSENT_VERSION_MANIFEST,
}) {
  // Never accepted: no record at all, or onboardingDone is false.
  if (!stored || !stored.onboardingDone) {
    return { status: "never-accepted", requiredVersion, acceptedVersion: null };
  }

  const acceptedVersion = stored.consentVersion || null;

  // Legacy install with no consentVersion — treat as valid (fail-open).
  // Such records exist from before the version field was wired.
  if (!acceptedVersion) {
    return { status: "valid", requiredVersion, acceptedVersion: null };
  }

  // Already at or past required — no prompt.
  if (compareVersions(acceptedVersion, requiredVersion) >= 0) {
    return { status: "valid", requiredVersion, acceptedVersion };
  }

  // Behind. Walk the manifest to determine soft vs hard.
  const requiredIdx = manifest.findIndex(m => m.version === requiredVersion);
  if (requiredIdx === -1) {
    // Required version not in the manifest — malformed config. Fail
    // open: do not punish the user for our config bug.
    return { status: "valid", requiredVersion, acceptedVersion };
  }

  const acceptedIdx = manifest.findIndex(m => m.version === acceptedVersion);
  if (acceptedIdx === -1) {
    // User accepted a version not in the current manifest (e.g. a
    // retired entry). Fail open.
    return { status: "valid", requiredVersion, acceptedVersion };
  }

  if (acceptedIdx >= requiredIdx) {
    // Defensive: catches the case where compareVersions said "behind"
    // but manifest order says otherwise (mis-ordered manifest).
    return { status: "valid", requiredVersion, acceptedVersion };
  }

  // Walk every intermediate version from accepted+1 to required
  // (inclusive). If any is material, the cumulative result is hard.
  let hasMaterial = false;
  for (let i = acceptedIdx + 1; i <= requiredIdx; i++) {
    if (manifest[i].additive === false) {
      hasMaterial = true;
      break;
    }
  }

  return {
    status: hasMaterial ? "hard-reonboard" : "soft-reonboard",
    requiredVersion,
    acceptedVersion,
  };
}
