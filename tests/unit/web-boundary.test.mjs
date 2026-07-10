/**
 * MUGA: Web-cleaner-tool one-way dependency-direction guard (#1029,
 * Phase 2, design ADR-3).
 *
 * Local RED/GREEN mirror of tools/check-web-boundary.mjs (npm run
 * check:web-boundary), which CI also runs directly. The boundary is:
 * web/ (and its generated landing/clean/ mirror) may never import from
 * src/, and src/ may never import from web/ or landing/clean/. The
 * generated engine copies (byte-identical IIFE / JSON, zero imports) are
 * allowlisted since they ARE the sanctioned boundary artifact, not a
 * source-level dependency.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { findForbiddenReferences, checkWebBoundary } from "../../tools/check-web-boundary.mjs";

test("findForbiddenReferences flags a relative import into src/", () => {
  const text = `import { processUrl } from "../../src/lib/cleaner.js";`;
  const found = findForbiddenReferences(text, /(^|\/)src\//);
  assert.deepEqual(found, ["../../src/lib/cleaner.js"]);
});

test("findForbiddenReferences ignores specifiers that do not reference the forbidden segment", () => {
  const text = `import { cleanUrl } from "./adapter.js";`;
  const found = findForbiddenReferences(text, /(^|\/)src\//);
  assert.deepEqual(found, []);
});

test("findForbiddenReferences flags a require() call into web/", () => {
  const text = `const adapter = require("../web/engine/adapter.js");`;
  const found = findForbiddenReferences(text, /(^|\/)(web|landing\/clean)\//);
  assert.deepEqual(found, ["../web/engine/adapter.js"]);
});

test("findForbiddenReferences flags a script src= attribute referencing src/", () => {
  const text = `<script src="../src/content/cleaner-bundle.js"></script>`;
  const found = findForbiddenReferences(text, /(^|\/)src\//);
  assert.deepEqual(found, ["../src/content/cleaner-bundle.js"]);
});

test("checkWebBoundary() reports zero violations on the real repo tree", () => {
  const violations = checkWebBoundary();
  assert.deepEqual(violations, []);
});
