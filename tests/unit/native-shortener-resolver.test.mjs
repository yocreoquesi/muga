import { test, describe, beforeEach, afterEach } from "node:test";
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
