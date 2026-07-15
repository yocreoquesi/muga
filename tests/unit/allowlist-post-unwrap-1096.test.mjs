/**
 * MUGA — Regression test for #1096 (audit-2026-07).
 *
 * A domain-only allowlist entry ("fully inert" / never touched by any path)
 * was only checked against the PRE-unwrap entry host (cleaner.js earlyHostname).
 * So an allowlisted destination reached THROUGH a redirect wrapper
 * (l.facebook.com/l.php?u=...example.com...) had its own params stripped after
 * unwrap — contradicting the exemption contract.
 *
 * Chosen behavior (Option B): MUGA still unwraps the foreign wrapper (it is NOT
 * exempt), but once the URL resolves to an allowlisted host it stops — the
 * destination's params are left intact. The wrapper is removed (action
 * "cleaned", URL changed) but nothing on the exempt destination is stripped.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { processUrl } from "../../src/lib/cleaner.js";

const BASE = {
  enabled: true,
  injectOwnAffiliate: false,
  notifyForeignAffiliate: false,
  stripAllAffiliates: false,
  blacklist: [],
};

const wrap = (dest) => `https://l.facebook.com/l.php?u=${encodeURIComponent(dest)}`;

describe("#1096 — allowlist exemption applies to the post-unwrap destination", () => {
  test("wrapper → allowlisted destination: unwrapped, but destination params preserved", () => {
    const dest = "https://example.com/p?utm_source=x&utm_medium=y";
    const r = processUrl(wrap(dest), { ...BASE, whitelist: ["example.com"] }, []);

    // Foreign wrapper removed...
    assert.equal(new URL(r.cleanUrl).host, "example.com", "the facebook wrapper must be unwrapped away");
    // ...but the exempt destination's own params are untouched.
    const params = new URL(r.cleanUrl).searchParams;
    assert.equal(params.get("utm_source"), "x", "an allowlisted destination must keep its params");
    assert.equal(params.get("utm_medium"), "y", "an allowlisted destination must keep its params");
    assert.equal(r.action, "cleaned", "unwrapping the wrapper is a URL change → applied by the SW");
    assert.equal(r.junkRemoved, 0, "no params were stripped from the exempt destination");
  });

  test("control: a NON-allowlisted destination through the same wrapper is still cleaned", () => {
    const dest = "https://other.com/p?utm_source=x&utm_medium=y";
    const r = processUrl(wrap(dest), { ...BASE, whitelist: ["example.com"] }, []);

    const params = new URL(r.cleanUrl).searchParams;
    assert.equal(params.has("utm_source"), false, "a non-exempt destination must still be stripped");
    assert.equal(params.has("utm_medium"), false, "a non-exempt destination must still be stripped");
  });

  test("control: direct navigation to the allowlisted host stays fully untouched", () => {
    const raw = "https://example.com/p?utm_source=x&utm_medium=y";
    const r = processUrl(raw, { ...BASE, whitelist: ["example.com"] }, []);

    assert.equal(r.action, "untouched", "direct navigation to an exempt host is fully inert");
    assert.equal(r.cleanUrl, raw, "exempt host returned completely unmodified");
  });
});
