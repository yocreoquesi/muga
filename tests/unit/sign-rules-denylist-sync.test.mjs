/**
 * REMOTE_PARAM_DENYLIST + AFFILIATE_PARAM_GUARD sync regression guard.
 *
 * `tools/sign-rules.mjs` is a pure Node CLI with no npm deps and cannot
 * `import` from `src/lib/remote-rules.js` (which targets the browser and
 * pulls in browser-only surfaces). The denylist is therefore duplicated.
 *
 * Any divergence — a new entry added to one side but not the other —
 * would cause the signing tool to silently accept a param that the
 * extension would later reject at verification time (or vice versa).
 * Same class of bug as `URL_RE` duplicated between SW and content script,
 * which we guard with `tests/unit/url-regex-sync.test.mjs`.
 *
 * This test extracts the Set literal bodies from both files as text and
 * asserts the entries match exactly (order-independent).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");

const REMOTE_RULES_PATH = resolve(root, "src/lib/remote-rules.js");
const SIGN_RULES_PATH = resolve(root, "tools/sign-rules.mjs");

/**
 * Extract the string-array contents of a declaration like
 *   `const REMOTE_PARAM_DENYLIST = new Set([ "q", "query", ... ]);`
 * or the equivalent `export const` form. Returns a sorted array of entries.
 */
function extractSetEntries(source, constName) {
  // Match both `const NAME = new Set([...])` and `export const NAME = new Set([...])`.
  // Also tolerate `Object.freeze(new Set([...]))`.
  const re = new RegExp(
    String.raw`(?:export\s+)?const\s+${constName}\s*=\s*(?:Object\.freeze\s*\(\s*)?new\s+Set\s*\(\s*\[([\s\S]*?)\]\s*\)`,
    "m"
  );
  const match = source.match(re);
  if (!match) {
    throw new Error(`Could not locate "const ${constName} = new Set([...])" in source`);
  }
  const body = match[1];
  // Extract quoted strings, ignoring comments and whitespace.
  const strings = Array.from(body.matchAll(/"([^"\\]*(?:\\.[^"\\]*)*)"/g), m => m[1]);
  if (strings.length === 0) {
    throw new Error(`${constName} appears empty — did the regex miss quoting style?`);
  }
  return strings.slice().sort();
}

test("REMOTE_PARAM_DENYLIST: tools/sign-rules.mjs matches src/lib/remote-rules.js", () => {
  const libSource = readFileSync(REMOTE_RULES_PATH, "utf8");
  const toolSource = readFileSync(SIGN_RULES_PATH, "utf8");

  const libEntries = extractSetEntries(libSource, "REMOTE_PARAM_DENYLIST");
  const toolEntries = extractSetEntries(toolSource, "REMOTE_PARAM_DENYLIST");

  assert.deepEqual(
    toolEntries,
    libEntries,
    `REMOTE_PARAM_DENYLIST drift between tools/sign-rules.mjs and src/lib/remote-rules.js. ` +
      `Only in lib: ${JSON.stringify(libEntries.filter(x => !toolEntries.includes(x)))}. ` +
      `Only in tool: ${JSON.stringify(toolEntries.filter(x => !libEntries.includes(x)))}.`
  );
});

test("AFFILIATE_PARAM_GUARD: tools/sign-rules.mjs matches src/lib/remote-rules.js", () => {
  const libSource = readFileSync(REMOTE_RULES_PATH, "utf8");
  const toolSource = readFileSync(SIGN_RULES_PATH, "utf8");

  // The tool may inline AFFILIATE_PARAM_GUARD entries into the same
  // REMOTE_PARAM_DENYLIST Set, or keep them separate. Accept either:
  // if a dedicated AFFILIATE_PARAM_GUARD Set exists in the tool, compare
  // it to the lib; otherwise assert every lib guard entry appears in the
  // tool's denylist.
  const libGuard = extractSetEntries(libSource, "AFFILIATE_PARAM_GUARD");

  let toolGuard;
  try {
    toolGuard = extractSetEntries(toolSource, "AFFILIATE_PARAM_GUARD");
  } catch {
    toolGuard = null;
  }

  if (toolGuard !== null) {
    assert.deepEqual(
      toolGuard,
      libGuard,
      `AFFILIATE_PARAM_GUARD drift between tools/sign-rules.mjs and src/lib/remote-rules.js.`
    );
    return;
  }

  // Fallback: tool inlined guard entries into REMOTE_PARAM_DENYLIST.
  const toolDenylist = extractSetEntries(toolSource, "REMOTE_PARAM_DENYLIST");
  const missing = libGuard.filter(x => !toolDenylist.includes(x));
  assert.equal(
    missing.length,
    0,
    `AFFILIATE_PARAM_GUARD entries missing from tools/sign-rules.mjs denylist: ${JSON.stringify(missing)}`
  );
});
