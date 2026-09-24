/**
 * MUGA — regression guard: the published documents must describe what MUGA
 * keeps on the device the way the code keeps it (#1425).
 *
 * The privacy policies, the transparency report and the Terms described URL
 * storage as session-only. Three local stores outlive the session:
 *
 *   - the Activity ledger ("Recent activity"): up to DEFAULT_LEDGER_CAPACITY
 *     full URLs under `attributionLedger` in chrome.storage.local, default ON;
 *   - the cross-site frequency map under `crossSiteFreq` (param names per
 *     site, values only as one-way hashes), default ON;
 *   - per-site counters under `domainStats`, capped at DOMAIN_STATS_MAX.
 *
 * Run with: npm test
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { PREF_DEFAULTS } from "../../src/lib/prefs.js";
import { DEFAULT_LEDGER_CAPACITY } from "../../src/lib/attribution-ledger.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "../..");
const read = (rel) => readFileSync(join(ROOT, rel), "utf8");

const PRIVACY_POLICIES = ["docs/privacy-page.html", "src/privacy/privacy.html"];
const TERMS = ["docs/tos.html", "src/privacy/tos.html"];

// Read the cap from source so this test does not depend on storage.js's
// chrome.* shims at import time.
const DOMAIN_STATS_MATCH = read("src/lib/storage.js").match(/export const DOMAIN_STATS_MAX\s*=\s*(\d+)\s*;/);
assert.ok(DOMAIN_STATS_MATCH, "storage.js must declare DOMAIN_STATS_MAX (source of truth for this file)");
const DOMAIN_STATS_MAX = Number(DOMAIN_STATS_MATCH[1]);

describe("source of truth: these stores persist by default", () => {
  test("ledger, cross-site frequency and per-site stats are on by default", () => {
    assert.equal(PREF_DEFAULTS.attributionLedgerEnabled, true);
    assert.equal(PREF_DEFAULTS.crossSiteFrequencyEnabled, true);
    assert.equal(PREF_DEFAULTS.domainStats, true);
  });
  test("each store is written to chrome.storage.local", () => {
    assert.match(read("src/background/process-url.js"), /chrome\.storage\.local\.set\(\{\s*attributionLedger/);
    assert.match(read("src/lib/cross-site-frequency.js"), /const KEY = "crossSiteFreq"/);
    // setStats() is a thin chrome.storage.local.set wrapper.
    assert.match(read("src/lib/storage.js"), /setStats\(\{ domainStats/);
  });
});

describe("privacy policies disclose every persistent local store", () => {
  for (const docPath of PRIVACY_POLICIES) {
    const html = read(docPath);
    test(`${docPath} names the Activity ledger with its cap`, () => {
      assert.ok(html.includes("attributionLedger"), "names the attributionLedger key");
      assert.ok(
        html.includes(`last ${DEFAULT_LEDGER_CAPACITY} URLs`),
        `states the ${DEFAULT_LEDGER_CAPACITY}-URL cap`
      );
    });
    test(`${docPath} names the cross-site frequency map and per-site stats`, () => {
      assert.ok(html.includes("crossSiteFreq"), "names the crossSiteFreq key");
      assert.ok(html.includes("domainStats"), "names the domainStats key");
      assert.ok(html.includes(`up to ${DOMAIN_STATS_MAX} sites`), `states the ${DOMAIN_STATS_MAX}-site cap`);
    });
    test(`${docPath} does not file recently cleaned URLs under short-lived data`, () => {
      assert.doesNotMatch(html, /short-lived session data \([^)]*recently cleaned URLs/);
    });
  }
});

describe("no document says URLs never outlive the session", () => {
  for (const docPath of [...PRIVACY_POLICIES, ...TERMS, "docs/transparency.html"]) {
    test(docPath, () => {
      const html = read(docPath);
      assert.doesNotMatch(html, /never stored beyond the current session/i);
      assert.doesNotMatch(html, /does not collect, transmit, or store your browsing data/i);
    });
  }
});
