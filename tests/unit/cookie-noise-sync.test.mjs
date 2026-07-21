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
