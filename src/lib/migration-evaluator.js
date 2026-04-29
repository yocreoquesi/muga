/**
 * MUGA: Migration Evaluator
 *
 * Pure function. Given the user's previous version, current version, prior
 * responses to migrations, and current pref state, returns the ordered list
 * of migrations that need to be presented to the user this run.
 *
 * No I/O. No storage access. Caller is responsible for fetching responses
 * (via migration-storage) and prefs (via storage), and applying accepted
 * migrations.
 *
 * @see migration-spec.js for entry shape.
 */

import { MIGRATIONS } from "./migration-spec.js";

/**
 * Compares two "x.y.z" semver-ish version strings.
 * Returns negative when a < b, zero when equal, positive when a > b.
 * Missing components are treated as zero ("1.2" === "1.2.0").
 *
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
export function compareVersions(a, b) {
  const pa = String(a).split(".").map(n => parseInt(n, 10) || 0);
  const pb = String(b).split(".").map(n => parseInt(n, 10) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const ai = pa[i] || 0;
    const bi = pb[i] || 0;
    if (ai !== bi) return ai - bi;
  }
  return 0;
}

/**
 * Returns the migrations that should be presented to the user this run.
 *
 * A migration fires when:
 *   - The user is upgrading across it: previousVersion <= entry.fromVersion
 *     AND currentVersion >= entry.toVersion.
 *   - The user has not already responded (accept | decline | dismiss).
 *   - The user's current pref state does not already match the proposed
 *     value (i.e. they have not manually opted in already).
 *
 * Returns entries in declared order so multiple-upgrade paths surface them
 * the same way every time.
 *
 * @param {object}   args
 * @param {string}   args.previousVersion - The version the user was on before this upgrade.
 * @param {string}   args.currentVersion  - The currently running extension version.
 * @param {Record<string, "accept"|"decline"|"dismiss">} args.responses - Per-id responses.
 * @param {object}   args.prefs           - The user's current preferences.
 * @param {Array}    [args.migrations]    - Override the spec (testing). Defaults to MIGRATIONS.
 * @returns {Array<object>} Pending migrations to present, in declared order.
 */
export function evaluateMigrations({
  previousVersion,
  currentVersion,
  responses = {},
  prefs = {},
  migrations = MIGRATIONS,
}) {
  if (!previousVersion || !currentVersion) return [];
  const pending = [];
  for (const m of migrations) {
    // Upgrade window check: must be crossing this migration.
    if (compareVersions(previousVersion, m.fromVersion) > 0) continue;
    if (compareVersions(currentVersion, m.toVersion) < 0) continue;

    // Already responded? Skip.
    if (responses[m.id]) continue;

    // Pref state already matches the proposed value? Skip — nothing to ask.
    let alreadyMatches = true;
    for (const key of Object.keys(m.proposedValue)) {
      if (prefs[key] !== m.proposedValue[key]) {
        alreadyMatches = false;
        break;
      }
    }
    if (alreadyMatches) continue;

    pending.push(m);
  }
  return pending;
}
