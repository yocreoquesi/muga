/**
 * MUGA — Unit tests for proxy-navigate pure helper (B20 #453, W-1)
 *
 * Tests the extracted pure function that handles the UNWRAP_VIA_PROXY
 * content-script-side navigation logic. All Chrome/DOM APIs are injected
 * as dependencies so this function is testable in Node.js without globals.
 *
 * Run with: npm test
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { handleProxyNavigation } from "../../src/lib/proxy-navigate.js";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/**
 * Returns a minimal prefs object with privacyProxyEnabled set to the given value.
 * Other fields default to safe values.
 */
function makePrefs(privacyProxyEnabled = true) {
  return { privacyProxyEnabled, enabled: true, onboardingDone: true };
}

/**
 * Standard opaque host list mirroring the real one.
 * Enough entries to exercise matching.
 */
const OPAQUE_HOSTS = Object.freeze([
  "s.click.aliexpress.com",
  "anrdoezrs.net",
  "ad.admitad.com",
]);

/**
 * A detectWrapper stub that returns truthy for known wrapper URLs,
 * null for others. Used to simulate the wrapper-engine behavior.
 */
function detectWrapperStub(url) {
  try {
    const h = new URL(url).hostname.replace(/^www\./, "");
    if (OPAQUE_HOSTS.includes(h)) return { id: "test-wrapper" };
  } catch { /* ignore */ }
  return null;
}

/**
 * An unwrap stub that always returns null (cannot be unwrapped client-side).
 * This represents opaque networks where the destination is unknown client-side.
 */
function unwrapNullStub() {
  return null;
}

/**
 * An unwrap stub that returns a valid extracted URL.
 * Used to test the "local unwrap succeeded — no proxy needed" path.
 */
function unwrapExtractedStub() {
  return { unwrapped: "https://merchant.example.com/product/123", hops: 1 };
}

// ---------------------------------------------------------------------------
// a. Proxy ON + opaque host + detectWrapper hit + unwrap null
//    → calls sendMessage with UNWRAP_VIA_PROXY, calls preventDefault, navigates on ok
// ---------------------------------------------------------------------------
describe("proxy-navigate — proxy ON + opaque + no local unwrap → sends UNWRAP_VIA_PROXY", () => {
  test("calls preventDefault on the event", async () => {
    let preventDefaultCalled = false;
    const event = { preventDefault() { preventDefaultCalled = true; } };

    const sendMessage = async () => ({ ok: true, destination: "https://store.example.com/p/1" });
    const navigate = () => {};

    await handleProxyNavigation({
      url: "https://anrdoezrs.net/click?id=123",
      event,
      prefs: makePrefs(true),
      opaqueHosts: OPAQUE_HOSTS,
      detectWrapper: detectWrapperStub,
      unwrap: unwrapNullStub,
      sendMessage,
      navigate,
    });

    assert.equal(preventDefaultCalled, true, "event.preventDefault must be called");
  });

  test("calls sendMessage with type UNWRAP_VIA_PROXY and the original url", async () => {
    let sentMessage = null;
    const opaqueUrl = "https://anrdoezrs.net/click?id=123";
    const event = { preventDefault() {} };

    const sendMessage = async (msg) => { sentMessage = msg; return { ok: true, destination: "https://store.example.com/p/1" }; };
    const navigate = () => {};

    await handleProxyNavigation({
      url: opaqueUrl,
      event,
      prefs: makePrefs(true),
      opaqueHosts: OPAQUE_HOSTS,
      detectWrapper: detectWrapperStub,
      unwrap: unwrapNullStub,
      sendMessage,
      navigate,
    });

    assert.ok(sentMessage, "sendMessage must be called");
    assert.equal(sentMessage.type, "UNWRAP_VIA_PROXY");
    assert.equal(sentMessage.url, opaqueUrl);
  });

  test("on response ok=true navigates to the destination", async () => {
    const destination = "https://store.example.com/product/42";
    let navigatedTo = null;
    const event = { preventDefault() {} };

    const sendMessage = async () => ({ ok: true, destination });
    const navigate = (url) => { navigatedTo = url; };

    await handleProxyNavigation({
      url: "https://anrdoezrs.net/click?id=123",
      event,
      prefs: makePrefs(true),
      opaqueHosts: OPAQUE_HOSTS,
      detectWrapper: detectWrapperStub,
      unwrap: unwrapNullStub,
      sendMessage,
      navigate,
    });

    assert.equal(navigatedTo, destination, "must navigate to the resolved destination");
  });
});

// ---------------------------------------------------------------------------
// b. Proxy ON + non-opaque host → no preventDefault, no sendMessage
// ---------------------------------------------------------------------------
describe("proxy-navigate — proxy ON + non-opaque host → default navigation", () => {
  test("does NOT call preventDefault for non-opaque host", async () => {
    let preventDefaultCalled = false;
    const event = { preventDefault() { preventDefaultCalled = true; } };

    const navigate = () => {};
    const sendMessage = async () => { throw new Error("should not be called"); };

    const result = await handleProxyNavigation({
      url: "https://amazon.com/dp/B001",
      event,
      prefs: makePrefs(true),
      opaqueHosts: OPAQUE_HOSTS,
      detectWrapper: detectWrapperStub,
      unwrap: unwrapNullStub,
      sendMessage,
      navigate,
    });

    assert.equal(preventDefaultCalled, false, "event.preventDefault must NOT be called for non-opaque host");
    assert.equal(result, "default-navigate", "must return 'default-navigate' for non-opaque host");
  });

  test("does NOT call sendMessage for non-opaque host", async () => {
    let messageSent = false;
    const event = { preventDefault() {} };
    const navigate = () => {};
    const sendMessage = async () => { messageSent = true; return { ok: true, destination: "x" }; };

    await handleProxyNavigation({
      url: "https://amazon.com/dp/B001",
      event,
      prefs: makePrefs(true),
      opaqueHosts: OPAQUE_HOSTS,
      detectWrapper: detectWrapperStub,
      unwrap: unwrapNullStub,
      sendMessage,
      navigate,
    });

    assert.equal(messageSent, false, "sendMessage must NOT be called for non-opaque host");
  });
});

// ---------------------------------------------------------------------------
// c. Proxy OFF + opaque host → no preventDefault, no UNWRAP message
// ---------------------------------------------------------------------------
describe("proxy-navigate — proxy OFF + opaque host → default navigation (CTA fires elsewhere)", () => {
  test("does NOT call preventDefault when proxy is disabled", async () => {
    let preventDefaultCalled = false;
    const event = { preventDefault() { preventDefaultCalled = true; } };

    const navigate = () => {};
    const sendMessage = async () => ({ ok: true, destination: "https://x.com" });

    const result = await handleProxyNavigation({
      url: "https://anrdoezrs.net/click?id=99",
      event,
      prefs: makePrefs(false), // proxy OFF
      opaqueHosts: OPAQUE_HOSTS,
      detectWrapper: detectWrapperStub,
      unwrap: unwrapNullStub,
      sendMessage,
      navigate,
    });

    assert.equal(preventDefaultCalled, false, "must NOT preventDefault when proxy is off");
    assert.equal(result, "default-navigate", "must return 'default-navigate' when proxy is off");
  });

  test("does NOT call sendMessage when proxy is disabled", async () => {
    let messageSent = false;
    const event = { preventDefault() {} };
    const navigate = () => {};
    const sendMessage = async () => { messageSent = true; return { ok: true, destination: "x" }; };

    await handleProxyNavigation({
      url: "https://anrdoezrs.net/click?id=99",
      event,
      prefs: makePrefs(false),
      opaqueHosts: OPAQUE_HOSTS,
      detectWrapper: detectWrapperStub,
      unwrap: unwrapNullStub,
      sendMessage,
      navigate,
    });

    assert.equal(messageSent, false, "sendMessage must NOT be called when proxy is disabled");
  });
});

// ---------------------------------------------------------------------------
// d. Proxy ON + opaque + detectWrapper hit + unwrap returns extracted URL
//    → local unwrap succeeded — no proxy needed, no preventDefault
// ---------------------------------------------------------------------------
describe("proxy-navigate — proxy ON + opaque + local unwrap succeeds → no proxy call", () => {
  test("does NOT call preventDefault when local unwrap returns a URL", async () => {
    let preventDefaultCalled = false;
    const event = { preventDefault() { preventDefaultCalled = true; } };

    const navigate = () => {};
    const sendMessage = async () => { throw new Error("should not be called"); };

    const result = await handleProxyNavigation({
      url: "https://anrdoezrs.net/click?id=456",
      event,
      prefs: makePrefs(true),
      opaqueHosts: OPAQUE_HOSTS,
      detectWrapper: detectWrapperStub,
      unwrap: unwrapExtractedStub, // returns a URL — local unwrap won
      sendMessage,
      navigate,
    });

    assert.equal(preventDefaultCalled, false, "must NOT preventDefault when local unwrap extracts a URL");
    assert.equal(result, "default-navigate", "must return 'default-navigate' when local unwrap succeeds");
  });

  test("does NOT send UNWRAP_VIA_PROXY when local unwrap succeeds", async () => {
    let messageSent = false;
    const event = { preventDefault() {} };
    const navigate = () => {};
    const sendMessage = async () => { messageSent = true; return { ok: true, destination: "x" }; };

    await handleProxyNavigation({
      url: "https://anrdoezrs.net/click?id=456",
      event,
      prefs: makePrefs(true),
      opaqueHosts: OPAQUE_HOSTS,
      detectWrapper: detectWrapperStub,
      unwrap: unwrapExtractedStub,
      sendMessage,
      navigate,
    });

    assert.equal(messageSent, false, "UNWRAP_VIA_PROXY must NOT be sent when local unwrap extracts a URL");
  });
});

// ---------------------------------------------------------------------------
// e. SW returns ok: true → navigate to destination
// ---------------------------------------------------------------------------
describe("proxy-navigate — SW ok:true → navigate to destination", () => {
  test("navigates to exact destination from response", async () => {
    const destination = "https://merchant.example.com/landing?offer=summer";
    let navigatedTo = null;
    const event = { preventDefault() {} };
    const navigate = (url) => { navigatedTo = url; };
    const sendMessage = async () => ({ ok: true, destination });

    const result = await handleProxyNavigation({
      url: "https://ad.admitad.com/g/abc",
      event,
      prefs: makePrefs(true),
      opaqueHosts: OPAQUE_HOSTS,
      detectWrapper: detectWrapperStub,
      unwrap: unwrapNullStub,
      sendMessage,
      navigate,
    });

    assert.equal(navigatedTo, destination, "must navigate to SW-provided destination");
    assert.equal(result, "proxy-navigate", "must return 'proxy-navigate' on success");
  });
});

// ---------------------------------------------------------------------------
// f. SW returns ok:true but destination is non-http(s) → fall back
// ---------------------------------------------------------------------------
describe("proxy-navigate — SW ok:true but non-http destination → fallback", () => {
  test("falls back to original URL when destination scheme is not http/https", async () => {
    const opaqueUrl = "https://anrdoezrs.net/click?id=999";
    let navigatedTo = null;
    const event = { preventDefault() {} };
    const navigate = (url) => { navigatedTo = url; };
    // SW returns a malicious non-http destination
    const sendMessage = async () => ({ ok: true, destination: "javascript:alert(1)" });

    const result = await handleProxyNavigation({
      url: opaqueUrl,
      event,
      prefs: makePrefs(true),
      opaqueHosts: OPAQUE_HOSTS,
      detectWrapper: detectWrapperStub,
      unwrap: unwrapNullStub,
      sendMessage,
      navigate,
    });

    assert.equal(navigatedTo, opaqueUrl, "must fall back to original URL on non-http destination");
    assert.equal(result, "fallback", "must return 'fallback' on invalid destination scheme");
  });

  test("falls back when destination has ftp scheme", async () => {
    const opaqueUrl = "https://anrdoezrs.net/click?id=888";
    let navigatedTo = null;
    const event = { preventDefault() {} };
    const navigate = (url) => { navigatedTo = url; };
    const sendMessage = async () => ({ ok: true, destination: "ftp://evil.example.com/file" });

    await handleProxyNavigation({
      url: opaqueUrl,
      event,
      prefs: makePrefs(true),
      opaqueHosts: OPAQUE_HOSTS,
      detectWrapper: detectWrapperStub,
      unwrap: unwrapNullStub,
      sendMessage,
      navigate,
    });

    assert.equal(navigatedTo, opaqueUrl, "must fall back to original URL on ftp scheme");
  });
});

// ---------------------------------------------------------------------------
// g. SW returns ok:true but destination > 2000 chars → fall back
// ---------------------------------------------------------------------------
describe("proxy-navigate — SW ok:true but destination too long → fallback", () => {
  test("falls back when destination exceeds 2000 chars", async () => {
    const opaqueUrl = "https://anrdoezrs.net/click?id=777";
    let navigatedTo = null;
    const event = { preventDefault() {} };
    const navigate = (url) => { navigatedTo = url; };
    const longDest = "https://merchant.example.com/" + "a".repeat(2000);
    const sendMessage = async () => ({ ok: true, destination: longDest });

    const result = await handleProxyNavigation({
      url: opaqueUrl,
      event,
      prefs: makePrefs(true),
      opaqueHosts: OPAQUE_HOSTS,
      detectWrapper: detectWrapperStub,
      unwrap: unwrapNullStub,
      sendMessage,
      navigate,
    });

    assert.equal(navigatedTo, opaqueUrl, "must fall back to original URL when destination is too long");
    assert.equal(result, "fallback", "must return 'fallback' when destination exceeds length cap");
  });

  test("accepts destination at exactly 2000 chars", async () => {
    // Edge: exactly at the cap is valid. URL = 29 chars scheme+host + 1971 path chars = 2000 total
    const base = "https://merchant.example.com/";
    const path = "a".repeat(2000 - base.length);
    const dest = base + path;
    assert.equal(dest.length, 2000, "test setup: destination must be exactly 2000 chars");

    let navigatedTo = null;
    const event = { preventDefault() {} };
    const navigate = (url) => { navigatedTo = url; };
    const sendMessage = async () => ({ ok: true, destination: dest });

    const result = await handleProxyNavigation({
      url: "https://anrdoezrs.net/click?id=666",
      event,
      prefs: makePrefs(true),
      opaqueHosts: OPAQUE_HOSTS,
      detectWrapper: detectWrapperStub,
      unwrap: unwrapNullStub,
      sendMessage,
      navigate,
    });

    assert.equal(navigatedTo, dest, "must navigate to destination at exactly 2000 chars");
    assert.equal(result, "proxy-navigate", "must return 'proxy-navigate' for valid 2000-char destination");
  });
});

// ---------------------------------------------------------------------------
// h. SW returns ok: false → fall back to original URL
// ---------------------------------------------------------------------------
describe("proxy-navigate — SW ok:false → fallback to original URL", () => {
  test("falls back to original URL when SW returns ok:false", async () => {
    const opaqueUrl = "https://anrdoezrs.net/click?id=555";
    let navigatedTo = null;
    const event = { preventDefault() {} };
    const navigate = (url) => { navigatedTo = url; };
    const sendMessage = async () => ({ ok: false, reason: "timeout" });

    const result = await handleProxyNavigation({
      url: opaqueUrl,
      event,
      prefs: makePrefs(true),
      opaqueHosts: OPAQUE_HOSTS,
      detectWrapper: detectWrapperStub,
      unwrap: unwrapNullStub,
      sendMessage,
      navigate,
    });

    assert.equal(navigatedTo, opaqueUrl, "must fall back to original URL on SW failure");
    assert.equal(result, "fallback", "must return 'fallback' on SW failure");
  });

  test("falls back on reason=disabled", async () => {
    const opaqueUrl = "https://anrdoezrs.net/click?id=444";
    let navigatedTo = null;
    const event = { preventDefault() {} };
    const navigate = (url) => { navigatedTo = url; };
    const sendMessage = async () => ({ ok: false, reason: "disabled" });

    await handleProxyNavigation({
      url: opaqueUrl,
      event,
      prefs: makePrefs(true),
      opaqueHosts: OPAQUE_HOSTS,
      detectWrapper: detectWrapperStub,
      unwrap: unwrapNullStub,
      sendMessage,
      navigate,
    });

    assert.equal(navigatedTo, opaqueUrl, "must fall back on any ok:false reason");
  });
});

// ---------------------------------------------------------------------------
// i. Timeout: sendMessage takes too long → fallback to original URL
// ---------------------------------------------------------------------------
describe("proxy-navigate — timeout → fallback to original URL", () => {
  test("falls back when sendMessage does not resolve within timeoutMs", async () => {
    const opaqueUrl = "https://anrdoezrs.net/click?id=timeout";
    let navigatedTo = null;
    const event = { preventDefault() {} };
    const navigate = (url) => { navigatedTo = url; };

    // sendMessage never resolves within the timeout window
    const sendMessage = () => new Promise(() => { /* never resolves */ });

    const result = await handleProxyNavigation({
      url: opaqueUrl,
      event,
      prefs: makePrefs(true),
      opaqueHosts: OPAQUE_HOSTS,
      detectWrapper: detectWrapperStub,
      unwrap: unwrapNullStub,
      sendMessage,
      navigate,
      timeoutMs: 50, // Very short timeout for the test
    });

    assert.equal(navigatedTo, opaqueUrl, "must fall back to original URL on timeout");
    assert.equal(result, "fallback", "must return 'fallback' on timeout");
  });

  test("falls back when sendMessage rejects (channel closed)", async () => {
    const opaqueUrl = "https://anrdoezrs.net/click?id=reject";
    let navigatedTo = null;
    const event = { preventDefault() {} };
    const navigate = (url) => { navigatedTo = url; };

    const sendMessage = async () => { throw new Error("channel closed"); };

    const result = await handleProxyNavigation({
      url: opaqueUrl,
      event,
      prefs: makePrefs(true),
      opaqueHosts: OPAQUE_HOSTS,
      detectWrapper: detectWrapperStub,
      unwrap: unwrapNullStub,
      sendMessage,
      navigate,
    });

    assert.equal(navigatedTo, opaqueUrl, "must fall back when sendMessage rejects");
    assert.equal(result, "fallback", "must return 'fallback' when sendMessage rejects");
  });
});

// ---------------------------------------------------------------------------
// Triangulation: detectWrapper returning null for opaque host (edge case)
// If the host IS in opaqueHosts but detectWrapper returns null (not a known
// wrapper pattern) — the proxy path should NOT fire (we only proxy opaque
// wrappers that detectWrapper recognises as such)
// ---------------------------------------------------------------------------
describe("proxy-navigate — opaque host but detectWrapper returns null → default navigate", () => {
  test("does NOT send UNWRAP_VIA_PROXY when detectWrapper returns null on opaque host", async () => {
    // An opaque host that is NOT a recognized wrapper (e.g. future entry added to
    // OPAQUE_HOSTS before it's added to WRAPPERS) should fall through to default.
    let messageSent = false;
    const event = { preventDefault() {} };
    const navigate = () => {};
    const sendMessage = async () => { messageSent = true; return { ok: true, destination: "x" }; };

    // detectWrapper always returns null in this stub
    const detectWrapperReturnsNull = () => null;

    const result = await handleProxyNavigation({
      url: "https://anrdoezrs.net/click?id=noWrapper",
      event,
      prefs: makePrefs(true),
      opaqueHosts: OPAQUE_HOSTS,
      detectWrapper: detectWrapperReturnsNull,
      unwrap: unwrapNullStub,
      sendMessage,
      navigate,
    });

    assert.equal(messageSent, false, "must NOT send UNWRAP_VIA_PROXY when detectWrapper returns null");
    assert.equal(result, "default-navigate", "must return 'default-navigate' when detectWrapper returns null");
  });
});
