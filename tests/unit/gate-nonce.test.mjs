/**
 * MUGA — Gate-nonce security tests (#811)
 *
 * Verifies that the `muga:history-gate` event cannot be spoofed by a
 * hostile page. The handshake mechanism works as follows:
 *
 *   1. At document_start, `history-defuser.js` (isolated world) generates
 *      a random nonce and fires a one-shot `muga:history-gate:nonce` event.
 *   2. All listeners — in both worlds — capture the nonce from this event
 *      and store it in a closure-local variable, then remove the nonce
 *      listener. No global property is written.
 *   3. Every subsequent `muga:history-gate` dispatch by the isolated-world
 *      gatekeeper includes the nonce in `detail.nonce`.
 *   4. Listeners silently ignore any gate event whose `detail.nonce` does
 *      not match the captured value.
 *
 * These tests are source-analysis tests (no DOM, no jsdom). They verify
 * the structural contracts that make the handshake sound.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

const src = {
  dispatcher:      readFileSync(join(__dirname, "../../src/content/history-defuser.js"), "utf8"),
  histMainworld:   readFileSync(join(__dirname, "../../src/content/history-defuser-mainworld.js"), "utf8"),
  winNameMainworld:readFileSync(join(__dirname, "../../src/content/window-name-defuser-mainworld.js"), "utf8"),
  winNameGate:     readFileSync(join(__dirname, "../../src/content/window-name-defuser.js"), "utf8"),
  domRewriter:     readFileSync(join(__dirname, "../../src/content/dom-link-rewriter.js"), "utf8"),
  domRewriterClick:readFileSync(join(__dirname, "../../src/content/dom-link-rewriter-click.js"), "utf8"),
  bounceStateCleaner: readFileSync(join(__dirname, "../../src/content/bounce-state-cleaner.js"), "utf8"),
};

// ── Dispatcher contracts ────────────────────────────────────────────────────

describe("gate-nonce — dispatcher (history-defuser.js)", () => {
  test("dispatcher generates a random nonce using crypto.getRandomValues", () => {
    assert.ok(
      /crypto\.getRandomValues/.test(src.dispatcher),
      "dispatcher must generate nonce via crypto.getRandomValues",
    );
  });

  test("dispatcher fires the one-shot muga:history-gate:nonce handshake event", () => {
    assert.ok(
      /muga:history-gate:nonce/.test(src.dispatcher),
      "dispatcher must fire muga:history-gate:nonce to share the nonce with listeners",
    );
  });

  test("dispatcher includes nonce in muga:history-gate detail", () => {
    // The dispatchGate function must spread or include the nonce in detail.
    assert.ok(
      /dispatchEvent[^]*CustomEvent[^]*muga:history-gate[^;]{0,400}nonce/s.test(src.dispatcher) ||
      /nonce[^]*muga:history-gate/s.test(src.dispatcher),
      "dispatcher must include nonce in every muga:history-gate event detail",
    );
  });

  test("dispatcher does not leave a global nonce property after handshake", () => {
    // No persistent window.__muga* assignment that stores the nonce.
    // The nonce must live only inside the IIFE closure.
    const stripped = src.dispatcher
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "");
    // window.__mugaNonce or similar globals are forbidden
    assert.ok(
      !/window\.__mugaNonce/.test(stripped) &&
      !/window\.__mugaGateNonce/.test(stripped) &&
      !/window\.__mugaHandshake/.test(stripped),
      "dispatcher must not write the nonce to any window.__ property",
    );
  });
});

// ── Listener contracts (common) ─────────────────────────────────────────────

const listenerFiles = [
  ["history-defuser-mainworld.js", src.histMainworld],
  ["window-name-defuser-mainworld.js", src.winNameMainworld],
  ["window-name-defuser.js", src.winNameGate],
  ["dom-link-rewriter.js", src.domRewriter],
  ["dom-link-rewriter-click.js", src.domRewriterClick],
  ["bounce-state-cleaner.js", src.bounceStateCleaner],
];

describe("gate-nonce — all listeners capture the nonce", () => {
  for (const [filename, fileSource] of listenerFiles) {
    test(`${filename} listens for muga:history-gate:nonce to capture the nonce`, () => {
      assert.ok(
        /muga:history-gate:nonce/.test(fileSource),
        `${filename} must subscribe to the muga:history-gate:nonce handshake event`,
      );
    });

    test(`${filename} validates nonce on muga:history-gate before acting`, () => {
      // The listener must check that e.detail.nonce matches its captured value.
      assert.ok(
        /detail\.nonce/.test(fileSource),
        `${filename} must check detail.nonce when processing muga:history-gate`,
      );
    });

    test(`${filename} does not expose the nonce as a global window property`, () => {
      const stripped = fileSource
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/\/\/.*$/gm, "");
      assert.ok(
        !/window\.__mugaNonce/.test(stripped) &&
        !/window\.__mugaGateNonce/.test(stripped) &&
        !/window\.__mugaHandshake/.test(stripped),
        `${filename} must not leak the nonce via any window.__ property`,
      );
    });
  }
});

// ── No-global-trace contract ─────────────────────────────────────────────────

describe("gate-nonce — handshake leaves no readable global behind", () => {
  test("no content script assigns the nonce to a window property readable after handshake", () => {
    const allSources = Object.values(src);
    for (const fileSource of allSources) {
      const stripped = fileSource
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/\/\/.*$/gm, "");
      assert.ok(
        !/window\.__mugaNonce\s*=/.test(stripped) &&
        !/window\.__mugaGateNonce\s*=/.test(stripped),
        "no content script may assign the nonce to a global window property",
      );
    }
  });

  test("handshake event name muga:history-gate:nonce is distinct from the gate event", () => {
    // Sanity: the nonce handshake must use a different event name than the
    // operational gate, so the nonce-bearing handshake event is one-shot
    // and the gate event is the recurring signal.
    assert.notEqual(
      "muga:history-gate:nonce",
      "muga:history-gate",
      "handshake event name must differ from gate event name",
    );
    // Verify dispatcher fires both event names.
    assert.ok(/muga:history-gate:nonce/.test(src.dispatcher), "dispatcher fires handshake event");
    assert.ok(/muga:history-gate[^:]/.test(src.dispatcher), "dispatcher fires gate event");
  });
});

// ── Manifest ordering invariant ───────────────────────────────────────────────
//
// history-defuser.js (the dispatcher) MUST appear AFTER every other script
// that contains "muga:history-gate:nonce" (i.e., every listener). If a new
// listener is added without moving the dispatcher to the end, this test fails.
// Invariant is checked dynamically so adding a new listener without reordering
// manifests will automatically break this test.

describe("gate-nonce — manifest ordering: dispatcher runs last", () => {
  const _contentDir = join(__dirname, "../../src/content");
  const DISPATCHER = "content/history-defuser.js";
  const NONCE_PATTERN = /muga:history-gate:nonce/;

  /**
   * Discover all content scripts that subscribe to the nonce event by
   * reading each file referenced in the manifest content_scripts list.
   * Returns the set of manifest-relative paths (e.g. "content/foo.js")
   * whose source contains the pattern.
   */
  function findNonceRegistrants(manifestScripts) {
    const srcRoot = join(__dirname, "../../src");
    const registrants = [];
    for (const scriptPath of manifestScripts) {
      if (scriptPath === DISPATCHER) continue; // skip dispatcher itself
      let source;
      try {
        source = readFileSync(join(srcRoot, scriptPath), "utf8");
      } catch {
        continue; // lib or missing file — not a content script we own
      }
      if (NONCE_PATTERN.test(source)) {
        registrants.push(scriptPath);
      }
    }
    return registrants;
  }

  function extractIsolatedScripts(manifestPath) {
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    // Find the content_scripts group that is NOT world:MAIN and runs at
    // document_start — that is the isolated group containing the dispatcher.
    const groups = manifest.content_scripts || [];
    for (const group of groups) {
      const world = group.world || "ISOLATED";
      const runAt = group.run_at || "document_idle";
      if (world !== "MAIN" && runAt === "document_start" && Array.isArray(group.js)) {
        if (group.js.includes(DISPATCHER)) {
          return group.js;
        }
      }
    }
    return [];
  }

  const manifests = [
    ["src/manifest.json (MV3)", join(__dirname, "../../src/manifest.json")],
    ["src/manifest.v2.json (Firefox MV2)", join(__dirname, "../../src/manifest.v2.json")],
  ];

  for (const [label, manifestPath] of manifests) {
    test(`${label}: history-defuser.js appears after all nonce-registrant scripts`, () => {
      const scripts = extractIsolatedScripts(manifestPath);
      assert.ok(
        scripts.length > 0,
        `${label}: could not locate the isolated document_start group containing ${DISPATCHER}`,
      );

      const dispatcherIdx = scripts.indexOf(DISPATCHER);
      assert.ok(
        dispatcherIdx !== -1,
        `${label}: ${DISPATCHER} not found in the isolated document_start group`,
      );

      const registrants = findNonceRegistrants(scripts);
      assert.ok(
        registrants.length > 0,
        `${label}: no nonce registrant scripts found — at least one listener must exist`,
      );

      for (const registrant of registrants) {
        const registrantIdx = scripts.indexOf(registrant);
        assert.ok(
          registrantIdx !== -1,
          `${label}: registrant ${registrant} is not in the isolated group`,
        );
        assert.ok(
          registrantIdx < dispatcherIdx,
          `${label}: ${registrant} (index ${registrantIdx}) must come BEFORE ${DISPATCHER} (index ${dispatcherIdx}) — nonce registrants must register before the dispatcher fires`,
        );
      }
    });
  }
});
