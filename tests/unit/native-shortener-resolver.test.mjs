import { test, describe, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  resolveShortener,
  isAllowlistedShortener,
  isPrivateHost,
  GENERIC_SHORTENERS,
} from "../../src/lib/native-shortener-resolver.js";

// ── fetch mock harness ───────────────────────────────────────────────────────
// The resolver uses redirect:"follow" and reads response.url (the final URL
// after the browser followed the chain); the body is cancelled, never read. So
// each test installs a `handler(fetchedUrl) => finalUrl` (or a thrower), and the
// mock response only needs { url, body:{cancel} }.

const realFetch = globalThis.fetch;

function fakeResponse(finalUrl) {
  return {
    url: finalUrl,
    body: { cancel: async () => {} },
  };
}

function installFetch(handler) {
  globalThis.fetch = async (url) => {
    const out = handler(String(url));
    // A handler may return a bare final-URL string or a full fake response.
    return typeof out === "string" ? fakeResponse(out) : out;
  };
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

  // ── IPv6 Unique Local Addresses fc00::/7 (RFC 4193) ─────────────────────────
  // ULA is the IPv6 analogue of RFC 1918 private space and must never be a
  // valid shortener destination. Covers both fc00::/8 and fd00::/8 halves, in
  // bare and bracketed forms.
  test("isPrivateHost blocks IPv6 ULA fc00::/7", () => {
    for (const h of ["fd00::1", "fc00::1", "[fd00::1]", "[fc00::1]", "fdff:ffff::1", "fc12:3456::abcd"]) {
      assert.equal(isPrivateHost(h), true, `${h} is IPv6 ULA (private)`);
    }
    // A global-unicast IPv6 address must still resolve (not ULA).
    assert.equal(isPrivateHost("2606:4700::1111"), false, "2606:4700::1111 is global unicast");
    assert.equal(isPrivateHost("[2606:4700::1111]"), false, "bracketed global unicast");
  });
});

// ── happy paths ──────────────────────────────────────────────────────────────

describe("resolveShortener — happy paths", () => {
  test("resolves each allowlisted host to its final destination", async () => {
    for (const host of GENERIC_SHORTENERS) {
      installFetch(() => "https://example.com/dest");
      const r = await resolveShortener(`https://${host}/abc`);
      assert.deepEqual(r, { ok: true, destination: "https://example.com/dest", hops: 1 }, `host ${host}`);
    }
  });

  test("allows an http:// destination (denoise tool, not an https-enforcer)", async () => {
    installFetch(() => "http://example.com/x");
    const r = await resolveShortener("https://bit.ly/x");
    assert.deepEqual(r, { ok: true, destination: "http://example.com/x", hops: 1 });
  });

  test("upgrades an http:// shortener URL to https for the fetch (https preferred)", async () => {
    let fetchedUrl = null;
    installFetch((url) => { fetchedUrl = url; return "https://example.com/dest"; });
    const r = await resolveShortener("http://bit.ly/1PZiIBZ");
    assert.equal(r.ok, true);
    assert.equal(fetchedUrl, "https://bit.ly/1PZiIBZ", "the shortener must be fetched over https");
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

  // shortener-resolver-expansion Slice 1 (D1): ad-gateway hosts are rejected
  // with a distinct reason before any network fetch is attempted.
  test("ad_gateway: known ad-gateway host is rejected without fetching", async () => {
    installFetch(() => assert.fail("must not fetch an ad-gateway host"));
    const r = await resolveShortener("https://ouo.io/x");
    assert.deepEqual(r, { ok: false, reason: "ad_gateway" });
  });

  test("not_shortener: an unrelated unknown host still returns not_shortener (unaffected by ad_gateway guard)", async () => {
    installFetch(() => assert.fail("must not fetch a non-allowlisted host"));
    const r = await resolveShortener("https://some-random-unknown-host.example/x");
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

  test("no_redirect: the request never left the shortener host", async () => {
    // response.url still points at the shortener → nothing was resolved.
    installFetch(() => "https://bit.ly/x");
    const r = await resolveShortener("https://bit.ly/x");
    assert.deepEqual(r, { ok: false, reason: "no_redirect" });
  });

  test("oversize_location: final destination exceeds the 2000-char cap", async () => {
    const huge = "https://example.com/" + "a".repeat(2100);
    installFetch(() => huge);
    const r = await resolveShortener("https://bit.ly/x");
    assert.deepEqual(r, { ok: false, reason: "oversize_location" });
  });

  test("invalid_url: final destination has a non-http(s) scheme", async () => {
    installFetch(() => "ftp://example.com/x");
    const r = await resolveShortener("https://bit.ly/x");
    assert.deepEqual(r, { ok: false, reason: "invalid_url" });
  });

  test("private_address_blocked: final destination resolves to a loopback host", async () => {
    installFetch(() => "https://127.0.0.1/x");
    const r = await resolveShortener("https://bit.ly/x");
    assert.deepEqual(r, { ok: false, reason: "private_address_blocked" });
  });
});
