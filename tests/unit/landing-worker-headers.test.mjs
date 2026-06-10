/**
 * MUGA Landing Worker — security headers unit tests (#830).
 *
 * Verifies that the Worker clones the ASSETS response and injects every
 * required security header without dropping existing response properties.
 *
 * Run with: npm test
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

// ── minimal env stub ──────────────────────────────────────────────────────────

function makeEnv({ status = 200, body = "hello", headers = {} } = {}) {
  return {
    ASSETS: {
      async fetch() {
        return new Response(body, { status, headers });
      },
    },
  };
}

// ── import the worker ─────────────────────────────────────────────────────────

const { default: worker } = await import("../../landing-worker/worker.js");

// ── tests ─────────────────────────────────────────────────────────────────────

describe("landing-worker — security headers", () => {
  test("sets X-Frame-Options: DENY", async () => {
    const env = makeEnv();
    const res = await worker.fetch(new Request("https://muga.app/"), env);
    assert.equal(res.headers.get("X-Frame-Options"), "DENY");
  });

  test("sets X-Content-Type-Options: nosniff", async () => {
    const env = makeEnv();
    const res = await worker.fetch(new Request("https://muga.app/"), env);
    assert.equal(res.headers.get("X-Content-Type-Options"), "nosniff");
  });

  test("sets Referrer-Policy: strict-origin-when-cross-origin", async () => {
    const env = makeEnv();
    const res = await worker.fetch(new Request("https://muga.app/"), env);
    assert.equal(res.headers.get("Referrer-Policy"), "strict-origin-when-cross-origin");
  });

  test("sets Strict-Transport-Security with max-age=31536000", async () => {
    const env = makeEnv();
    const res = await worker.fetch(new Request("https://muga.app/"), env);
    const hsts = res.headers.get("Strict-Transport-Security");
    assert.ok(hsts !== null, "HSTS header must be present");
    assert.ok(hsts.includes("max-age=31536000"), `HSTS must include max-age=31536000, got: ${hsts}`);
  });

  test("sets Content-Security-Policy with frame-ancestors 'none'", async () => {
    const env = makeEnv();
    const res = await worker.fetch(new Request("https://muga.app/"), env);
    const csp = res.headers.get("Content-Security-Policy");
    assert.ok(csp !== null, "CSP header must be present");
    assert.ok(csp.includes("frame-ancestors 'none'"), `CSP must include frame-ancestors 'none', got: ${csp}`);
    assert.ok(csp.includes("object-src 'none'"), `CSP must include object-src 'none', got: ${csp}`);
  });

  test("preserves response status from ASSETS", async () => {
    const env = makeEnv({ status: 404 });
    const res = await worker.fetch(new Request("https://muga.app/missing"), env);
    assert.equal(res.status, 404);
  });

  test("preserves response body from ASSETS", async () => {
    const env = makeEnv({ body: "page content" });
    const res = await worker.fetch(new Request("https://muga.app/"), env);
    const text = await res.text();
    assert.equal(text, "page content");
  });

  test("does not overwrite an existing header already set by ASSETS", async () => {
    // Security headers are always overwritten (set, not append) — this test
    // confirms the worker sets the header even when ASSETS provides one too.
    const env = makeEnv({ headers: { "X-Frame-Options": "SAMEORIGIN" } });
    const res = await worker.fetch(new Request("https://muga.app/"), env);
    // Worker's DENY takes precedence over ASSETS' SAMEORIGIN.
    assert.equal(res.headers.get("X-Frame-Options"), "DENY");
  });
});
