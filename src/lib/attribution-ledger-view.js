/**
 * MUGA — Attribution Ledger view layer (#460, A2).
 *
 * Pure rendering bridge between the presenter (A1) and the popup DOM.
 * Takes the view-state from `presentLedger()` plus an `i18n(key, vars?)`
 * function and returns an array of plain objects, one per ledger entry,
 * shaped for trivial DOM construction:
 *
 *   {
 *     url:               string,    // full, untouched — feed to clipboard
 *     urlDisplay:        string,    // truncated for the popup (≤ MAX_DISPLAY)
 *     badgeText?:        string,    // pre-translated badge label
 *     creatorCreditText?: string,   // pre-translated "Supporting @creator"
 *     networkText?:      string,    // pre-translated "via {network}"
 *   }
 *
 * Why a separate module from the popup glue: keeps the popup glue down to
 * `createElement / textContent / appendChild` calls, with all of the
 * branching ("which badge does this event get?") in one place that needs
 * no chrome.* stub or DOM stub to test.
 *
 * The `i18n` function is supplied by the caller. The popup wires
 * `(key, vars) => t(key, lang)` then handles {placeholder} substitution
 * inside the popup glue where `vars` is needed. We pre-substitute here so
 * the rendered objects are immediately appendable as text nodes.
 */

import { presentLedger as _presentLedger } from "./attribution-ledger.js";

/** Max length for `urlDisplay`. Long URLs get truncated with a single
 *  Unicode ellipsis so the popup column stays readable. The full URL is
 *  preserved in `url` so the per-row copy button has the correct value. */
export const MAX_DISPLAY_URL_LENGTH = 80;

const ELLIPSIS = "…"; // single-char "…"

/** Maps each ledger event-decision to its corresponding badge i18n key.
 *  Decision values come from attribution-ledger.js EVENT_TYPES. `navigate`
 *  is intentionally absent — bare navigations have no badge. */
const BADGE_KEY_BY_DECISION = Object.freeze({
  clean: "ledger_badge_cleaned",
  "preserve-affiliate": "ledger_badge_preserve_affiliate",
  "inject-affiliate": "ledger_badge_inject_affiliate",
  "honor-creator": "ledger_badge_honor_creator",
  "blocked-opaque": "ledger_badge_blocked_opaque",
});

/**
 * Truncates a URL for display. Short URLs pass through unchanged. Longer
 * URLs are cut to MAX_DISPLAY_URL_LENGTH-1 chars + ellipsis (so the total
 * length, including the ellipsis, is exactly MAX_DISPLAY_URL_LENGTH).
 *
 * Pure: no allocations beyond the substring + concat.
 *
 * @param {string} url
 * @returns {string}
 */
function truncateUrl(url) {
  if (typeof url !== "string") return "";
  if (url.length <= MAX_DISPLAY_URL_LENGTH) return url;
  return url.slice(0, MAX_DISPLAY_URL_LENGTH - 1) + ELLIPSIS;
}

/**
 * Builds the DOM-ready entry list from a presenter view-state. The popup
 * just iterates the result and creates DOM nodes — no further branching
 * needed.
 *
 * Defensive: a malformed/missing `viewState` returns `[]` so a corrupted
 * chrome.storage.local read can't crash the popup boot.
 *
 * @param {{entries: Array<object>}|null|undefined} viewState
 * @param {(key: string, vars?: Record<string, string>) => string} i18n
 * @returns {Array<{url:string, urlDisplay:string, badgeText?:string, creatorCreditText?:string, networkText?:string}>}
 */
export function renderEntries(viewState, i18n) {
  if (!viewState || typeof viewState !== "object") return [];
  const entries = Array.isArray(viewState.entries) ? viewState.entries : [];
  const rows = [];

  for (const entry of entries) {
    if (!entry || typeof entry.url !== "string") continue;
    const row = {
      url: entry.url,
      urlDisplay: truncateUrl(entry.url),
    };

    // Badge: keyed off the presenter's own `badge` field when present
    // (cleaner action), otherwise looked up from the decision. This keeps
    // the mapping in one place even if A1 starts emitting more badges.
    const badgeKey = entry.badge || BADGE_KEY_BY_DECISION[entry.decision];
    if (badgeKey) row.badgeText = i18n(badgeKey);

    // Network attribution. Honor Creator Mode entries MUST carry the
    // network so the user can see WHICH redirect their click flowed
    // through (acceptance criterion). Affiliate preserve/inject also
    // surface the network when the cleaner attached one.
    if (entry.network) {
      row.networkText = i18n("ledger_network_template", { network: entry.network });
    }

    // Creator credit ("Supporting @creator-X"). Only honor-creator carries
    // this today.
    if (entry.creatorCredit) {
      row.creatorCreditText = i18n("ledger_creator_credit_template", {
        creator: entry.creatorCredit,
      });
    }

    rows.push(row);
  }

  return rows;
}

// Re-export the presenter so popup glue can import a single module.
// Keeping the dependency direction explicit: popup → view → presenter.
export { _presentLedger as presentLedger };
