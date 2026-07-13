/**
 * MUGA: unwrap indicator for the popup preview (#1062 part 3).
 *
 * The popup already shows the "% shorter" line and the removed-parameter
 * breakdown, but not the third receipt the issue asks for: whether MUGA
 * UNWRAPPED a redirect. When the cleaner reveals the real destination behind a
 * redirect wrapper (or resolves a shortener), the HOST changes — plain
 * tracking-param cleaning never touches the host. So a host change IS the
 * unwrap signal.
 *
 * This mirrors the shipped web tool exactly (web/engine/adapter.js:
 * `unwrapped = destinationHost !== inputUrl.hostname`) so the extension and the
 * muga.app/clean tool tell the user the same honest thing.
 *
 * Pure, DOM-free — content/popup can't ES-import cross-browser in the content
 * layer, but the popup IS an extension page and imports this directly.
 *
 * @param {string} originalUrl The URL as the user sees it (pre-clean).
 * @param {string} cleanUrl    The cleaned/unwrapped URL.
 * @returns {{ unwrapped: boolean, destinationHost: string|null }}
 *   unwrapped=true with the revealed host when the destination host differs
 *   from the original; otherwise a no-op. Never throws.
 */
export function computeUnwrapView(originalUrl, cleanUrl) {
  const none = { unwrapped: false, destinationHost: null };
  if (typeof originalUrl !== "string" || typeof cleanUrl !== "string") return none;

  let originalHost;
  let destinationHost;
  try {
    originalHost = new URL(originalUrl).hostname;
  } catch {
    return none;
  }
  try {
    destinationHost = new URL(cleanUrl).hostname;
  } catch {
    return none;
  }

  if (!destinationHost || destinationHost === originalHost) return none;
  return { unwrapped: true, destinationHost };
}
