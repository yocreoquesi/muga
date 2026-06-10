/**
 * MUGA E2E helpers — DNR propagation wait (#824)
 *
 * chrome.storage.set resolves when the write is durable, but the extension
 * service worker's prefs cache and the browser's DNR rule table are updated
 * asynchronously. There is NO observable signal (no DOM flag, no storage
 * event, no URL change) that the DNR rules or SW prefs cache have refreshed
 * after a storage.set call in a beforeEach setup page.
 *
 * Rather than scattering magic `setTimeout(r, 500)` calls across every
 * setup function, we centralise the debt here so it is:
 *   1. Greppable — `waitForDnrPropagation` is the single search term.
 *   2. Documented — the reason and the known limitation live in one place.
 *   3. Easy to remove — when Chrome/Playwright exposes a real signal, fix
 *      this one function and all callers improve automatically.
 *
 * Flaky-vector debt: tracked in #824. Replace with a real observable signal
 * when one becomes available (e.g. a chrome.declarativeNetRequest.onRulesUpdated
 * event, or a SW-injected page flag confirming prefs have been loaded).
 */

/**
 * Wait for DNR rule propagation and SW prefs-cache refresh after a
 * chrome.storage.set call in an extension setup page.
 *
 * This is intentionally a named function and NOT an inline setTimeout so
 * the debt is greppable and centrally documented. Do NOT inline raw
 * setTimeout calls in setup functions — use this helper instead.
 *
 * @param {import('@playwright/test').Page} _page - Unused; reserved for a
 *   future implementation that polls an observable signal on the page.
 * @param {number} [ms=500] - Override the wait duration. Use sparingly —
 *   the default 500ms is the empirical floor on CI. Only increase if a
 *   specific test demonstrates genuine flakiness at 500ms.
 */
export async function waitForDnrPropagation(_page, ms = 500) {
  // DEBT (#824): no observable signal exists yet. Replace this sleep with
  // a condition-based wait when Chrome exposes a DNR-applied event or the
  // SW exposes a prefs-ready flag via the page world.
  await new Promise((r) => setTimeout(r, ms));
}
