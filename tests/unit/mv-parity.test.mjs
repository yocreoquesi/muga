/**
 * MUGA — MV2/MV3 parity guard (#989).
 *
 * Past parity gaps between the Chrome MV3 build (src/manifest.json) and the
 * Firefox MV2 build (src/manifest.v2.json) were caught late in review instead
 * of at CI time: a DNR rule (#820), the onboarding trigger (#888 follow-up),
 * and most recently a leftover content-script registration (#1026). Each of
 * those existing gaps now has its own dedicated regression test (see
 * firefox-mv2.test.mjs's "DNR ruleset MV2 parity" describe block and
 * firefox-mv2-mainworld-injection.test.mjs). This file adds the two
 * dimensions those tests do NOT cover end-to-end:
 *
 *   1. Runtime message-TYPE parity: the set of `message.type` values the
 *      background handles must be identical for both builds, because both
 *      builds load the exact same background source file. This test pins
 *      that single-source-of-truth wiring AND the message-type roster, so a
 *      future MV-conditional branch around a message type (or a second,
 *      build-specific background file) fails loudly instead of silently
 *      diverging.
 *
 *   2. Content-script registration parity: the flattened set of content
 *      scripts declared by each manifest must be identical except for the
 *      two already-documented MV-specific differences below. Adding or
 *      removing a shared content script in only one manifest — or changing
 *      its world/run_at in only one manifest — now fails here instead of
 *      waiting for a live-browser bug report.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * LEGITIMATE MV-specific differences encoded below (NOT parity gaps):
 *
 *   - content/history-defuser-mainworld.js and
 *     content/window-name-defuser-mainworld.js are CHROME-MV3-ONLY. MV3 loads
 *     them via the `world: "MAIN"` content_scripts group. Firefox MV2 has no
 *     `world: "MAIN"` support; the isolated-world companions
 *     (history-defuser.js / window-name-defuser.js) install the page-world
 *     wrap themselves via `window.wrappedJSObject` + `exportFunction`
 *     instead (#1026, pinned by firefox-mv2-mainworld-injection.test.mjs).
 *
 *   - content/amp-redirect.js is FIREFOX-MV2-ONLY. Chrome MV3 handles AMP
 *     canonicalization via the `amp_redirect` DNR ruleset (declarative,
 *     network-layer); Firefox MV2 has no equivalent so it runs this content
 *     script as a document_end fallback instead (#820, partially pinned by
 *     firefox-mv2.test.mjs's "DNR ruleset MV2 parity" describe block, which
 *     covers the ruleset ID but not the content-script registration itself —
 *     this file closes that gap).
 * ─────────────────────────────────────────────────────────────────────────
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");

const mv3Manifest = JSON.parse(readFileSync(resolve(ROOT, "src/manifest.json"), "utf8"));
const mv2Manifest = JSON.parse(readFileSync(resolve(ROOT, "src/manifest.v2.json"), "utf8"));
const backgroundHtml = readFileSync(resolve(ROOT, "src/background/background.html"), "utf8");
const serviceWorkerSrc = readFileSync(resolve(ROOT, "src/background/service-worker.js"), "utf8");

// ---------------------------------------------------------------------------
// 1. Message-TYPE parity — single shared background source
// ---------------------------------------------------------------------------

// Pinned roster of production `message.type` values the main
// chrome.runtime.onMessage listener in service-worker.js handles (excludes
// the __TEST__* dispatch, which is a separate, explicitly test-mode-gated
// mechanism inside the same shared file and therefore trivially in parity).
// If a message type is added or removed, update this list — that is the
// point of the guard: the change gets reviewed instead of silently drifting
// between builds.
const EXPECTED_MESSAGE_TYPES = [
  "getPrefs",
  "PROCESS_URL",
  "BADGE_AND_STATS",
  "ADD_TO_WHITELIST",
  "ADD_TO_BLACKLIST",
  "GET_DEBUG_LOG",
  "INCREMENT_STAT",
  "CLEAR_DEBUG_LOG",
  "ENABLE_REMOTE_RULES",
  "DISABLE_REMOTE_RULES",
  "GET_REMOTE_RULES_STATUS",
  "FORCE_FETCH_REMOTE_RULES",
  "RESOLVE_SHORTENER",
];

/**
 * Extract every literal `message.type === "..."` (or '...') check from the
 * given source. Used both to pin the production roster above and to prove
 * no message type is checked more than once under a different MV-specific
 * guard elsewhere in the file.
 */
function extractMessageTypes(src) {
  // Excludes `typeof message.type === "string"` (a type-of guard, not a
  // literal message-type comparison) via the negative lookbehind on "typeof ".
  const re = /(?<!typeof )message\.type\s*===\s*["']([^"']+)["']/g;
  const types = new Set();
  let m;
  while ((m = re.exec(src)) !== null) {
    types.add(m[1]);
  }
  return types;
}

describe("MV parity — background message-type handlers share one source file (#989)", () => {
  test("MV3 manifest points its background at background/service-worker.js", () => {
    assert.equal(
      mv3Manifest.background?.service_worker,
      "background/service-worker.js",
      "MV3 manifest.json must declare background/service-worker.js as the service worker",
    );
  });

  test("MV2 manifest points its background page at background/background.html", () => {
    assert.equal(
      mv2Manifest.background?.page,
      "background/background.html",
      "MV2 manifest.v2.json must declare background/background.html as the background page",
    );
  });

  test("background.html loads the SAME service-worker.js file MV3 uses directly", () => {
    // This is the load-bearing assertion for message-type parity: as long as
    // both builds execute this one file, the set of message.type handlers is
    // structurally identical by construction. If a future change points
    // background.html at a different (e.g. MV2-specific) script, this fails.
    assert.match(
      backgroundHtml,
      /<script\s+type="module"\s+src="service-worker\.js"><\/script>/,
      "background.html must load service-worker.js as a module — the exact same file MV3's " +
      "background.service_worker points to (background/service-worker.js)",
    );
  });

  test("exactly one chrome.runtime.onMessage.addListener registration exists in service-worker.js", () => {
    // Guards against a future second, MV-specific listener being added
    // alongside the shared one — that would let message-type handling
    // silently diverge between builds despite both loading this file.
    const matches = serviceWorkerSrc.match(/chrome\.runtime\.onMessage\.addListener\(/g) || [];
    assert.equal(
      matches.length,
      1,
      "service-worker.js must register exactly one runtime.onMessage listener " +
      `(found ${matches.length}) — a second listener could gate message types per build`,
    );
  });

  test("no message.type check is gated behind an MV-specific conditional", () => {
    // isFirefoxMV2 / manifest_version are used elsewhere in service-worker.js
    // (e.g. DNR ruleset partitioning at startup), which is legitimate runtime
    // capability branching, not message-type registration. The listener body
    // itself (from the addListener call to its closing paren before the next
    // top-level function) must never reference either token, or a message
    // type could become reachable on only one build.
    const listenerStart = serviceWorkerSrc.indexOf("chrome.runtime.onMessage.addListener(");
    assert.ok(listenerStart >= 0, "onMessage.addListener call not found");
    const nextFunctionIdx = serviceWorkerSrc.indexOf("\nasync function", listenerStart);
    assert.ok(nextFunctionIdx > listenerStart, "could not locate end of the onMessage listener body");
    const listenerBody = serviceWorkerSrc.slice(listenerStart, nextFunctionIdx);
    assert.doesNotMatch(
      listenerBody,
      /isFirefoxMV2|manifest_version/,
      "the shared onMessage listener body must not branch on isFirefoxMV2 or manifest_version — " +
      "that would let a message type be handled on only one build",
    );
  });

  test("production message-type roster matches the pinned EXPECTED_MESSAGE_TYPES list", () => {
    const found = extractMessageTypes(serviceWorkerSrc);
    const foundSorted = [...found].sort();
    const expectedSorted = [...EXPECTED_MESSAGE_TYPES].sort();
    assert.deepStrictEqual(
      foundSorted,
      expectedSorted,
      "message-type roster drifted from EXPECTED_MESSAGE_TYPES — since both manifests load this " +
      "same file, update the pinned list above after confirming the new/removed type is intentional",
    );
  });
});

// ---------------------------------------------------------------------------
// 2. Content-script registration parity
// ---------------------------------------------------------------------------

// Chrome-MV3-only content scripts (world: "MAIN"), see file header (#1026).
const ALLOWED_MV3_ONLY_SCRIPTS = [
  "content/history-defuser-mainworld.js",
  "content/window-name-defuser-mainworld.js",
];

// Firefox-MV2-only content script (document_end fallback), see file header (#820).
const ALLOWED_MV2_ONLY_SCRIPTS = ["content/amp-redirect.js"];

function flattenContentScripts(manifest) {
  const groups = manifest.content_scripts || [];
  /** @type {Map<string, { world: string, run_at: string, matches: string[] }>} */
  const byFile = new Map();
  for (const group of groups) {
    const world = group.world || "ISOLATED";
    const run_at = group.run_at || "document_idle";
    const matches = group.matches || [];
    for (const js of group.js || []) {
      assert.ok(
        !byFile.has(js),
        `content script ${js} appears in more than one content_scripts group in the same manifest`,
      );
      byFile.set(js, { world, run_at, matches });
    }
  }
  return byFile;
}

describe("MV parity — content-script registration (#989)", () => {
  const mv3Scripts = flattenContentScripts(mv3Manifest);
  const mv2Scripts = flattenContentScripts(mv2Manifest);

  test("no unexpected content script is MV3-only", () => {
    const onlyMv3 = [...mv3Scripts.keys()].filter((f) => !mv2Scripts.has(f));
    assert.deepStrictEqual(
      onlyMv3.sort(),
      [...ALLOWED_MV3_ONLY_SCRIPTS].sort(),
      "content scripts present in manifest.json but missing from manifest.v2.json must exactly " +
      "match ALLOWED_MV3_ONLY_SCRIPTS — if this fails, either add the script to manifest.v2.json " +
      "or, if it is intentionally Chrome-only, document why and add it to the allowed list:\n  " +
      onlyMv3.join("\n  "),
    );
  });

  test("no unexpected content script is MV2-only", () => {
    const onlyMv2 = [...mv2Scripts.keys()].filter((f) => !mv3Scripts.has(f));
    assert.deepStrictEqual(
      onlyMv2.sort(),
      [...ALLOWED_MV2_ONLY_SCRIPTS].sort(),
      "content scripts present in manifest.v2.json but missing from manifest.json must exactly " +
      "match ALLOWED_MV2_ONLY_SCRIPTS — if this fails, either add the script to manifest.json " +
      "or, if it is intentionally Firefox-only, document why and add it to the allowed list:\n  " +
      onlyMv2.join("\n  "),
    );
  });

  test("shared content scripts have identical world/run_at/matches in both manifests", () => {
    const shared = [...mv3Scripts.keys()].filter((f) => mv2Scripts.has(f));
    assert.ok(shared.length > 0, "expected at least one content script shared by both manifests");
    for (const file of shared) {
      const a = mv3Scripts.get(file);
      const b = mv2Scripts.get(file);
      assert.deepStrictEqual(
        a,
        b,
        `content script ${file} has drifted between manifests (world/run_at/matches must match): ` +
        `MV3=${JSON.stringify(a)} MV2=${JSON.stringify(b)}`,
      );
    }
  });

  test("the shared isolated content-script set is non-empty and includes the core cleaner pipeline", () => {
    // Regression guard: if this ever comes back empty, the two sets above
    // (world/run_at/matches) could still pass vacuously.
    const shared = [...mv3Scripts.keys()].filter((f) => mv2Scripts.has(f));
    for (const required of [
      "content/cleaner-bundle.js",
      "content/cleaner.js",
      "content/history-defuser.js",
      "content/window-name-defuser.js",
    ]) {
      assert.ok(
        shared.includes(required),
        `expected ${required} to be a shared (non-MV-specific) content script in both manifests`,
      );
    }
  });

  test("ALLOWED_MV3_ONLY_SCRIPTS are declared with world: 'MAIN' in manifest.json", () => {
    for (const file of ALLOWED_MV3_ONLY_SCRIPTS) {
      const entry = mv3Scripts.get(file);
      assert.ok(entry, `${file} must be declared in manifest.json`);
      assert.equal(
        entry.world,
        "MAIN",
        `${file} is documented as Chrome-MV3-only via world: "MAIN" — found world: "${entry.world}"`,
      );
    }
  });

  test("ALLOWED_MV2_ONLY_SCRIPTS are declared in manifest.v2.json only (not MV3)", () => {
    for (const file of ALLOWED_MV2_ONLY_SCRIPTS) {
      assert.ok(mv2Scripts.has(file), `${file} must be declared in manifest.v2.json`);
      assert.ok(!mv3Scripts.has(file), `${file} must NOT be declared in manifest.json`);
    }
  });
});
