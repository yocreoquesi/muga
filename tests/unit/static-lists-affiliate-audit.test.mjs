/**
 * MUGA — the affiliate guard, applied to the hand-curated lists (#1263)
 *
 * GATE 1 (tools/rule-ingestion/gates/affiliate-guard.mjs) guards the INGESTION
 * pipeline, and since #1263 it also guards promotion. Neither path is how the
 * `u` entry arrived: somebody typed it into the static list. Nothing has ever
 * re-validated `TRACKING_PARAMS` and `TRACKING_PREFIXES` against the affiliate
 * index, so a hand-written entry of that exact shape has had nothing standing
 * in its way.
 *
 * This file is that check. It is a tripwire, not a fix: the lists are clean
 * today, in both directions, and the point is that they stay clean when
 * somebody adds an entry six months from now.
 *
 * Two directions, because affiliate params arrive in two shapes:
 *
 *   (1) EXACT NAMES  — a param in TRACKING_PARAMS whose name the affiliate
 *       index claims. Stripping it universally deletes creator attribution
 *       on every site the program pays out on. This is #1213.
 *
 *   (2) PREFIXES     — a TRACKING_PREFIXES entry that swallows an attribution
 *       name. More dangerous than (1) because nobody typed the attribution
 *       name at all: `ir_` was written to catch Impact Radius ad-measurement
 *       params, and whether it also catches Impact's ATTRIBUTION params is a
 *       fact about upstream naming that no one here controls.
 *
 * Run with: npm test
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";

import {
  TRACKING_PARAMS,
  TRACKING_PREFIXES,
  AFFILIATE_PATTERNS,
  REDIRECT_NETWORK_PATTERNS,
} from "../../src/lib/affiliates.js";
import {
  buildPreserveIndex,
  STATIC_PRESERVE,
} from "../../tools/rule-ingestion/gates/affiliate-guard.mjs";

const { set: ATTRIBUTION_NAMES, owners: ATTRIBUTION_OWNERS } = buildPreserveIndex(
  AFFILIATE_PATTERNS,
  REDIRECT_NETWORK_PATTERNS,
  STATIC_PRESERVE
);

/**
 * Collisions the project has looked at and decided to keep.
 *
 * EMPTY, and that is the finding: every hand-curated entry is currently clean
 * against the affiliate index. It exists because the alternative, when a future
 * collision is a genuine accepted trade-off, is deleting this test — and a
 * guard whose only escape hatch is removal gets removed.
 *
 * To add an entry, state which program's attribution the entry strips, on which
 * hosts, and why that is acceptable there. "It is probably fine" is not a
 * reason; `getLandingPolicy` first-touch preservation covering the landing page
 * is one, as long as the note says so out loud, because that preservation does
 * not survive past the landing.
 *
 * @type {Map<string, string>} entry → the recorded reason
 */
const ACCEPTED_COLLISIONS = new Map();

const lower = (v) => String(v).toLowerCase();

// ── (1) Exact names ───────────────────────────────────────────────────────────

describe("static lists — no TRACKING_PARAMS entry is affiliate attribution", () => {
  test("every hand-curated param name clears the affiliate index", () => {
    const collisions = TRACKING_PARAMS.filter(
      (p) => ATTRIBUTION_NAMES.has(lower(p)) && !ACCEPTED_COLLISIONS.has(lower(p))
    ).map((p) => {
      const owner = ATTRIBUTION_OWNERS.get(lower(p));
      return `${p} (claimed by ${owner?.id} via ${owner?.source})`;
    });

    assert.deepStrictEqual(
      collisions,
      [],
      "TRACKING_PARAMS strips these on EVERY domain, and the affiliate index says they carry " +
        `creator attribution:\n  ${collisions.join("\n  ")}\n` +
        "This is the #1213 shape: the creator who recommended the link is not paid. " +
        "Remove the entry, or record it in ACCEPTED_COLLISIONS with the reason."
    );
  });
});

// ── (2) Prefixes ──────────────────────────────────────────────────────────────

describe("static lists — no TRACKING_PREFIXES entry swallows an attribution name", () => {
  test("no prefix matches a name the affiliate index claims", () => {
    const collisions = [];
    for (const prefix of TRACKING_PREFIXES) {
      if (ACCEPTED_COLLISIONS.has(lower(prefix))) continue;
      for (const name of ATTRIBUTION_NAMES) {
        if (name.startsWith(lower(prefix))) {
          const owner = ATTRIBUTION_OWNERS.get(name);
          collisions.push(`${prefix} swallows ${name} (${owner?.id} via ${owner?.source})`);
        }
      }
    }

    assert.deepStrictEqual(
      collisions,
      [],
      `A prefix in TRACKING_PREFIXES matches an affiliate-attribution param:\n  ${collisions.join("\n  ")}\n` +
        "A prefix is broader than anyone reading the list can see at a glance, which is why " +
        "it is checked separately. Narrow the prefix, or record it in ACCEPTED_COLLISIONS."
    );
  });

  test("the `ir_` prefix stays clear of Impact Radius attribution", () => {
    // The specific trade-off #1263 asked to have recorded rather than left
    // implicit. `ir_` is in TRACKING_PREFIXES to catch Impact Radius
    // ad-measurement params (ir_adid, ir_campaignid, ir_partnerid), and Impact
    // powers affiliate programs far beyond the ones MUGA declares. It is safe
    // ONLY because Impact happens to name its attribution params without the
    // underscore. That is a fact about someone else's naming, not a decision of
    // ours, so it is pinned here rather than trusted.
    const impact = [...ATTRIBUTION_OWNERS]
      .filter(([, owner]) => owner.id === "impact-radius")
      .map(([name]) => name);

    assert.ok(
      impact.length > 0,
      "impact-radius must still be in REDIRECT_NETWORK_PATTERNS for this pin to mean anything"
    );

    const swallowed = impact.filter((name) => name.startsWith("ir_"));
    assert.deepStrictEqual(
      swallowed,
      [],
      `The blanket "ir_" prefix now strips Impact Radius attribution: ${swallowed.join(", ")}.\n` +
        "Impact powers programs well beyond the ones MUGA declares, and only the click id is " +
        "preserved at landing, which by design does not survive past the landing page. " +
        "Replace the prefix with the explicit ir_ measurement params it was written for."
    );
  });
});

// ── The allowlist must not rot ────────────────────────────────────────────────

describe("static lists — ACCEPTED_COLLISIONS stays honest", () => {
  test("every allowlisted entry still collides and still carries a reason", () => {
    const stale = [];
    for (const [entry, reason] of ACCEPTED_COLLISIONS) {
      if (!reason || reason.trim().length === 0) {
        stale.push(`${entry}: allowlisted with no recorded reason`);
        continue;
      }
      const collidesExactly = ATTRIBUTION_NAMES.has(entry);
      const collidesAsPrefix = [...ATTRIBUTION_NAMES].some((n) => n.startsWith(entry));
      if (!collidesExactly && !collidesAsPrefix) {
        stale.push(`${entry}: no longer collides, so the exemption hides nothing`);
      }
    }

    assert.deepStrictEqual(
      stale,
      [],
      `ACCEPTED_COLLISIONS has entries that no longer earn their place:\n  ${stale.join("\n  ")}\n` +
        "An exemption that exempts nothing is worse than none: it reads as a known hazard " +
        "and trains the next reader to skim the list. Delete it."
    );
  });
});
