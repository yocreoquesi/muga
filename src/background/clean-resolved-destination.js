/**
 * MUGA — cleaning a resolved shortener destination (#1264)
 *
 * `RESOLVE_SHORTENER` used to hand the raw output of `resolveShortener()` back
 * to its caller, which navigated to it (click) or displayed it as the real
 * destination (hover, #1028). The destination never passed through the JS
 * cleaning pipeline.
 *
 * The gap is narrower than "the destination is never cleaned", and saying it
 * the wide way overstates it: on navigation the DNR layer still strips
 * tracking params on Chrome, the blocking webRequest handler does the same on
 * Firefox, and the content script self-cleans on load. What is skipped are the
 * stages that exist ONLY in the JS pipeline:
 *
 *   - wrapper unwrapping, for every recipe that is not regex-pure. Only
 *     l.facebook.com and lm.facebook.com are mirrored into DNR by
 *     src/lib/wrapper-dnr-builder.js; the rest of the WRAPPERS table has no
 *     network-layer equivalent;
 *   - the path rules, beyond the Amazon canonical DNR rule.
 *
 * So a short link resolving onto a wrapped URL took that hop un-unwrapped,
 * while the same URL clicked directly would have been unwrapped. The user
 * asked MUGA to reveal where a short link really leads and got one hop less
 * than the extension can resolve.
 *
 * ── Why this is its own module ──────────────────────────────────────────────
 *
 * Same reason as run-migrations.js, single-flight-loader.js and
 * dnr-teardown.js: living inside service-worker.js means it can only be
 * tested through `swSource.includes(...)` source-string assertions, which is
 * the pattern the drift guard exists to stop growing (#706) and the mistake
 * #1268 names — a test that asserts against a hand-written copy rather than
 * the code that runs. Here the cleaning function is injected, so the tests
 * drive the real branching.
 */

/**
 * Runs a resolved shortener destination through the full cleaning pipeline
 * before it is handed back for navigation or preview.
 *
 * Cleaning can rewrite the host — that is the entire point, since unwrapping a
 * wrapper moves you to the destination inside it — and that invalidates the
 * checks `resolveShortener` already performed on the value it returned. So
 * every guarantee it made is re-asserted here against the rewritten URL rather
 * than assumed to survive the rewrite:
 *
 *   - **http(s) only**, because the content script and its `navigate()` helper
 *     both refuse anything else, so a bad scheme turns the click into a
 *     silent no-op;
 *   - **within `maxLength`**, for that same reason — `navigate()` returns
 *     early above the cap;
 *   - **not a private host**, because an unwrapped inner URL is
 *     attacker-chosen. The resolver's SSRF guard must not become escapable by
 *     wrapping a private address inside a redirect that a public shortener
 *     points at.
 *
 * Every failure path returns the ORIGINAL destination, which is exactly what
 * the handler returned before this function existed. Cleaning can improve the
 * result or do nothing; it can never make the outcome worse than today's.
 *
 * @param {string} destination
 *   Destination as validated and returned by `resolveShortener`.
 * @param {{
 *   clean: (url: string) => Promise<{cleanUrl?: string}>,
 *   isPrivateHost: (hostname: string) => boolean,
 *   maxLength: number,
 *   onError?: (err: unknown) => void,
 * }} deps
 * @returns {Promise<string>} The cleaned destination, or `destination` unchanged.
 */
export async function cleanResolvedDestination(destination, deps) {
  const { clean, isPrivateHost, maxLength, onError } = deps;
  if (typeof destination !== "string" || destination.length === 0) return destination;

  let cleaned;
  try {
    const result = await clean(destination);
    cleaned = result?.cleanUrl;
  } catch (err) {
    onError?.(err);
    return destination;
  }

  // Nothing to do is the common case: most destinations are already clean, and
  // returning the identical string keeps the caller's value byte-identical.
  if (typeof cleaned !== "string" || cleaned === destination) return destination;

  let parsed;
  try {
    parsed = new URL(cleaned);
  } catch {
    return destination;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return destination;
  if (cleaned.length > maxLength) return destination;
  if (isPrivateHost(parsed.hostname)) return destination;

  return cleaned;
}
