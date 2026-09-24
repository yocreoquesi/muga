/**
 * MUGA: Store rating/review links
 *
 * Centralizes the "Rate MUGA" destination URLs so every entry point (popup
 * footer, popup rating nudge, Settings footer, Settings dev-tools preview)
 * links to the same, correct place instead of re-deriving it.
 *
 * #1387: the previous per-callsite ternary hardcoded a Chrome Web Store URL
 * with no extension ID, which Chrome resolves to its store home page rather
 * than MUGA's listing. The real listing requires the 32-character extension
 * ID (pjdpeamhcjdhfijpmgamjdoplbnbajoh).
 */

import { isFirefox } from "./browser-detect.js";

/**
 * MUGA's real Chrome Web Store listing (reviews tab). The extension ID
 * (pjdpeamhcjdhfijpmgamjdoplbnbajoh) is required — a URL without it resolves
 * to the Chrome Web Store home page instead of MUGA's page (#1387).
 */
export const CHROME_STORE_RATE_URL =
  "https://chromewebstore.google.com/detail/pjdpeamhcjdhfijpmgamjdoplbnbajoh/reviews";

/** MUGA's Firefox AMO listing (reviews tab), for parity with the Chrome URL. */
export const FIREFOX_STORE_RATE_URL = "https://addons.mozilla.org/firefox/addon/muga/reviews/";

/**
 * Returns the correct "Rate MUGA" URL for the running browser.
 * @returns {string}
 */
export function getRateUrl() {
  return isFirefox() ? FIREFOX_STORE_RATE_URL : CHROME_STORE_RATE_URL;
}
