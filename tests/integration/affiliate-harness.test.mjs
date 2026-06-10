/** MUGA: Synthetic affiliate-flow harness (#650 MVP + #657 G3 strong-form) */
//
// Drives a contract test for the 2.1 denoise pivot's load-bearing
// invariants on affiliate-redirect networks. Reads per-network fixtures
// from tests/integration/affiliate-harness/fixtures/ and asserts the
// matrix v1.0 (docs/affiliate-networks-matrix.md) policies hold against
// the actual codebase.
//
// Coverage (matrix v1.0):
//   - Awin           (awin1.com)
//   - CJ Affiliate   (8 redirect domains)
//   - AliExpress     (s.click.aliexpress.com)
//   - Partnerize     (prf.hn)
//   - Admitad        (ad.admitad.com — alitems.com follow-up)
//   - A8.net         (px.a8.net)
//   - Impact Radius  (*.pxf.io)             — retired from wrapper in #692
//   - Rakuten        (click.linksynergy.com) — retired from wrapper in #692
//   - TradeTracker   (tc.tradetracker.net)   — retired from wrapper in #692
//
// Guards:
//   G1 — Redirect-host pass-through invariants (HARD). The membership check
//        uses isAffiliateRedirectNetwork() so wildcard entries (e.g. `*.pxf.io`)
//        resolve correctly. The raw AFFILIATE_REDIRECT_NETWORKS export is no
//        longer probed directly. pending_resolution still skips G1 per-fixture
//        for any network that may need it in the future.
//   G2 — Tracking-noise is universally stripped at landing (HARD).
//   G3 — Attribution params preserved via getLandingPolicy + processUrl
//        (HARD; always enforced — the policy function resolves all networks
//        via REDIRECT_NETWORK_PATTERNS regardless of pass-through wiring).

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";

import {
  isAffiliateRedirectNetwork,
  isGenericShortener,
} from "../../src/lib/opaque-networks.js";
import { TRACKING_PARAMS } from "../../src/lib/affiliates.js";
import { getLandingPolicy, processUrl } from "../../src/lib/cleaner.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = join(__dirname, "affiliate-harness", "fixtures");

const TRACKING_PARAM_SET = new Set(TRACKING_PARAMS);

const PREFS = Object.freeze({
  enabled: true,
  blacklist: [],
  whitelist: [],
  customParams: [],
  remoteParams: [],
  userCustomRules: [],
  disabledCategories: [],
});

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
        const skip = pending ? { skip: pending } : {};
        test(`${host} is classified as an affiliate-redirect network`, skip, () => {
          assert.equal(
            isAffiliateRedirectNetwork(host),
            true,
            `${host} must be in AFFILIATE_REDIRECT_NETWORKS — otherwise the cleaner won't preserve it`,
          );
        });

        test(`${host} is NOT a generic shortener (URL Unwrapper rejects it)`, skip, () => {
          assert.equal(
            isGenericShortener(host),
            false,
            `${host} must NOT be in GENERIC_SHORTENERS — otherwise the Worker would resolve it and break attribution`,
          );
        });

        test(`${host} is recognised by isAffiliateRedirectNetwork (covers wildcard entries)`, skip, () => {
          // Goes through the helper so wildcard suffix entries (e.g. `*.pxf.io`
          // matching `target.pxf.io`) resolve. The raw AFFILIATE_REDIRECT_NETWORKS
          // export contains literal entries AND `*.suffix` patterns; do NOT
          // probe it with `.includes()` directly.
          assert.equal(
            isAffiliateRedirectNetwork(host),
            true,
            `${host} not recognised by isAffiliateRedirectNetwork — fixture and source disagree`,
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

        // G1 sub-test (#815): The redirect URL is the attribution event.
        // processUrl MUST return the URL byte-identical (action="untouched",
        // cleanUrl===input). Any param stripped here destroys a creator's
        // commission on the click itself — before the merchant even reads it.
        test(`sample redirect URL ${sampleUrl} passes through processUrl byte-identical (click IS the attribution event)`, pending ? { skip: pending } : {}, () => {
          const { action, cleanUrl } = processUrl(
            sampleUrl,
            PREFS,
            [],
            undefined,
            undefined,
          );
          assert.equal(
            action,
            "untouched",
            `processUrl must not touch a redirect-network URL — returned action="${action}" for ${sampleUrl}. ` +
            `The click-through URL IS the attribution event; any mutation destroys the creator's commission.`,
          );
          assert.equal(
            cleanUrl,
            sampleUrl,
            `processUrl must return the redirect URL byte-identical — got cleanUrl=${cleanUrl} for input ${sampleUrl}. ` +
            `Params on redirect-network hosts carry attribution state for the network, not tracking noise.`,
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
  for (const { data } of fixtures) {
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

// ── G3: Attribution params preserved via getLandingPolicy (HARD) ─────────────
//
// For every landing sample the matrix-required params (expected.preserve)
// must:
//   (a) NOT be in the universal-strip TRACKING_PARAMS list (#655 contract).
//   (b) BE returned by getLandingPolicy(landing_host, referrer) inside the
//       preserve Set (#656 contract).
//   (c) Survive an end-to-end processUrl call with the sample referrer; the
//       same call must strip every param marked expected.strip.
//
// G3 enforces for every fixture, including those flagged pending_resolution
// at the G1 level — the policy function resolves via REDIRECT_NETWORK_PATTERNS
// regardless of whether the host has been migrated into
// AFFILIATE_REDIRECT_NETWORKS. The pending_resolution gap is a pass-through
// wiring concern, not a policy gap.

describe("affiliate-harness — G3: attribution params preserved at landing (HARD)", () => {
  for (const { data } of fixtures) {
    for (const sample of data.landing_samples) {
      const landingHost = new URL(sample.url).hostname;

      for (const param of sample.expected.preserve) {
        test(`${data.network}: ${param} is NOT in universal-strip TRACKING_PARAMS`, () => {
          assert.ok(
            !TRACKING_PARAM_SET.has(param),
            `${param} must NOT be in TRACKING_PARAMS — universal strip would kill attribution on ${landingHost}`,
          );
        });

        test(`${data.network}: getLandingPolicy(${landingHost}, referrer).preserve contains ${param}`, () => {
          const policy = getLandingPolicy(landingHost, sample.referrer);
          assert.ok(
            policy.preserve.has(param),
            `getLandingPolicy did not include ${param} in preserve for referrer ${sample.referrer} → landing ${landingHost}. Policy returned network=${policy.network}, preserve=[${[...policy.preserve].join(", ")}]`,
          );
        });
      }

      test(`${data.network}: processUrl preserves matrix params and strips noise on first-touch`, () => {
        const { action, cleanUrl } = processUrl(
          sample.url,
          PREFS,
          [],
          undefined,
          undefined,
          sample.referrer,
        );
        assert.ok(
          action === "cleaned" || action === "noop",
          `processUrl returned unexpected action=${action} for ${sample.url}`,
        );

        const u = new URL(cleanUrl);

        for (const param of sample.expected.preserve) {
          assert.ok(
            u.searchParams.has(param),
            `processUrl dropped ${param} on first-touch from ${sample.referrer} → ${sample.url}. Got cleanUrl=${cleanUrl}`,
          );
        }

        for (const param of sample.expected.strip) {
          assert.equal(
            u.searchParams.has(param),
            false,
            `processUrl did NOT strip ${param} on ${sample.url}. Got cleanUrl=${cleanUrl}`,
          );
        }
      });
    }
  }
});

// ── Diagnostic: per-network verdict summary ──────────────────────────────────
//
// Not an assertion. Prints a readable table to the test output so reviewers
// can scan the per-network state at a glance.

describe("affiliate-harness — per-network summary", () => {
  test("summary table", () => {
    const rows = [];
    for (const { data } of fixtures) {
      let passThrough;
      if (data.pending_resolution) {
        passThrough = "PENDING";
      } else {
        const hostsOK = data.redirect_hosts.every(
          (h) => isAffiliateRedirectNetwork(h) && !isGenericShortener(h),
        );
        passThrough = hostsOK ? "PASS" : "FAIL";
      }

      const stripOK = data.landing_samples.every((s) =>
        s.expected.strip.every((p) => TRACKING_PARAM_SET.has(p)),
      );

      const preserveOK = data.landing_samples.every((s) => {
        if (!s.referrer) return false;
        const landingHost = new URL(s.url).hostname;
        const policy = getLandingPolicy(landingHost, s.referrer);
        const inPolicy = s.expected.preserve.every((p) => policy.preserve.has(p));
        const notStripped = s.expected.preserve.every((p) => !TRACKING_PARAM_SET.has(p));
        return inPolicy && notStripped;
      });

      rows.push({
        network: data.network,
        pass_through: passThrough,
        strip_at_landing: stripOK ? "PASS" : "FAIL",
        preserve_at_landing: preserveOK ? "PASS" : "FAIL",
      });
    }
    const out = ["", "  affiliate-harness summary:"];
    for (const r of rows) {
      out.push(
        `  - ${r.network.padEnd(32)} pass-through:${r.pass_through.padEnd(8)} strip:${r.strip_at_landing.padEnd(5)} preserve:${r.preserve_at_landing}`,
      );
    }
    out.push("");
    process.stdout.write(out.join("\n"));
    assert.ok(rows.length > 0);
  });
});
