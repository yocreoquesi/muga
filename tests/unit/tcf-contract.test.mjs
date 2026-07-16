/**
 * MUGA — Cookie Consent Minimizer: IAB TCF v2.2 spec-contract test (#1129)
 *
 * The Sourcepoint adapter (#1123) rides the generic IAB TCF `__tcfapi`
 * surface (see src/lib/cmp-adapters.js's docblock). The published TCF v2.2
 * API command signature is:
 *
 *   __tcfapi(command, version, callback[, parameter])
 *
 * MUGA only ever legitimately CALLS the `postRejectAll` command — never a
 * consent-granting command like `postAcceptAll` / `postAcceptAllConsents`,
 * never TCF v1 (`version` must be the numeric literal `2`), and never with
 * a missing/non-function callback (a missing callback either throws inside
 * the CMP's own `__tcfapi` implementation or silently drops the reject
 * signal, depending on vendor — either way it must never happen).
 *
 * This test reads both content scripts as source text (readFileSync, no
 * execution — same static-analysis style as tests/unit/cookie-noise-sync.test.mjs)
 * and:
 *   1. Extracts every `__tcfapi(` call site via a small top-level argument
 *      splitter (regex alone cannot safely split nested parens/braces in
 *      the callback body).
 *   2. Asserts each call's 1st arg is exactly the string literal
 *      "postRejectAll", the 2nd arg is exactly the numeric literal 2, and
 *      the 3rd arg is a function (arrow or `function`) — not a missing
 *      argument, not a variable, not a non-function literal.
 *   3. Runs the same validator against synthetic negative-case strings
 *      (wrong command, variable command, TCF v1, missing callback) to
 *      prove the checker actually has teeth — a validator that always
 *      returns true would pass step 2 vacuously.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

const FILES = {
  mainworld: join(__dirname, "../../src/content/cookie-noise-mainworld.js"),
  isolated: join(__dirname, "../../src/content/cookie-noise.js"),
};

const sources = {
  mainworld: readFileSync(FILES.mainworld, "utf8"),
  isolated: readFileSync(FILES.isolated, "utf8"),
};

// ── Call-site extraction ─────────────────────────────────────────────────

/**
 * Splits the top-level (depth-0) comma-separated argument list of a call
 * whose opening `(` has already been consumed, starting at `startIndex`.
 * Tracks paren/bracket/brace depth and string literals (with backslash
 * escapes) so nested structures in a callback body — e.g.
 * `(success) => { void success; }` — never get mis-split on an inner
 * comma or an inner `)`.
 *
 * @param {string} source
 * @param {number} startIndex Index just past the call's opening `(`.
 * @returns {{args: string[], endIndex: number}} Trimmed argument source
 *   strings, and the index of the call's matching closing `)`.
 */
function splitTopLevelArgs(source, startIndex) {
  let parenDepth = 0;
  let bracketDepth = 0;
  let braceDepth = 0;
  let inString = null;
  let current = "";
  const args = [];

  for (let i = startIndex; i < source.length; i++) {
    const ch = source[i];

    if (inString) {
      current += ch;
      if (ch === "\\") {
        i++;
        if (i < source.length) current += source[i];
        continue;
      }
      if (ch === inString) inString = null;
      continue;
    }

    if (ch === '"' || ch === "'" || ch === "`") {
      inString = ch;
      current += ch;
      continue;
    }
    if (ch === "(") {
      parenDepth++;
      current += ch;
      continue;
    }
    if (ch === "[") {
      bracketDepth++;
      current += ch;
      continue;
    }
    if (ch === "{") {
      braceDepth++;
      current += ch;
      continue;
    }
    if (ch === ")") {
      if (parenDepth === 0) {
        if (current.trim().length > 0 || args.length > 0) args.push(current);
        return { args: args.map((a) => a.trim()), endIndex: i };
      }
      parenDepth--;
      current += ch;
      continue;
    }
    if (ch === "]") {
      bracketDepth--;
      current += ch;
      continue;
    }
    if (ch === "}") {
      braceDepth--;
      current += ch;
      continue;
    }
    if (ch === "," && parenDepth === 0 && bracketDepth === 0 && braceDepth === 0) {
      args.push(current);
      current = "";
      continue;
    }
    current += ch;
  }

  throw new Error("Unterminated __tcfapi(...) call — no matching closing paren found");
}

/**
 * Finds every `__tcfapi(` call site in source text.
 *
 * @param {string} source
 * @returns {Array<{args: string[], raw: string}>}
 */
function findTcfapiCalls(source) {
  const calls = [];
  const callRegex = /__tcfapi\s*\(/g;
  let m;
  while ((m = callRegex.exec(source)) !== null) {
    const argsStart = m.index + m[0].length;
    const { args, endIndex } = splitTopLevelArgs(source, argsStart);
    calls.push({ args, raw: source.slice(m.index, endIndex + 1) });
  }
  return calls;
}

// ── TCF v2.2 command-signature validator ─────────────────────────────────

const REJECT_COMMAND_LITERAL = /^(["'])postRejectAll\1$/;
const ARROW_CALLBACK = /^(async\s*)?\(?[^()=]*\)?\s*=>/;
const FUNCTION_CALLBACK = /^(async\s+)?function\b/;

/**
 * Validates a parsed `__tcfapi(...)` call against the published TCF v2.2
 * command signature: `__tcfapi(command, version, callback[, parameter])`.
 *
 * MUGA-specific tightening (the never-accept guard): `command` must be
 * exactly the string literal `"postRejectAll"` — not merely "a string",
 * not a variable that could resolve to a consent-granting command at
 * runtime.
 *
 * @param {{args: string[]}} call
 * @returns {{valid: boolean, reason: string|null}}
 */
function validateTcfapiCall(call) {
  const { args } = call;

  if (args.length < 3) {
    return {
      valid: false,
      reason: `expected 3 arguments (command, version, callback), got ${args.length}`,
    };
  }

  const command = args[0].trim();
  const version = args[1].trim();
  const callback = args[2].trim();

  if (!REJECT_COMMAND_LITERAL.test(command)) {
    return {
      valid: false,
      reason: `1st argument (command) must be the exact string literal "postRejectAll", got: ${command}`,
    };
  }

  if (version !== "2") {
    return {
      valid: false,
      reason: `2nd argument (version) must be the numeric literal 2, got: ${version}`,
    };
  }

  if (!ARROW_CALLBACK.test(callback) && !FUNCTION_CALLBACK.test(callback)) {
    return {
      valid: false,
      reason: `3rd argument (callback) must be a function (arrow or function expression), got: ${callback}`,
    };
  }

  return { valid: true, reason: null };
}

// ── Real call sites: both content scripts must conform ───────────────────

describe("tcf-contract — __tcfapi call sites conform to the published TCF v2.2 signature", () => {
  for (const [label, key] of [
    ["cookie-noise-mainworld.js", "mainworld"],
    ["cookie-noise.js", "isolated"],
  ]) {
    const src = sources[key];
    const calls = findTcfapiCalls(src);

    test(`${label} contains at least one __tcfapi(...) call site`, () => {
      assert.ok(calls.length > 0, `${label} must call __tcfapi (Sourcepoint reject path)`);
    });

    test(`${label} — every __tcfapi call conforms to __tcfapi(command, version, callback[, parameter])`, () => {
      for (const call of calls) {
        const result = validateTcfapiCall(call);
        assert.ok(
          result.valid,
          `${label}: invalid __tcfapi call \`${call.raw.slice(0, 80)}...\` — ${result.reason}`,
        );
      }
    });
  }

  test("neither content script contains a postAcceptAll / postAcceptAllConsents command literal anywhere", () => {
    // Belt-and-suspenders: even outside an actual __tcfapi(...) call site,
    // these command literals must never appear in executable source.
    const FORBIDDEN = /postAcceptAll(Consents)?/;
    for (const [label, key] of [
      ["cookie-noise-mainworld.js", "mainworld"],
      ["cookie-noise.js", "isolated"],
    ]) {
      assert.doesNotMatch(sources[key], FORBIDDEN, `${label} must never reference a consent-granting TCF command`);
    }
  });
});

// ── Negative cases: prove the validator has teeth ─────────────────────────
//
// A validator that always returns { valid: true } would pass every test
// above vacuously. These synthetic cases prove validateTcfapiCall actually
// rejects each of the shapes the real call sites must never take.

describe("tcf-contract — validator rejects synthetic malformed __tcfapi calls", () => {
  test("rejects a non-postRejectAll command literal (e.g. postAcceptAll)", () => {
    const [call] = findTcfapiCalls('window.__tcfapi("postAcceptAll", 2, (ok) => {});');
    const result = validateTcfapiCall(call);
    assert.equal(result.valid, false);
    assert.match(result.reason, /postRejectAll/);
  });

  test("rejects postAcceptAllConsents", () => {
    const [call] = findTcfapiCalls('window.__tcfapi("postAcceptAllConsents", 2, (ok) => {});');
    const result = validateTcfapiCall(call);
    assert.equal(result.valid, false);
  });

  test("rejects a variable/dynamic command (not a string literal)", () => {
    const [call] = findTcfapiCalls("window.__tcfapi(cmd, 2, (ok) => {});");
    const result = validateTcfapiCall(call);
    assert.equal(result.valid, false);
    assert.match(result.reason, /command/);
  });

  test("rejects TCF v1 (version literal 1 instead of 2)", () => {
    const [call] = findTcfapiCalls('window.__tcfapi("postRejectAll", 1, (ok) => {});');
    const result = validateTcfapiCall(call);
    assert.equal(result.valid, false);
    assert.match(result.reason, /version/);
  });

  test("rejects a variable version (not the numeric literal 2)", () => {
    const [call] = findTcfapiCalls('window.__tcfapi("postRejectAll", tcfVersion, (ok) => {});');
    const result = validateTcfapiCall(call);
    assert.equal(result.valid, false);
  });

  test("rejects a missing callback argument", () => {
    const [call] = findTcfapiCalls('window.__tcfapi("postRejectAll", 2);');
    const result = validateTcfapiCall(call);
    assert.equal(result.valid, false);
    assert.match(result.reason, /3 arguments/);
  });

  test("rejects a non-function literal in the callback position", () => {
    const [call] = findTcfapiCalls('window.__tcfapi("postRejectAll", 2, "not-a-function");');
    const result = validateTcfapiCall(call);
    assert.equal(result.valid, false);
    assert.match(result.reason, /callback/);
  });

  test("rejects a bare variable in the callback position", () => {
    const [call] = findTcfapiCalls("window.__tcfapi(\"postRejectAll\", 2, myCallbackRef);");
    const result = validateTcfapiCall(call);
    assert.equal(result.valid, false);
  });

  test("accepts a valid call with a 4th optional parameter argument", () => {
    const [call] = findTcfapiCalls('window.__tcfapi("postRejectAll", 2, (ok) => {}, undefined);');
    const result = validateTcfapiCall(call);
    assert.equal(result.valid, true);
  });

  test("accepts a valid call using a classic function expression callback", () => {
    const [call] = findTcfapiCalls("window.__tcfapi(\"postRejectAll\", 2, function (ok) { return ok; });");
    const result = validateTcfapiCall(call);
    assert.equal(result.valid, true);
  });
});

// ── Argument splitter itself: nested structures must not break parsing ────

describe("tcf-contract — top-level argument splitter handles nested parens/braces/strings", () => {
  test("does not mis-split on a comma inside the callback body", () => {
    const src = 'window.__tcfapi("postRejectAll", 2, (a, b) => { doThing(a, b); });';
    const [call] = findTcfapiCalls(src);
    assert.equal(call.args.length, 3, "nested commas inside the callback must not create extra top-level args");
  });

  test("does not mis-split on a string literal containing a comma or paren", () => {
    const src = 'window.__tcfapi("postRejectAll", 2, (ok) => { console.log("a, (b)"); });';
    const [call] = findTcfapiCalls(src);
    assert.equal(call.args.length, 3);
    assert.equal(validateTcfapiCall(call).valid, true);
  });
});
