/**
 * MUGA — Tests for the DOM Link Rewriter Click interceptor (#450 / B9).
 *
 * B8 (#443) installs a MutationObserver that rewrites tracking-decorated
 * `<a href>` values as the DOM mutates. That covers SPA re-renders and
 * static page anchors — but NOT the last-millisecond reinjection trick
 * Twitter / Facebook / LinkedIn use: a `mousedown` listener that re-
 * decorates `event.target.href` AFTER MUGA has already cleaned it. By
 * the time the click fires, the user navigates to the dirty URL.
 *
 * B9 closes that gap with a CAPTURE-PHASE listener on `mousedown` AND
 * `click` at the document level. Capture phase runs BEFORE the page's
 * own bubble-phase listeners — but more importantly, BEFORE the browser
 * starts the navigation. We re-run the cleaner on the anchor's href in
 * place via the B8 rewriter (idempotent on already-clean URLs).
 *
 * CRITICAL CONTRACT — never call preventDefault, stopPropagation, or
 * stopImmediatePropagation. The rewriter is a passive observer of the
 * click; the user's navigation MUST proceed to the cleaned destination.
 *
 * Like the B8 unit tests, this file uses the PURE FACTORY shape with
 * stubbed events + stubbed rewriter. The thin content-script bootstrap
 * is exercised structurally (manifest + IIFE shape + gate listener).
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
import { createClickRewriter } from "../../src/lib/dom-link-rewriter-click.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Builds a stub rewriter that records each `rewriteLink` call. Mirrors
 * the surface of `createLinkRewriter().rewriteLink` from B8 — the only
 * method B9 consumes.
 */
function makeStubRewriter() {
  const calls = [];
  return {
    rewriteLink(anchor) { calls.push(anchor); },
    get __calls() { return calls; },
  };
}

/**
 * Builds a stub event with target + flags that record any improper
 * preventDefault/stopPropagation invocation. The B9 contract is that
 * NONE of these are ever called — clicks must navigate to the cleaned
 * URL exactly as the user intended.
 */
function makeEvent(target, type = "click") {
  const flags = { prevented: false, stopped: false, stoppedImmediate: false };
  return {
    type,
    target,
    preventDefault() { flags.prevented = true; },
    stopPropagation() { flags.stopped = true; },
    stopImmediatePropagation() { flags.stoppedImmediate = true; },
    get __flags() { return flags; },
  };
}

/**
 * Builds a stub anchor that supports `closest('a[href]')` returning
 * itself, mirroring how a real `<a href>` element behaves when an
 * inner `<span>`/`<img>` was the actual click target.
 */
function makeAnchor(href = "https://example.com/?utm_source=x") {
  const a = {
    tagName: "A",
    nodeType: 1,
    __href: href,
    closest(selector) {
      if (selector === "a[href]") return a;
      return null;
    },
  };
  return a;
}

/**
 * Builds a stub inner element (e.g. <span> inside <a>) that resolves
 * `closest('a[href]')` to the supplied parent anchor.
 */
function makeInnerEl(parentAnchor) {
  return {
    tagName: "SPAN",
    nodeType: 1,
    closest(selector) {
      if (selector === "a[href]" && parentAnchor) return parentAnchor;
      return null;
    },
  };
}

/**
 * Builds a stub DOM target that records addEventListener / removeEventListener
 * calls so install/uninstall semantics can be asserted.
 */
function makeListenerTarget() {
  const adds = [];
  const removes = [];
  return {
    addEventListener(type, fn, opts) { adds.push({ type, fn, opts }); },
    removeEventListener(type, fn, opts) { removes.push({ type, fn, opts }); },
    get __adds() { return adds; },
    get __removes() { return removes; },
  };
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe("createClickRewriter — onMousedown / onClick dispatch", () => {
  test("mousedown on element inside anchor → rewriter.rewriteLink called with the anchor", () => {
    const rewriter = makeStubRewriter();
    const cr = createClickRewriter({ rewriter });
    const anchor = makeAnchor();
    const inner = makeInnerEl(anchor);
    const evt = makeEvent(inner, "mousedown");

    cr.onMousedown(evt);

    assert.equal(rewriter.__calls.length, 1);
    assert.strictEqual(rewriter.__calls[0], anchor,
      "must pass the resolved anchor (closest('a[href]')), not the click target");
  });

  test("click on element inside anchor → rewriter.rewriteLink called with the anchor", () => {
    const rewriter = makeStubRewriter();
    const cr = createClickRewriter({ rewriter });
    const anchor = makeAnchor();
    const inner = makeInnerEl(anchor);
    const evt = makeEvent(inner, "click");

    cr.onClick(evt);

    assert.equal(rewriter.__calls.length, 1);
    assert.strictEqual(rewriter.__calls[0], anchor);
  });

  test("mousedown directly on anchor target → rewriter called with the anchor itself", () => {
    const rewriter = makeStubRewriter();
    const cr = createClickRewriter({ rewriter });
    const anchor = makeAnchor();
    const evt = makeEvent(anchor, "mousedown");

    cr.onMousedown(evt);

    assert.equal(rewriter.__calls.length, 1);
    assert.strictEqual(rewriter.__calls[0], anchor);
  });

  test("mousedown on element NOT inside an anchor → rewriter NOT called", () => {
    const rewriter = makeStubRewriter();
    const cr = createClickRewriter({ rewriter });
    // closest returns null — click happened outside any <a href>.
    const standalone = {
      tagName: "DIV",
      nodeType: 1,
      closest() { return null; },
    };
    const evt = makeEvent(standalone, "mousedown");

    cr.onMousedown(evt);

    assert.equal(rewriter.__calls.length, 0);
  });

  test("click on element NOT inside an anchor → rewriter NOT called", () => {
    const rewriter = makeStubRewriter();
    const cr = createClickRewriter({ rewriter });
    const standalone = {
      tagName: "BUTTON",
      nodeType: 1,
      closest() { return null; },
    };
    const evt = makeEvent(standalone, "click");

    cr.onClick(evt);

    assert.equal(rewriter.__calls.length, 0);
  });

  test("event with null target → no-op, no throw", () => {
    const rewriter = makeStubRewriter();
    const cr = createClickRewriter({ rewriter });
    const evt = { type: "click", target: null };

    assert.doesNotThrow(() => cr.onClick(evt));
    assert.equal(rewriter.__calls.length, 0);
  });

  test("event without target.closest → no-op, no throw (defensive)", () => {
    // Some synthetic events / shadow DOM hosts won't expose `closest`.
    // The rewriter must skip silently rather than blow up the page's
    // click pipeline.
    const rewriter = makeStubRewriter();
    const cr = createClickRewriter({ rewriter });
    const evt = { type: "click", target: { tagName: "DIV", nodeType: 1 } };

    assert.doesNotThrow(() => cr.onClick(evt));
    assert.equal(rewriter.__calls.length, 0);
  });

  test("listeners do NOT call preventDefault / stopPropagation / stopImmediatePropagation", () => {
    // THE LOAD-BEARING CONTRACT. If the rewriter ever calls any of these
    // it breaks the user's click → navigation flow. The whole point of
    // capture-phase rewriting is to be PASSIVE: tweak the href, let the
    // browser navigate.
    const rewriter = makeStubRewriter();
    const cr = createClickRewriter({ rewriter });
    const anchor = makeAnchor();
    const inner = makeInnerEl(anchor);

    const md = makeEvent(inner, "mousedown");
    cr.onMousedown(md);
    assert.equal(md.__flags.prevented, false);
    assert.equal(md.__flags.stopped, false);
    assert.equal(md.__flags.stoppedImmediate, false);

    const ck = makeEvent(inner, "click");
    cr.onClick(ck);
    assert.equal(ck.__flags.prevented, false);
    assert.equal(ck.__flags.stopped, false);
    assert.equal(ck.__flags.stoppedImmediate, false);
  });

  test("rewriter that throws → swallowed, no error escapes the click handler", () => {
    // A throw bubbling out of a capture-phase listener would not be
    // fatal to navigation, but it would spam the console on every click
    // and could be picked up by page-level error reporters as if it
    // were the page's own bug. Match B8: swallow.
    const explodingRewriter = {
      rewriteLink() { throw new Error("boom"); },
    };
    const cr = createClickRewriter({ rewriter: explodingRewriter });
    const anchor = makeAnchor();
    const inner = makeInnerEl(anchor);
    const evt = makeEvent(inner, "click");

    assert.doesNotThrow(() => cr.onClick(evt));
    // Still must NOT have called preventDefault — exception or not.
    assert.equal(evt.__flags.prevented, false);
  });

  test("rapid double dispatch — rewriteLink called twice (no debounce, idempotent)", () => {
    // If a site re-decorates on mousedown each time, BOTH events fire
    // and BOTH should rewrite. The B8 rewriter is idempotent on already-
    // clean URLs, so calling rewriteLink twice is safe and correct.
    const rewriter = makeStubRewriter();
    const cr = createClickRewriter({ rewriter });
    const anchor = makeAnchor();
    const inner = makeInnerEl(anchor);

    cr.onMousedown(makeEvent(inner, "mousedown"));
    cr.onClick(makeEvent(inner, "click"));

    assert.equal(rewriter.__calls.length, 2,
      "no debouncing — each event runs the cleaner; idempotency keeps it safe");
  });

  test("custom getAnchorFromEvent override is honored (testability hook)", () => {
    // The default closes over event.target.closest('a[href]'); for
    // testing or for future shadow-DOM support, the resolver is
    // injectable. Wiring this through the factory keeps the production
    // code simple AND keeps the seam.
    const rewriter = makeStubRewriter();
    const sentinelAnchor = makeAnchor("https://example.com/sentinel");
    const cr = createClickRewriter({
      rewriter,
      getAnchorFromEvent: () => sentinelAnchor,
    });
    const evt = makeEvent({ tagName: "X" }, "click");

    cr.onClick(evt);

    assert.equal(rewriter.__calls.length, 1);
    assert.strictEqual(rewriter.__calls[0], sentinelAnchor);
  });
});

describe("createClickRewriter — install / uninstall", () => {
  test("install attaches mousedown + click listeners with capture: true", () => {
    const rewriter = makeStubRewriter();
    const cr = createClickRewriter({ rewriter });
    const target = makeListenerTarget();

    cr.install(target);

    assert.equal(target.__adds.length, 2);
    const types = target.__adds.map((a) => a.type).sort();
    assert.deepEqual(types, ["click", "mousedown"]);
    // CAPTURE PHASE is the load-bearing detail. Capture runs BEFORE the
    // page's own bubble listeners and BEFORE navigation; bubble runs
    // after the page's listener has already re-decorated and after the
    // browser has started navigating.
    for (const a of target.__adds) {
      assert.ok(
        a.opts === true || (a.opts && a.opts.capture === true),
        `${a.type} listener must use capture phase`
      );
    }
  });

  test("uninstall removes the same listeners that install attached", () => {
    const rewriter = makeStubRewriter();
    const cr = createClickRewriter({ rewriter });
    const target = makeListenerTarget();

    cr.install(target);
    cr.uninstall(target);

    assert.equal(target.__removes.length, 2);
    // Same fn refs as add (otherwise removeEventListener is a no-op).
    const addedFns = new Set(target.__adds.map((a) => a.fn));
    for (const r of target.__removes) {
      assert.ok(addedFns.has(r.fn),
        `removeEventListener fn ref must match the addEventListener ref for ${r.type}`);
    }
  });

  test("install is idempotent — calling twice does not double-attach", () => {
    // A second install with the same target would attach a duplicate
    // listener and fire rewriteLink twice for every event. Either we
    // dedupe internally or uninstall-before-install. Match B8's gate
    // pattern: the inner observer is only created once.
    const rewriter = makeStubRewriter();
    const cr = createClickRewriter({ rewriter });
    const target = makeListenerTarget();

    cr.install(target);
    cr.install(target);

    assert.equal(target.__adds.length, 2,
      "second install must NOT attach a second pair of listeners");
  });

  test("uninstall without prior install is a no-op (does not throw)", () => {
    const rewriter = makeStubRewriter();
    const cr = createClickRewriter({ rewriter });
    const target = makeListenerTarget();

    assert.doesNotThrow(() => cr.uninstall(target));
    assert.equal(target.__removes.length, 0);
  });

  test("installed listeners route mousedown / click through the rewriter", () => {
    // End-to-end seam: install attaches the listeners, dispatching
    // through the captured fn refs reaches the rewriter.
    const rewriter = makeStubRewriter();
    const cr = createClickRewriter({ rewriter });
    const target = makeListenerTarget();
    cr.install(target);

    const mdEntry = target.__adds.find((a) => a.type === "mousedown");
    const ckEntry = target.__adds.find((a) => a.type === "click");

    const anchor = makeAnchor();
    const inner = makeInnerEl(anchor);
    mdEntry.fn(makeEvent(inner, "mousedown"));
    ckEntry.fn(makeEvent(inner, "click"));

    assert.equal(rewriter.__calls.length, 2);
  });
});

describe("createClickRewriter — input validation", () => {
  test("missing rewriter throws TypeError", () => {
    assert.throws(() => createClickRewriter({}), TypeError);
    assert.throws(() => createClickRewriter(), TypeError);
  });

  test("rewriter without rewriteLink throws TypeError", () => {
    assert.throws(
      () => createClickRewriter({ rewriter: { foo: 1 } }),
      TypeError
    );
  });
});

// ── Manifest + content-script wiring (structural) ──────────────────────────

describe("dom-link-rewriter-click — content-script wiring", () => {
  test("manifest.json registers content/dom-link-rewriter-click.js at document_start in isolated world", () => {
    const manifest = JSON.parse(readFileSync(
      join(__dirname, "../../src/manifest.json"), "utf8"
    ));
    const entry = manifest.content_scripts.find((e) =>
      Array.isArray(e.js) && e.js.some((p) => p.endsWith("dom-link-rewriter-click.js"))
    );
    assert.ok(entry, "dom-link-rewriter-click.js must be in a content_scripts entry");
    assert.equal(entry.run_at, "document_start");
    assert.notEqual(entry.world, "MAIN",
      "click rewriter must run in the isolated world (shares DOM, reads gate)");
  });

  test("manifest.v2.json registers dom-link-rewriter-click.js at document_start", () => {
    const manifest = JSON.parse(readFileSync(
      join(__dirname, "../../src/manifest.v2.json"), "utf8"
    ));
    const entry = manifest.content_scripts.find((e) =>
      Array.isArray(e.js) && e.js.some((p) => p.endsWith("dom-link-rewriter-click.js"))
    );
    assert.ok(entry, "dom-link-rewriter-click.js must be registered for MV2");
    assert.equal(entry.run_at, "document_start");
  });

  test("content/dom-link-rewriter-click.js is an IIFE listening for the gate event", () => {
    const src = readFileSync(
      join(__dirname, "../../src/content/dom-link-rewriter-click.js"), "utf8"
    );
    assert.ok(/^\(function/m.test(src), "content script must be an IIFE");
    assert.equal(/^\s*import\s+/m.test(src), false,
      "content script must not contain top-level ES module imports");
    assert.ok(/muga:history-gate/.test(src),
      "rewriter must listen for muga:history-gate to honor disabled state");
    // Capture phase is non-negotiable — bubble phase is too late.
    assert.ok(/capture\s*:\s*true|true\s*\)/.test(src),
      "listeners must be installed with capture: true");
    // Listens to BOTH mousedown and click — mousedown catches reinjection
    // between hover and click; click catches reinjection at click time.
    assert.ok(/mousedown/.test(src), "must listen for mousedown");
    assert.ok(/['"]click['"]/.test(src), "must listen for click");
    // MUST NOT call preventDefault/stopPropagation/stopImmediatePropagation.
    assert.equal(/preventDefault\s*\(/.test(src), false,
      "click rewriter must NEVER call preventDefault");
    assert.equal(/stopPropagation\s*\(/.test(src), false,
      "click rewriter must NEVER call stopPropagation");
    assert.equal(/stopImmediatePropagation\s*\(/.test(src), false,
      "click rewriter must NEVER call stopImmediatePropagation");
  });
});
