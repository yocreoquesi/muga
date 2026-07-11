/**
 * MUGA: Web-cleaner-tool adapter — dirty-to-expected contract grid against
 * the REAL cleaning engine (#1029, Phase 3, spec "Engine Update
 * Transparency", design ADR-6/ADR-8 item 2).
 *
 * Loads `src/content/cleaner-bundle.js` DOM-free via
 * tests/unit/helpers/load-web-engine.mjs (the byte-drift gate in
 * web-engine-mirror.test.mjs guarantees `web/engine/cleaner-bundle.js` is
 * identical) and injects the real engine into the adapter. If MUGA's
 * engine changes in a way that breaks this contract, this suite fails
 * BEFORE any web UI code change is needed.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { cleanUrl } from "../../web/engine/adapter.js";
import { engine } from "./helpers/load-web-engine.mjs";

describe("web adapter contract — tracking parameter removal", () => {
  test("strips utm_*, fbclid, gclid, mc_cid while keeping unrelated params and path", () => {
    const out = cleanUrl(
      "https://example.com/shop/item?utm_source=news&utm_medium=email&fbclid=abc123&gclid=xyz&mc_cid=q1w2&id=42",
      engine,
    );
    assert.equal(out.ok, true);
    for (const tracker of ["utm_source", "utm_medium", "fbclid", "gclid", "mc_cid"]) {
      assert.ok(out.removed.includes(tracker), `expected ${tracker} to be removed`);
    }
    const cleaned = new URL(out.cleanUrl);
    assert.equal(cleaned.pathname, "/shop/item");
    assert.equal(cleaned.searchParams.get("id"), "42");
    assert.equal(cleaned.searchParams.has("utm_source"), false);
    assert.equal(cleaned.searchParams.has("fbclid"), false);
  });
});

describe("web adapter contract — wrapper unwrapping", () => {
  test("unwraps google.com/url?q=<dest> to the destination host", () => {
    const out = cleanUrl("https://www.google.com/url?q=https://example.com/page", engine);
    assert.equal(out.ok, true);
    assert.equal(out.unwrapped, true);
    assert.equal(out.destinationHost, "example.com");
    assert.ok(out.cleanUrl.startsWith("https://example.com/page"));
  });

  test("unwraps l.facebook.com/l.php?u=<dest> to the destination host", () => {
    const out = cleanUrl(
      "https://l.facebook.com/l.php?u=" + encodeURIComponent("https://example.com/page") + "&h=abc",
      engine,
    );
    assert.equal(out.ok, true);
    assert.equal(out.unwrapped, true);
    assert.equal(out.destinationHost, "example.com");
    assert.ok(out.cleanUrl.startsWith("https://example.com/page"));
  });
});

describe("web adapter contract — affiliate and referral preservation", () => {
  test("preserves an existing Amazon affiliate tag while stripping tracking params", () => {
    const out = cleanUrl(
      "https://www.amazon.com/dp/B000123456?tag=somecreator-20&utm_source=newsletter",
      engine,
    );
    assert.equal(out.ok, true);
    assert.equal(out.affiliatePreserved, true);
    assert.ok(out.removed.includes("utm_source"));
    const cleaned = new URL(out.cleanUrl);
    assert.equal(cleaned.searchParams.get("tag"), "somecreator-20");
  });
});

describe("web adapter contract — no-op for already-clean URLs", () => {
  test("returns the input unchanged when nothing needs cleaning", () => {
    const input = "https://example.com/already-clean?id=42";
    const out = cleanUrl(input, engine);
    assert.equal(out.ok, true);
    assert.equal(out.cleanUrl, input);
    assert.deepEqual(out.removed, []);
    assert.equal(out.unwrapped, false);
  });
});

describe("web adapter contract — negative / invalid input handling", () => {
  test("empty input never throws and reports ok:false", () => {
    assert.doesNotThrow(() => cleanUrl("", engine));
    const out = cleanUrl("", engine);
    assert.equal(out.ok, false);
    assert.ok(out.error);
  });

  test("non-URL text never throws and reports ok:false", () => {
    assert.doesNotThrow(() => cleanUrl("not a url at all", engine));
    const out = cleanUrl("not a url at all", engine);
    assert.equal(out.ok, false);
    assert.ok(out.error);
  });

  test("javascript: scheme is rejected, never surfaced", () => {
    const out = cleanUrl("javascript:alert(document.cookie)", engine);
    assert.equal(out.ok, false);
    assert.ok(out.error);
  });

  test("an oversized destination (>2000 chars) is rejected with a friendly message", () => {
    const oversized = "https://example.com/?q=" + "a".repeat(2000);
    assert.ok(oversized.length > 2000);
    const out = cleanUrl(oversized, engine);
    assert.equal(out.ok, false);
    assert.ok(out.error);
  });
});

describe("web adapter contract — naked-link MUGA referral injection (web-tool-naked-link-injection)", () => {
  test("naked Amazon link gets MUGA's own tag; cleanUrlNoMugaReferral is the injection-off rerun", () => {
    const out = cleanUrl("https://www.amazon.com/dp/B000123456", engine);
    assert.equal(out.ok, true);
    assert.equal(out.action, "injected");
    assert.equal(out.mugaReferralInjected, true);
    assert.equal(out.mugaReferralPresent, true, "an injected tag is also present in the output");
    const injected = new URL(out.cleanUrl);
    assert.equal(injected.searchParams.get("tag"), "muga0b-20");
    assert.ok(out.cleanUrlNoMugaReferral, "cleanUrlNoMugaReferral must be present when injected");
    const optOut = new URL(out.cleanUrlNoMugaReferral);
    assert.equal(optOut.searchParams.has("tag"), false, "opt-out URL must carry no MUGA tag");
    assert.equal(optOut.pathname, injected.pathname);
  });

  test("naked Amazon link WITH a product-name slug strips the slug in BOTH the injected and opt-out URLs", () => {
    const out = cleanUrl("https://www.amazon.es/-/en/Sony-MDR-7506-Reduction-Closed-Headphones/dp/B000AJIF4E", engine);
    assert.equal(out.ok, true);
    assert.equal(out.mugaReferralInjected, true);
    assert.ok(!out.cleanUrl.includes("Sony-MDR-7506"), "injected URL must strip the Amazon slug");
    assert.ok(out.cleanUrlNoMugaReferral, "opt-out URL must be present when injected");
    // Regression guard: the injection-off rerun once omitted path-strip, so
    // the opt-out URL kept the slug the injected URL had already dropped.
    assert.ok(!out.cleanUrlNoMugaReferral.includes("Sony-MDR-7506"), "opt-out URL must also strip the Amazon slug");
    assert.equal(
      new URL(out.cleanUrlNoMugaReferral).pathname,
      new URL(out.cleanUrl).pathname,
      "opt-out and injected URLs must share the same slug-stripped pathname",
    );
  });

  test("naked eBay link gets MUGA's own referral, same opt-out contract", () => {
    const out = cleanUrl("https://www.ebay.com/itm/123456789", engine);
    assert.equal(out.ok, true);
    assert.equal(out.action, "injected");
    assert.equal(out.mugaReferralInjected, true);
    assert.equal(new URL(out.cleanUrl).searchParams.get("campid"), "5339147108");
    assert.ok(out.cleanUrlNoMugaReferral);
    assert.equal(new URL(out.cleanUrlNoMugaReferral).searchParams.has("campid"), false);
  });

  test("existing creator/foreign referral is preserved: no injection, no opt-out URL", () => {
    const out = cleanUrl("https://www.amazon.com/dp/B000123456?tag=somecreator-20", engine);
    assert.equal(out.ok, true);
    assert.equal(out.affiliatePreserved, true);
    assert.equal(out.mugaReferralInjected, false, "MUGA must not add anything when a referral already exists");
    assert.equal(out.mugaReferralPresent, false, "a foreign referral is not MUGA's own — no opt-out");
    assert.equal(out.cleanUrlNoMugaReferral, null, "nothing to opt out of when the referral is not MUGA's");
    assert.equal(new URL(out.cleanUrl).searchParams.get("tag"), "somecreator-20");
  });

  test("a pasted link that ALREADY carries MUGA's own tag surfaces the opt-out (not just the inject case)", () => {
    // The bug this fixes: re-cleaning a link that already carries our tag left
    // the referral on the output with no way to copy a tag-free variant, because
    // the opt-out was gated on action === "injected".
    const out = cleanUrl("https://www.amazon.com/dp/B000123456?tag=muga0b-20", engine);
    assert.equal(out.ok, true);
    assert.notEqual(out.action, "injected", "MUGA did not inject — the tag was already there");
    assert.equal(out.mugaReferralInjected, false);
    assert.equal(out.mugaReferralPresent, true, "our own tag is present in the output, so the opt-out must appear");
    assert.ok(out.cleanUrlNoMugaReferral, "a tag-free variant must be offered");
    assert.equal(
      new URL(out.cleanUrlNoMugaReferral).searchParams.has("tag"),
      false,
      "the opt-out URL must carry no MUGA tag",
    );
    // The default (with-referral) URL still carries our tag.
    assert.equal(new URL(out.cleanUrl).searchParams.get("tag"), "muga0b-20");
  });

  test("already-present tag with extra tracking: tracking is cleaned, our tag opt-out still offered", () => {
    const out = cleanUrl("https://www.amazon.com/dp/B000123456?tag=muga0b-20&utm_source=news", engine);
    assert.equal(out.ok, true);
    assert.ok(out.removed.includes("utm_source"), "tracking params must still be removed");
    assert.equal(out.mugaReferralPresent, true);
    assert.ok(out.cleanUrlNoMugaReferral);
    const optOut = new URL(out.cleanUrlNoMugaReferral);
    assert.equal(optOut.searchParams.has("tag"), false, "opt-out drops our tag");
    assert.equal(optOut.searchParams.has("utm_source"), false, "opt-out keeps the cleaned tracking removed");
  });

  test("non-supported program / plain link: no injection, no opt-out URL", () => {
    const out = cleanUrl("https://example.com/already-clean?id=42", engine);
    assert.equal(out.ok, true);
    assert.equal(out.mugaReferralInjected, false);
    assert.equal(out.mugaReferralPresent, false);
    assert.equal(out.cleanUrlNoMugaReferral, null);
  });

  test("existing fields (removed, unwrapped, affiliatePreserved, action) are unchanged by the new fields", () => {
    const out = cleanUrl(
      "https://example.com/shop/item?utm_source=news&utm_medium=email&id=42",
      engine,
    );
    assert.equal(out.ok, true);
    assert.deepEqual(out.removed.sort(), ["utm_medium", "utm_source"]);
    assert.equal(out.unwrapped, false);
    assert.equal(out.affiliatePreserved, false);
    assert.equal(out.action, "cleaned");
    assert.equal(out.mugaReferralInjected, false);
    assert.equal(out.mugaReferralPresent, false);
    assert.equal(out.cleanUrlNoMugaReferral, null);
  });
});

describe("web adapter contract — path-strip-rules.json parity", () => {
  test("strips the Amazon product-name slug (bug: web tool never applied path-strip)", () => {
    const out = cleanUrl(
      "https://www.amazon.es/-/en/Sony-MDR-7506-Reduction-Closed-Headphones/dp/B000AJIF4E/?th=1",
      engine,
    );
    assert.equal(out.ok, true);
    assert.ok(
      !out.cleanUrl.includes("Sony-MDR-7506"),
      "the Amazon product-name slug must be stripped from the cleaned URL",
    );
    const cleaned = new URL(out.cleanUrl);
    assert.equal(cleaned.pathname, "/-/en/dp/B000AJIF4E/");
  });
});

describe("web adapter contract — domain-rules.json parity", () => {
  test("preserves a domain-rule preserveParams entry that would otherwise be stripped as tracking", () => {
    // web/engine/domain-rules.json (mirrored from src/rules/domain-rules.json)
    // declares carrefourpl.snrpage.com -> preserveParams: ["utm_source"]. Without
    // domainRules wired into processUrl, utm_source is a global TRACKING_PARAM
    // and would be stripped like utm_medium below.
    const out = cleanUrl(
      "https://carrefourpl.snrpage.com/page?utm_source=abc&utm_medium=xyz",
      engine,
    );
    assert.equal(out.ok, true);
    assert.equal(out.removed.includes("utm_source"), false, "utm_source is domain-rule preserved");
    assert.ok(out.removed.includes("utm_medium"), "utm_medium has no domain-rule exemption here");
    const cleaned = new URL(out.cleanUrl);
    assert.equal(cleaned.searchParams.get("utm_source"), "abc");
    assert.equal(cleaned.searchParams.has("utm_medium"), false);
  });
});
