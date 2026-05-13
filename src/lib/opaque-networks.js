/** MUGA: Opaque affiliate networks — wrappers that cannot be unwrapped client-side */
//
// Adding entries here is security-relevant. Goes through proposal review.
//
// These are redirect-network intermediaries whose destination URL is NOT
// embedded in the redirect URL (e.g. stored server-side behind a click ID).
// Client-side unwrapping is impossible; the Privacy Proxy tier handles them
// when the user has opted in (privacyProxyEnabled = true).
//
// Source references for each entry:
//   - s.click.aliexpress.com  — AliExpress affiliate click tracker
//   - anrdoezrs.net / dpbolvw.net / jdoqocy.com / kqzyfj.com /
//     tkqlhce.com / emjcd.com / qksrv.net / cj.dotomi.com
//       — CJ Affiliate (Commission Junction) redirect domains
//         (src/rules/caps-manifest.json, program id: cj-affiliate)
//   - ad.admitad.com — Admitad CPA network
//   - bit.ly          — Generic URL shortener (redirector-coverage-expansion, PR-02)
//   - tinyurl.com     — Generic URL shortener (redirector-coverage-expansion, PR-03)
//   - prf.hn          — Partnerize / Performance Horizon affiliate (redirector-coverage-expansion, PR-04)
//   - px.a8.net       — A8.net Japan affiliate; px.a8.net confirmed via T00 STANDARD probe
//   - amzn.to         — Amazon branded shortener; tag= preservation gated via G3/T19
//   - t.co            — Twitter/X URL shortener; extension-only activation (Worker already accepts via the wrappers manifest)
//   - link.medium.com — Medium URL shortener; extension-only activation (Worker already accepts via the wrappers manifest)
//   - lnkd.in         — LinkedIn share tracker; STANDARD probe verdict 2026-05-09 (#607)
//   - fb.me           — Facebook universal shortener; STANDARD probe verdict 2026-05-09 (#607)
//   - ebay.to         — eBay branded shortener; STANDARD probe verdict 2026-05-09 (#607)

export const OPAQUE_NETWORKS = Object.freeze([
  // AliExpress affiliate click tracker
  "s.click.aliexpress.com",

  // CJ Affiliate (Commission Junction) — all redirect domains from src/rules/caps-manifest.json
  "anrdoezrs.net",
  "dpbolvw.net",
  "jdoqocy.com",
  "kqzyfj.com",
  "tkqlhce.com",
  "emjcd.com",
  "qksrv.net",
  "cj.dotomi.com",

  // Admitad CPA network
  "ad.admitad.com",

  // Generic URL shorteners (redirector-coverage-expansion)
  "bit.ly",
  "tinyurl.com",

  // Partnerize / Performance Horizon affiliate (opaque path — no client-side extractor)
  "prf.hn",

  // A8.net Japan affiliate — hostname px.a8.net confirmed STANDARD via T00 probe
  "px.a8.net",

  // Amazon branded shortener — tag= preservation verified via G3 regression test
  "amzn.to",

  // Extension-only activations: Worker already accepts these via the wrappers manifest's buildSpecAllowlist
  "t.co",
  "link.medium.com",

  // Branded shorteners (#607 — verified STANDARD via curl probe 2026-05-09; Worker hardcoded entries)
  "lnkd.in",
  "fb.me",
  "ebay.to",
]);

/**
 * Returns true when the given hostname is a known opaque network host that
 * cannot be unwrapped client-side.
 *
 * Centralises the www. normalization that previously lived inline inside the
 * content-script IIFE in src/content/cleaner.js. After the T10–T12 refactor,
 * cleaner.js delegates to window.__mugaCleaner.isOpaqueNetworkHost (provided
 * by the content bundle) which re-exports this function.
 *
 * @param {string|null|undefined} hostname - URL.hostname (already lower-cased
 *   by the URL parser in most callers, but normalisation is applied defensively)
 * @returns {boolean}
 */
export function isOpaqueNetworkHost(hostname) {
  if (!hostname) return false;
  const h = hostname.replace(/^www\./, "");
  return OPAQUE_NETWORKS.includes(h) || OPAQUE_NETWORKS.includes(hostname);
}
