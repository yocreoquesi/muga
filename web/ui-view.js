/** MUGA: Web-cleaner-tool UI view-model (#1029, Phase 4)
 *
 * Pure formatting layer between web/engine/adapter.js's `cleanUrl()`
 * result and the DOM. No DOM access here, no imports of web/engine/*.
 * web/ui.js (browser-only, DOM wiring) applies this view-model to
 * elements via `textContent` / `createElement` and cannot be unit tested
 * under node:test; this module carries the branching that decides WHAT
 * to render so it stays covered by tests/unit/web-ui-view.test.mjs.
 * Mirrors the precedent set by src/lib/remote-rules-changelog-view.js.
 *
 * Copy constraints (spec "Copy Style Constraints"): messages never use
 * an em-dash or "--". MUGA injects its own referral on naked Amazon/eBay
 * links (web-tool-naked-link-injection slice 2, ADR-1). When it does, this
 * module surfaces `mugaReferralInjected`, `cleanUrlNoMugaReferral`, and a
 * disclosure string, so the DOM layer can render the FTC-style notice and
 * the "Copy without MUGA's referral" opt-out. Any creator/foreign referral
 * is always preserved and never gets a disclosure (nothing MUGA added).
 */

/**
 * @typedef {object} CleanResultView
 * @property {"empty"|"error"|"clean"} state
 * @property {string} message Friendly, render-ready summary text.
 * @property {string|null} cleanUrl
 * @property {number} removedCount
 * @property {string[]} removedList
 * @property {boolean} unwrapped
 * @property {string|null} destinationHost
 * @property {boolean} affiliatePreserved
 * @property {boolean} noChanges
 * @property {boolean} mugaReferralInjected
 * @property {boolean} mugaReferralPresent
 * @property {string|null} cleanUrlNoMugaReferral
 * @property {string|null} disclosure
 */

/**
 * FTC-style disclosures shown when the cleaned URL carries MUGA's own
 * referral. Two variants (maintainer-approved verbatim copy):
 *  - INJECTED: MUGA added its tag to a link that had none this run.
 *  - PRESENT:  the pasted link already carried MUGA's tag (re-cleaned).
 * Both point at the opt-out without a directional phrase ("below"/"above"),
 * because the opt-out button sits ABOVE this text in the DOM.
 */
const REFERRAL_DISCLOSURE_INJECTED =
  "This link had no referral of its own, so MUGA added one for a selected store " +
  "to help keep the tool free. Prefer a clean link? You can copy one without it too.";

const REFERRAL_DISCLOSURE_PRESENT =
  "This link already carries MUGA's referral, which helps keep the tool free. " +
  "Prefer a clean link? You can copy one without it too.";

/**
 * The view shown before the user has cleaned anything yet.
 * @returns {CleanResultView}
 */
export function emptyStateView() {
  return {
    state: "empty",
    message: "Paste a URL above and press Clean to see what changes.",
    cleanUrl: null,
    removedCount: 0,
    removedList: [],
    unwrapped: false,
    destinationHost: null,
    affiliatePreserved: false,
    noChanges: false,
    mugaReferralInjected: false,
    mugaReferralPresent: false,
    cleanUrlNoMugaReferral: null,
    disclosure: null,
  };
}

/**
 * Builds the "N tracking parameters removed[, redirect wrapper unwrapped]."
 * change summary, or the no-changes sentence when nothing happened.
 *
 * @param {string[]} removedList
 * @param {boolean} unwrapped
 * @returns {string}
 */
function buildChangeSummary(removedList, unwrapped) {
  const parts = [];
  if (removedList.length > 0) {
    const noun = removedList.length === 1 ? "parameter" : "parameters";
    parts.push(`${removedList.length} tracking ${noun} removed`);
  }
  if (unwrapped) {
    parts.push("redirect wrapper unwrapped");
  }
  if (parts.length === 0) {
    return "No tracking parameters or redirect wrappers found. This URL is already clean.";
  }
  return `${parts.join(", ")}.`;
}

/**
 * @typedef {object} LengthReductionView
 * @property {number} shorterPercent Whole-number percent shorter (0 when isClean).
 * @property {string} label Length-only headline text (never a "tracking" claim).
 * @property {number} keptLen Character length of the cleaned URL.
 * @property {number} removedLen Character length removed (`max(0, original - clean)`).
 * @property {boolean} isClean True when nothing was removed.
 */

/**
 * Computes the length-reduction bar view-model from the original (pasted)
 * URL and the cleaned URL. A pure LENGTH claim: never phrased as a
 * "% was tracking" claim (spec "Length-reduction bar"). Never renders 0%
 * while a real reduction happened (design D4's clamp guard); when nothing
 * was removed, short-circuits to the "already clean" label instead of a
 * 0% bar.
 *
 * @param {string} originalUrl The URL as pasted by the user.
 * @param {string} cleanUrl The cleaned URL returned by the adapter.
 * @returns {LengthReductionView}
 */
export function computeLengthReduction(originalUrl, cleanUrl) {
  const originalLen = typeof originalUrl === "string" ? originalUrl.length : 0;
  const cleanLen = typeof cleanUrl === "string" ? cleanUrl.length : 0;
  const removedLen = Math.max(0, originalLen - cleanLen);
  const isClean = removedLen === 0;
  const shorterPercent = isClean || originalLen === 0
    ? 0
    : Math.max(1, Math.round((removedLen / originalLen) * 100));

  return {
    shorterPercent,
    label: isClean ? "Already clean, nothing to remove" : `This link is ${shorterPercent}% shorter`,
    keptLen: cleanLen,
    removedLen,
    isClean,
  };
}

/**
 * Formats a web/engine/adapter.js `cleanUrl()` result into a render-ready
 * view-model. Never throws: a missing/malformed result degrades to the
 * "error" state with a generic message, same as the adapter's own
 * never-throw contract.
 *
 * @param {{
 *   ok?: boolean,
 *   cleanUrl?: string,
 *   removed?: string[],
 *   unwrapped?: boolean,
 *   destinationHost?: string|null,
 *   affiliatePreserved?: boolean,
 *   mugaReferralInjected?: boolean,
 *   mugaReferralPresent?: boolean,
 *   cleanUrlNoMugaReferral?: string|null,
 *   action?: string,
 *   error?: string,
 * }|null|undefined} result
 * @returns {CleanResultView}
 */
export function formatCleanResult(result) {
  if (!result || !result.ok) {
    const message = result && typeof result.error === "string" && result.error.length > 0
      ? result.error
      : "Something went wrong while cleaning that URL.";
    return {
      state: "error",
      message,
      cleanUrl: null,
      removedCount: 0,
      removedList: [],
      unwrapped: false,
      destinationHost: null,
      affiliatePreserved: false,
      noChanges: false,
      mugaReferralInjected: false,
      mugaReferralPresent: false,
      cleanUrlNoMugaReferral: null,
      disclosure: null,
    };
  }

  const removedList = Array.isArray(result.removed) ? result.removed : [];
  const unwrapped = !!result.unwrapped;
  const noChanges = removedList.length === 0 && !unwrapped;
  const mugaReferralInjected = !!result.mugaReferralInjected;
  // A just-injected referral is always present in the output too, so treat
  // "injected" as a superset of "present" even if the adapter only set one.
  const mugaReferralPresent = !!result.mugaReferralPresent || mugaReferralInjected;

  return {
    state: "clean",
    message: buildChangeSummary(removedList, unwrapped),
    cleanUrl: typeof result.cleanUrl === "string" ? result.cleanUrl : null,
    removedCount: removedList.length,
    removedList,
    unwrapped,
    destinationHost: result.destinationHost ?? null,
    affiliatePreserved: !!result.affiliatePreserved,
    noChanges,
    mugaReferralInjected,
    mugaReferralPresent,
    cleanUrlNoMugaReferral: mugaReferralPresent && typeof result.cleanUrlNoMugaReferral === "string"
      ? result.cleanUrlNoMugaReferral
      : null,
    // Wording follows how the referral got there: added this run vs already
    // on the pasted link. Both only show when our referral is present.
    disclosure: mugaReferralInjected
      ? REFERRAL_DISCLOSURE_INJECTED
      : (mugaReferralPresent ? REFERRAL_DISCLOSURE_PRESENT : null),
  };
}
