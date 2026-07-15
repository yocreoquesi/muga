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
// detection logic. Both files' entire source (including comments) must
// stay free of any trace of a consent-granting action.

describe("cookie-noise content scripts — STRUCTURAL guard: no consent-granting action path", () => {
  const FORBIDDEN = /allowall|accept/i;

  test("cookie-noise-mainworld.js source contains no AllowAll / accept-family identifier", () => {
    assert.doesNotMatch(sources.mainworld, FORBIDDEN);
  });

  test("cookie-noise.js source contains no AllowAll / accept-family identifier", () => {
    assert.doesNotMatch(sources.isolated, FORBIDDEN);
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
});
