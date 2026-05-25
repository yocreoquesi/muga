/** MUGA: Synthetic affiliate-flow harness (#650 MVP — tier-1) */
//
// Drives a contract test for the 2.1 denoise pivot's load-bearing
// invariants on affiliate-redirect networks. Reads per-network fixtures
// from tests/integration/affiliate-harness/fixtures/ and asserts the
// matrix v1.0 (docs/affiliate-networks-matrix.md) policies hold against
// the actual codebase.
//
// MVP scope (tier-1):
//   - Awin       (awin1.com)
//   - CJ         (8 redirect domains)
//   - AliExpress (s.click.aliexpress.com)
//
// The other six networks (Impact, Partnerize, Admitad, A8.net, Rakuten,
// TradeTracker) follow the same fixture shape — adding them is a JSON edit.
// See tests/integration/affiliate-harness/README.md.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";

import {
  isAffiliateRedirectNetwork,
  isGenericShortener,
  AFFILIATE_REDIRECT_NETWORKS,
} from "../../src/lib/opaque-networks.js";
import { TRACKING_PARAMS } from "../../src/lib/affiliates.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = join(__dirname, "affiliate-harness", "fixtures");

const TRACKING_PARAM_SET = new Set(TRACKING_PARAMS);

function loadFixtures() {
  return readdirSync(FIXTURE_DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => ({
      file: f,
      data: JSON.parse(readFileSync(join(FIXTURE_DIR, f), "utf8")),
    }));
}

const fixtures = loadFixtures();

assert.ok(fixtures.length > 0, "harness must load at least one fixture");

// ── G1: Redirect-host pass-through invariants ────────────────────────────────
//
// Every redirect host listed in the fixture must:
//   (a) be classified as an affiliate-redirect network (so cleaner preserves
//       it untouched — the click IS the attribution event).
//   (b) NOT be a generic shortener (so the URL Unwrapper client gate at
//       service-worker.js refuses to send it to unwrap.muga.app — #659).
//   (c) be present in AFFILIATE_REDIRECT_NETWORKS (the source of truth).
//
// If any of these fail, an affiliate creator's commission is at risk.

describe("affiliate-harness — G1: redirect-host pass-through (HARD)", () => {
  for (const { file, data } of fixtures) {
    const pending = data.pending_resolution;
    const suiteName = pending
      ? `${data.network} (${file}) — PENDING: ${pending}`
      : `${data.network} (${file})`;
    describe(suiteName, () => {
      for (const host of data.redirect_hosts) {
        test(`${host} is classified as an affiliate-redirect network`, pending ? { skip: pending } : {}, () => {
          assert.equal(
            isAffiliateRedirectNetwork(host),
            true,
            `${host} must be in AFFILIATE_REDIRECT_NETWORKS — otherwise the cleaner won't preserve it`,
          );
        });

        test(`${host} is NOT a generic shortener (URL Unwrapper rejects it)`, pending ? { skip: pending } : {}, () => {
          assert.equal(
            isGenericShortener(host),
            false,
            `${host} must NOT be in GENERIC_SHORTENERS — otherwise the Worker would resolve it and break attribution`,
          );
        });

        test(`${host} appears in the AFFILIATE_REDIRECT_NETWORKS export`, pending ? { skip: pending } : {}, () => {
          // www-prefixed entries are normalised by the helper, but the raw
          // export uses bare hosts. Strip the www. for the membership check.
          const bare = host.replace(/^www\./, "");
          assert.ok(
            AFFILIATE_REDIRECT_NETWORKS.includes(bare),
            `${bare} missing from AFFILIATE_REDIRECT_NETWORKS — fixture and source disagree`,
          );
        });
      }

      for (const sampleUrl of data.redirect_url_samples) {
        test(`sample redirect URL ${sampleUrl} preserves its host as an affiliate redirect`, pending ? { skip: pending } : {}, () => {
          const u = new URL(sampleUrl);
          assert.equal(
            isAffiliateRedirectNetwork(u.hostname),
            true,
            `redirect URL host must remain on an AFFILIATE_REDIRECT_NETWORKS entry`,
          );
        });
      }
    });
  }
});

// ── G2: Tracking-noise is universally stripped at landing (HARD) ─────────────
//
// For every landing sample, the params marked `strip` must be in the
// canonical TRACKING_PARAMS list — i.e., the cleaner removes them on any
// site. This guards against accidental removal of utm_*/fbclid/gclid
// coverage during refactors of TRACKING_PARAMS.

describe("affiliate-harness — G2: tracking noise stripped at landing (HARD)", () => {
  for (const { file, data } of fixtures) {
    for (const sample of data.landing_samples) {
      for (const param of sample.expected.strip) {
        test(`${data.network} landing strips ${param}`, () => {
          assert.ok(
            TRACKING_PARAM_SET.has(param),
            `${param} must be in TRACKING_PARAMS so the cleaner strips it on ${sample.url}`,
          );
        });
      }
    }
  }
});

// ── G3: Attribution params are NOT in universal-strip (SKIP pending #655) ────
//
// For every landing sample, the params marked `preserve` (the matrix's
// required-at-landing list) must NOT currently be inside TRACKING_PARAMS,
// because being there means the cleaner strips them universally — killing
// the merchant's first-party cookie sync.
//
// Today most of these ARE in TRACKING_PARAMS (the universal strip is the
// 2.0 behavior). #655 is the audit that removes them and migrates the
// per-network preservation to `getLandingPolicy()` (#656). This guard is
// the gate that confirms #655 actually shipped — flip the skip when it does.

describe("affiliate-harness — G3: attribution params preserved at landing (BLOCKED on #655)", () => {
  for (const { file, data } of fixtures) {
    for (const sample of data.landing_samples) {
      const blockedOn = sample.blocked_on || "(unspecified)";
      for (const param of sample.expected.preserve) {
        test(
          `${data.network} landing preserves ${param} (gated on #655)`,
          { skip: `blocked on ${blockedOn} TRACKING_PARAMS audit — unskip when ${blockedOn} ships` },
          () => {
            assert.ok(
              !TRACKING_PARAM_SET.has(param),
              `${param} must NOT be in universal-strip TRACKING_PARAMS once ${blockedOn} lands`,
            );
          },
        );
      }
    }
  }
});

// ── Diagnostic: per-network verdict summary ──────────────────────────────────
//
// Not an assertion. Prints a readable table to the test output so reviewers
// can scan the per-network state at a glance, satisfying the issue's
// "Output legible: tabla per-red con verdict pass/fail" requirement.

describe("affiliate-harness — per-network summary", () => {
  test("summary table", () => {
    const rows = [];
    for (const { file, data } of fixtures) {
      const stripOK = data.landing_samples.every((s) =>
        s.expected.strip.every((p) => TRACKING_PARAM_SET.has(p)),
      );
      const preserveBlockedOn = data.landing_samples
        .map((s) => s.blocked_on)
        .filter(Boolean)
        .pop() || "—";
      let passThrough;
      if (data.pending_resolution) {
        passThrough = "PENDING";
      } else {
        const hostsOK = data.redirect_hosts.every(
          (h) => isAffiliateRedirectNetwork(h) && !isGenericShortener(h),
        );
        passThrough = hostsOK ? "PASS" : "FAIL";
      }
      rows.push({
        network: data.network,
        pass_through: passThrough,
        strip_at_landing: stripOK ? "PASS" : "FAIL",
        preserve_at_landing: `BLOCKED on ${preserveBlockedOn}`,
      });
    }
    const out = ["", "  affiliate-harness summary:"];
    for (const r of rows) {
      out.push(
        `  - ${r.network.padEnd(30)} pass-through:${r.pass_through.padEnd(8)} strip:${r.strip_at_landing.padEnd(5)} preserve:${r.preserve_at_landing}`,
      );
    }
    out.push("");
    process.stdout.write(out.join("\n"));
    assert.ok(rows.length > 0);
  });
});
