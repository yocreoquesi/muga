/**
 * MUGA — Benchmark ClearURLs adapter (#506 phase 2b).
 *
 * The competitor adapter contract is documented in
 * tests/benchmark/competitors/README-CONTRACT.txt. These tests pin
 * the contract end-to-end against the vendored ClearURLs snapshot.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { clearurlsAdapter, _compiledForTests } from "../../tests/benchmark/competitors/clearurls.mjs";

describe("ClearURLs adapter — contract", () => {
  test("exports the documented adapter shape", () => {
    assert.equal(typeof clearurlsAdapter, "object");
    assert.equal(typeof clearurlsAdapter.name, "string");
    assert.equal(typeof clearurlsAdapter.label, "string");
    assert.equal(typeof clearurlsAdapter.source, "string");
    assert.equal(typeof clearurlsAdapter.clean, "function");
    assert.equal(clearurlsAdapter.name, "clearurls");
  });

  test("compiled provider list is non-empty (snapshot loaded)", () => {
    assert.ok(_compiledForTests.length > 0,
      "expected the vendored ClearURLs snapshot to compile at least one provider");
    // ClearURLs default provider count is well over 100 — guard against
    // the snapshot file going empty / corrupted in a refresh.
    assert.ok(_compiledForTests.length > 50,
      `expected >50 providers from data/clearurls.json, got ${_compiledForTests.length}`);
  });
});

describe("ClearURLs adapter — strip behavior", () => {
  test("invalid URL passes through unchanged", () => {
    assert.equal(clearurlsAdapter.clean("not a url"), "not a url");
  });

  test("non-http(s) protocol passes through unchanged", () => {
    assert.equal(
      clearurlsAdapter.clean("ftp://example.com/path"),
      "ftp://example.com/path",
    );
  });

  test("URL with no provider match is returned unchanged", () => {
    // `example.test` is reserved (RFC 6761) — no real ClearURLs provider
    // targets it.
    const raw = "https://example.test/page?someparam=value";
    assert.equal(clearurlsAdapter.clean(raw), raw);
  });

  test("strips utm_source on a generic URL via the global provider", () => {
    // ClearURLs ships a `globalRules` provider whose urlPattern matches
    // any http(s) URL and whose rules cover the UTM family. We don't
    // depend on the exact provider name, just on the outcome.
    const raw = "https://example.com/page?utm_source=email&utm_medium=link&keep=me";
    const out = clearurlsAdapter.clean(raw);
    const u = new URL(out);
    assert.ok(!u.searchParams.has("utm_source"), "utm_source should be stripped");
    assert.ok(!u.searchParams.has("utm_medium"), "utm_medium should be stripped");
    assert.equal(u.searchParams.get("keep"), "me", "non-tracking param must survive");
  });

  test("strips fbclid", () => {
    const raw = "https://example.com/page?fbclid=ABC123";
    const out = clearurlsAdapter.clean(raw);
    assert.ok(!out.includes("fbclid"), `fbclid should be stripped from ${out}`);
  });

  test("strips Amazon noise params (provider-scoped)", () => {
    const raw = "https://www.amazon.com/dp/B0XYZ?ref=foo&qid=12345&keywords=stuff";
    const out = clearurlsAdapter.clean(raw);
    const u = new URL(out);
    // ClearURLs' Amazon provider strips qid + ref-family. The Amazon
    // affiliate `tag=` is in its referralMarketing list, which the
    // ClearURLs default config strips — so a foreign creator's tag
    // would be stripped here. That's the wedge difference: MUGA
    // preserves `tag` for creators; ClearURLs strips it.
    assert.ok(!u.searchParams.has("qid"), "qid should be stripped");
  });

  test("Amazon `tag=` IS stripped by ClearURLs default config (referralMarketing)", () => {
    // The benchmark must show what ClearURLs actually does, not what
    // we wish it did. This test pins the wedge difference: MUGA
    // preserves third-party affiliate tags; ClearURLs treats them as
    // strippable by default.
    const raw = "https://www.amazon.com/dp/B0XYZ?tag=somecreator-21";
    const out = clearurlsAdapter.clean(raw);
    assert.ok(!out.includes("tag="), `ClearURLs strips Amazon tag= by default; got ${out}`);
  });

  test("clean is pure — same input produces same output", () => {
    const raw = "https://example.com/page?utm_source=x&keep=me";
    const a = clearurlsAdapter.clean(raw);
    const b = clearurlsAdapter.clean(raw);
    assert.equal(a, b);
  });

  test("clean does not throw on adversarial regex-ish inputs", () => {
    // Long pathological strings that an underlying regex might
    // mishandle. The contract says clean() must NEVER throw — return
    // rawUrl on anything weird.
    const inputs = [
      "https://example.com/" + "x".repeat(5000),
      "https://example.com/?" + "a=b&".repeat(500),
      "https://example.com/?x=" + "%00".repeat(100),
    ];
    for (const raw of inputs) {
      assert.doesNotThrow(() => clearurlsAdapter.clean(raw),
        `clean must not throw on: ${raw.slice(0, 80)}...`);
    }
  });
});
