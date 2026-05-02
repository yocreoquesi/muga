/**
 * MUGA — Tests for the DOM Link Rewriter (#443 / B8).
 *
 * The rewriter watches `<a href>` mutations and runs URL cleaning on
 * each. Two correctness invariants drive these tests:
 *
 *   1. IDEMPOTENCY. If the cleaned href equals the current href the
 *      rewriter MUST NOT call setAttribute. Calling setAttribute on a
 *      MutationObserver target retriggers the observer; without the
 *      no-op guard the observer feedback-loops and burns CPU forever.
 *   2. NON-HTTP HREFS UNTOUCHED. mailto:, tel:, javascript:, data:,
 *      and any URL the cleaner can't parse must pass through with NO
 *      DOM write. The cleaner is allowed to throw on those — the
 *      rewriter swallows.
 *
 * Like history-defuser.test.mjs, this test file uses the PURE FACTORY
 * shape (`createLinkRewriter`) with stubbed anchors. No jsdom: project
 * rule is no third-party test libs. Stub anchors expose `getAttribute`
 * and `setAttribute` only — the surface the rewriter actually touches.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
import { createLinkRewriter } from "../../src/lib/dom-link-rewriter.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Builds a stub `<a>`-like node. Records every `setAttribute` call for
 * assertions. `tagName` defaults to "A" so the rewriter's tag-guard
 * accepts it; tests that need a non-anchor pass `tagName: "DIV"`.
 */
function makeAnchor(href, { tagName = "A" } = {}) {
  let current = href;
  const setCalls = [];
  return {
    tagName,
    nodeType: 1,
    getAttribute(name) {
      if (name === "href") return current;
      return null;
    },
    setAttribute(name, value) {
      setCalls.push({ name, value });
      if (name === "href") current = value;
    },
    get __href() { return current; },
    get __setCalls() { return setCalls; },
    // Used by rewriteAll(NodeList-like): the rewriter iterates with
    // for-of, so we don't need anything fancier here.
  };
}

/**
 * Tracking-stripping cleaner — strips utm_source, utm_medium, fbclid.
 * Mirrors trackingCleaner from history-defuser.test.mjs. Throws on a
 * non-string sentinel so we can verify the rewriter swallows.
 */
function trackingCleaner(rawUrl) {
  if (typeof rawUrl !== "string" || rawUrl.length === 0) return rawUrl;
  if (rawUrl === "__BOOM__") throw new Error("boom");
  const STRIP = new Set(["utm_source", "utm_medium", "fbclid"]);
  let u;
  try {
    u = new URL(rawUrl);
  } catch {
    try {
      u = new URL(rawUrl, "https://example.invalid/");
      for (const k of [...u.searchParams.keys()]) {
        if (STRIP.has(k)) u.searchParams.delete(k);
      }
      return u.pathname + u.search + u.hash;
    } catch {
      return rawUrl;
    }
  }
  for (const k of [...u.searchParams.keys()]) {
    if (STRIP.has(k)) u.searchParams.delete(k);
  }
  return u.toString();
}

/**
 * isCleanLink reports whether the href is in scope for cleaning. The
 * production wiring will pass a check that excludes mailto:, tel:,
 * javascript:, data:, blob:, and href values without a "?". Tests
 * mirror that subset.
 */
function defaultIsCleanLink(href) {
  if (typeof href !== "string" || href.length === 0) return false;
  if (/^(mailto|tel|javascript|data|blob):/i.test(href)) return false;
  return true;
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe("createLinkRewriter — rewriteLink", () => {
  test("dirty href triggers setAttribute with cleaned URL", () => {
    const rw = createLinkRewriter({
      urlCleaner: trackingCleaner,
      isCleanLink: defaultIsCleanLink,
    });
    const a = makeAnchor("https://example.com/p?utm_source=x&id=42");
    rw.rewriteLink(a);
    assert.equal(a.__setCalls.length, 1);
    assert.equal(a.__setCalls[0].name, "href");
    assert.equal(a.__setCalls[0].value, "https://example.com/p?id=42");
  });

  test("already-clean href does NOT trigger setAttribute (idempotency)", () => {
    const rw = createLinkRewriter({
      urlCleaner: trackingCleaner,
      isCleanLink: defaultIsCleanLink,
    });
    const a = makeAnchor("https://example.com/p?id=42");
    rw.rewriteLink(a);
    assert.equal(a.__setCalls.length, 0,
      "rewriter must not write when cleaned === current; the observer would loop");
  });

  test("re-running rewriteLink after a clean is still a no-op", () => {
    const rw = createLinkRewriter({
      urlCleaner: trackingCleaner,
      isCleanLink: defaultIsCleanLink,
    });
    const a = makeAnchor("https://example.com/p?utm_source=x");
    rw.rewriteLink(a);
    assert.equal(a.__setCalls.length, 1);
    rw.rewriteLink(a);
    rw.rewriteLink(a);
    assert.equal(a.__setCalls.length, 1,
      "second/third pass on the now-clean href must NOT call setAttribute");
  });

  test("mailto: href is ignored", () => {
    const rw = createLinkRewriter({
      urlCleaner: trackingCleaner,
      isCleanLink: defaultIsCleanLink,
    });
    const a = makeAnchor("mailto:nobody@example.com?utm_source=x");
    rw.rewriteLink(a);
    assert.equal(a.__setCalls.length, 0);
  });

  test("tel: href is ignored", () => {
    const rw = createLinkRewriter({
      urlCleaner: trackingCleaner,
      isCleanLink: defaultIsCleanLink,
    });
    const a = makeAnchor("tel:+15551234?utm_source=x");
    rw.rewriteLink(a);
    assert.equal(a.__setCalls.length, 0);
  });

  test("javascript: href is ignored", () => {
    const rw = createLinkRewriter({
      urlCleaner: trackingCleaner,
      isCleanLink: defaultIsCleanLink,
    });
    const a = makeAnchor("javascript:void(0)");
    rw.rewriteLink(a);
    assert.equal(a.__setCalls.length, 0);
  });

  test("missing/empty href is ignored without throwing", () => {
    const rw = createLinkRewriter({
      urlCleaner: trackingCleaner,
      isCleanLink: defaultIsCleanLink,
    });
    const a = makeAnchor(null);
    assert.doesNotThrow(() => rw.rewriteLink(a));
    assert.equal(a.__setCalls.length, 0);
    const b = makeAnchor("");
    assert.doesNotThrow(() => rw.rewriteLink(b));
    assert.equal(b.__setCalls.length, 0);
  });

  test("non-anchor element is ignored", () => {
    const rw = createLinkRewriter({
      urlCleaner: trackingCleaner,
      isCleanLink: defaultIsCleanLink,
    });
    const div = makeAnchor("https://example.com/p?utm_source=x", { tagName: "DIV" });
    rw.rewriteLink(div);
    assert.equal(div.__setCalls.length, 0,
      "non-A elements must not be rewritten even if they have an href attribute");
  });

  test("cleaner that throws — swallow and skip setAttribute", () => {
    const rw = createLinkRewriter({
      urlCleaner: trackingCleaner,
      isCleanLink: defaultIsCleanLink,
    });
    const a = makeAnchor("__BOOM__");
    // isCleanLink rejects this since it has no scheme — but if it
    // somehow reaches the cleaner the throw must not propagate.
    assert.doesNotThrow(() => rw.rewriteLink(a));
    assert.equal(a.__setCalls.length, 0);
  });

  test("cleaner returns null/undefined/non-string → no setAttribute", () => {
    const rw = createLinkRewriter({
      urlCleaner: () => null,
      isCleanLink: defaultIsCleanLink,
    });
    const a = makeAnchor("https://example.com/p?utm_source=x");
    rw.rewriteLink(a);
    assert.equal(a.__setCalls.length, 0,
      "if the cleaner can't produce a string, leave the DOM alone");

    const rw2 = createLinkRewriter({
      urlCleaner: () => undefined,
      isCleanLink: defaultIsCleanLink,
    });
    const b = makeAnchor("https://example.com/p?utm_source=x");
    rw2.rewriteLink(b);
    assert.equal(b.__setCalls.length, 0);

    const rw3 = createLinkRewriter({
      urlCleaner: () => 42,
      isCleanLink: defaultIsCleanLink,
    });
    const c = makeAnchor("https://example.com/p?utm_source=x");
    rw3.rewriteLink(c);
    assert.equal(c.__setCalls.length, 0);
  });

  test("cleaner returning empty string is treated as no-op", () => {
    const rw = createLinkRewriter({
      urlCleaner: () => "",
      isCleanLink: defaultIsCleanLink,
    });
    const a = makeAnchor("https://example.com/p?utm_source=x");
    rw.rewriteLink(a);
    assert.equal(a.__setCalls.length, 0,
      "empty string is a degenerate cleaner result — must not destroy the link");
  });
});

describe("createLinkRewriter — rewriteAll", () => {
  test("mixed list: only dirty anchors get setAttribute", () => {
    const rw = createLinkRewriter({
      urlCleaner: trackingCleaner,
      isCleanLink: defaultIsCleanLink,
    });
    const dirty = makeAnchor("https://example.com/a?utm_source=x");
    const clean = makeAnchor("https://example.com/b?id=1");
    const mailto = makeAnchor("mailto:x@y.invalid?utm_source=x");
    rw.rewriteAll([dirty, clean, mailto]);
    assert.equal(dirty.__setCalls.length, 1);
    assert.equal(clean.__setCalls.length, 0);
    assert.equal(mailto.__setCalls.length, 0);
  });

  test("accepts NodeList-like (length + indexed access)", () => {
    const rw = createLinkRewriter({
      urlCleaner: trackingCleaner,
      isCleanLink: defaultIsCleanLink,
    });
    const a = makeAnchor("https://example.com/?utm_source=x");
    const b = makeAnchor("https://example.com/?utm_medium=y");
    const nodeListLike = {
      length: 2,
      0: a,
      1: b,
      [Symbol.iterator]: function* () { yield a; yield b; },
    };
    rw.rewriteAll(nodeListLike);
    assert.equal(a.__setCalls.length, 1);
    assert.equal(b.__setCalls.length, 1);
  });

  test("empty/null iterable does not throw", () => {
    const rw = createLinkRewriter({
      urlCleaner: trackingCleaner,
      isCleanLink: defaultIsCleanLink,
    });
    assert.doesNotThrow(() => rw.rewriteAll([]));
    assert.doesNotThrow(() => rw.rewriteAll(null));
    assert.doesNotThrow(() => rw.rewriteAll(undefined));
  });
});

describe("createLinkRewriter — onMutation", () => {
  test("childList record with addedNodes: rewrites newly-inserted anchors", () => {
    const rw = createLinkRewriter({
      urlCleaner: trackingCleaner,
      isCleanLink: defaultIsCleanLink,
    });
    const inserted = makeAnchor("https://example.com/?utm_source=new");
    const records = [{
      type: "childList",
      addedNodes: [inserted],
      target: { nodeType: 1, tagName: "DIV" },
    }];
    rw.onMutation(records);
    assert.equal(inserted.__setCalls.length, 1);
    assert.equal(inserted.__setCalls[0].value, "https://example.com/");
  });

  test("childList record: descendant anchors inside an inserted subtree are rewritten", () => {
    const rw = createLinkRewriter({
      urlCleaner: trackingCleaner,
      isCleanLink: defaultIsCleanLink,
    });
    const descendant = makeAnchor("https://example.com/d?utm_source=x");
    // Inserted subtree root is a DIV that "contains" one anchor. The
    // factory must descend via querySelectorAll('a[href]') when the
    // node provides it. Test stub provides that hook.
    const subtreeRoot = {
      tagName: "DIV",
      nodeType: 1,
      querySelectorAll(sel) {
        assert.equal(sel, "a[href]");
        return [descendant];
      },
    };
    const records = [{
      type: "childList",
      addedNodes: [subtreeRoot],
      target: { nodeType: 1, tagName: "BODY" },
    }];
    rw.onMutation(records);
    assert.equal(descendant.__setCalls.length, 1);
  });

  test("attributes record on href: rewrites the affected anchor", () => {
    const rw = createLinkRewriter({
      urlCleaner: trackingCleaner,
      isCleanLink: defaultIsCleanLink,
    });
    const a = makeAnchor("https://example.com/p?utm_source=x");
    const records = [{
      type: "attributes",
      attributeName: "href",
      target: a,
      addedNodes: [],
    }];
    rw.onMutation(records);
    assert.equal(a.__setCalls.length, 1);
  });

  test("attributes record on a non-href attribute is ignored", () => {
    const rw = createLinkRewriter({
      urlCleaner: trackingCleaner,
      isCleanLink: defaultIsCleanLink,
    });
    const a = makeAnchor("https://example.com/p?utm_source=x");
    const records = [{
      type: "attributes",
      attributeName: "data-foo",
      target: a,
      addedNodes: [],
    }];
    rw.onMutation(records);
    assert.equal(a.__setCalls.length, 0,
      "filter is attributeName !== 'href' — non-href changes must not trigger work");
  });

  test("addedNodes containing a non-element (e.g. text node) is skipped without throwing", () => {
    const rw = createLinkRewriter({
      urlCleaner: trackingCleaner,
      isCleanLink: defaultIsCleanLink,
    });
    const textNode = { nodeType: 3 /* TEXT_NODE */, tagName: undefined };
    const records = [{
      type: "childList",
      addedNodes: [textNode],
      target: { nodeType: 1, tagName: "DIV" },
    }];
    assert.doesNotThrow(() => rw.onMutation(records));
  });

  test("empty/null mutationList does not throw", () => {
    const rw = createLinkRewriter({
      urlCleaner: trackingCleaner,
      isCleanLink: defaultIsCleanLink,
    });
    assert.doesNotThrow(() => rw.onMutation([]));
    assert.doesNotThrow(() => rw.onMutation(null));
    assert.doesNotThrow(() => rw.onMutation(undefined));
  });

  test("mutation triggered by our own setAttribute — naturally idempotent", () => {
    // When the observer sees the OUR write, it re-fires. The cleaner
    // returns the SAME clean URL on the second pass, so no setAttribute
    // is issued and the loop terminates. This is the load-bearing
    // safety property for B8.
    const rw = createLinkRewriter({
      urlCleaner: trackingCleaner,
      isCleanLink: defaultIsCleanLink,
    });
    const a = makeAnchor("https://example.com/?utm_source=x");
    rw.rewriteLink(a);
    assert.equal(a.__setCalls.length, 1);
    // Simulate the observer firing again with our self-induced mutation.
    const records = [{
      type: "attributes",
      attributeName: "href",
      target: a,
      addedNodes: [],
    }];
    rw.onMutation(records);
    rw.onMutation(records);
    assert.equal(a.__setCalls.length, 1,
      "self-induced mutations must converge — second pass must NOT setAttribute");
  });
});

// ── Manifest + content-script wiring (structural) ──────────────────────────

describe("dom-link-rewriter — content-script wiring", () => {
  test("manifest.json registers content/dom-link-rewriter.js at document_start in the isolated world", () => {
    const manifest = JSON.parse(readFileSync(
      join(__dirname, "../../src/manifest.json"), "utf8"
    ));
    const entry = manifest.content_scripts.find((e) =>
      Array.isArray(e.js) && e.js.some((p) => p.endsWith("dom-link-rewriter.js"))
    );
    assert.ok(entry, "dom-link-rewriter.js must be in a content_scripts entry");
    assert.equal(entry.run_at, "document_start");
    // Must NOT be world: MAIN — DOM is shared, the rewrite runs in the
    // isolated world so it can read prefs (via the gate event) without
    // a cross-world flag dance.
    assert.notEqual(entry.world, "MAIN",
      "dom-link-rewriter must run in the isolated world");
  });

  test("manifest.v2.json registers dom-link-rewriter.js at document_start", () => {
    const manifest = JSON.parse(readFileSync(
      join(__dirname, "../../src/manifest.v2.json"), "utf8"
    ));
    const entry = manifest.content_scripts.find((e) =>
      Array.isArray(e.js) && e.js.some((p) => p.endsWith("dom-link-rewriter.js"))
    );
    assert.ok(entry, "dom-link-rewriter.js must be registered for MV2");
    assert.equal(entry.run_at, "document_start");
  });

  test("content/dom-link-rewriter.js is an IIFE with no ES module imports", () => {
    const src = readFileSync(
      join(__dirname, "../../src/content/dom-link-rewriter.js"), "utf8"
    );
    assert.ok(/^\(function/m.test(src), "content script must be an IIFE");
    assert.equal(/^\s*import\s+/m.test(src), false,
      "content script must not contain top-level ES module imports");
    // Must listen for the cross-world gate event published by
    // history-defuser.js — same gate, no second message round-trip.
    assert.ok(/muga:history-gate/.test(src),
      "rewriter must listen for muga:history-gate to honor disabled state");
    // Must install a MutationObserver.
    assert.ok(/MutationObserver/.test(src),
      "rewriter must install a MutationObserver");
    // attributeFilter is the load-bearing perf optimization — without
    // it every attribute mutation pages through the JS callback.
    assert.ok(/attributeFilter/.test(src),
      "MutationObserver must use attributeFilter: ['href']");
  });
});
