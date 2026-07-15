/**
 * MUGA — Clipboard write with legacy-fallback decision logic (#1098 fix).
 *
 * popup.js is a plain DOMContentLoaded script with no module exports (see
 * the source-grep convention used across tests/unit/popup-*.test.mjs), so
 * the *decision* logic that was hard to unit-test in place is extracted
 * here as a small, dependency-injected, DOM-free helper — same pattern
 * options.js uses for settings-schema.js / creator-allowlist.js.
 *
 * Bug this exists to fix (#1098): a bare
 *   navigator.clipboard.writeText(text).catch(fallback)
 * throws SYNCHRONOUSLY (TypeError: Cannot read properties of undefined)
 * when `navigator.clipboard` itself is undefined — some restricted
 * WebExtension popup contexts (e.g. Firefox for Android) don't expose it
 * at all. A synchronous throw never reaches `.catch()`, so the legacy
 * `document.execCommand("copy")` fallback never ran and the caller got no
 * feedback whatsoever (not even the existing "✗" failure state).
 */

/**
 * Decides between the Clipboard API and a legacy fallback, and runs
 * whichever path is viable. Handles three failure shapes uniformly:
 *   1. `clipboardApi` is absent (undefined/null) or has no `writeText`.
 *   2. `clipboardApi.writeText(text)` throws SYNCHRONOUSLY instead of
 *      returning a rejected Promise (the #1098 case).
 *   3. `clipboardApi.writeText(text)` returns a Promise that rejects.
 *
 * In all three cases, `legacyFallback` runs. `legacyFallback` is
 * synchronous and must throw on failure (mirrors popup.js's
 * `document.execCommand("copy")` wrapper).
 *
 * @param {{writeText: (text: string) => Promise<void>} | null | undefined} clipboardApi
 *        Typically `navigator.clipboard`, injected so this stays testable
 *        without a real DOM/browser.
 * @param {string} text  Text to copy (only used by the Clipboard API path;
 *        `legacyFallback` already closes over whatever it needs to copy).
 * @param {() => void} legacyFallback  Synchronous legacy copy path; must
 *        throw if it fails.
 * @returns {Promise<void>} Resolves if either path succeeded, rejects if
 *        both failed.
 */
export function writeToClipboard(clipboardApi, text, legacyFallback) {
  if (!clipboardApi || typeof clipboardApi.writeText !== "function") {
    return Promise.resolve().then(legacyFallback);
  }
  try {
    return clipboardApi.writeText(text).catch(legacyFallback);
  } catch {
    // Some contexts throw synchronously instead of rejecting (#1098).
    return Promise.resolve().then(legacyFallback);
  }
}
