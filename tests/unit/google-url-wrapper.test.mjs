/**
 * MUGA — google.com/url wrapper recipe (#1028 follow-up).
 *
 * Run with: npm test
 *
 * Google's search-result / outbound redirect (google.<ccTLD>/url?url=… or q=…)
 * is a safe, non-affiliate local-unwrap target: the /url redirect is not an
 * attribution event, so replacing it with its embedded destination loses
 * nothing a creator or merchant relies on. The automated ClearURLs harvester
 * skips it only because ClearURLs anchors the host on a multi-TLD wildcard
 * (`google(?:\.[a-z]{2,}){1,}`) and gate #1 of harvest-unwrap requires a
 * concrete literal host. It is therefore hand-authored in wrappers.json with a
 * scoped `^…$` host regex.
 *
 * This test locks two things:
 *   1. The recipe unwraps real Google redirect shapes across ccTLDs.
 *   2. The host regex is tight: search pages, impostor hosts, and non-Google
 *      hosts are never unwrapped.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { unwrap, detectWrapper } from "../../src/lib/wrapper-engine.js";
import { WRAPPERS_RAW } from "../../src/rules/wrappers.data.js";

const destHost = (input) => {
  const res = unwrap(input);
  return res ? new URL(res.unwrapped).host : null;
};

describe("google.com/url wrapper — positive unwraps", () => {
  test("www.google.com/url?q= (URL-encoded destination) unwraps to the merchant", () => {
    const input =
      "https://www.google.com/url?q=https%3A%2F%2Fmerchant.example.com%2Fp%2F123&sa=D&usg=AOv";
    assert.equal(detectWrapper(input)?.id, "google-url");
    assert.equal(destHost(input), "merchant.example.com");
  });

  test("google.co.uk/url?url= (two-label ccTLD) unwraps", () => {
    const input = "https://google.co.uk/url?url=https://shop.example.org/x&usg=abc";
    assert.equal(destHost(input), "shop.example.org");
  });

  test("google.de/url?q= (single-label ccTLD) unwraps", () => {
    const input = "https://google.de/url?q=https://news.example.net/article";
    assert.equal(destHost(input), "news.example.net");
  });

  test("google.com.au/url?q= (com.<cc> ccTLD) unwraps", () => {
    const input = "https://google.com.au/url?q=https://store.example.com/item";
    assert.equal(destHost(input), "store.example.com");
  });
});

describe("google.com/url wrapper — negative cases (must NOT unwrap)", () => {
  test("google.com/search?q= (a search query, not the /url redirect) is untouched", () => {
    const input = "https://www.google.com/search?q=hello+world";
    assert.equal(detectWrapper(input), null);
    assert.equal(unwrap(input), null);
  });

  test("google.evil.com impostor host does not match the recipe", () => {
    const input = "https://google.evil.com/url?q=https://phish.example.com";
    assert.equal(detectWrapper(input), null);
    assert.equal(unwrap(input), null);
  });

  test("notgoogle.com does not match (host must start with google.)", () => {
    const input = "https://notgoogle.com/url?q=https://x.example.com";
    assert.equal(detectWrapper(input), null);
    assert.equal(unwrap(input), null);
  });

  // Anchoring guards — these lock the regex against future edits that might
  // accidentally introduce a subdomain wildcard or drop the `$` anchor.
  test("google.com.evil.com impostor (extra labels after a real ccTLD) does not match", () => {
    const input = "https://google.com.evil.com/url?q=https://phish.example.com";
    assert.equal(detectWrapper(input), null);
    assert.equal(unwrap(input), null);
  });

  test("google.co.uk.evil.com impostor does not match", () => {
    const input = "https://google.co.uk.evil.com/url?q=https://phish.example.com";
    assert.equal(detectWrapper(input), null);
    assert.equal(unwrap(input), null);
  });

  test("sub.google.com (arbitrary subdomain, not www) does not match", () => {
    const input = "https://sub.google.com/url?q=https://x.example.com";
    assert.equal(detectWrapper(input), null);
    assert.equal(unwrap(input), null);
  });

  test("google.com/url with no q/url param yields no unwrap", () => {
    const input = "https://www.google.com/url?sa=t&source=web";
    // The host+path match, but with no extractable destination the engine
    // returns null rather than a bogus unwrap.
    assert.equal(unwrap(input), null);
  });

  test("google.com/url whose destination is not http(s) is not unwrapped", () => {
    const input = "https://www.google.com/url?q=javascript:alert(1)";
    assert.equal(unwrap(input), null);
  });
});

describe("google.com/url wrapper — recipe shape", () => {
  test("wrappers.data.js carries the google-url recipe with the expected extractor", () => {
    const entry = WRAPPERS_RAW.find((w) => w.id === "google-url");
    assert.ok(entry, "google-url entry present in WRAPPERS_RAW");
    assert.equal(entry.pathPrefix, "/url");
    assert.equal(entry.extractor.kind, "fromAnyParam");
    assert.deepEqual(entry.extractor.paramName, ["url", "q"]);
    assert.equal(entry.hostPatterns.length, 1);
    assert.ok(
      entry.hostPatterns[0].startsWith("^") && entry.hostPatterns[0].endsWith("$"),
      "host pattern is an anchored regex",
    );
  });
});
