/**
 * MUGA: domain-stats unit tests
 *
 * Tests the domain stats system: constants, exports, eviction logic,
 * feature flag default, and i18n key presence.
 */

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Simulate the eviction logic extracted from _flushDomainStats. */
function applyEviction(stats, max) {
  const entries = Object.entries(stats);
  if (entries.length <= max) return { ...stats };
  entries.sort((a, b) => a[1].params - b[1].params);
  return Object.fromEntries(entries.slice(entries.length - max));
}

// ── T3-1: DOMAIN_STATS_MAX constant equals 50 ────────────────────────────────

describe("DOMAIN_STATS_MAX", () => {
  it("T3-1: exports DOMAIN_STATS_MAX = 50", async () => {
    const { DOMAIN_STATS_MAX } = await import("../../src/lib/storage.js");
    assert.equal(DOMAIN_STATS_MAX, 50);
  });
});

// ── T3-2: incrementDomainStat and getDomainStats are exported functions ───────

describe("exports", () => {
  it("T3-2: incrementDomainStat is an exported function", async () => {
    const mod = await import("../../src/lib/storage.js");
    assert.equal(typeof mod.incrementDomainStat, "function");
  });

  it("T3-5: getDomainStats is an exported function", async () => {
    const mod = await import("../../src/lib/storage.js");
    assert.equal(typeof mod.getDomainStats, "function");
  });
});

// ── T3-3: Eviction logic — given 50+1 domains, lowest-count is evicted ───────

describe("eviction logic", () => {
  it("T3-3: evicts the lowest-count domain when cap is exceeded", () => {
    const MAX = 50;

    // Build 50 domains with params 1..50
    const stats = {};
    for (let i = 1; i <= MAX; i++) {
      stats[`domain${i}.com`] = { params: i, urls: 1 };
    }

    // Add domain51 with params=0 (lowest)
    stats["new-domain.com"] = { params: 0, urls: 1 };

    assert.equal(Object.keys(stats).length, 51);

    const kept = applyEviction(stats, MAX);

    assert.equal(Object.keys(kept).length, MAX);
    // The domain with 0 params (new-domain.com) must be evicted
    assert.equal("new-domain.com" in kept, false);
    // The domain with the lowest non-zero count (domain1.com, params=1) is kept
    assert.equal("domain1.com" in kept, true);
    // The highest-count domain must also be kept
    assert.equal(`domain${MAX}.com` in kept, true);
  });

  it("T3-3b: does not evict when count is exactly at cap", () => {
    const MAX = 50;
    const stats = {};
    for (let i = 1; i <= MAX; i++) {
      stats[`domain${i}.com`] = { params: i, urls: 1 };
    }
    const kept = applyEviction(stats, MAX);
    assert.equal(Object.keys(kept).length, MAX);
  });
});

// ── T3-7: domainStats feature flag in PREF_DEFAULTS defaults to true ──────────

describe("PREF_DEFAULTS.domainStats", () => {
  it("T3-7: domainStats exists in PREF_DEFAULTS and defaults to true", async () => {
    const { PREF_DEFAULTS } = await import("../../src/lib/storage.js");
    assert.equal("domainStats" in PREF_DEFAULTS, true);
    assert.equal(PREF_DEFAULTS.domainStats, true);
  });
});

// ── T3-10: i18n keys exist with both en and es ────────────────────────────────

describe("i18n keys for domain stats", () => {
  const REQUIRED_KEYS = [
    "domain_stats_label",
    "domain_stats_empty",
    "domain_stats_params",
    "domain_stats_urls",
  ];

  it("T3-10: all domain stats i18n keys exist with en and es translations", async () => {
    const { TRANSLATIONS } = await import("../../src/lib/i18n.js");
    for (const key of REQUIRED_KEYS) {
      assert.ok(key in TRANSLATIONS, `Missing i18n key: ${key}`);
      assert.equal(typeof TRANSLATIONS[key].en, "string", `Missing EN for: ${key}`);
      assert.ok(TRANSLATIONS[key].en.length > 0, `Empty EN string for: ${key}`);
      assert.equal(typeof TRANSLATIONS[key].es, "string", `Missing ES for: ${key}`);
      assert.ok(TRANSLATIONS[key].es.length > 0, `Empty ES string for: ${key}`);
    }
  });
});
