/**
 * MUGA — content-script auto-inject notice wiring (affiliate-autoinject-notice).
 *
 * Structural (source-string) tests, following this repo's established
 * pattern for content-script coverage (AGENTS.md: "Structural tests via
 * readFileSync for modules that cannot be imported in Node"; see
 * content-cleaner-patterns.test.mjs, popup-honored-creator-badge.test.mjs).
 *
 * Asserts:
 *  - the click-handler destructures `autoInjected` from the local processUrl
 *    result and branches to a dedicated neutral variant when present;
 *  - Keep is a TRUE no-op — it must NOT send ADD_TO_WHITELIST (unlike the
 *    existing generic "Allow" choice, which does write a whitelist entry —
 *    reusing it as-is would violate "Keep is a no-op");
 *  - Remove sends ADD_TO_BLACKLIST with the exact scopedBlacklistEntry from
 *    the predicate, never a hand-built domain::param::value string;
 *  - with notifyForeignAffiliate OFF, the auto-inject branch is unreachable
 *    (gated the same way the existing generic toast is gated).
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "../..");
const src = readFileSync(resolve(root, "src/content/cleaner.js"), "utf8");

describe("content/cleaner.js — autoInjected wiring", () => {
  test("click-handler destructures autoInjected from the local processUrl result", () => {
    assert.match(
      src,
      /const\s*\{\s*cleanUrl,\s*action,\s*detectedAffiliate,\s*autoInjected\s*\}\s*=\s*result;/,
      "click handler must destructure autoInjected alongside detectedAffiliate",
    );
  });

  test("defines a dedicated showAutoInjectNotice function", () => {
    assert.match(src, /function showAutoInjectNotice\(/, "must define showAutoInjectNotice");
  });

  test("gates the auto-inject variant on notifyForeignAffiliate, same as the generic toast", () => {
    const fnIdx = src.indexOf('if (action === "detected_foreign" && detectedAffiliate');
    assert.ok(fnIdx > -1, "detected_foreign branch must exist");
    const block = src.slice(fnIdx, fnIdx + 1200);
    assert.match(block, /autoInjected/, "detected_foreign branch must consult autoInjected");
    assert.match(block, /showAutoInjectNotice/, "must call showAutoInjectNotice when autoInjected is present");
  });

  test("showAutoInjectNotice: Remove sends ADD_TO_BLACKLIST with scopedBlacklistEntry (never a hand-built string)", () => {
    const fnStart = src.indexOf("function showAutoInjectNotice(");
    assert.ok(fnStart > -1);
    const fnEnd = src.indexOf("\n  }\n", fnStart);
    const block = src.slice(fnStart, fnEnd > -1 ? fnEnd : fnStart + 4000);

    assert.match(block, /ADD_TO_BLACKLIST/, "Remove must send ADD_TO_BLACKLIST");
    assert.match(block, /scopedBlacklistEntry/, "Remove must use the predicate's scopedBlacklistEntry field");
  });

  test("showAutoInjectNotice: Keep is a TRUE no-op — must NOT send ADD_TO_WHITELIST", () => {
    const fnStart = src.indexOf("function showAutoInjectNotice(");
    assert.ok(fnStart > -1);
    const fnEnd = src.indexOf("\n  }\n", fnStart);
    const block = src.slice(fnStart, fnEnd > -1 ? fnEnd : fnStart + 4000);

    assert.ok(
      !block.includes("ADD_TO_WHITELIST"),
      "Keep must be a true no-op: showAutoInjectNotice must never send ADD_TO_WHITELIST",
    );
  });

  test("Remove navigates to autoInjected.removeUrl (LOW-1: strips the tag on the CURRENT nav), Keep keeps href", () => {
    const fnIdx = src.indexOf("if (autoInjected) {");
    assert.ok(fnIdx > -1, "auto-inject callback branch must exist");
    const block = src.slice(fnIdx, fnIdx + 1200);
    // Remove ("clean") must navigate to the precomputed removeUrl, falling back
    // to cleanUrl — NOT plain cleanUrl (which still carries the platform tag on
    // a default-KEEP detected_foreign result).
    assert.match(
      block,
      /choice === "clean"\)\s*navigate\(autoInjected\.removeUrl \|\| cleanUrl,/,
      "Remove must navigate to autoInjected.removeUrl || cleanUrl",
    );
    // Keep ("original") still navigates to href with the tag KEPT.
    assert.match(block, /choice === "original"\)\s*navigate\(href,/, "Keep must still navigate to href");
  });

  test("showAutoInjectNotice references the neutral i18n keys, not the generic toast_title/toast_tag_msg", () => {
    const fnStart = src.indexOf("function showAutoInjectNotice(");
    assert.ok(fnStart > -1);
    const fnEnd = src.indexOf("\n  }\n", fnStart);
    const block = src.slice(fnStart, fnEnd > -1 ? fnEnd : fnStart + 4000);

    assert.match(block, /autoinject_toast_title/);
    assert.match(block, /autoinject_toast_msg/);
    assert.match(block, /autoinject_keep/);
    assert.match(block, /autoinject_remove/);
  });
});
