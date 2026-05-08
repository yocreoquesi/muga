/**
 * MUGA: Privacy Proxy mode label derivation (#453, B20)
 *
 * Pure function: maps (honorCreatorMode, privacyProxyEnabled) → i18n key.
 * Extracted to its own module so it can be unit-tested without DOM globals.
 */

/**
 * Derives the active mode label i18n key from both toggle states.
 *
 * Truth table:
 *   (false, false) → "mode_strict_local"
 *   (true,  false) → "mode_honor_creator"
 *   (false, true)  → "mode_privacy_proxy"
 *   (true,  true)  → "mode_honor_plus_proxy"
 *
 * @param {boolean} honor - honorCreatorMode pref value (truthy/falsy)
 * @param {boolean} proxy - privacyProxyEnabled pref value (truthy/falsy)
 * @returns {string} i18n key for the derived mode label
 */
export function deriveModeLabel(honor, proxy) {
  if (honor && proxy) return "mode_honor_plus_proxy";
  if (honor)          return "mode_honor_creator";
  if (proxy)          return "mode_privacy_proxy";
  return "mode_strict_local";
}
