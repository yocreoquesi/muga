/**
 * Phase 2 of #523 — parallel-source invariant.
 *
 * Verifies that the new CONSOLIDATED_PATTERNS view (sourced from the
 * vendored caps-spec manifest joined with OUR_TAGS) agrees with the
 * legacy AFFILIATE_PATTERNS array on every (param, host, ourTag) triple.
 * If the two views ever disagree, this test catches it before Phase 3
 * (#578) flips consumers — the cleaner pipeline cannot silently regress.
 *
 * Invariants:
 *   - For every legacy entry, there is a consolidated entry with the
 *     same param and a domains array that covers at least one of the
 *     legacy entry's domains (excluding the www. prefix). The
 *     consolidated entry's `ourTag` map produces the same value the
 *     legacy entry exposes for that host.
 *   - For every consolidated entry, there is at least one legacy
 *     entry whose domains overlap (same param), OR the program id is
 *     in PENDING_ACCOUNT_PROGRAM_IDS (programs MUGA has no account on
 *     yet — Phase 3 will start preserving them by decoupling preserve
 *     from `ourTag`, but they have no legacy mirror today).
 *
 * This test is removed in Phase 3 once the legacy AFFILIATE_PATTERNS
 * is retired.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  AFFILIATE_PATTERNS,
  CONSOLIDATED_PATTERNS,
  PENDING_ACCOUNT_PROGRAM_IDS,
} from "../../src/lib/affiliates.js";

function stripWww(host) {
  return host.replace(/^www\./, "");
}

describe("CONSOLIDATED_PATTERNS agrees with legacy AFFILIATE_PATTERNS (#523 phase 2)", () => {
  test("every legacy entry has a corresponding consolidated entry covering the same hosts", () => {
    for (const legacy of AFFILIATE_PATTERNS) {
      // Find consolidated entries that share the same param AND cover
      // at least one of the legacy entry's hosts.
      const candidates = CONSOLIDATED_PATTERNS.filter((c) => {
        if (c.param !== legacy.param) return false;
        const cHosts = new Set(c.domains.map(stripWww));
        return legacy.domains.some((d) => cHosts.has(stripWww(d)));
      });
      assert.ok(
        candidates.length === 1,
        `legacy entry ${legacy.id} (param=${legacy.param}) must map to exactly one ` +
          `consolidated entry; found ${candidates.length}`,
      );

      const consolidated = candidates[0];
      // For each host the legacy entry covers, the consolidated entry
      // must yield the same ourTag (or the same empty value).
      for (const d of legacy.domains) {
        const host = stripWww(d);
        const legacyTag = legacy.ourTag || "";
        const consolidatedTag = consolidated.ourTag[host] || "";
        assert.strictEqual(
          consolidatedTag,
          legacyTag,
          `tag mismatch for legacy ${legacy.id} on host ${host}: ` +
            `legacy="${legacyTag}" vs consolidated="${consolidatedTag}"`,
        );
      }
    }
  });

  test("every consolidated entry has a legacy mirror OR is in the pending-account allowlist", () => {
    for (const c of CONSOLIDATED_PATTERNS) {
      const matches = AFFILIATE_PATTERNS.filter((legacy) => {
        if (legacy.param !== c.param) return false;
        const cHosts = new Set(c.domains.map(stripWww));
        return legacy.domains.some((d) => cHosts.has(stripWww(d)));
      });
      if (matches.length === 0) {
        assert.ok(
          PENDING_ACCOUNT_PROGRAM_IDS.has(c.id),
          `consolidated entry ${c.id} has no legacy mirror but is not on the ` +
            `pending-account allowlist — either add it to PENDING_ACCOUNT_PROGRAM_IDS ` +
            `or backfill the legacy entry`,
        );
      }
    }
  });

  test("CONSOLIDATED_PATTERNS shape — every entry has the canonical fields", () => {
    const required = ["id", "name", "group", "domains", "param", "type", "ourTag", "references"];
    for (const c of CONSOLIDATED_PATTERNS) {
      for (const f of required) {
        assert.ok(
          Object.prototype.hasOwnProperty.call(c, f),
          `consolidated entry ${c.id || "(unknown)"} missing field "${f}"`,
        );
      }
      assert.strictEqual(c.type, "affiliate");
      assert.ok(Array.isArray(c.domains));
      assert.ok(typeof c.ourTag === "object" && c.ourTag !== null && !Array.isArray(c.ourTag),
        `consolidated entry ${c.id} ourTag must be a host→tag map (object), not a string or array`);
    }
  });

  test("OUR_TAGS hosts must match the consolidated domains (no orphan tag mapping)", () => {
    for (const c of CONSOLIDATED_PATTERNS) {
      const consolidatedHosts = new Set(c.domains);
      for (const taggedHost of Object.keys(c.ourTag)) {
        assert.ok(
          consolidatedHosts.has(taggedHost),
          `OUR_TAGS["${c.id}"] declares host "${taggedHost}" not in caps-spec domains ` +
            `[${c.domains.join(", ")}] — fix the typo or update caps-spec`,
        );
      }
    }
  });

  test("PENDING_ACCOUNT_PROGRAM_IDS roster matches CONSOLIDATED_PATTERNS programs with empty ourTag", () => {
    const empty = CONSOLIDATED_PATTERNS
      .filter((c) => Object.keys(c.ourTag).length === 0)
      .map((c) => c.id)
      .sort();
    const pending = [...PENDING_ACCOUNT_PROGRAM_IDS].sort();
    assert.deepStrictEqual(
      empty,
      pending,
      "programs with empty ourTag must equal PENDING_ACCOUNT_PROGRAM_IDS — keep both in sync",
    );
  });
});
