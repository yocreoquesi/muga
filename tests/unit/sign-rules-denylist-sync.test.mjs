/**
 * tools/sign-rules.mjs imports the denylist from the source module.
 *
 * Until #708, sign-rules.mjs carried inline copies of
 * `REMOTE_PARAM_DENYLIST` and `AFFILIATE_PARAM_GUARD` from
 * `src/lib/remote-rules.js` — the file comment claimed importing was
 * impossible ("browser-targeted ESM"), but the sibling
 * `tools/validate-rules-source.mjs` was already doing exactly that.
 * Drift between the two copies would have caused the signing tool to
 * silently accept a param that the extension's verifier later rejects.
 *
 * #708 removed the inline copies and added a real import. This test
 * pins that decision so the next contributor can't reintroduce the
 * duplication "to make the tool standalone" without a clear signal.
 *
 * If, in the future, sign-rules.mjs genuinely needs to be standalone
 * (e.g. for signing in a constrained CI image without access to src/),
 * this test must be updated alongside whatever new sync mechanism
 * replaces the import.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const SIGN_RULES_PATH = resolve(root, "tools/sign-rules.mjs");
const TOOL_SOURCE = readFileSync(SIGN_RULES_PATH, "utf8");

test("tools/sign-rules.mjs imports REMOTE_PARAM_DENYLIST from src/lib/remote-rules.js", () => {
  assert.ok(
    /import\s*\{[^}]*REMOTE_PARAM_DENYLIST[^}]*\}\s*from\s*["'][^"']*remote-rules\.js["']/.test(
      TOOL_SOURCE,
    ),
    "sign-rules.mjs must import REMOTE_PARAM_DENYLIST from src/lib/remote-rules.js — do not redefine it inline",
  );
});

test("tools/sign-rules.mjs imports AFFILIATE_PARAM_GUARD from src/lib/remote-rules.js", () => {
  assert.ok(
    /import\s*\{[^}]*AFFILIATE_PARAM_GUARD[^}]*\}\s*from\s*["'][^"']*remote-rules\.js["']/.test(
      TOOL_SOURCE,
    ),
    "sign-rules.mjs must import AFFILIATE_PARAM_GUARD from src/lib/remote-rules.js — do not redefine it inline",
  );
});

test("tools/sign-rules.mjs does NOT redeclare REMOTE_PARAM_DENYLIST inline", () => {
  // Negative assertion: the old `const REMOTE_PARAM_DENYLIST = new Set([...])`
  // shape must not reappear. If a contributor "needs" to vendor the constant,
  // they must update this test with the new sync strategy first.
  assert.ok(
    !/const\s+REMOTE_PARAM_DENYLIST\s*=\s*new\s+Set/.test(TOOL_SOURCE),
    "sign-rules.mjs must not redeclare REMOTE_PARAM_DENYLIST — import it from src/lib/remote-rules.js (#708)",
  );
});

test("tools/sign-rules.mjs does NOT redeclare AFFILIATE_PARAM_GUARD inline", () => {
  assert.ok(
    !/const\s+AFFILIATE_PARAM_GUARD\s*=\s*new\s+Set/.test(TOOL_SOURCE),
    "sign-rules.mjs must not redeclare AFFILIATE_PARAM_GUARD — import it from src/lib/remote-rules.js (#708)",
  );
});
