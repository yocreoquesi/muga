/**
 * MUGA — Unit tests for web/ui-view.js (#1029, Phase 4)
 *
 * web/ui.js is browser-only (DOM wiring) and cannot be exercised under
 * node:test, mirroring the precedent set by src/lib/remote-rules-
 * changelog-view.js / src/options/options.js: the branching that decides
 * WHAT to render is pulled into a pure view-model module so it stays
 * unit-tested, and the untested DOM-wiring file stays as thin as
 * possible (covered instead by tests/unit/web-ui-source-guard.test.mjs).
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { computeLengthReduction, emptyStateView, formatCleanResult } from "../../web/ui-view.js";

describe("emptyStateView()", () => {
  test("returns the initial empty state with no result yet", () => {
    const view = emptyStateView();
    assert.equal(view.state, "empty");
    assert.equal(typeof view.message, "string");
    assert.ok(view.message.length > 0);
    assert.equal(view.cleanUrl, null);
    assert.deepEqual(view.removedList, []);
    assert.equal(view.removedCount, 0);
    assert.equal(view.unwrapped, false);
    assert.equal(view.destinationHost, null);
    assert.equal(view.affiliatePreserved, false);
    assert.equal(view.noChanges, false);
  });
});

describe("formatCleanResult() — failure paths", () => {
  test("renders the adapter's friendly error message on ok:false", () => {
    const result = {
      ok: false,
      cleanUrl: "not a url",
      removed: [],
      unwrapped: false,
      destinationHost: null,
      affiliatePreserved: false,
      action: "invalid",
      error: "That doesn't look like a valid URL.",
    };
    const view = formatCleanResult(result);
    assert.equal(view.state, "error");
    assert.equal(view.message, "That doesn't look like a valid URL.");
    assert.equal(view.cleanUrl, null);
    assert.deepEqual(view.removedList, []);
  });

  test("falls back to a generic message when result is missing or has no error string", () => {
    assert.equal(formatCleanResult(null).state, "error");
    assert.ok(formatCleanResult(null).message.length > 0);
    assert.equal(formatCleanResult({ ok: false }).state, "error");
    assert.ok(formatCleanResult({ ok: false }).message.length > 0);
  });
});

describe("formatCleanResult() — success paths", () => {
  test("reports removed params and a change summary", () => {
    const result = {
      ok: true,
      cleanUrl: "https://example.com/shop/item?id=42",
      removed: ["utm_source", "utm_medium", "fbclid"],
      unwrapped: false,
      destinationHost: "example.com",
      affiliatePreserved: false,
      action: "cleaned",
    };
    const view = formatCleanResult(result);
    assert.equal(view.state, "clean");
    assert.equal(view.cleanUrl, "https://example.com/shop/item?id=42");
    assert.deepEqual(view.removedList, ["utm_source", "utm_medium", "fbclid"]);
    assert.equal(view.removedCount, 3);
    assert.equal(view.noChanges, false);
    assert.ok(view.message.includes("3 tracking parameters removed"));
  });

  test("uses singular phrasing for exactly one removed parameter", () => {
    const result = {
      ok: true,
      cleanUrl: "https://example.com/?id=1",
      removed: ["utm_source"],
      unwrapped: false,
      destinationHost: "example.com",
      affiliatePreserved: false,
      action: "cleaned",
    };
    const view = formatCleanResult(result);
    assert.ok(view.message.includes("1 tracking parameter removed"));
    assert.ok(!view.message.includes("1 tracking parameters"));
  });

  test("reports the destination host when unwrapped", () => {
    const result = {
      ok: true,
      cleanUrl: "https://example.com/page",
      removed: [],
      unwrapped: true,
      destinationHost: "example.com",
      affiliatePreserved: false,
      action: "cleaned",
    };
    const view = formatCleanResult(result);
    assert.equal(view.state, "clean");
    assert.equal(view.unwrapped, true);
    assert.equal(view.destinationHost, "example.com");
    assert.equal(view.noChanges, false);
    assert.ok(view.message.includes("redirect wrapper unwrapped"));
  });

  test("combines removed params and unwrap in the same summary", () => {
    const result = {
      ok: true,
      cleanUrl: "https://example.com/page",
      removed: ["utm_source"],
      unwrapped: true,
      destinationHost: "example.com",
      affiliatePreserved: false,
      action: "cleaned",
    };
    const view = formatCleanResult(result);
    assert.ok(view.message.includes("1 tracking parameter removed"));
    assert.ok(view.message.includes("redirect wrapper unwrapped"));
  });

  test("reports affiliatePreserved without describing injection", () => {
    const result = {
      ok: true,
      cleanUrl: "https://amazon.es/dp/B0?tag=creator-20",
      removed: ["utm_source"],
      unwrapped: false,
      destinationHost: "amazon.es",
      affiliatePreserved: true,
      action: "cleaned",
    };
    const view = formatCleanResult(result);
    assert.equal(view.affiliatePreserved, true);
    assert.ok(!/inject/i.test(view.message), "message must never mention injecting an affiliate tag");
  });

  test("reports noChanges:true with a clear message on an already-clean URL", () => {
    const result = {
      ok: true,
      cleanUrl: "https://example.com/already-clean?id=42",
      removed: [],
      unwrapped: false,
      destinationHost: "example.com",
      affiliatePreserved: false,
      action: "untouched",
    };
    const view = formatCleanResult(result);
    assert.equal(view.state, "clean");
    assert.equal(view.noChanges, true);
    assert.equal(view.removedCount, 0);
    assert.ok(view.message.length > 0);
  });

  test("defensively handles a non-array removed field", () => {
    const result = {
      ok: true,
      cleanUrl: "https://example.com/",
      removed: undefined,
      unwrapped: false,
      destinationHost: "example.com",
      affiliatePreserved: false,
      action: "untouched",
    };
    const view = formatCleanResult(result);
    assert.deepEqual(view.removedList, []);
    assert.equal(view.removedCount, 0);
  });
});

describe("computeLengthReduction() (sdd/web-cleaning-insight, spec Length-reduction bar)", () => {
  test("reports a positive percent and a length-only headline for a shortened URL", () => {
    const original = "https://example.com/shop/item?id=42&utm_source=newsletter&utm_medium=email&fbclid=abc123xyz";
    const clean = "https://example.com/shop/item?id=42";
    const view = computeLengthReduction(original, clean);
    assert.ok(view.shorterPercent > 0, "shorterPercent must be greater than 0");
    assert.equal(view.label, `This link is ${view.shorterPercent}% shorter`);
    assert.equal(view.isClean, false);
  });

  test("shows the already-clean label and no percent when nothing was removed", () => {
    const url = "https://example.com/already-clean?id=42";
    const view = computeLengthReduction(url, url);
    assert.equal(view.isClean, true);
    assert.equal(view.shorterPercent, 0);
    assert.equal(view.label, "Already clean, nothing to remove");
  });

  test("never renders 0% while a real (if tiny) reduction happened", () => {
    const original = "a".repeat(1000) + "x";
    const clean = "a".repeat(1000);
    const view = computeLengthReduction(original, clean);
    assert.equal(view.removedLen, 1);
    assert.equal(view.isClean, false);
    assert.ok(view.shorterPercent > 0, "shorterPercent must never be 0 when removedLen > 0");
  });
});

describe("copy style constraints (#1029 house rule)", () => {
  test("no view message ever contains an em-dash or a double hyphen", () => {
    const samples = [
      emptyStateView(),
      formatCleanResult(null),
      formatCleanResult({
        ok: true,
        cleanUrl: "https://example.com/",
        removed: ["utm_source", "utm_medium"],
        unwrapped: true,
        destinationHost: "example.com",
        affiliatePreserved: true,
        action: "cleaned",
      }),
    ];
    for (const view of samples) {
      assert.ok(!view.message.includes("—"), `message must not contain an em-dash: ${view.message}`);
      assert.ok(!view.message.includes("--"), `message must not contain "--": ${view.message}`);
    }
  });
});
