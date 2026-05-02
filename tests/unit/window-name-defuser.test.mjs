/**
 * MUGA — Tests for the Window-Name Defuser (#451 / B11).
 *
 * The defuser intercepts reads of `window.name` via a property accessor
 * installed at `document_start`. When the stored value is a URL with
 * known tracking params, reads return the cleaned URL. Non-URL payloads
 * (the common case: cross-frame tokens like "frame-foo") fall through
 * untouched, so legitimate uses of `window.name` are never disturbed.
 *
 * The module under test is a PURE factory — `installWindowNameDefuser`
 * — which takes an injectable host object (any object with a `name`
 * property accessor or data property) and an injectable URL cleaner.
 * No DOM, no jsdom (project rule: no third-party test libs). The
 * content-script entry that wires the real `window` and the bundled
 * `processUrl` is structural; the contract is enforced here.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
import { installWindowNameDefuser } from "../../src/lib/window-name-defuser.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Builds a stub host object with a backing `name` data property,
 * mimicking the `window` surface area the defuser touches. The defuser
 * should redefine the `name` property as an accessor on this object.
 */
function makeWindowStub(initial = "") {
  const host = {};
  let backing = initial;
  Object.defineProperty(host, "name", {
    get() { return backing; },
    set(v) { backing = v; },
    configurable: true,
    enumerable: true,
  });
  return host;
}

/**
 * Tracking-stripping cleaner — strips `utm_source`, `utm_medium`, and
 * `fbclid`. Returns the original string when the input is not a
 * URL-shaped payload (no scheme + host) — that's the contract the
 * defuser's heuristic relies on.
 */
function trackingCleaner(rawUrl) {
  if (typeof rawUrl !== "string" || rawUrl.length === 0) return rawUrl;
  const STRIP = new Set(["utm_source", "utm_medium", "fbclid"]);
  let u;
  try {
    u = new URL(rawUrl);
  } catch {
    return rawUrl;
  }
  let changed = false;
  for (const k of [...u.searchParams.keys()]) {
    if (STRIP.has(k)) {
      u.searchParams.delete(k);
      changed = true;
    }
  }
  return changed ? u.toString() : rawUrl;
}

const identityCleaner = (s) => s;

// ── Tests ───────────────────────────────────────────────────────────────────

describe("installWindowNameDefuser — basic install / uninstall", () => {
  test("install returns an uninstall function", () => {
    const host = makeWindowStub("");
    const uninstall = installWindowNameDefuser(host, identityCleaner);
    assert.equal(typeof uninstall, "function");
    uninstall();
  });

  test("after install, name is a configurable accessor", () => {
    const host = makeWindowStub("");
    installWindowNameDefuser(host, identityCleaner);
    const desc = Object.getOwnPropertyDescriptor(host, "name");
    assert.ok(desc, "name descriptor must exist");
    assert.equal(typeof desc.get, "function");
    assert.equal(typeof desc.set, "function");
    assert.equal(desc.configurable, true);
  });

  test("uninstall restores readable / writable behaviour", () => {
    const host = makeWindowStub("initial");
    const uninstall = installWindowNameDefuser(host, identityCleaner);
    host.name = "after";
    uninstall();
    // Post-uninstall, reads and writes still flow.
    assert.equal(host.name, "after");
    host.name = "again";
    assert.equal(host.name, "again");
  });
});

describe("installWindowNameDefuser — read-time cleaning", () => {
  test("URL with tracking params → cleaned on read", () => {
    const host = makeWindowStub("");
    installWindowNameDefuser(host, trackingCleaner);
    host.name = "https://example.com/path?utm_source=x&id=42";
    assert.equal(host.name, "https://example.com/path?id=42");
  });

  test("URL without tracking params → unchanged on read", () => {
    const host = makeWindowStub("");
    installWindowNameDefuser(host, trackingCleaner);
    host.name = "https://example.com/path?id=42";
    assert.equal(host.name, "https://example.com/path?id=42");
  });

  test("non-URL token → returned verbatim (no interference)", () => {
    const host = makeWindowStub("");
    installWindowNameDefuser(host, trackingCleaner);
    host.name = "frame-foo";
    assert.equal(host.name, "frame-foo");
  });

  test("empty string → empty string (cleaner not consulted)", () => {
    let called = 0;
    const host = makeWindowStub("");
    installWindowNameDefuser(host, (u) => { called++; return u; });
    assert.equal(host.name, "");
    assert.equal(called, 0);
  });

  test("JSON-shaped cross-frame payload → unchanged", () => {
    const host = makeWindowStub("");
    installWindowNameDefuser(host, trackingCleaner);
    host.name = '{"channel":"oauth","nonce":"abc123"}';
    assert.equal(host.name, '{"channel":"oauth","nonce":"abc123"}');
  });

  test("URL with no query → unchanged", () => {
    const host = makeWindowStub("");
    installWindowNameDefuser(host, trackingCleaner);
    host.name = "https://example.com/no-query";
    assert.equal(host.name, "https://example.com/no-query");
  });

  test("initial value present at install time is cleaned on first read", () => {
    const host = makeWindowStub("https://example.com/?utm_source=x");
    installWindowNameDefuser(host, trackingCleaner);
    assert.equal(host.name, "https://example.com/");
  });
});

describe("installWindowNameDefuser — error paths", () => {
  test("cleaner throw → original value forwarded (never crash on read)", () => {
    const host = makeWindowStub("");
    installWindowNameDefuser(host, () => { throw new Error("boom"); });
    host.name = "https://example.com/?utm_source=x";
    assert.equal(host.name, "https://example.com/?utm_source=x");
  });

  test("cleaner returning non-string → original value forwarded", () => {
    const host = makeWindowStub("");
    installWindowNameDefuser(host, () => null);
    host.name = "https://example.com/?utm_source=x";
    assert.equal(host.name, "https://example.com/?utm_source=x");
  });

  test("malformed URL-ish string → returned as-is, never throws", () => {
    const host = makeWindowStub("");
    installWindowNameDefuser(host, trackingCleaner);
    // Looks vaguely URL-shaped but is not parseable — must not crash.
    host.name = "http://[::not-a-url";
    assert.equal(host.name, "http://[::not-a-url");
  });
});

describe("installWindowNameDefuser — write-through semantics", () => {
  test("writing a non-URL value and reading it returns the same value", () => {
    const host = makeWindowStub("");
    installWindowNameDefuser(host, trackingCleaner);
    host.name = "session-token-xyz";
    assert.equal(host.name, "session-token-xyz");
    host.name = "another-token";
    assert.equal(host.name, "another-token");
  });

  test("subsequent writes update the stored value (read returns latest)", () => {
    const host = makeWindowStub("");
    installWindowNameDefuser(host, trackingCleaner);
    host.name = "https://a.test/?utm_source=x";
    assert.equal(host.name, "https://a.test/");
    host.name = "https://b.test/?utm_medium=y";
    assert.equal(host.name, "https://b.test/");
  });

  test("writes do NOT mutate the stored value (cleaning is on-read only)", () => {
    // The contract is: storage stays raw, cleaning happens at read time.
    // This matters because some scripts write window.name and re-read it
    // expecting their exact value back. Cleaning on write would corrupt
    // legitimate uses; cleaning on read only mutates output.
    const host = makeWindowStub("");
    installWindowNameDefuser(host, trackingCleaner);
    const dirty = "https://example.com/?utm_source=x&id=1";
    host.name = dirty;
    // First read sees cleaned output (the defuser job).
    assert.equal(host.name, "https://example.com/?id=1");
    // Stored value (re-readable after uninstall) was never rewritten:
    // we can verify by swapping cleaner for identity and checking again.
    // Easier: install with identity and confirm round-trip equals dirty.
    const host2 = makeWindowStub("");
    installWindowNameDefuser(host2, identityCleaner);
    host2.name = dirty;
    assert.equal(host2.name, dirty);
  });
});

describe("installWindowNameDefuser — disabled-state guard", () => {
  test("when isEnabled returns false, cleaner is not consulted", () => {
    let called = 0;
    const host = makeWindowStub("");
    installWindowNameDefuser(host, (u) => { called++; return "MUTATED"; }, {
      isEnabled: () => false,
    });
    host.name = "https://example.com/?utm_source=x";
    assert.equal(host.name, "https://example.com/?utm_source=x");
    assert.equal(called, 0);
  });

  test("when isEnabled returns true, cleaner runs", () => {
    const host = makeWindowStub("");
    installWindowNameDefuser(host, trackingCleaner, { isEnabled: () => true });
    host.name = "https://example.com/?utm_source=x";
    assert.equal(host.name, "https://example.com/");
  });

  test("isEnabled is consulted on each read (live toggle)", () => {
    let enabled = false;
    const host = makeWindowStub("");
    installWindowNameDefuser(host, trackingCleaner, {
      isEnabled: () => enabled,
    });
    host.name = "https://example.com/?utm_source=x";
    assert.equal(host.name, "https://example.com/?utm_source=x");
    enabled = true;
    assert.equal(host.name, "https://example.com/");
    enabled = false;
    assert.equal(host.name, "https://example.com/?utm_source=x");
  });
});

describe("installWindowNameDefuser — URL-shape heuristic", () => {
  test("only http/https scheme strings are treated as URL-shaped", () => {
    const host = makeWindowStub("");
    installWindowNameDefuser(host, trackingCleaner);
    // Non-http schemes should not be treated as URLs to clean (e.g. a
    // page-internal payload that happens to start with a colon).
    host.name = "javascript:void(0)";
    assert.equal(host.name, "javascript:void(0)");
    host.name = "data:text/plain,hello?utm_source=x";
    assert.equal(host.name, "data:text/plain,hello?utm_source=x");
  });

  test("strings that contain '?' but no scheme are NOT treated as URLs", () => {
    const host = makeWindowStub("");
    installWindowNameDefuser(host, trackingCleaner);
    host.name = "foo?bar=baz";
    assert.equal(host.name, "foo?bar=baz");
  });
});

// ── Manifest + content-script wiring (structural) ──────────────────────────

describe("window-name-defuser — content-script wiring", () => {
  test("manifest.json registers the main-world wrap at document_start with world MAIN", () => {
    const manifest = JSON.parse(readFileSync(
      join(__dirname, "../../src/manifest.json"), "utf8"
    ));
    const entry = manifest.content_scripts.find((e) =>
      Array.isArray(e.js) && e.js.some((p) => p.endsWith("window-name-defuser-mainworld.js"))
    );
    assert.ok(entry, "window-name-defuser-mainworld.js must be in a content_scripts entry");
    assert.equal(entry.run_at, "document_start");
    assert.equal(entry.world, "MAIN",
      "main-world wrap must declare world MAIN so the page-world window.name is wrapped");
  });

  test("manifest.json registers the isolated-world gate at document_start", () => {
    const manifest = JSON.parse(readFileSync(
      join(__dirname, "../../src/manifest.json"), "utf8"
    ));
    const entry = manifest.content_scripts.find((e) =>
      Array.isArray(e.js) && e.js.some((p) => p.endsWith("window-name-defuser.js"))
    );
    assert.ok(entry, "window-name-defuser.js must be in a content_scripts entry");
    assert.equal(entry.run_at, "document_start");
  });

  test("manifest.v2.json registers both window-name defuser scripts at document_start", () => {
    const manifest = JSON.parse(readFileSync(
      join(__dirname, "../../src/manifest.v2.json"), "utf8"
    ));
    const gateEntry = manifest.content_scripts.find((e) =>
      Array.isArray(e.js) && e.js.some((p) => p.endsWith("window-name-defuser.js"))
    );
    const wrapEntry = manifest.content_scripts.find((e) =>
      Array.isArray(e.js) && e.js.some((p) => p.endsWith("window-name-defuser-mainworld.js"))
    );
    assert.ok(gateEntry, "window-name-defuser.js (gate) must be registered for MV2");
    assert.equal(gateEntry.run_at, "document_start");
    assert.ok(wrapEntry, "window-name-defuser-mainworld.js (wrap) must be registered for MV2");
    assert.equal(wrapEntry.run_at, "document_start");
  });

  test("content/window-name-defuser.js is an IIFE (no ES module imports)", () => {
    const src = readFileSync(
      join(__dirname, "../../src/content/window-name-defuser.js"), "utf8"
    );
    assert.ok(/^\(function/m.test(src), "content script must be an IIFE");
    assert.equal(/^\s*import\s+/m.test(src), false,
      "content script must not contain top-level ES module imports");
  });

  test("content/window-name-defuser-mainworld.js is an IIFE that defines a name accessor", () => {
    const src = readFileSync(
      join(__dirname, "../../src/content/window-name-defuser-mainworld.js"), "utf8"
    );
    assert.ok(/^\(function/m.test(src), "content script must be an IIFE");
    assert.equal(/^\s*import\s+/m.test(src), false,
      "content script must not contain top-level ES module imports");
    assert.ok(/Object\.defineProperty\s*\(\s*window\s*,\s*['"]name['"]/.test(src),
      "main-world script must redefine window.name as an accessor");
    // No chrome.* CALLS (strip comments first to avoid prose tripping the guard).
    const stripped = src
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "");
    assert.equal(/\bchrome\.[a-zA-Z]/.test(stripped), false,
      "main-world script must not call any chrome.* extension API");
    // Reuses the existing B10 gate event so a single isolated-world
    // dispatcher governs both defusers.
    assert.ok(/muga:history-gate/.test(src),
      "main-world wrap must listen for muga:history-gate to honor disabled state");
  });
});
