/**
 * MUGA — resolveTopFrameHostname() (cookie-consent-all-frames FIX A)
 *
 * Pure helper that resolves the TOP frame's hostname from an injected,
 * testable environment snapshot (never touches `window`/`location` itself —
 * the content-script call site in src/content/cookie-noise.js supplies the
 * real values). Used to fix the per-site exemption check ("pause this
 * site") being bypassed inside a cross-origin consent iframe: in a child
 * frame, `location.hostname` is the CMP vendor's own host, not the paused
 * site's, so the exemption check must resolve the REAL top-frame host
 * instead.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { resolveTopFrameHostname } from "../../src/lib/frame-host.js";

describe("resolveTopFrameHostname — top frame", () => {
  test("returns the frame's own hostname when this IS the top frame", () => {
    const result = resolveTopFrameHostname({ isTopFrame: true, hostname: "example.com" });
    assert.equal(result, "example.com");
  });

  test("returns null when this IS the top frame but hostname is missing/empty", () => {
    assert.equal(resolveTopFrameHostname({ isTopFrame: true, hostname: "" }), null);
    assert.equal(resolveTopFrameHostname({ isTopFrame: true }), null);
  });
});

describe("resolveTopFrameHostname — child frame, Chrome/Edge ancestorOrigins", () => {
  test("resolves the OUTERMOST (last) ancestorOrigins entry as the top frame's hostname", () => {
    const result = resolveTopFrameHostname({
      isTopFrame: false,
      ancestorOrigins: ["https://consent-vendor.example", "https://real-site.example"],
    });
    assert.equal(result, "real-site.example");
  });

  test("strips scheme and port via URL parsing", () => {
    const result = resolveTopFrameHostname({
      isTopFrame: false,
      ancestorOrigins: ["https://real-site.example:8443"],
    });
    assert.equal(result, "real-site.example");
  });

  test("returns null for a malformed ancestorOrigins entry (never throws)", () => {
    const result = resolveTopFrameHostname({
      isTopFrame: false,
      ancestorOrigins: ["not-a-valid-origin"],
    });
    assert.equal(result, null);
  });
});

describe("resolveTopFrameHostname — undeterminable (fail-closed)", () => {
  test("returns null when ancestorOrigins is absent (e.g. Firefox)", () => {
    assert.equal(resolveTopFrameHostname({ isTopFrame: false }), null);
    assert.equal(resolveTopFrameHostname({ isTopFrame: false, ancestorOrigins: null }), null);
  });

  test("returns null when ancestorOrigins is empty", () => {
    const result = resolveTopFrameHostname({ isTopFrame: false, ancestorOrigins: [] });
    assert.equal(result, null);
  });

  test("never throws on garbage input", () => {
    assert.equal(resolveTopFrameHostname(null), null);
    assert.equal(resolveTopFrameHostname(undefined), null);
    assert.equal(resolveTopFrameHostname("garbage"), null);
    assert.equal(resolveTopFrameHostname({ isTopFrame: false, ancestorOrigins: { length: "not-a-number" } }), null);
    assert.equal(resolveTopFrameHostname({ isTopFrame: false, ancestorOrigins: [123] }), null);
  });
});
