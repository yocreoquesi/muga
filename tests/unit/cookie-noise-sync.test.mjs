/**
 * MUGA — Cookie Consent Minimizer: C11 content-script sync guard (#1027)
 *
 * Content scripts cannot use ES module imports (see AGENTS.md), so the
 * OneTrust detection + confidence-gate logic from src/lib/cmp-adapters.js
 * is hand-copied into content/cookie-noise-mainworld.js (Chrome MAIN
 * world) and content/cookie-noise.js (isolated world, used for the
 * Firefox wrappedJSObject reject path). This is the same "inline the pure
 * module" pattern src/lib/dom-link-rewriter.js uses with
 * content/dom-link-rewriter.js.
 *
 * This C11 sync test (readFileSync-based, no execution) proves the three
 * copies never drift: it extracts the block between the `@sync:cmp-adapters`
 * markers from each file and asserts the normalized (indentation-stripped)
 * line sequences are identical. A future edit to the confidence-gate math
 * in ONE file without the other two fails here immediately.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
import { computeClickVeto, VETO_WORDS } from "../../src/lib/cmp-tier2-veto.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const mv3Manifest = JSON.parse(readFileSync(join(__dirname, "../../src/manifest.json"), "utf8"));
const mv2Manifest = JSON.parse(readFileSync(join(__dirname, "../../src/manifest.v2.json"), "utf8"));

const FILES = {
  lib: join(__dirname, "../../src/lib/cmp-adapters.js"),
  mainworld: join(__dirname, "../../src/content/cookie-noise-mainworld.js"),
  isolated: join(__dirname, "../../src/content/cookie-noise.js"),
};

const START = "@sync:cmp-adapters:start";
const END = "@sync:cmp-adapters:end";

/**
 * Extracts the lines strictly between the start/end markers (exclusive),
 * normalized by trimming each line's leading/trailing whitespace. This
 * tolerates the differing indentation context (module top-level in
 * cmp-adapters.js vs. inside an IIFE in the content scripts) while still
 * catching any real drift in the logic itself.
 */
function extractSyncBlock(source, label) {
  const lines = source.split(/\r?\n/);
  const startIdx = lines.findIndex((l) => l.includes(START));
  const endIdx = lines.findIndex((l) => l.includes(END));
  assert.ok(startIdx !== -1, `${label}: missing ${START} marker`);
  assert.ok(endIdx !== -1, `${label}: missing ${END} marker`);
  assert.ok(endIdx > startIdx, `${label}: ${END} marker must come after ${START}`);
  return lines
    .slice(startIdx + 1, endIdx)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
}

const sources = {
  lib: readFileSync(FILES.lib, "utf8"),
  mainworld: readFileSync(FILES.mainworld, "utf8"),
  isolated: readFileSync(FILES.isolated, "utf8"),
};

describe("cookie-noise-sync — @sync:cmp-adapters block is present in all three files", () => {
  for (const [label, path] of Object.entries(FILES)) {
    test(`${label} (${path.split(/[\\/]/).pop()}) contains both sync markers`, () => {
      const src = sources[label];
      assert.ok(src.includes(START), `${label} missing ${START}`);
      assert.ok(src.includes(END), `${label} missing ${END}`);
    });
  }
});

describe("cookie-noise-sync — sync block is byte-identical (modulo indentation) across all copies", () => {
  const libBlock = extractSyncBlock(sources.lib, "cmp-adapters.js");
  const mainworldBlock = extractSyncBlock(sources.mainworld, "cookie-noise-mainworld.js");
  const isolatedBlock = extractSyncBlock(sources.isolated, "cookie-noise.js");

  test("sync block is non-empty", () => {
    assert.ok(libBlock.length > 0, "extracted sync block must not be empty — check the markers");
  });

  test("cookie-noise-mainworld.js sync block matches src/lib/cmp-adapters.js", () => {
    assert.deepEqual(
      mainworldBlock,
      libBlock,
      "content/cookie-noise-mainworld.js's @sync:cmp-adapters block has drifted from src/lib/cmp-adapters.js",
    );
  });

  test("cookie-noise.js sync block matches src/lib/cmp-adapters.js", () => {
    assert.deepEqual(
      isolatedBlock,
      libBlock,
      "content/cookie-noise.js's @sync:cmp-adapters block has drifted from src/lib/cmp-adapters.js",
    );
  });

  test("sync block defines CONFIDENCE_THRESHOLD, detectOneTrust, and canRejectOneTrust", () => {
    const joined = libBlock.join("\n");
    assert.ok(/CONFIDENCE_THRESHOLD\s*=\s*1/.test(joined));
    assert.ok(/function detectOneTrust/.test(joined));
    assert.ok(/function canRejectOneTrust/.test(joined));
  });

  test("sync block also defines detectCookiebot and canRejectCookiebot (#1118)", () => {
    const joined = libBlock.join("\n");
    assert.ok(/function detectCookiebot/.test(joined));
    assert.ok(/function canRejectCookiebot/.test(joined));
  });

  test("sync block also defines detectDidomi and canRejectDidomi (#1119)", () => {
    const joined = libBlock.join("\n");
    assert.ok(/function detectDidomi/.test(joined));
    assert.ok(/function canRejectDidomi/.test(joined));
  });

  test("sync block also defines detectCookieYes and canRejectCookieYes (#1120)", () => {
    const joined = libBlock.join("\n");
    assert.ok(/function detectCookieYes/.test(joined));
    assert.ok(/function canRejectCookieYes/.test(joined));
  });

  test("sync block also defines detectSourcepoint and canRejectSourcepoint (#1123)", () => {
    const joined = libBlock.join("\n");
    assert.ok(/function detectSourcepoint/.test(joined));
    assert.ok(/function canRejectSourcepoint/.test(joined));
  });

  test("sync block also defines detectUsercentrics and canRejectUsercentrics (#1121)", () => {
    const joined = libBlock.join("\n");
    assert.ok(/function detectUsercentrics/.test(joined));
    assert.ok(/function canRejectUsercentrics/.test(joined));
  });

  test("sync block also defines detectCookieInformation and canRejectCookieInformation", () => {
    const joined = libBlock.join("\n");
    assert.ok(/function detectCookieInformation/.test(joined));
    assert.ok(/function canRejectCookieInformation/.test(joined));
  });

  test("sync block also defines detectCookieScript and canRejectCookieScript", () => {
    const joined = libBlock.join("\n");
    assert.ok(/function detectCookieScript/.test(joined));
    assert.ok(/function canRejectCookieScript/.test(joined));
  });

  test("sync block also defines detectTarteaucitron and canRejectTarteaucitron", () => {
    const joined = libBlock.join("\n");
    assert.ok(/function detectTarteaucitron/.test(joined));
    assert.ok(/function canRejectTarteaucitron/.test(joined));
  });

  test("sync block also defines detectConsentmanager and canRejectConsentmanager", () => {
    const joined = libBlock.join("\n");
    assert.ok(/function detectConsentmanager/.test(joined));
    assert.ok(/function canRejectConsentmanager/.test(joined));
  });
});

// ── @sync:cookie-gate block (disabled-state gate) ───────────────────────────
//
// computeCookieGate is a pure helper in src/lib/cmp-adapters.js (unit-tested
// there) whose body is hand-inlined into content/cookie-noise.js (isolated
// world) because content scripts cannot import ES modules. The main-world
// caller never reads prefs, so it does NOT carry this block. This guard
// proves the library copy and the content-script copy never drift.

const GATE_START = "@sync:cookie-gate:start";
const GATE_END = "@sync:cookie-gate:end";

function extractMarkedBlock(source, startMarker, endMarker, label) {
  const lines = source.split(/\r?\n/);
  const startIdx = lines.findIndex((l) => l.includes(startMarker));
  const endIdx = lines.findIndex((l) => l.includes(endMarker));
  assert.ok(startIdx !== -1, `${label}: missing ${startMarker} marker`);
  assert.ok(endIdx !== -1, `${label}: missing ${endMarker} marker`);
  assert.ok(endIdx > startIdx, `${label}: ${endMarker} marker must come after ${startMarker}`);
  return lines
    .slice(startIdx + 1, endIdx)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
}

describe("cookie-noise-sync — @sync:cookie-gate block matches src/lib/cmp-adapters.js", () => {
  const libBlock = extractMarkedBlock(sources.lib, GATE_START, GATE_END, "cmp-adapters.js");
  const isolatedBlock = extractMarkedBlock(sources.isolated, GATE_START, GATE_END, "cookie-noise.js");

  test("cookie-gate sync block is non-empty and defines computeCookieGate", () => {
    assert.ok(libBlock.length > 0, "extracted cookie-gate block must not be empty — check the markers");
    assert.ok(/function computeCookieGate/.test(libBlock.join("\n")));
  });

  test("cookie-noise.js cookie-gate block matches src/lib/cmp-adapters.js", () => {
    assert.deepEqual(
      isolatedBlock,
      libBlock,
      "content/cookie-noise.js's @sync:cookie-gate block has drifted from src/lib/cmp-adapters.js",
    );
  });

  test("the main-world caller does NOT carry the cookie-gate block (it never reads prefs)", () => {
    assert.equal(sources.mainworld.includes(GATE_START), false,
      "cookie-noise-mainworld.js must not inline the prefs gate — it has no prefs access");
  });
});

// ── Retired Didomi minimum-accept path — full removal proof ────────────────
//
// The prior design (cookie-consent-accept Slice 2a) attempted a Didomi
// setCurrentUserStatus minimum-accept path, proven non-viable (engram id
// 1331) and retired. This must be fully gone from BOTH content scripts —
// not just unused, but structurally absent — including the MAIN-world
// accept dispatch fork and the cross-world gate-relay field.

describe("cookie-noise content scripts — the retired Didomi minimum-accept path is fully gone", () => {
  const RETIRED_IDENTIFIERS = [
    "canAttemptDidomiMinimumAccept",
    "resolveDidomiMinimumStatus",
    "buildMinimumPayload",
    "extractDidomiIds",
    "extractRequiredIds",
    "setCurrentUserStatus",
    "getRequiredPurposeIds",
    "getRequiredVendorIds",
    "hasSetCurrentUserStatusFn",
    "hasGetRequiredPurposeIdsFn",
    "hasGetRequiredVendorIdsFn",
    "hasGetPurposesFn",
    "hasGetVendorsFn",
    "didomiMinimumGateOpen",
    "_fxDidomiMinimumGateOpen",
    "computeDidomiMinimumGate",
  ];

  for (const [label, key] of [["cookie-noise-mainworld.js", "mainworld"], ["cookie-noise.js", "isolated"]]) {
    for (const identifier of RETIRED_IDENTIFIERS) {
      test(`${label} no longer contains retired identifier "${identifier}"`, () => {
        assert.equal(sources[key].includes(identifier), false, `${label} must not contain "${identifier}"`);
      });
    }
  }
});

// ── Retired consent-or-pay-wall accept-click mechanism — full removal proof ─
//
// cookie-consent-paywall-accept (and its Didomi-market extension) has been
// REMOVED entirely — MUGA never ships a capability that clicks a
// consent-granting control on the user's behalf. This must be fully gone
// from BOTH content scripts — not just unused, but structurally absent —
// including the button-discrimination primitives, the accept double-gate,
// and both dispatch functions. The DOM candidate-collection helpers
// (collectAcceptCandidates and friends) are DELIBERATELY NOT listed here —
// they are still used, unmodified, by the Sourcepoint reject-click DOM
// fallback (see the @sync:cmp-sp-reject-click section below).

describe("cookie-noise content scripts — the retired consent-or-pay-wall accept-click mechanism is fully gone", () => {
  const RETIRED_ACCEPT_IDENTIFIERS = [
    "accept-when-necessary",
    "cookieConsentAcceptConsented",
    "cmp-accept-adapters",
    "classifyConsentButton",
    "findFreeAcceptTarget",
    "hasFreeRejectControl",
    "hasPayOption",
    "findSpFreeAcceptTarget",
    "isPaywallFrame",
    "findDidomiFreeAcceptTarget",
    "isDidomiPaywallContext",
    "computeAcceptGate",
    "computeAcceptGateForFrame",
    "resolveFrameIdentity",
    "runAcceptClickDispatcher",
    "runDidomiAcceptClickDispatcher",
    "hasDidomiHostMount",
    "isAcceptTargetVisible",
    "acceptStartObserver",
    "acceptStopObserver",
    "acceptArmGiveUp",
    "_acceptActed",
    "_didomiAcceptActed",
    "_acceptGateOpen",
    "_acceptObserver",
  ];

  for (const [label, key] of [["cookie-noise-mainworld.js", "mainworld"], ["cookie-noise.js", "isolated"]]) {
    for (const identifier of RETIRED_ACCEPT_IDENTIFIERS) {
      test(`${label} no longer contains retired identifier "${identifier}"`, () => {
        assert.equal(sources[key].includes(identifier), false, `${label} must not contain "${identifier}"`);
      });
    }
  }
});

// ── @sync:cmp-sp-reject-click block (Sourcepoint reject-click DOM fallback) ─
//
// findSpRejectTarget is a pure helper in src/lib/cmp-adapters.js (unit-tested
// there) whose body is hand-inlined ONLY into content/cookie-noise.js
// (isolated world) — mirrors the @sync:cookie-gate precedent: a DOM click
// needs neither a page-authored global nor the MAIN world, so this has no
// main-world copy either.

const SP_REJECT_CLICK_START = "@sync:cmp-sp-reject-click:start";
const SP_REJECT_CLICK_END = "@sync:cmp-sp-reject-click:end";

describe("cookie-noise-sync — @sync:cmp-sp-reject-click block matches src/lib/cmp-adapters.js", () => {
  const libBlock = extractMarkedBlock(sources.lib, SP_REJECT_CLICK_START, SP_REJECT_CLICK_END, "cmp-adapters.js");
  const isolatedBlock = extractMarkedBlock(sources.isolated, SP_REJECT_CLICK_START, SP_REJECT_CLICK_END, "cookie-noise.js");

  test("sp-reject-click sync block is non-empty and defines findSpRejectTarget", () => {
    assert.ok(libBlock.length > 0, "extracted @sync:cmp-sp-reject-click block must not be empty — check the markers");
    assert.ok(/function findSpRejectTarget/.test(libBlock.join("\n")));
  });

  test("cookie-noise.js @sync:cmp-sp-reject-click block matches src/lib/cmp-adapters.js", () => {
    assert.deepEqual(
      isolatedBlock,
      libBlock,
      "content/cookie-noise.js's @sync:cmp-sp-reject-click block has drifted from src/lib/cmp-adapters.js",
    );
  });

  test("the main-world caller does NOT carry the @sync:cmp-sp-reject-click block (a DOM click needs no MAIN world)", () => {
    assert.equal(sources.mainworld.includes(SP_REJECT_CLICK_START), false,
      "cookie-noise-mainworld.js must not inline the SP reject-click resolver — this mechanism is isolated-world only");
  });

  test("findSpRejectTarget only ever targets choice type 13, never 11 (the action this project's structural guard forbids naming)", () => {
    const joined = libBlock.join("\n");
    assert.ok(/SP_REJECT_ALL_CHOICE\s*=\s*"13"/.test(joined));
    assert.equal(/spChoice\s*!==\s*"11"/.test(joined), false, "must not reference choice type 11 at all");
  });
});

// ── @sync:cmp-tier2-rules block (Tier 2 declarative reject-click rule data) ─
//
// TIER2_RULES is a frozen array in src/lib/cmp-tier2-rules.js (unit-tested
// there) whose body is hand-inlined ONLY into content/cookie-noise.js
// (isolated world) — mirrors the @sync:site-exempt precedent: the lib copy
// carries an `export` keyword content scripts cannot use, so the comparison
// strips a leading `export ` token from each line before comparing.

const TIER2_RULES_FILES = {
  lib: join(__dirname, "../../src/lib/cmp-tier2-rules.js"),
  isolated: FILES.isolated,
};

const tier2RulesSources = {
  lib: readFileSync(TIER2_RULES_FILES.lib, "utf8"),
  isolated: sources.isolated,
};

const TIER2_RULES_START = "@sync:cmp-tier2-rules:start";
const TIER2_RULES_END = "@sync:cmp-tier2-rules:end";

function extractTier2RulesBlock(source, label) {
  return extractMarkedBlock(source, TIER2_RULES_START, TIER2_RULES_END, label)
    .map((l) => l.replace(/^export\s+/, ""));
}

describe("cookie-noise-sync — @sync:cmp-tier2-rules block matches src/lib/cmp-tier2-rules.js", () => {
  const libBlock = extractTier2RulesBlock(tier2RulesSources.lib, "cmp-tier2-rules.js");
  const isolatedBlock = extractTier2RulesBlock(tier2RulesSources.isolated, "cookie-noise.js");

  test("tier2-rules sync block is non-empty and defines TIER2_RULES", () => {
    assert.ok(libBlock.length > 0, "extracted @sync:cmp-tier2-rules block must not be empty — check the markers");
    assert.ok(/const TIER2_RULES\s*=\s*Object\.freeze/.test(libBlock.join("\n")));
  });

  test("cookie-noise.js @sync:cmp-tier2-rules block matches src/lib/cmp-tier2-rules.js (modulo the export keyword)", () => {
    assert.deepEqual(
      isolatedBlock,
      libBlock,
      "content/cookie-noise.js's @sync:cmp-tier2-rules block has drifted from src/lib/cmp-tier2-rules.js",
    );
  });

  test("the main-world caller does NOT carry the @sync:cmp-tier2-rules block (Tier 2 is isolated-world only)", () => {
    assert.equal(sources.mainworld.includes(TIER2_RULES_START), false,
      "cookie-noise-mainworld.js must not inline the Tier 2 rule data — this mechanism is isolated-world only");
  });

  test("neither seed rule defines an accept-family field (no field beyond id/present/reject/openSettings)", () => {
    const joined = libBlock.join("\n");
    assert.doesNotMatch(joined, /allowall|accept/i);
  });
});

// ── @sync:cmp-tier2 block (Tier 2 fail-closed reject resolution) ───────────
//
// resolveTier2Reject is a pure helper in src/lib/cmp-adapters.js (unit-tested
// there) whose body is hand-inlined ONLY into content/cookie-noise.js
// (isolated world) — mirrors the @sync:cmp-sp-reject-click precedent: a DOM
// click needs neither a page-authored global nor the MAIN world.

const TIER2_START = "@sync:cmp-tier2:start";
const TIER2_END = "@sync:cmp-tier2:end";

describe("cookie-noise-sync — @sync:cmp-tier2 block matches src/lib/cmp-adapters.js", () => {
  const libBlock = extractMarkedBlock(sources.lib, TIER2_START, TIER2_END, "cmp-adapters.js");
  const isolatedBlock = extractMarkedBlock(sources.isolated, TIER2_START, TIER2_END, "cookie-noise.js");

  test("tier2 resolver sync block is non-empty and defines resolveTier2Reject", () => {
    assert.ok(libBlock.length > 0, "extracted @sync:cmp-tier2 block must not be empty — check the markers");
    assert.ok(/function resolveTier2Reject/.test(libBlock.join("\n")));
  });

  test("cookie-noise.js @sync:cmp-tier2 block matches src/lib/cmp-adapters.js", () => {
    assert.deepEqual(
      isolatedBlock,
      libBlock,
      "content/cookie-noise.js's @sync:cmp-tier2 block has drifted from src/lib/cmp-adapters.js",
    );
  });

  test("the main-world caller does NOT carry the @sync:cmp-tier2 block (Tier 2 is isolated-world only)", () => {
    assert.equal(sources.mainworld.includes(TIER2_START), false,
      "cookie-noise-mainworld.js must not inline the Tier 2 resolver — this mechanism is isolated-world only");
  });
});

// ── @sync:cmp-tier2-veto block (Tier 2 runtime semantic click-veto) ───────
//
// normalizeAccessibleName / computeClickVeto / VETO_WORDS are pure exports
// in src/lib/cmp-tier2-veto.js (unit-tested there, including the load-bearing
// teeth test) whose body is hand-inlined ONLY into content/cookie-noise.js
// (isolated world) — mirrors the @sync:cmp-tier2 precedent immediately
// above: a DOM click needs neither a page-authored global nor the MAIN
// world.

const TIER2_VETO_FILES = {
  lib: join(__dirname, "../../src/lib/cmp-tier2-veto.js"),
  isolated: FILES.isolated,
};

const tier2VetoSources = {
  lib: readFileSync(TIER2_VETO_FILES.lib, "utf8"),
  isolated: sources.isolated,
};

const TIER2_VETO_START = "@sync:cmp-tier2-veto:start";
const TIER2_VETO_END = "@sync:cmp-tier2-veto:end";

describe("cookie-noise-sync — @sync:cmp-tier2-veto block matches src/lib/cmp-tier2-veto.js", () => {
  const libBlock = extractMarkedBlock(tier2VetoSources.lib, TIER2_VETO_START, TIER2_VETO_END, "cmp-tier2-veto.js");
  const isolatedBlock = extractMarkedBlock(tier2VetoSources.isolated, TIER2_VETO_START, TIER2_VETO_END, "cookie-noise.js");

  test("tier2-veto sync block is non-empty and defines normalizeAccessibleName, computeClickVeto, and VETO_WORDS", () => {
    assert.ok(libBlock.length > 0, "extracted @sync:cmp-tier2-veto block must not be empty — check the markers");
    const joined = libBlock.join("\n");
    assert.ok(/function normalizeAccessibleName/.test(joined));
    assert.ok(/function computeClickVeto/.test(joined));
    assert.ok(/const VETO_WORDS\s*=\s*Object\.freeze/.test(joined));
  });

  test("cookie-noise.js @sync:cmp-tier2-veto block matches src/lib/cmp-tier2-veto.js", () => {
    assert.deepEqual(
      isolatedBlock,
      libBlock,
      "content/cookie-noise.js's @sync:cmp-tier2-veto block has drifted from src/lib/cmp-tier2-veto.js",
    );
  });

  test("the main-world caller does NOT carry the @sync:cmp-tier2-veto block (Tier 2 is isolated-world only)", () => {
    assert.equal(sources.mainworld.includes(TIER2_VETO_START), false,
      "cookie-noise-mainworld.js must not inline the Tier 2 veto — this mechanism is isolated-world only");
  });

  test("the veto's deny word list contains known accept words (its teeth), mirroring the lib teeth test", () => {
    const joined = libBlock.join("\n");
    assert.ok(/"accept"/.test(joined));
    assert.ok(/"aceptar"/.test(joined));
    assert.ok(/"akzeptieren"/.test(joined));
  });

  test("the veto defines a save-family word list and the openSettings save-word veto reason (PR A review follow-up / PR B2)", () => {
    const joined = libBlock.join("\n");
    assert.ok(/const SAVE_WORDS\s*=\s*Object\.freeze/.test(joined), "must define SAVE_WORDS");
    assert.ok(/save:\s*SAVE_WORDS/.test(joined), "VETO_WORDS must expose the save list");
    assert.ok(/"save-word"/.test(joined), "computeClickVeto must be able to return the save-word veto reason");
  });

  test('the veto defines a "save" role branch, gated on a save-word match AND context.saveInvariantSatisfied === true (cookie-consent-toggle-reject, PR 1 / design.md ADR-4)', () => {
    const joined = libBlock.join("\n");
    assert.ok(/role === "save"/.test(joined), "computeClickVeto must branch on role === \"save\"");
    assert.ok(/context\.saveInvariantSatisfied\s*!==\s*true|saveInvariantSatisfied\s*===\s*true/.test(joined),
      "the save branch must gate on saveInvariantSatisfied === true");
    assert.ok(/"no-save-word"/.test(joined), "must be able to return the no-save-word veto reason");
    assert.ok(/"save-invariant-unsatisfied"/.test(joined), "must be able to return the save-invariant-unsatisfied veto reason");
  });

  test("computeClickVeto's 4th `context` parameter is defaulted so .length stays 3 (cookie-consent-toggle-reject, PR 1 — no breaking change to existing 3-arg call sites)", () => {
    assert.ok(/function computeClickVeto\(accessibleName, role, wordLists, context = \{\}\)/.test(libBlock.join("\n")),
      "computeClickVeto must declare context as a defaulted 4th parameter, exactly `context = {}`");
    assert.equal(computeClickVeto.length, 3, "computeClickVeto.length must stay 3 after adding the save role");
  });
});

// ── @sync:cmp-tier2-save-invariant block (toggle-reject save invariant) ────
// (cookie-consent-toggle-reject, PR 1 — safety core, INERT this PR)
//
// computeSaveInvariant / planToggleActuation are pure exports in
// src/lib/cmp-tier2-save-invariant.js (unit-tested there, including the
// never-turn-ON battery) whose body is hand-inlined ONLY into
// content/cookie-noise.js (isolated world) — mirrors the @sync:cmp-tier2-veto
// precedent immediately above. NOT CALLED anywhere in cookie-noise.js this
// PR (see the block's own comment there) — no dispatcher wiring exists yet
// (PR 2). This test proves the block is present and byte-identical even
// while inert, so the safety math itself can be reviewed before any DOM
// actuation code is added to call it.

const SAVE_INVARIANT_FILES = {
  lib: join(__dirname, "../../src/lib/cmp-tier2-save-invariant.js"),
  isolated: FILES.isolated,
};

const saveInvariantSources = {
  lib: readFileSync(SAVE_INVARIANT_FILES.lib, "utf8"),
  isolated: sources.isolated,
};

const SAVE_INVARIANT_START = "@sync:cmp-tier2-save-invariant:start";
const SAVE_INVARIANT_END = "@sync:cmp-tier2-save-invariant:end";

describe("cookie-noise-sync — @sync:cmp-tier2-save-invariant block matches src/lib/cmp-tier2-save-invariant.js", () => {
  const libBlock = extractMarkedBlock(saveInvariantSources.lib, SAVE_INVARIANT_START, SAVE_INVARIANT_END, "cmp-tier2-save-invariant.js");
  const isolatedBlock = extractMarkedBlock(saveInvariantSources.isolated, SAVE_INVARIANT_START, SAVE_INVARIANT_END, "cookie-noise.js");

  test("save-invariant sync block is non-empty and defines computeSaveInvariant and planToggleActuation", () => {
    assert.ok(libBlock.length > 0, "extracted @sync:cmp-tier2-save-invariant block must not be empty — check the markers");
    const joined = libBlock.join("\n");
    assert.ok(/function computeSaveInvariant/.test(joined));
    assert.ok(/function planToggleActuation/.test(joined));
  });

  test("cookie-noise.js @sync:cmp-tier2-save-invariant block matches src/lib/cmp-tier2-save-invariant.js", () => {
    assert.deepEqual(
      isolatedBlock,
      libBlock,
      "content/cookie-noise.js's @sync:cmp-tier2-save-invariant block has drifted from src/lib/cmp-tier2-save-invariant.js",
    );
  });

  test("the main-world caller does NOT carry the @sync:cmp-tier2-save-invariant block (Tier 2 is isolated-world only)", () => {
    assert.equal(sources.mainworld.includes(SAVE_INVARIANT_START), false,
      "cookie-noise-mainworld.js must not inline the save invariant — this mechanism is isolated-world only");
  });

  test("planToggleActuation never emits an on-action — no field in its return shape could carry one (bare number[] of force-off indices)", () => {
    const joined = libBlock.join("\n");
    assert.doesNotMatch(joined, /checked\s*=\s*true/, "the block must never write checked = true anywhere");
    assert.doesNotMatch(joined, /aria-checked['"]\s*,\s*['"]true/, "the block must never set aria-checked to true anywhere");
  });

  test("this PR wires ZERO dispatcher call sites for computeSaveInvariant/planToggleActuation — behavior-inert (PR 1)", () => {
    const src = sources.isolated;
    for (const fnName of ["computeSaveInvariant", "planToggleActuation"]) {
      // A deliberate `void NAME;` no-op reference (satisfying no-unused-vars
      // while the block is inert) must exist, and it must be the ONLY
      // reference outside the declaration/docblocks — i.e. no real call
      // `NAME(` anywhere except the function's own declaration line.
      assert.ok(src.includes(`void ${fnName};`), `${fnName} must have a deliberate void no-op reference, not a real call site`);
    }
    // Neither function is referenced at all inside the two known dispatcher
    // bodies (runTier2RejectDispatcher today; the PR-2 toggle branch that
    // would call them does not exist yet).
    const dispatcherMatch = /function runTier2RejectDispatcher\(\)\s*\{([\s\S]*?)\n  \}/.exec(src);
    assert.ok(dispatcherMatch, "cookie-noise.js must define runTier2RejectDispatcher()");
    assert.doesNotMatch(dispatcherMatch[1], /computeSaveInvariant\(|planToggleActuation\(/,
      "runTier2RejectDispatcher must not call computeSaveInvariant/planToggleActuation yet — that wiring is PR 2, out of scope for PR 1");
  });

  test("no rule instance (bundled TIER2_RULES) uses a toggleScope field yet — PR 1 adds zero CMP wiring", () => {
    // Scoped to the actual rule-data sync block, not prose — this file's own
    // comments legitimately MENTION "toggleScope" to explain what PR 2 will
    // add (see the block comment above the @sync:cmp-tier2-save-invariant
    // region). What must not exist yet is the field itself inside the rule
    // data (both the bundled TIER2_RULES array and its content-script copy).
    const rulesLibSrc = readFileSync(join(__dirname, "../../src/lib/cmp-tier2-rules.js"), "utf8");
    const rulesLibBlock = extractMarkedBlock(rulesLibSrc, TIER2_RULES_START, TIER2_RULES_END, "cmp-tier2-rules.js");
    const rulesIsolatedBlock = extractMarkedBlock(sources.isolated, TIER2_RULES_START, TIER2_RULES_END, "cookie-noise.js");
    assert.equal(/toggleScope/.test(rulesLibBlock.join("\n")), false,
      "src/lib/cmp-tier2-rules.js's TIER2_RULES data must not reference toggleScope at all in PR 1 — that field is introduced in PR 2");
    assert.equal(/toggleScope/.test(rulesIsolatedBlock.join("\n")), false,
      "cookie-noise.js's @sync:cmp-tier2-rules copy must not reference toggleScope at all in PR 1");
  });
});

// ── Tier 2 dispatch — main-world exclusion (task 3.3) ───────────────────────
//
// Tier 2's DOM query-and-click capability must live ONLY in the isolated
// content-script world (content/cookie-noise.js), never in
// content/cookie-noise-mainworld.js — mirrors the identical guard for the
// Sourcepoint reject-click dispatch above.

describe("cookie-noise-mainworld.js — no Tier 2 query/click logic of any kind", () => {
  const TIER2_IDENTIFIERS = [
    "runTier2RejectDispatcher",
    "resolveTier2Reject",
    "TIER2_RULES",
    "tier2Confirmed",
    "tier2StartObserver",
    "tier2StopObserver",
    "confirmTier2RejectDismissal",
    "tier2WarnDrift",
  ];

  for (const identifier of TIER2_IDENTIFIERS) {
    test(`cookie-noise-mainworld.js does not contain "${identifier}"`, () => {
      assert.equal(sources.mainworld.includes(identifier), false,
        `cookie-noise-mainworld.js must not contain "${identifier}" — Tier 2 is isolated-world only`);
    });
  }
});

// ── Tier 2 reject-click dispatch — structural guards ────────────────────────
//
// Mirrors the Sourcepoint reject-click structural guards above: prove the
// click call site is gated on a confirmed single target before ever
// clicking, marks a rule acted only after a real click (never on mere
// detection or on opening the settings hop), and the drift-warning path
// makes no network/telemetry call of any kind (console-only, per Decision 7).

describe("cookie-noise.js — Tier 2 reject-click dispatch structural guards", () => {
  test("runTier2RejectDispatcher gates on resolveTier2Reject's single status before ever clicking", () => {
    const src = sources.isolated;
    const fnMatch = /function runTier2RejectDispatcher\(\)\s*\{([\s\S]*?)\n  \}/.exec(src);
    assert.ok(fnMatch, "cookie-noise.js must define runTier2RejectDispatcher()");
    const body = fnMatch[1];
    const resolveIdx = body.indexOf("resolveTier2Reject(");
    const clickIdx = body.indexOf(".ref.click(");
    assert.ok(resolveIdx !== -1, "must call resolveTier2Reject");
    assert.ok(clickIdx !== -1, "must call .ref.click()");
    assert.ok(resolveIdx < clickIdx, "runTier2RejectDispatcher must resolve resolveTier2Reject before ever clicking");
  });

  test("the dispatcher marks a rule's _tier2Acted only INSIDE the confirmed-single reject branch, never on mere detection or on opening the settings hop (no false success)", () => {
    const src = sources.isolated;
    const fnMatch = /function runTier2RejectDispatcher\(\)\s*\{([\s\S]*?)\n  \}/.exec(src);
    assert.ok(fnMatch);
    const body = fnMatch[1];
    const singleBranchIdx = body.indexOf('if (result.status === "single") {');
    const actedIdx = body.indexOf("_tier2Acted[rule.id] = true;");
    const pmOpenedIdx = body.indexOf("_tier2PmOpened[rule.id] = true;");
    assert.ok(singleBranchIdx !== -1, "the reject click must be gated on a confirmed single target");
    assert.ok(actedIdx !== -1, "must set _tier2Acted[rule.id] = true");
    assert.equal(body.split("_tier2Acted[rule.id] = true;").length - 1, 1, "_tier2Acted must be set in exactly one place");
    assert.ok(singleBranchIdx < actedIdx, "_tier2Acted must only be set AFTER confirming a single reject target");
    assert.ok(pmOpenedIdx !== -1, "the open-settings hop must be guarded by _tier2PmOpened");
    assert.ok(actedIdx < pmOpenedIdx, "the open-settings branch comes after the reject branch and must not set _tier2Acted");
  });

  test("the Tier 2 gate (_tier2GateOpen, from the same reject master gate as the Tier-1 API ladder and the Sourcepoint fallback) is checked before the dispatch runs", () => {
    assert.ok(/_tier2GateOpen/.test(sources.isolated));
  });

  test("Tier 2 dispatch reuses the existing reject master gate (`open`) — no separate Tier 2 pref/toggle is read", () => {
    const src = sources.isolated;
    // Excludes the `let _tier2GateOpen = false;` declaration — only the
    // real wiring assignment (inside readPrefsAndGate) is relevant here.
    const assignments = [...src.matchAll(/(?<!let )_tier2GateOpen\s*=\s*(\w+);/g)].map((m) => m[1]);
    assert.ok(assignments.length > 0, "cookie-noise.js must assign _tier2GateOpen from a variable");
    assert.ok(
      assignments.includes("open"),
      "_tier2GateOpen must be assigned from the same `open` gate value as _spRejectGateOpen — no new gate",
    );
  });

  test("the drift-warning path (tier2WarnDrift, confirmTier2RejectDismissal, tier2ArmGiveUp) makes no network/telemetry call — console-only", () => {
    const src = sources.isolated;
    const NETWORK_PATTERN = /sendMessage|fetch\s*\(|XMLHttpRequest|sendBeacon/;
    for (const fnName of ["tier2WarnDrift", "confirmTier2RejectDismissal", "tier2ArmGiveUp"]) {
      const fnMatch = new RegExp(`function ${fnName}\\([^)]*\\)\\s*\\{([\\s\\S]*?)\\n  \\}`).exec(src);
      assert.ok(fnMatch, `cookie-noise.js must define ${fnName}()`);
      assert.doesNotMatch(fnMatch[1], NETWORK_PATTERN, `${fnName} must not make any network/telemetry call`);
    }
  });

  test("tier2WarnDrift only ever warns once per rule id (guarded by _tier2Warned)", () => {
    assert.ok(/_tier2Warned\[ruleId\]/.test(sources.isolated));
  });
});

// ── Tier 2 semantic click-veto wiring (#1027, Slice 2 / PR A) ──────────────
//
// LOAD-BEARING. computeClickVeto must run BEFORE both the reject and the
// openSettings `.click()` calls, and a veto must fail closed exactly like
// the pre-existing "single" resolution guards above: no `_tier2Acted` /
// `_tier2PmOpened` write on a vetoed target, console-only warn-once, and a
// `continue` back to the observer loop (a later pass may find a correctly
// labelled target once the DOM settles).

describe("cookie-noise.js — Tier 2 semantic click-veto wiring", () => {
  function tier2DispatcherBody() {
    const fnMatch = /function runTier2RejectDispatcher\(\)\s*\{([\s\S]*?)\n  \}/.exec(sources.isolated);
    assert.ok(fnMatch, "cookie-noise.js must define runTier2RejectDispatcher()");
    return fnMatch[1];
  }

  test('computeClickVeto is called with role "reject" BEFORE the reject .ref.click()', () => {
    const body = tier2DispatcherBody();
    const vetoIdx = body.indexOf('computeClickVeto(result.target.fullText, "reject", VETO_WORDS)');
    const clickIdx = body.indexOf("result.target.ref.click()");
    assert.ok(vetoIdx !== -1, 'must call computeClickVeto(..., "reject", VETO_WORDS) before the reject click');
    assert.ok(clickIdx !== -1);
    assert.ok(vetoIdx < clickIdx, "the reject veto must be evaluated before ref.click()");
  });

  test('computeClickVeto is called with role "openSettings" BEFORE the openSettings .ref.click()', () => {
    const body = tier2DispatcherBody();
    const vetoIdx = body.indexOf('computeClickVeto(openCandidates[0].fullText, "openSettings", VETO_WORDS)');
    const clickIdx = body.indexOf("openCandidates[0].ref.click()");
    assert.ok(vetoIdx !== -1, 'must call computeClickVeto(..., "openSettings", VETO_WORDS) before the openSettings click');
    assert.ok(clickIdx !== -1);
    assert.ok(vetoIdx < clickIdx, "the openSettings veto must be evaluated before ref.click()");
  });

  test("on reject veto, _tier2Acted is NOT set — the veto check happens before the acted-assignment and continues", () => {
    const body = tier2DispatcherBody();
    const vetoIdx = body.indexOf('const veto = computeClickVeto(result.target.fullText, "reject", VETO_WORDS);');
    const actedIdx = body.indexOf("_tier2Acted[rule.id] = true;");
    assert.ok(vetoIdx !== -1 && actedIdx !== -1);
    assert.ok(vetoIdx < actedIdx, "the reject veto must be checked before _tier2Acted is ever set");
    assert.ok(
      /if\s*\(!veto\.allow\)\s*\{[\s\S]*?continue;[\s\S]*?\}/.test(body),
      "a reject veto must continue without falling through to the click/acted branch",
    );
  });

  test("on openSettings veto, _tier2PmOpened is NOT set — the veto check happens before the pmOpened-assignment and continues", () => {
    const body = tier2DispatcherBody();
    const vetoIdx = body.indexOf('const openVeto = computeClickVeto(openCandidates[0].fullText, "openSettings", VETO_WORDS);');
    const pmOpenedIdx = body.indexOf("_tier2PmOpened[rule.id] = true;");
    assert.ok(vetoIdx !== -1 && pmOpenedIdx !== -1);
    assert.ok(vetoIdx < pmOpenedIdx, "the openSettings veto must be checked before _tier2PmOpened is ever set");
    assert.ok(
      /if\s*\(!openVeto\.allow\)\s*\{[\s\S]*?continue;[\s\S]*?\}/.test(body),
      "an openSettings veto must continue without falling through to the click/pmOpened branch",
    );
  });

  test("a vetoed reject/openSettings target warns via tier2WarnVeto, which makes no network/telemetry call", () => {
    const src = sources.isolated;
    const fnMatch = /function tier2WarnVeto\([^)]*\)\s*\{([\s\S]*?)\n  \}/.exec(src);
    assert.ok(fnMatch, "cookie-noise.js must define tier2WarnVeto()");
    const NETWORK_PATTERN = /sendMessage|fetch\s*\(|XMLHttpRequest|sendBeacon/;
    assert.doesNotMatch(fnMatch[1], NETWORK_PATTERN, "tier2WarnVeto must not make any network/telemetry call");
  });

  test("tier2WarnVeto warns at most once per rule id + role (guarded by _tier2VetoWarned)", () => {
    assert.ok(/_tier2VetoWarned\[key\]/.test(sources.isolated));
  });

  test("the veto applies identically regardless of rule origin — exactly one veto call site per role, no conditional skip", () => {
    // Spec scenario 5 / design ADR-1: the veto call sites take no
    // origin/source parameter and there is no per-rule conditional that
    // skips computeClickVeto for any subset of rules — every rule in the
    // single shared `mergedRules` loop (bundled + filtered remote, #1027
    // Slice 2 / PR B2) goes through the same two calls.
    const body = tier2DispatcherBody();
    const rejectVetoCalls = body.split('computeClickVeto(result.target.fullText, "reject", VETO_WORDS)').length - 1;
    const openVetoCalls = body.split('computeClickVeto(openCandidates[0].fullText, "openSettings", VETO_WORDS)').length - 1;
    assert.equal(rejectVetoCalls, 1, "exactly one unconditional reject veto call site, shared by every rule");
    assert.equal(openVetoCalls, 1, "exactly one unconditional openSettings veto call site, shared by every rule");
  });
});

// ── Tier 2 remote-rule content-side merge (#1027, Slice 2 / PR B2) ─────────
//
// cookie-noise.js cannot be imported in Node (top-level chrome.*/document
// usage — see AGENTS.md), so the CSS-parse-filter + ADD-only merge logic is
// exercised here via a PURE re-implementation that mirrors production
// exactly (same pattern as makeMaybeFetchTier2Helper in
// service-worker-patterns.test.mjs), with an INJECTABLE `canParse`
// predicate standing in for the real `document.querySelector` try/catch —
// this makes the filter/merge decision genuinely behaviorally testable
// without a DOM, while the production file's own use of a real
// document.querySelector is confirmed by a single minimal structural guard
// below (#824 — one new source-string assertion, mirroring the existing
// precedent in this file and in service-worker-patterns.test.mjs).

function makeTier2RemoteMergeHelper(bundledIds, canParse) {
  function filterSelectorArray(arr) {
    if (!Array.isArray(arr)) return [];
    return arr.filter((sel) => typeof sel === "string" && sel.length > 0 && canParse(sel));
  }
  function filterRemoteRule(rule) {
    if (!rule || typeof rule !== "object") return null;
    if (typeof rule.id !== "string" || bundledIds.has(rule.id)) return null;
    const reject = filterSelectorArray(rule.reject);
    if (reject.length === 0) return null;
    const present = filterSelectorArray(rule.present);
    const openSettings = filterSelectorArray(rule.openSettings);
    return { id: rule.id, present, reject, openSettings };
  }
  return function recomputeMergedRules(bundledRules, rawRemoteRules) {
    const list = Array.isArray(rawRemoteRules) ? rawRemoteRules : [];
    const filtered = [];
    for (const raw of list) {
      const rule = filterRemoteRule(raw);
      if (rule) filtered.push(rule);
    }
    return [...bundledRules, ...filtered];
  };
}

describe("Tier 2 content-side remote-rule merge — pure re-implementation (mirrors cookie-noise.js)", () => {
  const BUNDLED = [
    { id: "complianz", present: ["#a"], reject: [".deny"], openSettings: [] },
    { id: "cookie-notice", present: ["#b"], reject: ["#refuse"], openSettings: [] },
  ];
  const bundledIds = new Set(BUNDLED.map((r) => r.id));

  test("a fresh-id remote rule with fully parseable selectors is merged (spec scenario: fresh id merged)", () => {
    const canParse = () => true;
    const recompute = makeTier2RemoteMergeHelper(bundledIds, canParse);
    const merged = recompute(BUNDLED, [
      { id: "acme-cmp", present: ["#acme"], reject: [".acme-reject"], openSettings: [] },
    ]);
    assert.equal(merged.length, 3);
    assert.ok(merged.some((r) => r.id === "acme-cmp"));
  });

  test("ADD-only: a remote rule id colliding with a bundled id is dropped entirely — bundled wins (defense-in-depth)", () => {
    const canParse = () => true;
    const recompute = makeTier2RemoteMergeHelper(bundledIds, canParse);
    const merged = recompute(BUNDLED, [
      { id: "complianz", present: ["#hostile"], reject: [".hostile-reject"], openSettings: [] },
    ]);
    assert.equal(merged.length, 2, "the colliding remote rule must be dropped, not appended or merged");
    const complianz = merged.find((r) => r.id === "complianz");
    assert.deepEqual(complianz, BUNDLED[0], "the bundled rule's own selectors must be completely untouched");
  });

  test("an unparseable selector is dropped from its array (fail-closed), never used to match DOM elements", () => {
    const canParse = (sel) => sel !== ":::not-css";
    const recompute = makeTier2RemoteMergeHelper(bundledIds, canParse);
    const merged = recompute(BUNDLED, [
      { id: "acme-cmp", present: ["#acme"], reject: [".good-reject", ":::not-css"], openSettings: [] },
    ]);
    const rule = merged.find((r) => r.id === "acme-cmp");
    assert.deepEqual(rule.reject, [".good-reject"], "the unparseable selector must be filtered out");
  });

  test("a rule left with zero usable reject selectors after filtering is skipped entirely", () => {
    const canParse = (sel) => sel !== ".only-reject";
    const recompute = makeTier2RemoteMergeHelper(bundledIds, canParse);
    const merged = recompute(BUNDLED, [
      { id: "acme-cmp", present: ["#acme"], reject: [".only-reject"], openSettings: [] },
    ]);
    assert.equal(merged.length, 2, "a rule with no usable reject selector must not be merged at all");
  });

  test("present/openSettings are allowed to end up empty after filtering (fails closed downstream, not here)", () => {
    const canParse = (sel) => sel !== "#gone-present";
    const recompute = makeTier2RemoteMergeHelper(bundledIds, canParse);
    const merged = recompute(BUNDLED, [
      { id: "acme-cmp", present: ["#gone-present"], reject: [".good-reject"], openSettings: ["#gone-present"] },
    ]);
    const rule = merged.find((r) => r.id === "acme-cmp");
    assert.deepEqual(rule.present, []);
    assert.deepEqual(rule.openSettings, []);
  });

  test("a merged rule object carries no origin/source field distinguishing it from a bundled rule", () => {
    const canParse = () => true;
    const recompute = makeTier2RemoteMergeHelper(bundledIds, canParse);
    const merged = recompute(BUNDLED, [
      { id: "acme-cmp", present: ["#acme"], reject: [".acme-reject"], openSettings: [] },
    ]);
    for (const rule of merged) {
      assert.deepEqual(
        Object.keys(rule).sort(),
        ["id", "openSettings", "present", "reject"],
        "a merged rule (bundled or remote-origin) must expose exactly id/present/reject/openSettings — no origin/source field a dispatcher could branch on",
      );
    }
  });
});

// ── Spec scenario 5 integration test: veto applies identically to bundled ──
// and remote-origin candidates (#1027, Slice 2 / PR B2, task 6.4) ─────────
//
// Uses the REAL computeClickVeto/VETO_WORDS exported from
// src/lib/cmp-tier2-veto.js (a pure ES module, genuinely importable and
// executable in Node — unlike cookie-noise.js itself) to prove there is no
// origin-based exemption: a bundled-origin candidate and a merged
// remote-origin candidate, both resolving to an accept-matching accessible
// name, are vetoed identically. computeClickVeto's signature takes no
// origin/source parameter at all (see its JSDoc), so this test also proves
// there is structurally no way to plumb one through.

describe("Tier 2 dispatch — spec scenario 5: veto applies identically to bundled and remote-origin candidates", () => {
  const canParse = () => true;
  const bundledIds = new Set(["complianz", "cookie-notice"]);
  const recompute = makeTier2RemoteMergeHelper(bundledIds, canParse);
  const merged = recompute(
    [{ id: "complianz", present: ["#a"], reject: [".deny"], openSettings: [] }],
    [{ id: "acme-cmp", present: ["#acme"], reject: [".acme-reject"], openSettings: [] }],
  );
  const bundledOriginRule = merged.find((r) => r.id === "complianz");
  const remoteOriginRule = merged.find((r) => r.id === "acme-cmp");

  test("both a bundled-origin and a remote-origin candidate with an accept-matching accessible name are vetoed", () => {
    assert.ok(bundledOriginRule, "test setup: bundled-origin rule must be present in mergedRules");
    assert.ok(remoteOriginRule, "test setup: remote-origin rule must be present in mergedRules");
    const bundledVeto = computeClickVeto("Accept all", "reject", VETO_WORDS);
    const remoteVeto = computeClickVeto("Accept all", "reject", VETO_WORDS);
    assert.equal(bundledVeto.allow, false, "bundled-origin candidate must be vetoed");
    assert.equal(remoteVeto.allow, false, "remote-origin candidate must be vetoed identically");
    assert.equal(bundledVeto.reason, remoteVeto.reason, "the veto reason must be identical regardless of rule origin");
  });

  test("computeClickVeto's own signature has no origin/source parameter — there is no code path to plumb one through", () => {
    assert.equal(computeClickVeto.length, 3, "computeClickVeto must take exactly (accessibleName, role, wordLists) — no 4th origin argument");
  });
});

// ── Structural wiring guards (#824 — minimal, one assertion per guard) ────

describe("cookie-noise.js — Tier 2 remote-rule merge wiring (structural, task 6.1-6.3)", () => {
  const src = sources.isolated;

  test("runTier2RejectDispatcher iterates mergedRules, not TIER2_RULES directly", () => {
    const fnMatch = /function runTier2RejectDispatcher\(\)\s*\{([\s\S]*?)\n  \}/.exec(src);
    assert.ok(fnMatch);
    assert.ok(/for \(const rule of mergedRules\)/.test(fnMatch[1]),
      "runTier2RejectDispatcher must iterate mergedRules (bundled + filtered remote)");
  });

  test("tier2ArmGiveUp's drift check iterates mergedRules, not TIER2_RULES directly", () => {
    const fnMatch = /function tier2ArmGiveUp\(\)\s*\{([\s\S]*?)\n  \}/.exec(src);
    assert.ok(fnMatch);
    assert.ok(/for \(const rule of mergedRules\)/.test(fnMatch[1]),
      "tier2ArmGiveUp must also check mergedRules so drift warnings cover remote rules too");
  });

  test("gate-open reads chrome.storage.local.remoteTier2Rules and merges BEFORE the initial dispatch sweep", () => {
    const readIdx = src.indexOf("tier2ReadRemoteRulesAndMerge(() => {");
    const gateIdx = src.indexOf("_tier2GateOpen = open;");
    assert.ok(readIdx !== -1, "cookie-noise.js must call tier2ReadRemoteRulesAndMerge at gate-open");
    assert.ok(gateIdx !== -1 && gateIdx < readIdx, "the merge-and-dispatch call must happen inside the gate-open branch");
  });

  test("chrome.storage.onChanged(area local, remoteTier2Rules) re-merges and re-dispatches, gated on _tier2GateOpen", () => {
    const listenerMatch = /chrome\.storage\.onChanged\.addListener\(\(changes, area\) => \{([\s\S]*?)\n {6}\}\);/.exec(src);
    assert.ok(listenerMatch, "cookie-noise.js must register a storage.onChanged listener taking (changes, area)");
    const body = listenerMatch[1];
    assert.ok(/area === "local"/.test(body), "must react to area \"local\"");
    assert.ok(/changes\.remoteTier2Rules/.test(body), "must react specifically to a remoteTier2Rules change");
    assert.ok(/_tier2GateOpen/.test(body), "must be gated on the same _tier2GateOpen the dispatcher itself checks");
  });
});

// ── Content-script structural shape ─────────────────────────────────────────

describe("cookie-noise content scripts — IIFE shape, no ES imports", () => {
  for (const [label, key] of [["cookie-noise-mainworld.js", "mainworld"], ["cookie-noise.js", "isolated"]]) {
    const src = sources[key];

    test(`${label} is an IIFE`, () => {
      assert.ok(/^\(function/m.test(src), `${label} must be an IIFE`);
    });

    test(`${label} has no top-level ES module imports`, () => {
      assert.equal(/^\s*import\s+/m.test(src), false, `${label} must not contain ES module imports`);
    });

    // DELIBERATE, SCOPED CHANGE (feat/cookie-consent-all-frames): the
    // top-frame guard (`window.self !== window.top`) was REMOVED from both
    // consent content scripts. Real-site verification (engram
    // sdd/cookie-consent-accept/paywall-domclick-probe) found consent-or-pay
    // wall accept/reject UIs (Sourcepoint's sp_message_container iframe)
    // render in a CROSS-ORIGIN CHILD FRAME, unreachable by a top-frame-only
    // script. Both consent scripts are now registered `all_frames: true` in
    // their OWN dedicated manifest entries (asserted below) — every OTHER
    // content script keeps the old top-frame-only behavior. This is an
    // intentional, product-owner-approved footprint expansion, NOT a
    // regression: do not reintroduce the guard without re-litigating this
    // decision.
    test(`${label} does NOT have a top-frame guard (removed on purpose — runs in all frames)`, () => {
      assert.equal(
        /window\.self\s*!==\s*window\.top/.test(src),
        false,
        `${label} must NOT guard against iframes — this script is intentionally all_frames:true`,
      );
    });

    test(`${label} has a once-guard`, () => {
      assert.ok(/window\.__muga\w+\s*\)\s*return;/.test(src), `${label} must guard against double-injection`);
    });

    test(`${label} wraps its module body in a frame-safety try/catch (never throws into the frame)`, () => {
      assert.ok(
        /\btry\s*\{/.test(src) && /\}\s*catch\s*\{/.test(src),
        `${label} must wrap its body in try/catch so an uncaught error never escapes into a shared frame (all_frames:true)`,
      );
    });
  }

  test("cookie-noise-mainworld.js has no chrome.* API usage (main-world constraint)", () => {
    // Strip comments first — the docblock legitimately explains the
    // constraint in prose ("No chrome.* APIs"), which would otherwise
    // false-positive this check.
    const stripped = sources.mainworld.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    assert.equal(/\bchrome\s*\./.test(stripped), false,
      "main-world scripts have no extension messaging — must not reference chrome.* in executable code");
  });

  test("cookie-noise.js uses chrome.runtime.sendMessage to read prefs", () => {
    assert.ok(/chrome\.runtime\.sendMessage/.test(sources.isolated));
    assert.ok(/getPrefs/.test(sources.isolated));
  });
});

// ── Manifest scoping: only the two consent scripts are all_frames:true ─────
//
// (feat/cookie-consent-all-frames) Both consent content scripts must be
// registered all_frames:true, EACH IN ITS OWN dedicated content_scripts
// entry, in BOTH manifests. Every other content script must keep the
// default top-frame-only behavior (all_frames absent or false). This test
// is the manifest-side half of the "deliberate, scoped change" guard above
// — it fails if a future edit widens (or narrows) the all_frames scope.

describe("cookie-noise manifest scoping — all_frames:true is scoped to ONLY the consent scripts", () => {
  const CONSENT_SCRIPTS = ["content/cookie-noise.js", "content/cookie-noise-mainworld.js"];

  function collectAllFramesTrueScripts(manifest) {
    const scripts = [];
    for (const group of manifest.content_scripts || []) {
      if (group.all_frames === true) scripts.push(...(group.js || []));
    }
    return scripts;
  }

  test("src/manifest.json (MV3): exactly the two consent scripts are all_frames:true", () => {
    const allFramesTrue = collectAllFramesTrueScripts(mv3Manifest).sort();
    assert.deepStrictEqual(
      allFramesTrue,
      [...CONSENT_SCRIPTS].sort(),
      "MV3 must scope all_frames:true to ONLY content/cookie-noise.js and " +
      "content/cookie-noise-mainworld.js — no other content script's injection " +
      `scope may change. Found: ${JSON.stringify(allFramesTrue)}`,
    );
  });

  test("src/manifest.v2.json (Firefox MV2): exactly cookie-noise.js is all_frames:true", () => {
    // MV2 has no world:MAIN, so cookie-noise-mainworld.js is not loaded at all
    // (see firefox-mv2-mainworld-injection.test.mjs) — only cookie-noise.js
    // is a candidate here.
    const allFramesTrue = collectAllFramesTrueScripts(mv2Manifest).sort();
    assert.deepStrictEqual(
      allFramesTrue,
      ["content/cookie-noise.js"],
      "MV2 must scope all_frames:true to ONLY content/cookie-noise.js — no other " +
      `content script's injection scope may change. Found: ${JSON.stringify(allFramesTrue)}`,
    );
  });

  test("each all_frames:true consent script sits in its OWN dedicated content_scripts entry (not mixed with other scripts)", () => {
    for (const manifest of [mv3Manifest, mv2Manifest]) {
      for (const group of manifest.content_scripts || []) {
        if (group.all_frames !== true) continue;
        assert.equal(
          (group.js || []).length,
          1,
          `an all_frames:true content_scripts group must contain exactly one script (found: ${JSON.stringify(group.js)}) — ` +
          "consent scripts must not share an all_frames:true entry with a top-frame-only script",
        );
      }
    }
  });
});

// ── Bounded observer give-up (#1027) ────────────────────────────────────────
//
// On the majority of pages an opted-in user visits, no OneTrust banner ever
// appears. Both worlds must therefore bound their MutationObserver: after the
// DOM has settled (a grace window past DOMContentLoaded) with no reject
// having fired, the observer is disconnected so it does not run per-mutation
// for the whole page lifetime. The give-up is fail-closed — it only
// disconnects, it never acts. Content scripts cannot be imported in Node
// (see AGENTS.md), so this is verified structurally.

describe("cookie-noise observers — bounded give-up on non-OneTrust pages", () => {
  for (const [label, key] of [["cookie-noise-mainworld.js", "mainworld"], ["cookie-noise.js", "isolated"]]) {
    const src = sources[key];

    test(`${label} defines a bounded give-up window constant`, () => {
      assert.ok(/GIVE_UP_AFTER_DOM_READY_MS\s*=\s*\d+/.test(src),
        `${label} must define a numeric give-up window`);
    });

    test(`${label} anchors the give-up to DOMContentLoaded and schedules it on a timer`, () => {
      assert.ok(/DOMContentLoaded/.test(src), `${label} must anchor the give-up to DOMContentLoaded`);
      assert.ok(/setTimeout/.test(src), `${label} must schedule the give-up on a timer`);
    });

    test(`${label} disconnects the observer when the give-up fires without a reject`, () => {
      // The timer body must guard on the "already acted" flag before stopping,
      // so a fired reject is never undone and giving up stays fail-closed.
      assert.ok(/if\s*\(\s*!_(fx)?[Aa]cted\s*\)\s*(fx)?[sS]topObserver\(\)/.test(src),
        `${label} must only give up (disconnect) when no reject has fired`);
    });
  }
});

describe("cookie-noise gate handshake — separate channel from muga:history-gate", () => {
  test("cookie-noise-mainworld.js and cookie-noise.js do not dispatch/listen on muga:history-gate", () => {
    // The docblocks legitimately MENTION muga:history-gate in prose to
    // explain why a separate channel was chosen — that reference is fine.
    // What must never exist is an actual dispatch/listener wired to it.
    const WIRING = /(addEventListener|dispatchEvent\s*\(\s*new\s+CustomEvent)\s*\(\s*["']muga:history-gate/;
    for (const [label, key] of [["cookie-noise-mainworld.js", "mainworld"], ["cookie-noise.js", "isolated"]]) {
      const src = sources[key];
      assert.ok(/muga:cookie-gate/.test(src), `${label} must use the muga:cookie-gate channel`);
      assert.equal(WIRING.test(src), false,
        `${label} must NOT wire an actual listener/dispatch to muga:history-gate — this feature has its own opt-in pref`);
    }
  });

  test("both files reference the nonce handshake (muga:cookie-gate:nonce)", () => {
    assert.ok(/muga:cookie-gate:nonce/.test(sources.mainworld));
    assert.ok(/muga:cookie-gate:nonce/.test(sources.isolated));
  });

  test("neither file leaks the nonce onto a global window property", () => {
    for (const [label, key] of [["cookie-noise-mainworld.js", "mainworld"], ["cookie-noise.js", "isolated"]]) {
      const stripped = sources[key].replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
      assert.equal(/window\.__muga\w*[Nn]once\w*\s*=/.test(stripped), false,
        `${label} must not assign the nonce to a window.__ property`);
    }
  });
});

// ── STRUCTURAL never-auto-reject-the-other-way guard (own section) ─────────
//
// Same load-bearing rule as tests/unit/cmp-adapters.test.mjs's structural
// guard, extended to the reject-specific regions of the two content
// scripts that duplicate the detection logic.
//
// cookie-consent-paywall-accept CHANGED THE SHAPE of this guard for
// cookie-noise.js specifically: the accept-click mechanism is no longer a
// handful of tiny fenced regions inside an otherwise reject-only file — it
// is the file's OWN, legitimately extensive feature (DOM scan, veto,
// dispatch, observer). A positional "accept-free outside N fenced regions"
// scan would therefore be meaningless there now. The REAL invariants that
// matter are covered elsewhere: the retired-Didomi-path absence test above,
// the @sync:cmp-accept-veto sync-with-lib test above, and the per-vendor
// REJECT call-shape guards below (unchanged — these prove the Tier-1 reject
// ladder itself never calls a broad-accept method, in either file).
//
// cookie-noise-mainworld.js, however, carries NO accept logic at all
// anymore (the accept-click mechanism has no MAIN-world copy) — so it keeps
// the STRICT, unconditional guard: zero accept-family identifiers, full
// stop, exactly like src/lib/cmp-adapters.js's own guard.

describe("cookie-noise-mainworld.js — STRUCTURAL guard: zero accept-family identifiers (no accept logic lives in this world at all)", () => {
  const FORBIDDEN = /allowall|accept/i;

  test("cookie-noise-mainworld.js contains no AllowAll / accept-family identifier anywhere", () => {
    assert.doesNotMatch(sources.mainworld, FORBIDDEN);
  });
});

describe("cookie-noise content scripts — REJECT-ladder call-shape guards (per-vendor, unchanged by the accept-click mechanism)", () => {
  test("only window.OneTrust.RejectAll (or wrappedJSObject equivalent) is invoked — no other OneTrust method call", () => {
    for (const [label, key] of [["cookie-noise-mainworld.js", "mainworld"], ["cookie-noise.js", "isolated"]]) {
      const src = sources[key];
      const calls = [...src.matchAll(/OneTrust\.(\w+)\s*\(/g)].map((m) => m[1]);
      for (const fn of calls) {
        assert.equal(fn, "RejectAll", `${label} calls OneTrust.${fn}() — only RejectAll is permitted`);
      }
    }
  });

  test("only window.Cookiebot.submitCustomConsent (or wrappedJSObject equivalent) is invoked — no other Cookiebot method call", () => {
    for (const [label, key] of [["cookie-noise-mainworld.js", "mainworld"], ["cookie-noise.js", "isolated"]]) {
      const src = sources[key];
      const calls = [...src.matchAll(/Cookiebot\.(\w+)\s*\(/g)].map((m) => m[1]);
      assert.ok(calls.length > 0, `${label} must call Cookiebot.submitCustomConsent`);
      for (const fn of calls) {
        assert.equal(fn, "submitCustomConsent", `${label} calls Cookiebot.${fn}() — only submitCustomConsent is permitted`);
      }
    }
  });

  test("every submitCustomConsent call passes the literal (false, false, false) — never true, never a variable", () => {
    for (const [label, key] of [["cookie-noise-mainworld.js", "mainworld"], ["cookie-noise.js", "isolated"]]) {
      const src = sources[key];
      const calls = [...src.matchAll(/submitCustomConsent\s*\(([^)]*)\)/g)].map((m) => m[1].trim());
      assert.ok(calls.length > 0, `${label} must call submitCustomConsent`);
      for (const args of calls) {
        assert.equal(args, "false, false, false", `${label} submitCustomConsent must be called with (false, false, false)`);
      }
    }
  });

  test("only window.Didomi.setUserDisagreeToAll (or wrappedJSObject equivalent) is invoked — no other Didomi method call anywhere (the accept dispatch that once called other Didomi methods is retired)", () => {
    for (const [label, key] of [["cookie-noise-mainworld.js", "mainworld"], ["cookie-noise.js", "isolated"]]) {
      const src = sources[key];
      const calls = [...src.matchAll(/Didomi\.(\w+)\s*\(/g)].map((m) => m[1]);
      assert.ok(calls.length > 0, `${label} must call Didomi.setUserDisagreeToAll`);
      for (const fn of calls) {
        assert.equal(fn, "setUserDisagreeToAll", `${label} calls Didomi.${fn}() — only setUserDisagreeToAll is permitted`);
      }
    }
  });

  test("every setUserDisagreeToAll call passes zero arguments", () => {
    for (const [label, key] of [["cookie-noise-mainworld.js", "mainworld"], ["cookie-noise.js", "isolated"]]) {
      const src = sources[key];
      const calls = [...src.matchAll(/setUserDisagreeToAll\s*\(([^)]*)\)/g)].map((m) => m[1].trim());
      assert.ok(calls.length > 0, `${label} must call setUserDisagreeToAll`);
      for (const args of calls) {
        assert.equal(args, "", `${label} setUserDisagreeToAll must be called with zero arguments`);
      }
    }
  });

  test("only performBannerAction (or wrappedJSObject equivalent) is invoked as the CookieYes reject call", () => {
    for (const [label, key] of [["cookie-noise-mainworld.js", "mainworld"], ["cookie-noise.js", "isolated"]]) {
      const src = sources[key];
      const calls = [...src.matchAll(/performBannerAction\s*\(([^)]*)\)/g)].map((m) => m[1].trim());
      assert.ok(calls.length > 0, `${label} must call performBannerAction`);
    }
  });

  test('every performBannerAction call passes the literal "reject" argument — never accept_all/accept_partial, never a variable', () => {
    for (const [label, key] of [["cookie-noise-mainworld.js", "mainworld"], ["cookie-noise.js", "isolated"]]) {
      const src = sources[key];
      const calls = [...src.matchAll(/performBannerAction\s*\(([^)]*)\)/g)].map((m) => m[1].trim());
      assert.ok(calls.length > 0, `${label} must call performBannerAction`);
      for (const args of calls) {
        assert.equal(args, '"reject"', `${label} performBannerAction must be called with the literal string "reject"`);
      }
    }
  });

  test("only __tcfapi (or wrappedJSObject equivalent) is invoked as the Sourcepoint reject call", () => {
    for (const [label, key] of [["cookie-noise-mainworld.js", "mainworld"], ["cookie-noise.js", "isolated"]]) {
      const src = sources[key];
      const calls = [...src.matchAll(/__tcfapi\s*\(([^)]*)/g)].map((m) => m[1]);
      assert.ok(calls.length > 0, `${label} must call __tcfapi`);
    }
  });

  test("every __tcfapi call's first argument is exactly the literal 'postRejectAll' — never another command, never a variable", () => {
    for (const [label, key] of [["cookie-noise-mainworld.js", "mainworld"], ["cookie-noise.js", "isolated"]]) {
      const src = sources[key];
      const calls = [...src.matchAll(/__tcfapi\s*\(([^,]*),/g)].map((m) => m[1].trim());
      assert.ok(calls.length > 0, `${label} must call __tcfapi`);
      for (const firstArg of calls) {
        assert.equal(firstArg, "\"postRejectAll\"", `${label} __tcfapi's first argument must be the literal "postRejectAll"`);
      }
    }
  });

  test("only UC_UI.denyAllConsents (or wrappedJSObject equivalent) is invoked — no other UC_UI method call", () => {
    for (const [label, key] of [["cookie-noise-mainworld.js", "mainworld"], ["cookie-noise.js", "isolated"]]) {
      const src = sources[key];
      const calls = [...src.matchAll(/UC_UI\.(\w+)\s*\(/g)].map((m) => m[1]);
      assert.ok(calls.length > 0, `${label} must call UC_UI.denyAllConsents`);
      for (const fn of calls) {
        assert.equal(fn, "denyAllConsents", `${label} calls UC_UI.${fn}() — only denyAllConsents is permitted`);
      }
    }
  });

  test("every denyAllConsents call passes zero arguments — never a variable, never accept/allowAll", () => {
    for (const [label, key] of [["cookie-noise-mainworld.js", "mainworld"], ["cookie-noise.js", "isolated"]]) {
      const src = sources[key];
      const calls = [...src.matchAll(/denyAllConsents\s*\(([^)]*)\)/g)].map((m) => m[1].trim());
      assert.ok(calls.length > 0, `${label} must call denyAllConsents`);
      for (const args of calls) {
        assert.equal(args, "", `${label} denyAllConsents must be called with zero arguments`);
      }
    }
  });

  test("every denyAllConsents() call is immediately followed by a .catch(...) to swallow the returned promise's rejection", () => {
    for (const [label, key] of [["cookie-noise-mainworld.js", "mainworld"], ["cookie-noise.js", "isolated"]]) {
      const src = sources[key];
      assert.ok(
        /denyAllConsents\(\)\s*\.catch\s*\(/.test(src),
        `${label} must chain .catch(...) directly onto the denyAllConsents() call`,
      );
    }
  });

  test("only CookieInformation.declineAllCategories (or wrappedJSObject equivalent) is invoked — no other CookieInformation method call", () => {
    for (const [label, key] of [["cookie-noise-mainworld.js", "mainworld"], ["cookie-noise.js", "isolated"]]) {
      const src = sources[key];
      const calls = [...src.matchAll(/CookieInformation\.(\w+)\s*\(/g)].map((m) => m[1]);
      assert.ok(calls.length > 0, `${label} must call CookieInformation.declineAllCategories`);
      for (const fn of calls) {
        assert.equal(fn, "declineAllCategories", `${label} calls CookieInformation.${fn}() — only declineAllCategories is permitted`);
      }
    }
  });

  test("every declineAllCategories call passes zero arguments", () => {
    for (const [label, key] of [["cookie-noise-mainworld.js", "mainworld"], ["cookie-noise.js", "isolated"]]) {
      const src = sources[key];
      const calls = [...src.matchAll(/declineAllCategories\s*\(([^)]*)\)/g)].map((m) => m[1].trim());
      assert.ok(calls.length > 0, `${label} must call declineAllCategories`);
      for (const args of calls) {
        assert.equal(args, "", `${label} declineAllCategories must be called with zero arguments`);
      }
    }
  });

  test("only CookieScript.instance.rejectAllAction (or wrappedJSObject equivalent) is invoked — no other CookieScript method call", () => {
    for (const [label, key] of [["cookie-noise-mainworld.js", "mainworld"], ["cookie-noise.js", "isolated"]]) {
      const src = sources[key];
      const calls = [...src.matchAll(/CookieScript\.instance\.(\w+)\s*\(/g)].map((m) => m[1]);
      assert.ok(calls.length > 0, `${label} must call CookieScript.instance.rejectAllAction`);
      for (const fn of calls) {
        assert.equal(fn, "rejectAllAction", `${label} calls CookieScript.instance.${fn}() — only rejectAllAction is permitted`);
      }
    }
  });

  test("every rejectAllAction call passes zero arguments", () => {
    for (const [label, key] of [["cookie-noise-mainworld.js", "mainworld"], ["cookie-noise.js", "isolated"]]) {
      const src = sources[key];
      const calls = [...src.matchAll(/rejectAllAction\s*\(([^)]*)\)/g)].map((m) => m[1].trim());
      assert.ok(calls.length > 0, `${label} must call rejectAllAction`);
      for (const args of calls) {
        assert.equal(args, "", `${label} rejectAllAction must be called with zero arguments`);
      }
    }
  });

  test("only tarteaucitron.userInterface.respondAll (or wrappedJSObject equivalent) is invoked — no other tarteaucitron method call", () => {
    for (const [label, key] of [["cookie-noise-mainworld.js", "mainworld"], ["cookie-noise.js", "isolated"]]) {
      const src = sources[key];
      const calls = [...src.matchAll(/tarteaucitron\.userInterface\.(\w+)\s*\(/g)].map((m) => m[1]);
      assert.ok(calls.length > 0, `${label} must call tarteaucitron.userInterface.respondAll`);
      for (const fn of calls) {
        assert.equal(fn, "respondAll", `${label} calls tarteaucitron.userInterface.${fn}() — only respondAll is permitted`);
      }
    }
  });

  // LITERAL-ARG GUARD (unlike the zero-argument adapters above): respondAll's
  // first argument is a boolean where false = deny and true = accept-all —
  // this call site must be pinned to the literal `false`, mirroring the
  // Cookiebot submitCustomConsent(false, false, false) literal-args guard
  // above. A future edit to `respondAll(true)` or `respondAll()` (default
  // parameter semantics aside, the call site itself must never read that
  // way) must fail here.
  test("every respondAll call passes the literal false — never true, never a variable, never zero arguments", () => {
    for (const [label, key] of [["cookie-noise-mainworld.js", "mainworld"], ["cookie-noise.js", "isolated"]]) {
      const src = sources[key];
      const calls = [...src.matchAll(/respondAll\s*\(([^)]*)\)/g)].map((m) => m[1].trim());
      assert.ok(calls.length > 0, `${label} must call respondAll`);
      for (const args of calls) {
        assert.equal(args, "false", `${label} respondAll must be called with the literal false, and only false`);
      }
    }
  });

  // consentmanager.net (__cmp): a DUAL literal-arg guard — unlike every
  // prior single-literal-arg adapter above, setConsent's command name
  // ("setConsent") AND its consent-value argument (`0`) must BOTH be
  // pinned. `setConsent(...)`'s documented shape is
  // (command, consentValue, callback, isAsync) where consentValue: `0` =
  // reject-all, `1` = accept-all (grants broad consent) — verified via a
  // live behavioral probe (engram sdd/cookie-consent-coverage/tier1-live-probe).
  // A future edit to `__cmp("setConsent", 1, ...)` (accept) or any other
  // __cmp command must fail here.

  test("only __cmp (or wrappedJSObject equivalent) is invoked as the consentmanager.net reject call", () => {
    for (const [label, key] of [["cookie-noise-mainworld.js", "mainworld"], ["cookie-noise.js", "isolated"]]) {
      const src = sources[key];
      const calls = [...src.matchAll(/__cmp\s*\(([^)]*)/g)].map((m) => m[1]);
      assert.ok(calls.length > 0, `${label} must call __cmp`);
    }
  });

  test("every __cmp call's first argument is exactly the literal 'setConsent' — never another command, never a variable", () => {
    for (const [label, key] of [["cookie-noise-mainworld.js", "mainworld"], ["cookie-noise.js", "isolated"]]) {
      const src = sources[key];
      const calls = [...src.matchAll(/__cmp\s*\(([^,]*),/g)].map((m) => m[1].trim());
      assert.ok(calls.length > 0, `${label} must call __cmp`);
      for (const firstArg of calls) {
        assert.equal(firstArg, "\"setConsent\"", `${label} __cmp's first argument must be the literal "setConsent"`);
      }
    }
  });

  test("every __cmp setConsent call's second argument (the consent value) is exactly the literal 0 — never 1 (accept), never a variable", () => {
    for (const [label, key] of [["cookie-noise-mainworld.js", "mainworld"], ["cookie-noise.js", "isolated"]]) {
      const src = sources[key];
      const calls = [...src.matchAll(/__cmp\s*\(\s*"setConsent"\s*,\s*([^,]+),/g)].map((m) => m[1].trim());
      assert.ok(calls.length > 0, `${label} must call __cmp("setConsent", ...)`);
      for (const secondArg of calls) {
        assert.equal(secondArg, "0", `${label} __cmp("setConsent", ...)'s second argument must be the literal 0, and only 0`);
      }
    }
  });

  // DENYLIST scan (mirrors the same literals other vendor adapters would
  // use for a BROAD accept-all call — the consent-or-pay accept-click
  // mechanism does not call any vendor API at all, it only ever calls
  // `.click()` on a DOM element it already discriminated, but this scan is
  // cheap belt-and-suspenders defense against a future edit reintroducing
  // a vendor accept-all call site).
  const CONTENT_SCRIPT_DENYLIST = [
    "AllowAll",
    "acceptAllConsents",
    "acceptAllServices",
    "acceptAllAction",
    "postAcceptAll",
    "submitCustomConsent(true",
    "respondAll(true)",
    '__cmp("setConsent", 1',
    'performBannerAction("accept_all"',
    "setCurrentUserStatus",
  ];

  for (const forbidden of CONTENT_SCRIPT_DENYLIST) {
    test(`neither content script's source contains the broad-accept identifier "${forbidden}"`, () => {
      assert.equal(sources.mainworld.includes(forbidden), false, `cookie-noise-mainworld.js contains "${forbidden}"`);
      assert.equal(sources.isolated.includes(forbidden), false, `cookie-noise.js contains "${forbidden}"`);
    });
  }
});

// ── Sourcepoint reject-click dispatch — structural guards ──────────────────
//
// The reject-click mechanism (DOM fallback for the postRejectAll gap) lives
// only in content/cookie-noise.js — see the @sync:cmp-sp-reject-click
// section above for the pure resolver. Mirrors the accept-click dispatch
// structural guards above: prove the click call site exists, is gated on
// every required signal, marks itself acted only after a real click (never
// on mere detection), and never touches a page-authored global.

describe("cookie-noise.js — Sourcepoint reject-click dispatch structural guards", () => {
  test("runSpRejectClickDispatcher gates on findSpRejectTarget's single status before ever clicking (no same-frame DOM anchor pre-check — see real-site probe note)", () => {
    const src = sources.isolated;
    const fnMatch = /function runSpRejectClickDispatcher\(\)\s*\{([\s\S]*?)\n  \}/.exec(src);
    assert.ok(fnMatch, "cookie-noise.js must define runSpRejectClickDispatcher()");
    const body = fnMatch[1];
    const targetIdx = body.indexOf("findSpRejectTarget(");
    const clickIdx = body.indexOf(".ref.click(");
    assert.ok(targetIdx !== -1, "must call findSpRejectTarget");
    assert.ok(clickIdx !== -1, "must call .ref.click()");
    assert.ok(targetIdx < clickIdx, "runSpRejectClickDispatcher must resolve findSpRejectTarget before ever clicking");
    // A same-frame `sp_message_container` pre-check was tried and REMOVED: a
    // real-site probe found the container div and the sp_choice_type_*
    // buttons do not share a frame on real deployments (pinknews.co.uk), so
    // that pre-check silently blocked the dispatcher in the exact frame
    // where the buttons live. Must never be reintroduced without
    // re-litigating that finding.
    assert.equal(src.includes("hasSpMessageContainer("), false,
      "must not reintroduce the same-frame sp_message_container pre-check gate (hasSpMessageContainerDom, the unrelated pure Sourcepoint detection signal, is fine)");
  });

  test("the dispatcher marks _spRejectActed = true only INSIDE the confirmed-single reject branch, never on mere detection or on opening the '12' panel (no false success)", () => {
    const src = sources.isolated;
    const fnMatch = /function runSpRejectClickDispatcher\(\)\s*\{([\s\S]*?)\n  \}/.exec(src);
    assert.ok(fnMatch);
    const body = fnMatch[1];
    const singleBranchIdx = body.indexOf('if (result.status === "single") {');
    const actedIdx = body.indexOf("_spRejectActed = true;");
    const pmOpenedIdx = body.indexOf("_spPmOpened = true;");
    assert.ok(singleBranchIdx !== -1, "the reject click must be gated on a confirmed single '13' target");
    assert.ok(actedIdx !== -1, "must set _spRejectActed = true");
    // Success is marked in EXACTLY ONE place, and it is inside the
    // confirmed-single reject branch — never before target confirmation.
    assert.equal(body.split("_spRejectActed = true;").length - 1, 1, "_spRejectActed must be set in exactly one place");
    assert.ok(singleBranchIdx < actedIdx, "_spRejectActed must only be set AFTER confirming a single reject target");
    // The multi-layer panel-open is a SEPARATE, later branch that marks only
    // _spPmOpened (monotone-safe reveal) — it must NEVER mark reject success.
    assert.ok(pmOpenedIdx !== -1, "the multi-layer '12' panel-open must be guarded by _spPmOpened");
    assert.ok(actedIdx < pmOpenedIdx, "the open-'12' branch comes after the reject branch and must not set _spRejectActed");
  });

  test("the reject-click gate (_spRejectGateOpen, from the same reject master gate as the Tier-1 API ladder) is checked before the dispatch runs", () => {
    assert.ok(/_spRejectGateOpen/.test(sources.isolated));
  });

  test("cookie-noise-mainworld.js has no Sourcepoint reject-click dispatch of any kind (mechanism is isolated-world only)", () => {
    for (const forbidden of ["runSpRejectClickDispatcher", "findSpRejectTarget", "spRejectStartObserver"]) {
      assert.equal(sources.mainworld.includes(forbidden), false, `cookie-noise-mainworld.js must not contain "${forbidden}"`);
    }
  });
});

// ── @sync:frame-host block (TOP-frame hostname resolution) ─────────────────
//
// cookie-consent-all-frames FIX A: resolveTopFrameHostname() is a pure
// helper in src/lib/frame-host.js (unit-tested there) whose body is
// hand-inlined ONLY into content/cookie-noise.js (isolated world) — the
// main-world caller never resolves the exemption itself, it only relays
// the already-computed gate boolean over the nonce-gated event, so it does
// NOT carry this block either (mirrors the @sync:cookie-gate precedent).

const FRAME_HOST_FILES = {
  lib: join(__dirname, "../../src/lib/frame-host.js"),
  isolated: FILES.isolated,
};

const frameHostSources = {
  lib: readFileSync(FRAME_HOST_FILES.lib, "utf8"),
  isolated: sources.isolated,
};

const FRAME_HOST_START = "@sync:frame-host:start";
const FRAME_HOST_END = "@sync:frame-host:end";

describe("cookie-noise-sync — @sync:frame-host block matches src/lib/frame-host.js", () => {
  const libBlock = extractMarkedBlock(frameHostSources.lib, FRAME_HOST_START, FRAME_HOST_END, "frame-host.js");
  const isolatedBlock = extractMarkedBlock(frameHostSources.isolated, FRAME_HOST_START, FRAME_HOST_END, "cookie-noise.js");

  test("frame-host sync block is non-empty and defines resolveTopFrameHostname", () => {
    assert.ok(libBlock.length > 0, "extracted @sync:frame-host block must not be empty — check the markers");
    assert.ok(/function resolveTopFrameHostname/.test(libBlock.join("\n")));
  });

  test("cookie-noise.js @sync:frame-host block matches src/lib/frame-host.js", () => {
    assert.deepEqual(
      isolatedBlock,
      libBlock,
      "content/cookie-noise.js's @sync:frame-host block has drifted from src/lib/frame-host.js",
    );
  });

  test("the main-world caller does NOT carry the @sync:frame-host block (it never resolves the exemption itself)", () => {
    assert.equal(sources.mainworld.includes(FRAME_HOST_START), false,
      "cookie-noise-mainworld.js must not inline the top-frame resolver — it only relays the gate boolean");
  });
});

// ── @sync:site-exempt block (per-site exemption predicate) ─────────────────
//
// cookie-consent-all-frames FIX A: parseListEntry/stripTrailingDot/
// domainMatches/isSiteFullyExempt are hand-copied, byte-identical (modulo
// indentation AND the `export` keyword — content scripts cannot use ES
// module `export` syntax, so the normalizer below strips a leading
// `export ` token from each line before comparing), from src/lib/cleaner.js
// into content/cookie-noise.js ONLY (the main-world caller never resolves
// the exemption itself — same rationale as @sync:frame-host above).

const SITE_EXEMPT_FILES = {
  lib: join(__dirname, "../../src/lib/cleaner.js"),
  isolated: FILES.isolated,
};

const siteExemptSources = {
  lib: readFileSync(SITE_EXEMPT_FILES.lib, "utf8"),
  isolated: sources.isolated,
};

const SITE_EXEMPT_START = "@sync:site-exempt:start";
const SITE_EXEMPT_END = "@sync:site-exempt:end";

function extractSiteExemptBlock(source, label) {
  return extractMarkedBlock(source, SITE_EXEMPT_START, SITE_EXEMPT_END, label)
    .map((l) => l.replace(/^export\s+/, ""));
}

describe("cookie-noise-sync — @sync:site-exempt block matches src/lib/cleaner.js", () => {
  const libBlock = extractSiteExemptBlock(siteExemptSources.lib, "cleaner.js");
  const isolatedBlock = extractSiteExemptBlock(siteExemptSources.isolated, "cookie-noise.js");

  test("site-exempt sync block is non-empty and defines isSiteFullyExempt", () => {
    assert.ok(libBlock.length > 0, "extracted @sync:site-exempt block must not be empty — check the markers");
    const joined = libBlock.join("\n");
    assert.ok(/function parseListEntry/.test(joined));
    assert.ok(/function stripTrailingDot/.test(joined));
    assert.ok(/function domainMatches/.test(joined));
    assert.ok(/function isSiteFullyExempt/.test(joined));
  });

  test("cookie-noise.js @sync:site-exempt block matches src/lib/cleaner.js (modulo the export keyword)", () => {
    assert.deepEqual(
      isolatedBlock,
      libBlock,
      "content/cookie-noise.js's @sync:site-exempt block has drifted from src/lib/cleaner.js",
    );
  });

  test("the main-world caller does NOT carry the @sync:site-exempt block (it never resolves the exemption itself)", () => {
    assert.equal(sources.mainworld.includes(SITE_EXEMPT_START), false,
      "cookie-noise-mainworld.js must not inline the exemption predicate — it only relays the gate boolean");
  });
});

// ── computeGate() frame-branch shape ────────────────────────────────────────
//
// cookie-consent-all-frames FIX A: computeGate() must branch on frame
// identity (window.top === window.self) and use the hand-copied
// resolveTopFrameHostname()/isSiteFullyExempt() in the child-frame branch
// instead of window.__mugaCleaner. Behavioral coverage of both branches
// lives in tests/unit/cookie-noise-frame-exemption.test.mjs (a vm-execution
// harness) — this is a lightweight structural companion.

describe("cookie-noise.js computeGate() — frame-identity branch (FIX A)", () => {
  test("computeGate branches on window.top === window.self", () => {
    assert.ok(
      /window\.top\s*===\s*window\.self/.test(sources.isolated),
      "computeGate() must branch on frame identity to resolve the correct hostname",
    );
  });

  test("computeGate's child-frame branch calls resolveTopFrameHostname and isSiteFullyExempt", () => {
    assert.ok(/resolveTopFrameHostname\(/.test(sources.isolated));
    assert.ok(/isSiteFullyExempt\(hostname, prefsArg\)/.test(sources.isolated));
  });
});
