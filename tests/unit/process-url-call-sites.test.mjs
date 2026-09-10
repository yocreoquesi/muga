/**
 * MUGA — every processUrl() call site carries a complete context (#1255)
 *
 * `processUrl` takes eight positional arguments with defaults, so an
 * incomplete call is silently valid. Every caller assembled the list by hand,
 * and the ones that got it wrong were the surfaces whose only job is to show
 * the user what MUGA is about to do:
 *
 *   - hover-preview.js passed `[]` for domainRules, pathStripRules AND
 *     pathAffiliateRules. Worse, a test REQUIRED that shape and called it
 *     "the documented argument shape", so the guard pinned the bug in place.
 *   - dom-link-rewriter.js / -click.js passed the URL and nothing else.
 *     processUrl reads `prefs.canonicalExtractorEnabled`, so it threw on every
 *     call; the throw was caught and both fell through to their inline subset.
 *     Their docblock says the bundle is PREFERRED over that subset. It never
 *     once was.
 *
 * The same class was already found and fixed for the content-script hot path
 * under #951, and not propagated, because nothing structurally stopped a caller
 * from omitting arguments. This test is that structure: it reads the sources
 * and refuses a call that hands processUrl an empty rule list.
 *
 * Run with: npm test
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const SRC = join(ROOT, "src");

/**
 * Call sites still assembling their own argument list.
 *
 * EMPTY as of slice (b): popup and the Settings URL tester moved onto
 * lib/cleaning-context.js, and the content-script world onto
 * window.__mugaCleanWithContext in slice (a). Every remaining call goes
 * through one of those two.
 *
 * This list may only ever SHRINK. A new entry means a new hand-assembled call,
 * which is the thing #1255 exists to remove.
 */
const KNOWN_INCOMPLETE = new Map();

/** Generated bundles are build output, not a call site anyone maintains. */
const GENERATED = new Set(["src/content/cleaner-bundle.js"]);

function sourceFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...sourceFiles(abs));
    } else if (entry.name.endsWith(".js") || entry.name.endsWith(".mjs")) {
      out.push(abs);
    }
  }
  return out;
}

const rel = (abs) => relative(ROOT, abs).split(sep).join("/");

/**
 * Every `processUrl(` invocation in a file, as the text from the opening paren
 * to its match. Comments mentioning processUrl are excluded by requiring the
 * call to be preceded by an identifier boundary and followed by a real
 * argument list rather than end-of-line prose.
 */
function callsIn(src) {
  const calls = [];
  const RE = /(?<![\w.])(?:[\w$.]+\.)?processUrl\(/g;
  for (const m of src.matchAll(RE)) {
    // Skip matches inside a line comment.
    const lineStart = src.lastIndexOf("\n", m.index) + 1;
    const before = src.slice(lineStart, m.index);
    if (before.includes("//") || before.trimStart().startsWith("*")) continue;

    let depth = 0;
    let end = -1;
    for (let i = m.index + m[0].length - 1; i < src.length; i++) {
      if (src[i] === "(") depth++;
      else if (src[i] === ")") {
        depth--;
        if (depth === 0) { end = i; break; }
      }
    }
    if (end === -1) continue;
    calls.push(src.slice(m.index, end + 1));
  }
  return calls;
}

/** processUrl's own definition: `domainRules = []` is a default, not a call. */
const DEFINITION_FILE = "src/lib/cleaner.js";

/** Splits a call's argument list at top-level commas. */
function splitArgs(call) {
  const inner = call.slice(call.indexOf("(") + 1, -1);
  const args = [];
  let depth = 0;
  let current = "";
  for (const ch of inner) {
    if (ch === "(" || ch === "[" || ch === "{") depth++;
    else if (ch === ")" || ch === "]" || ch === "}") depth--;
    if (ch === "," && depth === 0) { args.push(current.trim()); current = ""; continue; }
    current += ch;
  }
  if (current.trim()) args.push(current.trim());
  return args;
}

const FILES = sourceFiles(SRC)
  .map(rel)
  .filter((p) => !GENERATED.has(p))
  .filter((p) => callsIn(readFileSync(join(ROOT, p), "utf8")).length > 0);

describe("processUrl call sites (#1255)", () => {
  test("the sweep finds the call sites it claims to", () => {
    assert.ok(
      FILES.includes("src/lib/cleaner.js"),
      "the definition's own file must be seen, or the regex is not matching calls at all"
    );
    assert.ok(
      // handleProcessUrl (and its processUrl() call) moved to
      // src/background/process-url.js (#1266 item 5, slice 6).
      FILES.includes("src/background/process-url.js"),
      "the service-worker's reference call site (now process-url.js) must be seen"
    );
  });

  test("no call site hands processUrl an empty rule list", () => {
    const offenders = [];
    for (const file of FILES) {
      if (KNOWN_INCOMPLETE.has(file) || file === DEFINITION_FILE) continue;
      const src = readFileSync(join(ROOT, file), "utf8");
      for (const call of callsIn(src)) {
        // An argument that is EXACTLY `[]` is a rule set the caller does not
        // have -- what hover-preview passed for all three. `x || []` is the
        // opposite: a real cache with a warm-up fallback, which is correct and
        // must not be flagged, or the guard trains people to work around it.
        if (splitArgs(call).some((a) => /^\[\s*\]$/.test(a))) {
          offenders.push(`${file}: ${call.replace(/\s+/g, " ").slice(0, 100)}`);
        }
      }
    }
    assert.deepStrictEqual(
      offenders,
      [],
      `A processUrl call passes an empty rule list:\n  ${offenders.join("\n  ")}\n` +
        "An empty domainRules/pathStripRules/pathAffiliateRules means the result will not " +
        "match what the extension actually produces. Clean through the shared context instead."
    );
  });

  test("no call site passes fewer arguments than the context needs", () => {
    const offenders = [];
    for (const file of FILES) {
      if (KNOWN_INCOMPLETE.has(file) || file === DEFINITION_FILE) continue;
      const src = readFileSync(join(ROOT, file), "utf8");
      for (const call of callsIn(src)) {
        // processUrl's last two parameters are pathStripRules and
        // pathAffiliateRules, and both default to []. A call that stops early
        // is not a syntax error, it is a caller silently opting out of the
        // path rules -- which is exactly what the popup preview did at six
        // arguments and the Settings URL tester at three. Requiring the full
        // eight is what makes those two visible instead of valid; an earlier
        // draft of this test only required two, and passed on both of them.
        //
        // One argument is the extreme case: prefs is undefined, processUrl
        // reads prefs.canonicalExtractorEnabled, and it throws.
        if (splitArgs(call).length < 8) {
          offenders.push(`${file}: ${call.replace(/\s+/g, " ").slice(0, 100)}`);
        }
      }
    }
    assert.deepStrictEqual(
      offenders,
      [],
      `A processUrl call stops short of the full context:\n  ${offenders.join("\n  ")}\n` +
        "The trailing arguments are the path rules, so stopping early opts out of them and " +
        "the result will not match what the extension produces. Clean through " +
        "lib/cleaning-context.js (extension pages) or window.__mugaCleanWithContext " +
        "(content scripts) rather than assembling another argument list."
    );
  });

  test("the tracked-incomplete list only shrinks", () => {
    for (const [file, why] of KNOWN_INCOMPLETE) {
      const src = readFileSync(join(ROOT, file), "utf8");
      assert.ok(
        callsIn(src).length > 0,
        `${file} no longer calls processUrl (${why}) — remove it from KNOWN_INCOMPLETE ` +
          "rather than leaving an exemption that exempts nothing"
      );
    }
  });
});
