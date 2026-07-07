/**
 * MUGA: unit tests for tools/rule-ingestion/harvest-preserve.mjs
 *
 * Run with: npm test
 *
 * Exercises the pure parsing/merge functions with synthetic fixtures (no
 * network, no dependency on the real quarantined raw files) so behavior is
 * pinned regardless of upstream data drift:
 *
 *   - parseAdguardExceptions: both `@@||host^$removeparam=X` and
 *     `@@/path...$removeparam=X,domain=A|B` forms; wildcard-TLD hosts are
 *     skipped rather than guessed; negated `domain=~x` entries are ignored.
 *   - parseClearUrlsProviders: a concrete-host provider's referralMarketing
 *     is harvested as a domain-scoped preserve; the globalRules catch-all
 *     and multi-TLD-wildcard providers are skipped, never globalized.
 *   - mergeIntoDomainRules: additive-only, idempotent, dedups and sorts
 *     preserveParams, and never touches existing stripParams/note text.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  parseAdguardExceptions,
  parseClearUrlsProviders,
  extractConcreteHost,
  isStrippedByMuga,
  mergeIntoDomainRules,
} from "../../tools/rule-ingestion/harvest-preserve.mjs";

// ── parseAdguardExceptions ────────────────────────────────────────────────────

describe("parseAdguardExceptions", () => {
  test("harvests a whole-host `@@||host^$removeparam=X` rule", () => {
    const { entries, skipped } = parseAdguardExceptions(
      "@@||example.com^$removeparam=fooparam",
    );
    assert.deepEqual(entries, [{ domain: "example.com", param: "fooparam" }]);
    assert.equal(skipped.length, 0);
  });

  test("harvests the anchored host PLUS positive domain= entries when options are only removeparam/domain", () => {
    const { entries } = parseAdguardExceptions(
      "@@||edge.example.com^$removeparam=cuid,domain=origin.example.com|other.example.net",
    );
    const domains = entries.map((e) => e.domain).sort();
    assert.deepEqual(domains, ["edge.example.com", "origin.example.com", "other.example.net"]);
    assert.ok(entries.every((e) => e.param === "cuid"));
  });

  test("ignores negated domain= entries (leading ~) but keeps the anchored host and positive ones", () => {
    const { entries } = parseAdguardExceptions(
      "@@||host.example.com^$removeparam=ref,domain=good.example.com|~excluded.example.com",
    );
    const domains = entries.map((e) => e.domain).sort();
    assert.deepEqual(domains, ["good.example.com", "host.example.com"]);
  });

  // ── Scope faithfulness: rules narrower than a whole host must be SKIPPED,
  //    never widened to the whole host (PR #1021 review, Risk 1). ──────────────
  test("skips an $app= scoped rule (e.g. msn.com/ocid app=msedgewebview2.exe)", () => {
    const { entries, skipped } = parseAdguardExceptions(
      "@@||msn.com^$app=msedgewebview2.exe,removeparam=ocid",
    );
    assert.deepEqual(entries, []);
    assert.equal(skipped.length, 1);
    assert.match(skipped[0].reason, /app/i);
  });

  test("skips a request-type scoped rule (xmlhttprequest)", () => {
    const { entries, skipped } = parseAdguardExceptions(
      "@@||shop.example.com/api$removeparam=utm_medium,xmlhttprequest,domain=shop.example.com",
    );
    assert.deepEqual(entries, []);
    assert.equal(skipped.length, 1);
  });

  test("skips a path-scoped rule (e.g. allegro.pl/affiliate)", () => {
    const { entries, skipped } = parseAdguardExceptions(
      "@@||allegro.pl/affiliate?redirect_url=$removeparam=utm_source",
    );
    assert.deepEqual(entries, []);
    assert.equal(skipped.length, 1);
    assert.match(skipped[0].reason, /host anchor/i);
  });

  test("skips a path-anchored `@@/path...$...,domain=A|B` rule (e.g. Eloqua /e/er?)", () => {
    const { entries, skipped } = parseAdguardExceptions(
      "@@/e/er?$removeparam=elq,domain=a.example.com|b.example.org",
    );
    assert.deepEqual(entries, []);
    assert.equal(skipped.length, 1);
  });

  test("skips a wildcard-host rule", () => {
    const { entries, skipped } = parseAdguardExceptions(
      "@@||brand.*/checkout?$removeparam=clickid",
    );
    assert.deepEqual(entries, []);
    assert.equal(skipped.length, 1);
    assert.match(skipped[0].line, /brand\.\*/);
  });

  test("ignores non-@@ lines and @@ lines without removeparam=", () => {
    const { entries, skipped } = parseAdguardExceptions(
      "||ads.example.com^\n@@||safe.example.com^$important\n",
    );
    assert.deepEqual(entries, []);
    assert.deepEqual(skipped, []);
  });

  test("lowercases resolved hosts", () => {
    const { entries } = parseAdguardExceptions(
      "@@||Example.COM^$removeparam=foo",
    );
    assert.equal(entries[0].domain, "example.com");
  });
});

// ── parseClearUrlsProviders ───────────────────────────────────────────────────

function clearUrlsFixture(providers) {
  return JSON.stringify({ providers });
}

describe("parseClearUrlsProviders", () => {
  test("harvests referralMarketing params for a concrete-host provider", () => {
    const raw = clearUrlsFixture({
      "shop.example": {
        urlPattern: "^https?:\\/\\/(?:[a-z0-9-]+\\.)*?shop\\.example",
        referralMarketing: ["partner", "mr:referralID"],
      },
    });
    const { entries, skipped } = parseClearUrlsProviders(raw);
    const domains = entries.map((e) => e.domain);
    assert.ok(domains.every((d) => d === "shop.example"));
    // Params are lowercased to match the runtime loader / domain-rules.json
    // convention (mixed-case upstream tokens like "mr:referralID" become
    // "mr:referralid").
    assert.deepEqual(
      entries.map((e) => e.param).sort(),
      ["mr:referralid", "partner"].sort(),
    );
    assert.equal(skipped.length, 0);
  });

  test("skips the globalRules catch-all provider without emitting its tokens", () => {
    const raw = clearUrlsFixture({
      globalRules: {
        urlPattern: ".*",
        referralMarketing: ["ref_?", "referrer"],
      },
    });
    const { entries, skipped } = parseClearUrlsProviders(raw);
    assert.deepEqual(entries, []);
    assert.equal(skipped.length, 1);
    assert.equal(skipped[0].provider, "globalRules");
  });

  test("skips a provider whose urlPattern is a multi-TLD wildcard (no concrete host)", () => {
    const raw = clearUrlsFixture({
      amazon: {
        urlPattern: "^https?:\\/\\/(?:[a-z0-9-]+\\.)*?amazon(?:\\.[a-z]{2,}){1,}",
        referralMarketing: ["tag"],
      },
    });
    const { entries, skipped } = parseClearUrlsProviders(raw);
    assert.deepEqual(entries, []);
    assert.equal(skipped.length, 1);
    assert.equal(skipped[0].provider, "amazon");
  });

  test("ignores providers with an empty referralMarketing list", () => {
    const raw = clearUrlsFixture({
      quiet: {
        urlPattern: "^https?:\\/\\/(?:[a-z0-9-]+\\.)*?quiet\\.example",
        referralMarketing: [],
      },
    });
    const { entries, skipped } = parseClearUrlsProviders(raw);
    assert.deepEqual(entries, []);
    assert.deepEqual(skipped, []);
  });
});

describe("extractConcreteHost", () => {
  test("resolves a plain host behind the generic optional-subdomain group", () => {
    assert.equal(
      extractConcreteHost("^https?:\\/\\/(?:[a-z0-9-]+\\.)*?backcountry\\.com"),
      "backcountry.com",
    );
  });

  test("returns null for the generic '.*' catch-all", () => {
    assert.equal(extractConcreteHost(".*"), null);
  });

  test("returns null when the domain continues into a wildcard-TLD group", () => {
    assert.equal(
      extractConcreteHost("^https?:\\/\\/(?:[a-z0-9-]+\\.)*?google(?:\\.[a-z]{2,}){1,}"),
      null,
    );
  });
});

// ── mergeIntoDomainRules ───────────────────────────────────────────────────────

describe("mergeIntoDomainRules", () => {
  test("creates a new domain entry with sorted, deduped preserveParams", () => {
    const existing = [{ domain: "a.example.com", preserveParams: ["q"] }];
    const harvested = [
      { domain: "new.example.com", param: "zeta" },
      { domain: "new.example.com", param: "alpha" },
      { domain: "new.example.com", param: "alpha" },
    ];
    const { rules, domainsTouched, paramsAdded } = mergeIntoDomainRules(existing, harvested);
    const created = rules.find((r) => r.domain === "new.example.com");
    assert.deepEqual(created.preserveParams, ["alpha", "zeta"]);
    assert.equal(created.note, "Preserve params harvested from AdGuard/ClearURLs exceptions");
    assert.equal(domainsTouched, 1);
    assert.equal(paramsAdded, 2);
  });

  test("inserts a new domain in alphabetically sorted position", () => {
    const existing = [
      { domain: "aaa.com", preserveParams: [] },
      { domain: "zzz.com", preserveParams: [] },
    ];
    const harvested = [{ domain: "mmm.com", param: "x" }];
    const { rules } = mergeIntoDomainRules(existing, harvested);
    assert.deepEqual(rules.map((r) => r.domain), ["aaa.com", "mmm.com", "zzz.com"]);
  });

  test("adds a missing param to an existing entry without touching stripParams or note", () => {
    const existing = [
      {
        domain: "existing.example.com",
        preserveParams: ["q"],
        stripParams: ["adid", "napm"],
        note: "Hand-written note: do not overwrite",
      },
    ];
    const harvested = [{ domain: "existing.example.com", param: "utm_source" }];
    const { rules, domainsTouched, paramsAdded } = mergeIntoDomainRules(existing, harvested);
    const entry = rules.find((r) => r.domain === "existing.example.com");
    assert.deepEqual(entry.preserveParams, ["q", "utm_source"]);
    assert.deepEqual(entry.stripParams, ["adid", "napm"]);
    assert.equal(entry.note, "Hand-written note: do not overwrite");
    assert.equal(domainsTouched, 1);
    assert.equal(paramsAdded, 1);
  });

  test("does not add a param that is already present in preserveParams", () => {
    const existing = [{ domain: "existing.example.com", preserveParams: ["utm_source"] }];
    const harvested = [{ domain: "existing.example.com", param: "utm_source" }];
    const { rules, domainsTouched, paramsAdded } = mergeIntoDomainRules(existing, harvested);
    assert.deepEqual(rules[0].preserveParams, ["utm_source"]);
    assert.equal(domainsTouched, 0);
    assert.equal(paramsAdded, 0);
  });

  test("is idempotent: applying the same harvested entries twice adds nothing the second time", () => {
    const existing = [{ domain: "existing.example.com", preserveParams: ["q"] }];
    const harvested = [
      { domain: "existing.example.com", param: "utm_source" },
      { domain: "brand-new.example.com", param: "clickid" },
    ];
    const first = mergeIntoDomainRules(existing, harvested);
    const second = mergeIntoDomainRules(first.rules, harvested);

    assert.equal(second.domainsTouched, 0);
    assert.equal(second.paramsAdded, 0);
    assert.deepEqual(second.rules, first.rules);
  });

  test("leaves entries with no harvested params completely untouched", () => {
    const existing = [
      { domain: "untouched.example.com", preserveParams: ["q"], stripParams: [], note: "keep me" },
    ];
    const { rules, domainsTouched } = mergeIntoDomainRules(existing, []);
    assert.deepEqual(rules, existing);
    assert.equal(domainsTouched, 0);
  });
});

describe("isStrippedByMuga", () => {
  const tracking = new Set(["utm_source", "cid", "fbclid"]);
  const prefixes = ["utm_", "ir_"];

  test("true for an exact TRACKING_PARAMS match", () => {
    assert.equal(isStrippedByMuga("cid", tracking, prefixes), true);
  });

  test("true for a TRACKING_PREFIXES prefix match", () => {
    assert.equal(isStrippedByMuga("ir_partnerid", tracking, prefixes), true);
    assert.equal(isStrippedByMuga("utm_anything", tracking, prefixes), true);
  });

  test("false for a param MUGA never strips (no-op preserve)", () => {
    // These are the kind of no-op preserves the harvest must drop: params
    // MUGA does not strip, so a domain-scoped preserve would change nothing.
    assert.equal(isStrippedByMuga("tduid", tracking, prefixes), false);
    assert.equal(isStrippedByMuga("partner", tracking, prefixes), false);
    assert.equal(isStrippedByMuga("mr:referralid", tracking, prefixes), false);
  });
});
