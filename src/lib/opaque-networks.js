/** MUGA: Redirect/shortener hosts whose destination is not embedded in the URL */
//
// Adding entries here is security-relevant. Goes through proposal review
// (caps-spec or muga RFC).
//
// 2.1 denoise pivot (#653): the historical OPAQUE_NETWORKS list is now split
// into two semantic buckets — generic shorteners (safe to unwrap by design,
// no attribution at stake) and affiliate redirect networks (attribution
// belongs to whoever owns the redirect; we must NOT swap a server-side
// unwrap for the original click). See docs/affiliate-networks-matrix.md
// (matrix v1.0) for the per-network analysis driving this classification.
//
// Buckets:
//
//   GENERIC_SHORTENERS — third-party URL shorteners with no attribution
//   contract. Client-side or server-side unwrap is harmless; under 2.1 the
//   client unwraps these directly when possible and the URL Unwrapper tier
//   (formerly Privacy Proxy) resolves the rest. See matrix §"Generic
//   shorteners" and §"Branded shorteners".
//
//   AFFILIATE_REDIRECT_NETWORKS — affiliate network intermediaries where
//   the click itself IS the attribution event. The merchant's first-party
//   cookie is populated from URL params at the landing page; replacing the
//   redirect with the canonical destination kills the creator's commission.
//   Under 2.1 these MUST pass through unchanged. See matrix §"Tier-1",
//   §"Tier-2", §"Tier-3" per-network "Recommended cleaner policy".
//
//   AD_GATEWAY_NETWORKS — shortener-resolver-expansion Slice 1: hosts that
//   present as shorteners but gate the real destination behind an
//   ad-interstitial or paywall instead of a plain HTTP redirect. Recognized
//   and never resolved; see isAdGateway() below.
//
//   PENDING_VERDICT — entries waiting for a P4.2 (#665) verdict. Kept in
//   the legacy union to preserve existing behavior until the verdict
//   lands; do NOT use the new helpers for these.
//
// Source references for each entry (cross-linked to matrix sections):
//   - s.click.aliexpress.com  — AliExpress affiliate click tracker
//                               (matrix §"AliExpress")
//   - anrdoezrs.net / dpbolvw.net / jdoqocy.com / kqzyfj.com /
//     tkqlhce.com / emjcd.com / qksrv.net / cj.dotomi.com
//                             — CJ Affiliate (Commission Junction) redirect
//                               domains (matrix §"CJ Affiliate"; caps-spec
//                               manifest.json program id: cj-affiliate)
//   - ad.admitad.com          — Admitad CPA network (matrix §"Admitad")
//   - prf.hn                  — Partnerize / Performance Horizon affiliate
//                               (matrix §"Partnerize" — strongest documented
//                               attribution verdict in the matrix)
//   - px.a8.net               — A8.net Japan affiliate; px.a8.net confirmed
//                               via T00 STANDARD probe (matrix §"A8.net")
//   - bit.ly                  — Generic URL shortener (PR-02)
//   - tinyurl.com             — Generic URL shortener (PR-03)
//   - amzn.to                 — Amazon branded shortener; tag= preservation
//                               gated via G3/T19; bucket verdict pending P4.2
//   - t.co                    — Twitter/X URL shortener
//   - link.medium.com         — Medium URL shortener
//   - lnkd.in                 — LinkedIn share tracker (STANDARD probe #607)
//   - fb.me                   — Facebook universal shortener (STANDARD probe #607)
//   - ebay.to                 — eBay branded shortener (STANDARD probe #607)

/**
 * Third-party URL shorteners with no affiliate attribution contract.
 * Safe to unwrap; under 2.1 the URL Unwrapper tier accepts these by default.
 */
export const GENERIC_SHORTENERS = Object.freeze([
  "bit.ly",
  "tinyurl.com",
  "t.co",
  "link.medium.com",
  "lnkd.in",
  "fb.me",
  "ebay.to",

  // shortener-resolver-expansion Slice 1 (confident-tier, no probe needed —
  // long-established generic shorteners with no ad-interstitial history):
  "is.gd",       // is.gd — generic shortener
  "v.gd",        // v.gd — is.gd's sister service
  "cutt.ly",     // cutt.ly — generic shortener
  "rebrand.ly",  // rebrand.ly — generic shortener
  "ow.ly",       // ow.ly — Hootsuite's generic shortener
  "buff.ly",     // buff.ly — Buffer's generic shortener

  // shortener-resolver-expansion Slice 2 (probable-tier, graduated after a
  // live redirect probe — see tools/probe-shortener-redirect.mjs — confirmed
  // each gives a direct 3xx to a real destination with no ad-interstitial):
  "rb.gy",       // rb.gy — Rebrandly's generic shortener
  "tiny.cc",     // tiny.cc — generic shortener
  "dlvr.it",     // dlvr.it — generic shortener
  "ift.tt",      // ift.tt — IFTTT's generic shortener
  "qr.ae",       // qr.ae — Quora's generic shortener

  // shortener-resolver-expansion Slice 3 (re-probed with a real browser
  // User-Agent — see tools/probe-shortener-redirect.mjs — a plain curl
  // without a browser UA gets a Cloudflare bot-challenge (403), but the
  // extension's background fetch() always carries the browser's real UA
  // and resolves cleanly with a direct 3xx; a Cloudflare challenge would
  // just fail the resolver's fetch, which is fail-safe):
  "t.ly",        // t.ly — generic shortener
]);

/**
 * Affiliate-network redirect intermediaries. The click itself is the
 * attribution event — the destination must be reached through the network's
 * redirect, not via client-side unwrap. Under 2.1 these MUST pass through
 * unchanged (#659 retires the Worker's resolution of these hosts).
 *
 * Skimlinks (go.redirectingat.com, go.skimresources.com) and ShareASale
 * (shareasale.com, www.shareasale.com) joined this bucket in #907, extending
 * the ADR-0003 policy: both were previously unwrapped client-side via
 * explicit wrapper-engine.js recipes, but — like Awin/Impact/Rakuten/
 * TradeTracker before them — their 30x is the attribution event, so a local
 * unwrap risks dropping click context the merchant's tag needs at landing.
 * Pass-through lets the network's own redirect execute in the browser.
 */
export const AFFILIATE_REDIRECT_NETWORKS = Object.freeze([
  // AliExpress affiliate click tracker
  "s.click.aliexpress.com",

  // Awin — retired from wrapper-engine in #684 per ADR-0003. Awin's
  // attribution model appends awc/wt_mc at the 30x; pass-through lets the
  // merchant's MasterTag populate the first-party cookie at landing.
  "awin1.com",
  "www.awin1.com",

  // CJ Affiliate (Commission Junction) — all redirect domains from caps-spec
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

  // Partnerize / Performance Horizon
  "prf.hn",

  // A8.net Japan affiliate — hostname px.a8.net confirmed STANDARD via T00 probe
  "px.a8.net",

  // Impact Radius — retired from wrapper-engine in #692 per ADR-0003 follow-up.
  // Wildcard entry: Impact assigns brand-specific subdomains on pxf.io
  // (target.pxf.io, walmart.pxf.io, gohealth.pxf.io, …). The apex pxf.io is
  // excluded by the wildcard semantics (requires at least one subdomain label).
  "*.pxf.io",

  // Rakuten Advertising (LinkShare) — retired from wrapper-engine in #692.
  "click.linksynergy.com",

  // TradeTracker — retired from wrapper-engine in #692.
  "tc.tradetracker.net",

  // Tradedoubler — retired from content-script legacy unwrap in #695. Matrix
  // doc analysed `tduid` as required-at-landing (the conventional click-id
  // family used by Tradedoubler advertiser integrations).
  "clk.tradedoubler.com",

  // Admitad alitems variant — sibling to ad.admitad.com (above). Retired from
  // content-script legacy unwrap in #695. Matrix doc lists alitems as a
  // known-unknown awaiting a full per-network entry (#646 follow-up); included
  // here per the matrix's bias toward preservation while the formal entry
  // gets researched.
  "alitems.com",

  // VigLink wrapper — retired from content-script legacy unwrap in #695.
  // Same known-unknown status as alitems.com; full matrix entry pending
  // (#646 follow-up). Pass-through is the conservative default.
  "redirect.viglink.com",

  // Skimlinks — retired from wrapper-engine in #907. Skimlinks' publisher
  // redirect (go.redirectingat.com / go.skimresources.com) is a genuine
  // attribution-bearing 30x, not a safe-to-unwrap generic redirector;
  // client-side unwrap would drop the click context the merchant tag
  // depends on at landing.
  "go.redirectingat.com",
  "go.skimresources.com",

  // ShareASale — retired from wrapper-engine in #907. Previously unwrapped
  // via an explicit `/r.cfm?urllink=` recipe; reclassified pass-through so
  // the network's 30x can populate the merchant's first-party cookie,
  // consistent with Awin/Impact/Rakuten/TradeTracker above.
  "shareasale.com",
  "www.shareasale.com",
]);

/**
 * Ad-gateway hosts: present as shorteners but gate the real destination
 * behind an ad-interstitial, paywall, or JS-timer page instead of a plain
 * HTTP redirect. shortener-resolver-expansion Slice 1 (D1): the resolver's
 * default-deny already excludes any host absent from GENERIC_SHORTENERS, so
 * this bucket's real value is (1) a mutual-disjointness invariant that
 * catches any future accidental addition of one of these hosts to
 * GENERIC_SHORTENERS, and (2) a distinct `resolveShortener` failure reason
 * ("ad_gateway") for hosts that must never be resolved. Intentionally
 * excluded from optional_host_permissions and CSP connect-src in both
 * manifests — no permission, no fetch, fails closed by construction.
 */
export const AD_GATEWAY_NETWORKS = Object.freeze([
  "ouo.io",
  "linkvertise.com",
  "soo.gd",
]);

/**
 * Hosts waiting for a P4.2 (#665) bucket verdict. Kept in the legacy
 * OPAQUE_NETWORKS union for behavior compat; NOT addressed by the new
 * isGenericShortener / isAffiliateRedirectNetwork helpers.
 */
const PENDING_VERDICT = Object.freeze([
  // Amazon branded shortener — tag= preservation verified via G3 regression test;
  // bucket assignment pending P4.2 (#665).
  "amzn.to",
]);

/**
 * Legacy union of every redirect/shortener host MUGA recognises. Retained
 * for backwards compat with existing callers and tests. New code should
 * prefer the bucket-specific arrays/helpers above so the caller's intent
 * (shortener vs affiliate redirect) is explicit at the call site.
 */
export const OPAQUE_NETWORKS = Object.freeze([
  ...AFFILIATE_REDIRECT_NETWORKS,
  ...GENERIC_SHORTENERS,
  ...PENDING_VERDICT,
]);

function matches(list, hostname) {
  if (!hostname) return false;
  const h = hostname.replace(/^www\./, "");
  if (list.includes(h) || list.includes(hostname)) return true;
  // Wildcard suffix match: an entry of the form `*.<suffix>` matches any
  // hostname whose suffix equals `<suffix>` AND has at least one subdomain
  // label. Mirrors the wildcard semantics used by getRedirectNetworkForRedirectHost
  // in affiliates.js (the matrix-side resolver). `*.pxf.io` matches
  // `target.pxf.io` but NOT the bare apex `pxf.io`.
  for (const entry of list) {
    if (typeof entry !== "string" || !entry.startsWith("*.")) continue;
    const suffix = entry.slice(1); // ".pxf.io"
    if (h.length > suffix.length && h.endsWith(suffix)) return true;
    if (hostname.length > suffix.length && hostname.endsWith(suffix)) return true;
  }
  return false;
}

/**
 * Returns true when the given hostname is a known generic URL shortener
 * with no affiliate attribution contract.
 *
 * @param {string|null|undefined} hostname
 * @returns {boolean}
 */
export function isGenericShortener(hostname) {
  return matches(GENERIC_SHORTENERS, hostname);
}

/**
 * Returns true when the given hostname is an affiliate-network redirect
 * intermediary whose click IS the attribution event. Hosts in this set
 * must NOT be client-side unwrapped under the 2.1 pivot.
 *
 * @param {string|null|undefined} hostname
 * @returns {boolean}
 */
export function isAffiliateRedirectNetwork(hostname) {
  return matches(AFFILIATE_REDIRECT_NETWORKS, hostname);
}

/**
 * Returns true when the given hostname is a known ad-gateway host — a
 * shortener-shaped link whose real destination is behind an ad-interstitial
 * or paywall. Never resolved by resolveShortener, regardless of toggle state.
 *
 * @param {string|null|undefined} hostname
 * @returns {boolean}
 */
export function isAdGateway(hostname) {
  return matches(AD_GATEWAY_NETWORKS, hostname);
}

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
  return matches(OPAQUE_NETWORKS, hostname);
}
