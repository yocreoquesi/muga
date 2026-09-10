/**
 * MUGA: the web cleaner prefills and cleans from `?url=` (#1262 item 3)
 *
 * Before this, every use of the web tool died in the tab it happened in: there
 * was no way to hand someone a cleaning to look at, so the one surface that
 * demonstrates the product without an install produced nothing shareable.
 * Reading `?url=` makes the address bar the share link.
 *
 * `web/ui.js` is browser-only and its own header says it is "not unit-testable
 * under node:test", covered instead by a structural source scan. That was true
 * of the file as a whole; it is not true of this behaviour, and a source scan
 * would only prove the string `URLSearchParams` appears somewhere.
 *
 * So this stubs the DOM surface `init()` and `render()` actually touch, which is
 * small and enumerable, and imports the REAL module. Same move
 * dnr-sync.test.mjs makes with `chrome`: stub the platform, test the code.
 * `ui.js` self-boots on import, so setting the globals before the import is
 * what runs the path under test.
 */

import { test, describe, afterEach } from "node:test";
import assert from "node:assert/strict";

/** One element, carrying only what web/ui.js reaches for. */
function el(id) {
  const node = {
    id,
    children: [],
    textContent: "",
    value: "",
    disabled: false,
    hidden: false,
    dataset: {},
    listeners: {},
    classes: new Set(),
    classList: {
      add: (...c) => c.forEach((x) => node.classes.add(x)),
      remove: (...c) => c.forEach((x) => node.classes.delete(x)),
      toggle: (c, on) => (on ? node.classes.add(c) : node.classes.delete(c)),
      contains: (c) => node.classes.has(c),
    },
    addEventListener: (type, fn) => { (node.listeners[type] ||= []).push(fn); },
    appendChild: (child) => { node.children.push(child); return child; },
    removeChild: (child) => { node.children = node.children.filter((c) => c !== child); },
    setAttribute: () => {},
    get firstChild() { return node.children[0] ?? null; },
  };
  return node;
}

/**
 * Installs a document/location pair and returns the element registry.
 * Every id web/ui.js asks for must exist, or init() would bail early and the
 * test would pass by doing nothing.
 */
function installDom(search) {
  const ids = [
    "clean-btn", "url-input", "copy-btn", "result-message", "result-url-row",
    "result-url-box", "transparency", "removed-block", "param-insight",
    "length-bar", "length-bar-headline", "length-bar-kept", "length-bar-removed",
    "unwrap-callout", "destination-line", "report-block", "report-link",
  ];
  const registry = new Map(ids.map((id) => [id, el(id)]));

  globalThis.document = {
    readyState: "complete",
    getElementById: (id) => registry.get(id) ?? null,
    createElement: (tag) => el(`created:${tag}`),
    addEventListener: () => {},
  };
  globalThis.location = { search };
  globalThis.navigator ??= { clipboard: { writeText: async () => {} } };
  return registry;
}

/**
 * Fresh module instance per scenario: ui.js self-boots at import time.
 *
 * The engine reaches MUGA through `window.__mugaCleaner`, which the vendored
 * bundle attaches on import. Loading it here is what makes this a real
 * cleaning rather than an assertion about an error path: without it the
 * adapter returns `engine-unavailable` and every URL "cleans" to itself.
 */
let n = 0;
async function bootUi() {
  globalThis.window = globalThis;
  await import("../../web/engine/cleaner-bundle.js");
  await import(`../../web/ui.js?prefill-test=${n++}`);
}

afterEach(() => {
  delete globalThis.document;
  delete globalThis.location;
});

test("the engine is actually loaded, so a failure below means the UI, not the stub", async () => {
  installDom("");
  globalThis.window = globalThis;
  await import("../../web/engine/cleaner-bundle.js");
  const { cleanUrl } = await import("../../web/engine/adapter.js");
  const r = cleanUrl("https://example.com/p?utm_source=news&id=7");
  assert.equal(r.ok, true, "the vendored engine did not attach; every assertion below would be vacuous");
  assert.equal(r.cleanUrl, "https://example.com/p?id=7");
});

describe("#1262 — the web cleaner prefills and cleans from ?url=", () => {
  test("a ?url= parameter lands in the input and is cleaned on load", async () => {
    const dom = installDom("?url=" + encodeURIComponent("https://example.com/p?utm_source=news&id=7"));
    await bootUi();

    assert.equal(
      dom.get("url-input").value,
      "https://example.com/p?utm_source=news&id=7",
      "the shared URL never reached the input, so nothing was cleaned",
    );
    assert.equal(
      dom.get("result-url-box").textContent,
      "https://example.com/p?id=7",
      "the tool did not clean the prefilled URL: utm_source should be gone and id kept",
    );
    assert.equal(dom.get("copy-btn").disabled, false, "a clean result must be copyable");
  });

  test("no ?url= leaves the empty state, not an error", async () => {
    const dom = installDom("");
    await bootUi();

    assert.equal(dom.get("url-input").value, "", "nothing should be prefilled");
    assert.equal(
      dom.get("result-message").classList.contains("is-error"),
      false,
      "arriving with no query must not look like a failure",
    );
  });

  test("an unusable ?url= leaves a working tool rather than a stack trace", async () => {
    // Someone will paste a broken link into a chat and someone else will click
    // it. Landing on a usable empty tool is the only acceptable outcome.
    const dom = installDom("?url=" + encodeURIComponent("not a url at all"));
    await bootUi();

    assert.equal(dom.get("url-input").value, "not a url at all");
    assert.equal(
      dom.get("copy-btn").disabled,
      true,
      "there is no clean result to copy, so the button must stay disabled",
    );
  });

  test("the landing mirror carries the same behaviour", async () => {
    // landing/clean/ui.js is a byte-parity mirror of web/ui.js: the landing
    // imports it at runtime. A prefill that worked on /clean but not on the
    // landing would be the mirror silently drifting.
    const { readFileSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const { dirname, join } = await import("node:path");
    const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
    assert.equal(
      readFileSync(join(root, "web/ui.js"), "utf8"),
      readFileSync(join(root, "landing/clean/ui.js"), "utf8"),
      "web/ui.js and landing/clean/ui.js diverged; the landing would not prefill",
    );
  });
});
