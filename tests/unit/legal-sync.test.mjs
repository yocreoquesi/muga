/**
 * MUGA: Legal-disclosure surface sync test (#412)
 *
 * Mechanical drift checks between the legal/disclosure documents and
 * the code that backs them. Fast, no I/O beyond reading text files —
 * intended for the standard `npm test` run.
 *
 * The legal substance review (does the policy accurately describe
 * current behavior) is a human task done in #399 / #400 / #401. This
 * file catches the OBVIOUS drift cases — a privacy-policy update
 * that forgot to mention the new storage location, an AMO metadata
 * file that didn't get bumped after a build-pipeline change, etc.
 *
 * If a check below fails, fix the doc. Do not weaken the check.
 *
 * Run with: npm test
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "../..");

function read(relPath) {
  return readFileSync(join(root, relPath), "utf8");
}

function readJSON(relPath) {
  return JSON.parse(read(relPath));
}

// ---------------------------------------------------------------------------
// 1. Privacy policy must mention chrome.storage.local
// ---------------------------------------------------------------------------
//
// Pre-#355, consent metadata lived in chrome.storage.sync. ADR-0001
// moved it to chrome.storage.local (per-device decision). The privacy
// policy's storage-locations section now MUST mention the local
// bucket — the most visible drift indicator if a future edit forgets
// the per-device disclosure.
//
describe("Legal-sync — privacy policy mentions chrome.storage.local", () => {
  test("src/privacy/privacy.html references chrome.storage.local at least once", () => {
    const html = read("src/privacy/privacy.html");
    assert.ok(
      /chrome\.storage\.local/.test(html),
      [
        "src/privacy/privacy.html does not mention chrome.storage.local.",
        "Per ADR-0001, consent metadata lives in chrome.storage.local on each",
        "device. The privacy policy must disclose this. Restore the storage-",
        "locations section before merging.",
      ].join(" ")
    );
  });

  test("docs/privacy-page.html (the published copy) references chrome.storage.local at least once", () => {
    const html = read("docs/privacy-page.html");
    assert.ok(
      /chrome\.storage\.local/.test(html),
      [
        "docs/privacy-page.html does not mention chrome.storage.local.",
        "This is the published copy of the privacy policy; it must mirror",
        "src/privacy/privacy.html on the per-device-consent disclosure.",
      ].join(" ")
    );
  });
});

// ---------------------------------------------------------------------------
// 2. AMO approval-notes must reference the bundle pipeline
// ---------------------------------------------------------------------------
//
// Post-#356, the content script is bundled via esbuild (the only
// source-language transformation in the project). amo-metadata.json's
// approval_notes must point AMO reviewers at the bundler script or
// build command — otherwise reviewers see a "no build step" claim
// that doesn't match what they're verifying.
//
describe("Legal-sync — AMO approval-notes reference the bundle pipeline", () => {
  test("amo-metadata.json approval_notes mentions the bundler when build:content exists in package.json", () => {
    const pkg = readJSON("package.json");
    const hasBuildContent = !!pkg.scripts?.["build:content"];
    if (!hasBuildContent) {
      // No build:content script in package.json — nothing to enforce.
      // (Defensive: the test is a no-op if the bundle pipeline is removed.)
      return;
    }
    const meta = readJSON("amo-metadata.json");
    const notes = meta?.version?.approval_notes || "";
    const mentionsBundler =
      notes.includes("tools/bundle-content.mjs") ||
      notes.includes("npm run build:content");
    assert.ok(
      mentionsBundler,
      [
        "amo-metadata.json approval_notes does not mention",
        "tools/bundle-content.mjs or 'npm run build:content'.",
        "Since package.json defines a build:content script, AMO reviewers",
        "must be told what the build step does and how to verify the",
        "committed bundle matches the unbundled source.",
      ].join(" ")
    );
  });
});

// ---------------------------------------------------------------------------
// 3. Privacy-policy version stamp matches the manifest version
// ---------------------------------------------------------------------------
//
// The existing tests/unit/docs-version-consistency.test.mjs already
// asserts version-stamp correctness against the runtime manifest
// version. This file deliberately does NOT add a fourth check on top
// — duplicating the assertion would create churn when a release
// inevitably bumps the manifest. The check stays in its established
// home; this comment is a pointer for future maintainers reading
// this file alone.
//
