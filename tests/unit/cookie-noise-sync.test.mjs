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

const FILES = {
  lib: join(__dirname, "../../src/lib/cmp-adapters.js"),
  mainworld: join(__dirname, "../../src/content/cookie-noise-mainworld.js"),
  isolated: join(__dirname, "../../src/content/cookie-noise.js"),
};

// cookie-consent-accept Slice 2a: the accept module's own lib file plus the
// same two content-script copies. Separate FILES map because the pure
// accept logic is hand-copied FROM a different lib file
// (src/lib/cmp-accept-adapters.js), not cmp-adapters.js.
const ACCEPT_FILES = {
  lib: join(__dirname, "../../src/lib/cmp-accept-adapters.js"),
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

const acceptSources = {
  lib: readFileSync(ACCEPT_FILES.lib, "utf8"),
  mainworld: sources.mainworld,
  isolated: sources.isolated,
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

// ── @sync:cmp-accept block (Didomi hard-wall + minimum-payload logic) ──────
//
// cookie-consent-accept Slice 2a: canAttemptDidomiMinimumAccept and
// buildMinimumPayload are pure, world-agnostic functions defined in
// src/lib/cmp-accept-adapters.js and hand-copied, byte-identical (modulo
// indentation), into BOTH content scripts — mirroring the
// @sync:cmp-adapters precedent above. The world-specific dispatch trigger
// that actually touches window.Didomi / wrappedJSObject.Didomi is a
// SEPARATE, NOT-required-identical region (@sync:cmp-accept-dispatch,
// tested further below) because the two worlds reach the page global
// differently — exactly how the existing reject call sites already work.

const ACCEPT_START = "@sync:cmp-accept:start";
const ACCEPT_END = "@sync:cmp-accept:end";

describe("cookie-noise-sync — @sync:cmp-accept block is present in all three files", () => {
  for (const [label, path] of Object.entries(ACCEPT_FILES)) {
    test(`${label} (${path.split(/[\\/]/).pop()}) contains both @sync:cmp-accept markers`, () => {
      const src = acceptSources[label];
      assert.ok(src.includes(ACCEPT_START), `${label} missing ${ACCEPT_START}`);
      assert.ok(src.includes(ACCEPT_END), `${label} missing ${ACCEPT_END}`);
    });
  }
});

describe("cookie-noise-sync — @sync:cmp-accept block is byte-identical (modulo indentation) across all copies", () => {
  const libBlock = extractMarkedBlock(acceptSources.lib, ACCEPT_START, ACCEPT_END, "cmp-accept-adapters.js");
  const mainworldBlock = extractMarkedBlock(acceptSources.mainworld, ACCEPT_START, ACCEPT_END, "cookie-noise-mainworld.js");
  const isolatedBlock = extractMarkedBlock(acceptSources.isolated, ACCEPT_START, ACCEPT_END, "cookie-noise.js");

  test("sync block is non-empty and defines canAttemptDidomiMinimumAccept and buildMinimumPayload", () => {
    assert.ok(libBlock.length > 0, "extracted @sync:cmp-accept block must not be empty — check the markers");
    const joined = libBlock.join("\n");
    assert.ok(/function canAttemptDidomiMinimumAccept/.test(joined));
    assert.ok(/function buildMinimumPayload/.test(joined));
  });

  test("cookie-noise-mainworld.js @sync:cmp-accept block matches src/lib/cmp-accept-adapters.js", () => {
    assert.deepEqual(
      mainworldBlock,
      libBlock,
      "content/cookie-noise-mainworld.js's @sync:cmp-accept block has drifted from src/lib/cmp-accept-adapters.js",
    );
  });

  test("cookie-noise.js @sync:cmp-accept block matches src/lib/cmp-accept-adapters.js", () => {
    assert.deepEqual(
      isolatedBlock,
      libBlock,
      "content/cookie-noise.js's @sync:cmp-accept block has drifted from src/lib/cmp-accept-adapters.js",
    );
  });
});

// ── @sync:cmp-accept-gate block (the accept double-gate) ────────────────────
//
// computeAcceptGate is a pure helper in src/lib/cmp-accept-adapters.js
// (unit-tested there) whose body is hand-inlined ONLY into
// content/cookie-noise.js (isolated world) — mirrors the @sync:cookie-gate
// precedent exactly: the main-world caller never reads prefs, so it does
// NOT carry this block either.

const ACCEPT_GATE_START = "@sync:cmp-accept-gate:start";
const ACCEPT_GATE_END = "@sync:cmp-accept-gate:end";

describe("cookie-noise-sync — @sync:cmp-accept-gate block matches src/lib/cmp-accept-adapters.js", () => {
  const libBlock = extractMarkedBlock(acceptSources.lib, ACCEPT_GATE_START, ACCEPT_GATE_END, "cmp-accept-adapters.js");
  const isolatedBlock = extractMarkedBlock(acceptSources.isolated, ACCEPT_GATE_START, ACCEPT_GATE_END, "cookie-noise.js");

  test("accept-gate sync block is non-empty and defines computeAcceptGate", () => {
    assert.ok(libBlock.length > 0, "extracted @sync:cmp-accept-gate block must not be empty — check the markers");
    assert.ok(/function computeAcceptGate/.test(libBlock.join("\n")));
  });

  test("cookie-noise.js @sync:cmp-accept-gate block matches src/lib/cmp-accept-adapters.js", () => {
    assert.deepEqual(
      isolatedBlock,
      libBlock,
      "content/cookie-noise.js's @sync:cmp-accept-gate block has drifted from src/lib/cmp-accept-adapters.js",
    );
  });

  test("the main-world caller does NOT carry the @sync:cmp-accept-gate block (it never reads prefs)", () => {
    assert.equal(acceptSources.mainworld.includes(ACCEPT_GATE_START), false,
      "cookie-noise-mainworld.js must not inline the accept double-gate — it has no prefs access");
  });
});

// ── Accept-related new signals (both content scripts) ──────────────────────

describe("cookie-noise content scripts — new Didomi accept-capability signals", () => {
  const NEW_SIGNALS = [
    "hasSetCurrentUserStatusFn",
    "hasGetRequiredPurposeIdsFn",
    "hasGetRequiredVendorIdsFn",
    "hasGetPurposesFn",
    "hasGetVendorsFn",
  ];

  for (const [label, key] of [["cookie-noise-mainworld.js", "mainworld"], ["cookie-noise.js", "isolated"]]) {
    for (const signal of NEW_SIGNALS) {
      test(`${label} collects ${signal}`, () => {
        assert.ok(sources[key].includes(signal), `${label} must collect the ${signal} signal`);
      });
    }
  }
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

    test(`${label} has a top-frame guard`, () => {
      assert.ok(/window\.self\s*!==\s*window\.top/.test(src), `${label} must guard against iframes`);
    });

    test(`${label} has a once-guard`, () => {
      assert.ok(/window\.__muga\w+\s*\)\s*return;/.test(src), `${label} must guard against double-injection`);
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
// guard, extended to the two content-script copies that duplicate the
// detection logic — RELAXED to POSITIONAL for cookie-consent-accept Slice
// 2a: an accept-family identifier is now allowed, but ONLY inside the
// three well-defined accept regions (@sync:cmp-accept, @sync:cmp-accept-gate,
// @sync:cmp-accept-dispatch — the last one carries the world-specific
// dispatch trigger, tested further below). Every reject region, the
// cookie-gate region, and everything else in either file must stay
// exactly as accept-free as before this Slice.

/**
 * Removes every marked region (inclusive of the start/end marker lines
 * themselves) from source, for the positional purity scan below. A marker
 * pair that is entirely absent from a given source is a no-op (some
 * regions — e.g. @sync:cmp-accept-gate / @sync:cmp-accept-dispatch — only
 * exist in the isolated-world file, not the main-world one).
 */
function stripMarkedRegions(source, markerPairs) {
  let out = source;
  for (const [start, end] of markerPairs) {
    const lines = out.split(/\r?\n/);
    const startIdx = lines.findIndex((l) => l.includes(start));
    const endIdx = lines.findIndex((l) => l.includes(end));
    if (startIdx === -1 || endIdx === -1 || endIdx < startIdx) continue;
    out = [...lines.slice(0, startIdx), ...lines.slice(endIdx + 1)].join("\n");
  }
  return out;
}

const ACCEPT_REGION_MARKERS = [
  ["@sync:cmp-accept:start", "@sync:cmp-accept:end"],
  ["@sync:cmp-accept-gate:start", "@sync:cmp-accept-gate:end"],
  ["@sync:cmp-accept-gate-call:start", "@sync:cmp-accept-gate-call:end"],
  ["@sync:cmp-accept-dispatch:start", "@sync:cmp-accept-dispatch:end"],
];

describe("cookie-noise content scripts — STRUCTURAL guard: no consent-granting action path outside the accept regions (POSITIONAL)", () => {
  const FORBIDDEN = /allowall|accept/i;

  test("cookie-noise-mainworld.js, with every accept region stripped, contains no AllowAll / accept-family identifier", () => {
    const stripped = stripMarkedRegions(sources.mainworld, ACCEPT_REGION_MARKERS);
    assert.doesNotMatch(stripped, FORBIDDEN);
  });

  test("cookie-noise.js, with every accept region stripped, contains no AllowAll / accept-family identifier", () => {
    const stripped = stripMarkedRegions(sources.isolated, ACCEPT_REGION_MARKERS);
    assert.doesNotMatch(stripped, FORBIDDEN);
  });

  test("sanity: the relax actually matters — the FULL (unstripped) mainworld source now legitimately contains an accept-family identifier", () => {
    assert.match(sources.mainworld, FORBIDDEN);
  });

  test("sanity: the relax actually matters — the FULL (unstripped) isolated source now legitimately contains an accept-family identifier", () => {
    assert.match(sources.isolated, FORBIDDEN);
  });

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

  test("only window.Didomi.setUserDisagreeToAll (or wrappedJSObject equivalent) is invoked as the REJECT call — no other Didomi method call OUTSIDE the accept-dispatch region", () => {
    // The accept-dispatch region legitimately calls other Didomi.* methods
    // (getRequiredPurposeIds, getRequiredVendorIds, getPurposes, getVendors,
    // setCurrentUserStatus) — that region has its own dedicated guard
    // further below. This test only cares about the REJECT ladder, so the
    // accept-dispatch region is stripped before scanning.
    for (const [label, key] of [["cookie-noise-mainworld.js", "mainworld"], ["cookie-noise.js", "isolated"]]) {
      const src = stripMarkedRegions(sources[key], [["@sync:cmp-accept-dispatch:start", "@sync:cmp-accept-dispatch:end"]]);
      const calls = [...src.matchAll(/Didomi\.(\w+)\s*\(/g)].map((m) => m[1]);
      assert.ok(calls.length > 0, `${label} must call Didomi.setUserDisagreeToAll`);
      for (const fn of calls) {
        assert.equal(fn, "setUserDisagreeToAll", `${label} calls Didomi.${fn}() outside the accept-dispatch region — only setUserDisagreeToAll is permitted there`);
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

  // ── Didomi accept dispatch (cookie-consent-accept Slice 2a) — its own
  // guard family, mirroring the reject-call shapes above exactly, but
  // scoped to the NEW @sync:cmp-accept-dispatch region only.

  test("only Didomi.setCurrentUserStatus (or wrappedJSObject equivalent) is invoked as the accept call — no other Didomi method call inside the dispatch region", () => {
    for (const [label, key] of [["cookie-noise-mainworld.js", "mainworld"], ["cookie-noise.js", "isolated"]]) {
      const src = sources[key];
      const dispatchBlock = extractMarkedBlock(
        src, "@sync:cmp-accept-dispatch:start", "@sync:cmp-accept-dispatch:end", label,
      ).join("\n");
      const calls = [...dispatchBlock.matchAll(/Didomi\.(\w+)\s*\(/g)].map((m) => m[1]);
      assert.ok(calls.length > 0, `${label} must call Didomi.setCurrentUserStatus inside @sync:cmp-accept-dispatch`);
      for (const fn of calls) {
        assert.ok(
          fn === "setCurrentUserStatus" || fn === "getRequiredPurposeIds" || fn === "getRequiredVendorIds" ||
            fn === "getPurposes" || fn === "getVendors",
          `${label} calls Didomi.${fn}() inside the dispatch region — only the getters and setCurrentUserStatus are permitted`,
        );
      }
    }
  });

  test("every setCurrentUserStatus call passes a single bare variable — never an inline object literal, never a hardcoded id", () => {
    for (const [label, key] of [["cookie-noise-mainworld.js", "mainworld"], ["cookie-noise.js", "isolated"]]) {
      const src = sources[key];
      const calls = [...src.matchAll(/setCurrentUserStatus\s*\(([^)]*)\)/g)].map((m) => m[1].trim());
      assert.ok(calls.length > 0, `${label} must call setCurrentUserStatus`);
      for (const args of calls) {
        assert.match(
          args, /^[A-Za-z_$][\w$]*$/,
          `${label} setCurrentUserStatus must be called with a single bare variable (the built payload), got: ${args}`,
        );
      }
    }
  });

  test("the accept dispatch is gated on the acceptGateOpen boolean AND canAttemptDidomiMinimumAccept before ever calling setCurrentUserStatus", () => {
    for (const [label, key] of [["cookie-noise-mainworld.js", "mainworld"], ["cookie-noise.js", "isolated"]]) {
      const src = sources[key];
      const dispatchBlock = extractMarkedBlock(
        src, "@sync:cmp-accept-dispatch:start", "@sync:cmp-accept-dispatch:end", label,
      ).join("\n");
      assert.ok(
        /canAttemptDidomiMinimumAccept/.test(dispatchBlock),
        `${label}'s dispatch region must call canAttemptDidomiMinimumAccept before acting`,
      );
      assert.ok(
        /didomiMinimumGateOpen/i.test(dispatchBlock),
        `${label}'s dispatch region must check the minimum-grant gate-open boolean before acting`,
      );
    }
  });

  // DENYLIST scan (mirrors tests/unit/cmp-accept-adapters.test.mjs's own
  // DENYLIST exactly): even though the dispatch region legitimately calls
  // Didomi, it must never widen to any broad-accept method identified
  // across the other 9 vendor adapters.
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
  ];

  for (const forbidden of CONTENT_SCRIPT_DENYLIST) {
    test(`neither content script's source contains the broad-accept identifier "${forbidden}"`, () => {
      assert.equal(sources.mainworld.includes(forbidden), false, `cookie-noise-mainworld.js contains "${forbidden}"`);
      assert.equal(sources.isolated.includes(forbidden), false, `cookie-noise.js contains "${forbidden}"`);
    });
  }
});
