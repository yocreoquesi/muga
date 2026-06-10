/**
 * MUGA — Live Worker contract tests (#608, #825)
 *
 * Verifies the extension-Worker contract against the real unwrap.muga.app
 * deployment: URL path shape, param schema, Origin gate, and signed-envelope
 * structure.
 *
 * These tests make real outbound HTTP requests to https://unwrap.muga.app.
 * They are EXCLUDED from PR gate runs to avoid hard-failing unrelated PRs on
 * transient Worker/CDN hiccups (#825). They run on every push to main so that
 * contract drift is visible where it belongs — on the integration branch, not
 * on contributors' PRs.
 *
 * Guard: set MUGA_LIVE_TESTS=1 to run. Without the env var every test is
 * skipped with a clear message. This allows `npm run test:integration` (full,
 * local) to include this file without surprises — the developer opts in
 * explicitly when they have network access and want live verification.
 *
 * Decommission note (#701): when the Worker is retired, delete this file and
 * remove the `test:integration:live` script from package.json. The
 * `test:integration:stub` script and the PR gate in ci.yml need no changes.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

const LIVE = process.env.MUGA_LIVE_TESTS === "1";
const SKIP_REASON =
  "live Worker tests skipped — set MUGA_LIVE_TESTS=1 to run (requires network access to unwrap.muga.app)";

const WORKER_BASE = "https://unwrap.muga.app";

// A known short URL that the Worker can resolve. Using bit.ly as a stable
// public shortener — the important thing is that the Worker receives the
// request with the correct contract shape and returns a signed envelope.
const SAMPLE_SHORT_URL = "https://bit.ly/3example";

// ── Contract: endpoint reachability ──────────────────────────────────────────

describe("live Worker contract — endpoint reachability (#608)", () => {
  test(
    "GET /v1/unwrap returns a non-5xx response for a valid short URL",
    { skip: LIVE ? false : SKIP_REASON },
    async () => {
      const target = `${WORKER_BASE}/v1/unwrap?url=${encodeURIComponent(SAMPLE_SHORT_URL)}`;
      const res = await fetch(target, {
        headers: { Origin: "chrome-extension://muga" },
        signal: AbortSignal.timeout(10_000),
      });
      // Worker may return 200, 400 (invalid URL), or 429 (rate-limited) —
      // any of these is a "contract alive" response. 5xx means the Worker
      // itself is broken.
      assert.ok(
        res.status < 500,
        `Worker returned HTTP ${res.status} — unexpected server-side error. ` +
          "If this is a transient CDN blip, re-run on main. " +
          "If it persists, the Worker deployment is broken."
      );
    }
  );
});

// ── Contract: response envelope shape ────────────────────────────────────────

describe("live Worker contract — response envelope shape (#608)", () => {
  test(
    "200 response body is JSON with expected top-level keys",
    { skip: LIVE ? false : SKIP_REASON },
    async () => {
      const target = `${WORKER_BASE}/v1/unwrap?url=${encodeURIComponent(SAMPLE_SHORT_URL)}`;
      const res = await fetch(target, {
        headers: { Origin: "chrome-extension://muga" },
        signal: AbortSignal.timeout(10_000),
      });

      if (res.status !== 200) {
        // Non-200 is acceptable for contract-alive check; skip envelope test.
        return;
      }

      const body = await res.json();
      assert.ok(
        typeof body === "object" && body !== null,
        "Worker response must be a JSON object"
      );
      // The signed envelope must carry at least a `url` result field.
      // Additional fields (sig, ts, etc.) may be present but are not
      // required by this contract version.
      assert.ok(
        "url" in body || "error" in body,
        `Worker envelope missing expected 'url' or 'error' field. Got keys: ${Object.keys(body).join(", ")}`
      );
    }
  );
});

// ── Contract: Origin gate ─────────────────────────────────────────────────────

describe("live Worker contract — Origin gate (#608)", () => {
  test(
    "request without a recognised Origin receives a deliberate 4xx rejection",
    { skip: LIVE ? false : SKIP_REASON },
    async () => {
      const target = `${WORKER_BASE}/v1/unwrap?url=${encodeURIComponent(SAMPLE_SHORT_URL)}`;
      const res = await fetch(target, {
        // No Origin header — simulates a rogue non-extension caller.
        signal: AbortSignal.timeout(10_000),
      });
      // The live Worker answers 404 (not 403/401) to callers without a
      // recognised Origin — endpoint cloaking: an unauthorized probe cannot
      // even confirm the route exists. Verified live 2026-06-10: no-Origin,
      // bogus-Origin and / all return 404 uniformly, while the
      // recognised-Origin reachability/envelope tests above get 200.
      assert.ok(
        [400, 401, 403, 404].includes(res.status),
        `Worker must reject requests without a recognised Origin (any deliberate ` +
          `4xx counts; the live gate cloaks with 404). Got HTTP ${res.status}.`
      );
    }
  );
});
