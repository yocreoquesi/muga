/**
 * MUGA — STRIP table parity guard (#723, spin-off from #709 item 1)
 *
 * The hot-path UTM/click-id strip subset is hand-copied into four
 * content scripts (content scripts can't import ES modules):
 *
 *   - src/content/dom-link-rewriter.js
 *   - src/content/dom-link-rewriter-click.js
 *   - src/content/history-defuser-mainworld.js
 *   - src/content/window-name-defuser-mainworld.js
 *
 * Each comment claims "kept in sync" but nothing enforced it — adding a new
 * high-volume tracker meant editing four files in lockstep. This test pins
 * that the four `const STRIP = Object.freeze({ ... })` literals are
 * byte-identical, the same way cleaner-bundle-sync / sign-rules-denylist-sync
 * pin their respective duplications.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";

import { TRACKING_PARAMS, REDIRECT_NETWORK_PATTERNS } from "../../src/lib/affiliates.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const FILES = [
  "dom-link-rewriter.js",
  "dom-link-rewriter-click.js",
  "history-defuser-mainworld.js",
  "window-name-defuser-mainworld.js",
];

/**
 * Extracts the `Object.freeze({ ... })` object literal that follows
 * `const STRIP =` in a content-script source file, brace-matched so the
 * full table (including trailing entries) is captured verbatim.
 */
function extractStripTable(relPath) {
  const src = readFileSync(join(__dirname, "../../src/content", relPath), "utf8");
  const decl = src.indexOf("const STRIP = Object.freeze({");
  assert.ok(decl !== -1, `${relPath} must declare const STRIP = Object.freeze({ ... })`);
  const open = src.indexOf("{", decl);
  let depth = 0;
  let i = open;
  for (; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") {
      depth--;
      if (depth === 0) break;
    }
  }
  assert.ok(i < src.length, `${relPath}: unbalanced braces in STRIP table`);
  return src.slice(open, i + 1);
}

test("all four content-script STRIP tables are byte-identical (#723)", () => {
  const tables = FILES.map((f) => ({ file: f, body: extractStripTable(f) }));
  const reference = tables[0];

  for (const { file, body } of tables.slice(1)) {
    if (body !== reference.body) {
      assert.fail(
        `STRIP table in src/content/${file} has drifted from ` +
          `src/content/${reference.file}.\n\n` +
          `--- ${reference.file} ---\n${reference.body}\n\n` +
          `--- ${file} ---\n${body}\n\n` +
          `Add new trackers to ALL FOUR files in lockstep, or the hot-path ` +
          `cleaners diverge silently.`,
      );
    }
  }
});

// ── STRIP ↔ TRACKING_PARAMS / landingParams coherence (#815) ────────────────
//
// The STRIP table is a hot-path subset hand-copied into four content scripts.
// Each STRIP param must appear in one of two places:
//   (A) TRACKING_PARAMS — universally stripped by the cleaner on every site, OR
//   (B) REDIRECT_NETWORK_PATTERNS[*].landingParams — required-at-landing by an
//       affiliate-redirect network. These params are intentionally NOT in
//       TRACKING_PARAMS because stripping them universally destroys creator
//       attribution. The cleaner's getLandingPolicy() preserves them on first-
//       touch landings; STRIP keeps them out of window.name/history leaks.
//
// Verified divergence set (as of #815, matrix v1.0):
//   - irclickid  → REDIRECT_NETWORK_PATTERNS["impact-radius"].landingParams
//   - cjevent    → REDIRECT_NETWORK_PATTERNS["cj-affiliate"].landingParams
//   - awc        → REDIRECT_NETWORK_PATTERNS["awin"].landingParams
//
// If the real divergence set grows, this test will fail with the actual
// params missing from both lists — update the divergence set comment AND
// ensure the new params are correctly placed in REDIRECT_NETWORK_PATTERNS
// (NOT in TRACKING_PARAMS).

/**
 * Extracts the keys from a STRIP object literal body (brace-matched).
 * Parses `key: value` pairs where key is an identifier or quoted string.
 */
function extractStripKeys(stripBody) {
  // Match identifier keys (unquoted) or quoted keys, followed by ": <value>"
  const keyRe = /(?:^|,)\s*([a-zA-Z_$][a-zA-Z0-9_$]*|"[^"]+"|'[^']+')\s*:/gm;
  const keys = [];
  let m;
  while ((m = keyRe.exec(stripBody)) !== null) {
    let key = m[1];
    if ((key.startsWith('"') && key.endsWith('"')) ||
        (key.startsWith("'") && key.endsWith("'"))) {
      key = key.slice(1, -1);
    }
    keys.push(key);
  }
  return keys;
}

test("every STRIP param is in TRACKING_PARAMS or in a REDIRECT_NETWORK_PATTERNS.landingParams (#815)", () => {
  // Use the first file as canonical (byte-identity already verified above).
  const stripBody = extractStripTable(FILES[0]);
  const stripKeys = extractStripKeys(stripBody);

  assert.ok(stripKeys.length > 0, "STRIP table must not be empty");

  const trackingSet = new Set(TRACKING_PARAMS.map((p) => p.toLowerCase()));

  // Build the union of all landingParams across all redirect-network entries.
  const allLandingParams = new Set();
  for (const network of REDIRECT_NETWORK_PATTERNS) {
    for (const p of network.landingParams) {
      allLandingParams.add(p.toLowerCase());
    }
  }

  const unmapped = [];
  for (const key of stripKeys) {
    const lower = key.toLowerCase();
    if (!trackingSet.has(lower) && !allLandingParams.has(lower)) {
      unmapped.push(key);
    }
  }

  assert.deepEqual(
    unmapped,
    [],
    `The following STRIP params are not in TRACKING_PARAMS and not in any ` +
    `REDIRECT_NETWORK_PATTERNS.landingParams:\n  ${unmapped.join(", ")}\n\n` +
    `Each STRIP param must be rooted in one of the two source-of-truth ` +
    `lists. If this param is a new click-ID that affiliate networks read ` +
    `at landing, add it to the appropriate REDIRECT_NETWORK_PATTERNS entry ` +
    `— NOT to TRACKING_PARAMS (doing so would strip it universally and ` +
    `break creator attribution). If it is generic tracking noise with no ` +
    `attribution semantics, add it to TRACKING_PARAMS instead.`,
  );
});

test("irclickid, cjevent, awc are NOT in TRACKING_PARAMS — inverse attribution guard (#815)", () => {
  // These three params are in STRIP (content scripts keep them out of
  // window.name/history leaks) but intentionally absent from TRACKING_PARAMS
  // because they are the click IDs that affiliate redirect networks (Impact
  // Radius, CJ Affiliate, Awin) write into the landing URL. Adding them to
  // TRACKING_PARAMS would cause the cleaner to strip them universally —
  // destroying creator commission on every first-touch landing.
  //
  // Verified against REDIRECT_NETWORK_PATTERNS (#815):
  //   irclickid → impact-radius.landingParams
  //   cjevent   → cj-affiliate.landingParams
  //   awc       → awin.landingParams
  //
  // If this test is RED, a contributor has added one of these params to
  // TRACKING_PARAMS. Revert that change and instead verify the param is
  // correctly declared in REDIRECT_NETWORK_PATTERNS.landingParams so
  // getLandingPolicy() preserves it on first-touch landings.
  const trackingSet = new Set(TRACKING_PARAMS.map((p) => p.toLowerCase()));

  const PROTECTED_CLICK_IDS = ["irclickid", "cjevent", "awc"];
  for (const param of PROTECTED_CLICK_IDS) {
    assert.equal(
      trackingSet.has(param.toLowerCase()),
      false,
      `"${param}" MUST NOT be in TRACKING_PARAMS. It is a redirect-network ` +
      `click ID required at landing for creator attribution. Adding it to ` +
      `TRACKING_PARAMS strips it universally and kills affiliate commission. ` +
      `It belongs in REDIRECT_NETWORK_PATTERNS.landingParams only.`,
    );
  }
});
