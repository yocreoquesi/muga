/**
 * MUGA — Affiliate-survival canaries (single source of truth) — #768 / epic #785.
 *
 * The canary safety net: a curated set of real affiliate URLs whose attribution
 * MUST survive MUGA's cleaning. This module is PURE DATA — no imports, no logic —
 * so it can be consumed by:
 *   - the test suite (tests/unit/affiliate-canaries.test.mjs), and
 *   - the rule-ingestion pipeline GATE 3 (#771, #777).
 *
 * Two kinds:
 *   PRESERVE_CANARIES — run processUrl(url, prefs). Every key in `mustSurvive`
 *     must remain on the cleaned URL with its EXACT value; every param in
 *     `mustStrip` must be removed.
 *   LANDING_CANARIES — run getLandingPolicy(landingHost, referrer). The returned
 *     `preserve` set must be a superset of `mustPreserve`, and `network` must
 *     match.
 *
 * Extracted verbatim from the assertions previously scattered across
 * cleaner.test.mjs and get-landing-policy.test.mjs (deduped by #769).
 * Relocated from tests/fixtures/affiliate-canaries.mjs to
 * tools/affiliate-safety/canaries.mjs (#777, EPIC C) — direction is now
 * tests/→tools/ (correct); tools/ production code can safely import this.
 *
 * NOTE: amzn.to is intentionally absent — it sits in opaque-networks'
 * PENDING_VERDICT bucket awaiting #665. The Tradedoubler `tduid` canary is added
 * by #770 (it has no coverage yet).
 */

/** Base prefs: cleaning on, no own-tag injection. Mirrors cleaner.test.mjs PREFS. */
const PRESERVE_PREFS = Object.freeze({
  enabled: true,
  injectOwnAffiliate: false,
  notifyForeignAffiliate: false,
  blacklist: [],
  whitelist: [],
});

/** Injection ON — proves an EXISTING (foreign) affiliate tag is never replaced. */
const INJECT_PREFS = Object.freeze({ ...PRESERVE_PREFS, injectOwnAffiliate: true });

const AMAZON_MARKETS = ["www.amazon.es", "www.amazon.de", "www.amazon.fr", "www.amazon.it", "www.amazon.co.uk", "www.amazon.com"];
const EBAY_MARKETS = ["www.ebay.com", "www.ebay.es", "www.ebay.de", "www.ebay.co.uk", "www.ebay.fr", "www.ebay.it"];

export const PRESERVE_CANARIES = Object.freeze([
  // Amazon `tag` across 6 TLDs: a creator's existing tag is never replaced,
  // even with our own-tag injection enabled.
  ...AMAZON_MARKETS.map((host) => ({
    name: `${host}: foreign affiliate tag survives (even with injection on)`,
    url: `https://${host}/dp/B08N5WRWNW?tag=creator-21`,
    prefs: INJECT_PREFS,
    mustSurvive: { tag: "creator-21" },
    mustStrip: [],
  })),

  // eBay `campid` across 6 marketplaces: existing campid never replaced.
  ...EBAY_MARKETS.map((host) => ({
    name: `${host}: foreign campid survives (even with injection on)`,
    url: `https://${host}/itm/123456789?campid=9999999999`,
    prefs: INJECT_PREFS,
    mustSurvive: { campid: "9999999999" },
    mustStrip: [],
  })),

  // Affiliate / tracking collisions: the affiliate param wins, noise is stripped.
  {
    name: "amazon.es: tag preserved, UTM stripped",
    url: "https://www.amazon.es/dp/B08N5WRWNW?tag=someaffiliate-21&utm_source=email&utm_medium=cpc",
    prefs: PRESERVE_PREFS,
    mustSurvive: { tag: "someaffiliate-21" },
    mustStrip: ["utm_source", "utm_medium"],
  },
  {
    name: "amazon.es: tag preserved, internal noise stripped",
    url: "https://www.amazon.es/dp/B08N5WRWNW?tag=someaffiliate-21&psc=1&pd_rd_r=abc&linkCode=ll1",
    prefs: PRESERVE_PREFS,
    mustSurvive: { tag: "someaffiliate-21" },
    mustStrip: ["psc", "pd_rd_r", "linkCode"],
  },
  {
    name: "ebay.es: campid preserved, mkevt + UTM stripped",
    url: "https://www.ebay.es/itm/123456?campid=some-affiliate-id&mkevt=1&utm_source=google",
    prefs: PRESERVE_PREFS,
    mustSurvive: { campid: "some-affiliate-id" },
    mustStrip: ["mkevt", "utm_source"],
  },
  {
    name: "pccomponentes: ref preserved (host-matched affiliate param), UTM stripped",
    url: "https://www.pccomponentes.com/producto?ref=some-affiliate-tag&utm_source=google",
    prefs: PRESERVE_PREFS,
    mustSurvive: { ref: "some-affiliate-tag" },
    mustStrip: ["utm_source"],
  },
]);

export const LANDING_CANARIES = Object.freeze([
  { name: "awin", landingHost: "zalando.es", referrer: "https://www.awin1.com/cread.php?id=1", mustPreserve: ["awc", "wt_mc"], network: "awin" },
  { name: "cj-affiliate", landingHost: "walmart.com", referrer: "https://anrdoezrs.net/click-123-456", mustPreserve: ["cjdata", "cjevent"], network: "cj-affiliate" },
  { name: "aliexpress-affiliate", landingHost: "aliexpress.com", referrer: "https://s.click.aliexpress.com/e/_DnZbqGr", mustPreserve: ["aff_request_id", "aff_trace_key", "algo_expid", "algo_pvid", "btsid", "ws_ab_test"], network: "aliexpress-affiliate" },
  { name: "impact-radius", landingHost: "target.com", referrer: "https://target.pxf.io/c/1234/abc", mustPreserve: ["iclid", "irclickid", "irgwc"], network: "impact-radius" },
  { name: "partnerize", landingHost: "partner.com", referrer: "https://prf.hn/click/123", mustPreserve: ["adref", "clickref", "pubref"], network: "partnerize" },
  { name: "admitad (ad.admitad.com)", landingHost: "shop.com", referrer: "https://ad.admitad.com/g/abc", mustPreserve: ["admitad_uid", "tagtag_uid"], network: "admitad" },
  { name: "admitad (alitems.com)", landingHost: "aliexpress.com", referrer: "https://alitems.com/g/xyz", mustPreserve: ["admitad_uid", "tagtag_uid"], network: "admitad" },
  { name: "a8net", landingHost: "rakuten.co.jp", referrer: "https://px.a8.net/svt/ejp?id=1", mustPreserve: ["a8"], network: "a8net" },
  { name: "rakuten-linkshare", landingHost: "ebay.com", referrer: "https://click.linksynergy.com/deeplink?id=1", mustPreserve: ["raneaid", "ranmid", "ransiteid"], network: "rakuten-linkshare" },
  { name: "tradetracker", landingHost: "merchant.de", referrer: "https://tc.tradetracker.net/?c=1&m=2", mustPreserve: ["ttaid", "ttcid", "ttrk"], network: "tradetracker" },
  // #770: Tradedoubler was the one matrix-v1.0 network with zero canary coverage.
  { name: "tradedoubler", landingHost: "merchant.com", referrer: "https://clk.tradedoubler.com/click?p=1&a=2&url=https%3A%2F%2Fmerchant.com", mustPreserve: ["tduid"], network: "tradedoubler" },
]);
