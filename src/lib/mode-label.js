/**
 * MUGA: mode label derivation (#453, B20; ADR-0004 phase 5)
 *
 * Pure function: maps (honorCreatorMode) → i18n key.
 * Extracted to its own module so it can be unit-tested without DOM globals.
 *
 * ADR-0004 phase 5 (2026-06-01): the `proxy` parameter (privacyProxyEnabled)
 * was removed because the Privacy Proxy feature was decommissioned. The function
 * now declares a single `honor` parameter; all callers have been updated. (Any
 * stray two-arg call would still work — JavaScript discards extra arguments.)
 */

/**
 * Derives the active mode label i18n key.
 *
 * Truth table:
 *   false → "mode_strict_local"
 *   true  → "mode_honor_creator"
 *
 * @param {boolean} honor - honorCreatorMode pref value (truthy/falsy)
 * @returns {string} i18n key for the derived mode label
 */
export function deriveModeLabel(honor) {
  if (honor) return "mode_honor_creator";
  return "mode_strict_local";
}
