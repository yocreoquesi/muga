import { test, describe, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  resolveShortener,
  isAllowlistedShortener,
  isPrivateHost,
  GENERIC_SHORTENERS,
} from "../../src/lib/native-shortener-resolver.js";

// ── fetch mock harness ───────────────────────────────────────────────────────
// Each test installs a `handler(url) => { status, location }` (or a thrower).

const realFetch = globalThis.fetch;

function fakeResponse({ status = 302, location = null } = {}) {
  return {
    status,
    headers: {
      get(name) {
        return name.toLowerCase() === "location" ? location : null;
      },
    },
  };
}

function installFetch(handler) {
  globalThis.fetch = async (url) => handler(String(url));
}

afterEach(() => {
  globalThis.fetch = realFetch;
});

// ── allowlist / private-host units ───────────────────────────────────────────

describe("allowlist + private-host helpers", () => {
  test("all allowlisted shorteners pass (case-insensitive)", () => {
    for (const host of GENERIC_SHORTENERS) {
      assert.equal(isAllowlistedShortener(host), true, `${host} should be allowlisted`);
      assert.equal(isAllowlistedShortener(host.toUpperCase()), true);
    }
  });

  test("non-shorteners and subdomains are not allowlisted", () => {
    assert.equal(isAllowlistedShortener("example.com"), false);
    assert.equal(isAllowlistedShortener("evil.bit.ly"), false); // host-exact, no wildcard
    assert.equal(isAllowlistedShortener(""), false);
  });

  test("isPrivateHost catches loopback/private/metadata", () => {
    for (const h of ["127.0.0.1", "10.0.0.1", "192.168.1.1", "169.254.169.254", "localhost", "::1"]) {
      assert.equal(isPrivateHost(h), true, `${h} should be private`);
    }
    assert.equal(isPrivateHost("example.com"), false);
  });

  // ── CGNAT 100.64.0.0/10 (RFC 6598) — boundary tests (#830) ──────────────────
  test("isPrivateHost blocks CGNAT range 100.64.0.0/10", () => {
    // Inside range: 100.64.x through 100.127.x
    assert.equal(isPrivateHost("100.64.0.0"), true,   "100.64.0.0 is CGNAT start");
    assert.equal(isPrivateHost("100.64.1.1"), true,   "100.64.1.1 is inside CGNAT");
    assert.equal(isPrivateHost("100.100.50.1"), true,  "100.100.50.1 is inside CGNAT");
    assert.equal(isPrivateHost("100.127.255.255"), true, "100.127.255.255 is CGNAT end");
  });

  test("isPrivateHost allows addresses just outside CGNAT boundaries", () => {
    // Below range: 100.63.x.x
    assert.equal(isPrivateHost("100.63.255.255"), false, "100.63.255.255 is below CGNAT");
    // Above range: 100.128.x.x
    assert.equal(isPrivateHost("100.128.0.0"), false,  "100.128.0.0 is above CGNAT");
  });

  // ── TEST-NET-1/2/3 (RFC 5737) — documentation ranges (#830) ─────────────────
  test("isPrivateHost blocks TEST-NET-1 192.0.2.0/24", () => {
    assert.equal(isPrivateHost("192.0.2.0"), true,   "192.0.2.0 is TEST-NET-1 start");
    assert.equal(isPrivateHost("192.0.2.128"), true,  "192.0.2.128 is inside TEST-NET-1");
    assert.equal(isPrivateHost("192.0.2.255"), true,  "192.0.2.255 is TEST-NET-1 end");
    // Adjacent address must be allowed (falls through to other checks)
    assert.equal(isPrivateHost("192.0.1.1"), false,  "192.0.1.1 is not TEST-NET-1");
    assert.equal(isPrivateHost("192.0.3.1"), false,  "192.0.3.1 is not TEST-NET-1");
  });

  test("isPrivateHost blocks TEST-NET-2 198.51.100.0/24", () => {
    assert.equal(isPrivateHost("198.51.100.0"), true,   "198.51.100.0 is TEST-NET-2 start");
    assert.equal(isPrivateHost("198.51.100.128"), true,  "198.51.100.128 is inside TEST-NET-2");
    assert.equal(isPrivateHost("198.51.100.255"), true,  "198.51.100.255 is TEST-NET-2 end");
    assert.equal(isPrivateHost("198.51.99.1"), false,   "198.51.99.1 is not TEST-NET-2");
    assert.equal(isPrivateHost("198.51.101.1"), false,  "198.51.101.1 is not TEST-NET-2");
  });

  test("isPrivateHost blocks TEST-NET-3 203.0.113.0/24", () => {
    assert.equal(isPrivateHost("203.0.113.0"), true,   "203.0.113.0 is TEST-NET-3 start");
    assert.equal(isPrivateHost("203.0.113.200"), true,  "203.0.113.200 is inside TEST-NET-3");
    assert.equal(isPrivateHost("203.0.113.255"), true,  "203.0.113.255 is TEST-NET-3 end");
    assert.equal(isPrivateHost("203.0.112.1"), false,  "203.0.112.1 is not TEST-NET-3");
    assert.equal(isPrivateHost("203.0.114.1"), false,  "203.0.114.1 is not TEST-NET-3");
  });

  // ── 6to4 relay anycast (RFC 3068) 192.88.99.0/24 (#830) ─────────────────────
  test("isPrivateHost blocks 6to4 relay anycast 192.88.99.0/24", () => {
    assert.equal(isPrivateHost("192.88.99.0"), true,   "192.88.99.0 is 6to4 relay start");
    assert.equal(isPrivateHost("192.88.99.128"), true,  "192.88.99.128 is inside 6to4 relay");
    assert.equal(isPrivateHost("192.88.99.255"), true,  "192.88.99.255 is 6to4 relay end");
    assert.equal(isPrivateHost("192.88.98.1"), false,  "192.88.98.1 is not 6to4 relay");
    assert.equal(isPrivateHost("192.88.100.1"), false, "192.88.100.1 is not 6to4 relay");
  });
});

// ── happy paths ──────────────────────────────────────────────────────────────

describe("resolveShortener — happy paths", () => {
  test("resolves each allowlisted host to an https destination", async () => {
    for (const host of GENERIC_SHORTENERS) {
      installFetch(() => fakeResponse({ status: 302, location: "https://example.com/dest" }));
      const r = await resolveShortener(`https://${host}/abc`);
      assert.deepEqual(r, { ok: true, destination: "https://example.com/dest", hops: 1 }, `host ${host}`);
    }
  });

  test("follows a chain across allowlisted shorteners and counts hops", async () => {
    installFetch((url) => {
      if (url.startsWith("https://bit.ly/")) return fakeResponse({ location: "https://t.co/step2" });
      if (url.startsWith("https://t.co/")) return fakeResponse({ location: "https://example.com/final" });
      return fakeResponse({ status: 200 });
    });
    const r = await resolveShortener("https://bit.ly/start");
    assert.deepEqual(r, { ok: true, destination: "https://example.com/final", hops: 2 });
  });

  test("allows an http:// destination (denoise tool, not an https-enforcer)", async () => {
    installFetch(() => fakeResponse({ status: 302, location: "http://example.com/x" }));
    const r = await resolveShortener("https://bit.ly/x");
    assert.deepEqual(r, { ok: true, destination: "http://example.com/x", hops: 1 });
  });

  test("honors 301/307/308 redirect statuses", async () => {
    for (const status of [301, 303, 307, 308]) {
      installFetch(() => fakeResponse({ status, location: "https://example.com/x" }));
      const r = await resolveShortener("https://tinyurl.com/x");
      assert.equal(r.ok, true, `status ${status}`);
    }
  });
});

// ── failure modes ────────────────────────────────────────────────────────────

describe("resolveShortener — failure modes", () => {
  test("not_shortener: input host not allowlisted", async () => {
    installFetch(() => assert.fail("must not fetch a non-allowlisted host"));
    const r = await resolveShortener("https://example.com/x");
    assert.deepEqual(r, { ok: false, reason: "not_shortener" });
  });

  test("not_shortener: unparseable input", async () => {
    const r = await resolveShortener("not a url");
    assert.deepEqual(r, { ok: false, reason: "not_shortener" });
  });

  test("network: fetch throws a generic error", async () => {
    installFetch(() => { throw new Error("ECONNREFUSED"); });
    const r = await resolveShortener("https://bit.ly/x");
    assert.deepEqual(r, { ok: false, reason: "network" });
  });

  test("timeout: fetch throws AbortError", async () => {
    installFetch(() => { const e = new Error("aborted"); e.name = "AbortError"; throw e; });
    const r = await resolveShortener("https://bit.ly/x");
    assert.deepEqual(r, { ok: false, reason: "timeout" });
  });

  test("no_redirect: non-3xx response", async () => {
    installFetch(() => fakeResponse({ status: 200 }));
    const r = await resolveShortener("https://bit.ly/x");
    assert.deepEqual(r, { ok: false, reason: "no_redirect" });
  });

  test("missing_location: 3xx without Location header", async () => {
    installFetch(() => fakeResponse({ status: 302, location: null }));
    const r = await resolveShortener("https://bit.ly/x");
    assert.deepEqual(r, { ok: false, reason: "missing_location" });
  });

  test("oversize_location: Location exceeds the 2000-char cap", async () => {
    const huge = "https://example.com/" + "a".repeat(2100);
    installFetch(() => fakeResponse({ status: 302, location: huge }));
    const r = await resolveShortener("https://bit.ly/x");
    assert.deepEqual(r, { ok: false, reason: "oversize_location" });
  });

  test("invalid_url: non-http(s) scheme in Location", async () => {
    installFetch(() => fakeResponse({ status: 302, location: "javascript:alert(1)" }));
    const r = await resolveShortener("https://bit.ly/x");
    assert.deepEqual(r, { ok: false, reason: "invalid_url" });
  });

  test("private_address_blocked: destination resolves to a loopback host", async () => {
    installFetch(() => fakeResponse({ status: 302, location: "https://127.0.0.1/x" }));
    const r = await resolveShortener("https://bit.ly/x");
    assert.deepEqual(r, { ok: false, reason: "private_address_blocked" });
  });

  test("redirect_loop: chain revisits a URL already seen", async () => {
    installFetch(() => fakeResponse({ status: 302, location: "https://bit.ly/loop" }));
    const r = await resolveShortener("https://bit.ly/loop");
    assert.deepEqual(r, { ok: false, reason: "redirect_loop" });
  });

  test("too_many_hops: chain of allowlisted shorteners exceeds MAX_HOPS", async () => {
    let n = 0;
    installFetch(() => fakeResponse({ status: 302, location: `https://bit.ly/${++n}` }));
    const r = await resolveShortener("https://bit.ly/0");
    assert.deepEqual(r, { ok: false, reason: "too_many_hops" });
  });
});
