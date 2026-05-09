/**
 * MUGA: amzn.to tag= preservation — D7 shipping gate (G3)
 *
 * Why this file exists: amzn.to is an Amazon-branded URL shortener that
 * resolves server-side to an Amazon product URL. After the Privacy Proxy Worker
 * resolves the short URL, the cleaner pipeline receives the resolved URL
 * (e.g. https://www.amazon.com/dp/B0XXXXX?tag=creator-20&linkCode=ll1).
 * The critical invariant is that the affiliate tag= parameter MUST survive the
 * cleaner when Honor Creator Mode is active — the tag credits a content creator.
 *
 * This unit test exercises processUrl() on the post-proxy resolved URL directly.
 * It does NOT test the proxy Client or Worker — only the cleaner's invariant on
 * the resolved URL the proxy is contractually obligated to deliver.
 *
 * Per AD-03 design, the four cases tested are:
 *   1. amazon.com ?tag=<creator> preserved with honorCreatorMode = true
 *   2. amazon.es  ?tag=<creator> preserved with honorCreatorMode = true
 *   3. Control: honorCreatorMode = false + stripAllAffiliates → tag stripped
 *   4. Noise params (linkCode, ref_, psc) stripped while tag= survives
 *
 * G3 gate: if any case fails, amzn.to is rolled back from BOTH
 * src/lib/opaque-networks.js AND muga-unwrap. All other redirector-coverage-
 * expansion additions (bit.ly, tinyurl.com, prf.hn, px.a8.net, t.co,
 * link.medium.com) are NOT contingent on this gate.
 *
 * Run with: npm test
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { processUrl } from "../../src/lib/cleaner.js";

describe("amzn.to regression — tag= preservation post-proxy (D7 shipping gate)", () => {
  test("amazon.com/dp/<asin>?tag=<creator> preserves tag when Honor Creator is on", () => {
    // Simulates the URL the Worker hands back after resolving amzn.to/<x>.
    // The Worker follows the amzn.to → amazon.com redirect chain server-side
    // and returns the fully-resolved URL including the affiliate tag.
    const resolvedFromProxy = "https://www.amazon.com/dp/B0XXXXX?tag=youtuber-20";
    const result = processUrl(resolvedFromProxy, {
      enabled: true,
      honorCreatorMode: true,
      privacyProxyEnabled: true,
    });
    assert.ok(
      result.cleanUrl.includes("tag=youtuber-20"),
      `Expected tag=youtuber-20 to survive the cleaner; got ${result.cleanUrl}`,
    );
  });

  test("amazon.es ?tag preserved on Honor Creator + Privacy Proxy active", () => {
    // Same gate for Spanish marketplace — tag= param is present for amazon.es
    // in AFFILIATE_PATTERNS, so it is in the affiliateParamSet that protects
    // it from being stripped by stripTrackingParams.
    const resolved = "https://www.amazon.es/dp/B0XXXXX?tag=creator-21";
    const result = processUrl(resolved, {
      enabled: true,
      honorCreatorMode: true,
      privacyProxyEnabled: true,
    });
    assert.ok(
      result.cleanUrl.includes("tag=creator-21"),
      `Expected tag=creator-21 to survive on amazon.es; got ${result.cleanUrl}`,
    );
  });

  test("amazon.com tag NOT preserved when Honor Creator is OFF and stripAllAffiliates is on (control)", () => {
    // This control case asserts the gate is mode-driven, not always-preserve.
    // When stripAllAffiliates is true, affiliate params ARE stripped even on
    // Amazon — the cleaner treats them as external tags.
    const resolved = "https://www.amazon.com/dp/B0XXXXX?tag=youtuber-20";
    const result = processUrl(resolved, {
      enabled: true,
      honorCreatorMode: false,
      privacyProxyEnabled: false,
      stripAllAffiliates: true,
    });
    assert.ok(
      !result.cleanUrl.includes("tag=youtuber-20"),
      `With stripAllAffiliates and no honor mode, tag= should be stripped; got ${result.cleanUrl}`,
    );
  });

  test("noise params on resolved Amazon URL are stripped while tag= survives", () => {
    // The Worker may return a URL with Amazon's own tracking noise alongside
    // the affiliate tag. The cleaner must strip the noise but preserve the tag.
    const resolved =
      "https://www.amazon.com/dp/B0XXXXX?tag=youtuber-20&psc=1&ref_=cm_sw_r&linkCode=ll1";
    const result = processUrl(resolved, {
      enabled: true,
      honorCreatorMode: true,
      privacyProxyEnabled: true,
    });
    // Tag must survive
    assert.ok(
      result.cleanUrl.includes("tag=youtuber-20"),
      `Expected tag=youtuber-20 to survive noise-param stripping; got ${result.cleanUrl}`,
    );
    // Amazon tracking noise must be gone
    assert.ok(
      !result.cleanUrl.includes("psc="),
      `Expected psc= to be stripped; got ${result.cleanUrl}`,
    );
    assert.ok(
      !result.cleanUrl.includes("linkCode="),
      `Expected linkCode= to be stripped; got ${result.cleanUrl}`,
    );
    assert.ok(
      !result.cleanUrl.includes("ref_="),
      `Expected ref_= to be stripped; got ${result.cleanUrl}`,
    );
  });
});
