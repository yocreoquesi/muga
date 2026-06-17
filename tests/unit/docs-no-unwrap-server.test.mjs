/**
 * MUGA — regression guard: user-facing docs must not reference the
 * decommissioned `unwrap.muga.app` Cloudflare Worker (#886), and must not
 * use present-tense "Privacy Proxy" language for the shortener feature.
 *
 * Scope: user-facing docs only.
 * Exempt: docs/adr/** and CHANGELOG.md — they legitimately reference the
 * decommissioned Worker as historical record.
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

const USER_FACING_DOCS = [
  "docs/transparency.html",
  "docs/privacy-page.html",
  "docs/tos.html",
  "docs/faq.md",
  "docs/store-listing.md",
  "docs/affiliate-networks-matrix.md",
];

const DECOMMISSIONED_HOST = "unwrap.muga.app";
const DECOMMISSIONED_PHRASE = "Privacy Proxy";

describe("User-facing docs must not reference the decommissioned unwrap.muga.app Worker", () => {
  for (const docPath of USER_FACING_DOCS) {
    test(`${docPath} contains no "${DECOMMISSIONED_HOST}" reference`, () => {
      const content = read(docPath);
      assert.ok(
        !content.includes(DECOMMISSIONED_HOST),
        [
          `${docPath} still references "${DECOMMISSIONED_HOST}".`,
          "This Worker was decommissioned in ADR-0004 (v2.2.0 / 2026-06-01).",
          "Shortener resolution is now native (src/lib/native-shortener-resolver.js).",
          "Update the doc to describe the native model — no MUGA server, no signed envelope.",
          "ADR docs (docs/adr/**) and CHANGELOG.md are exempt as historical record.",
        ].join(" ")
      );
    });
  }
});

describe('User-facing docs must not use present-tense "Privacy Proxy" language', () => {
  for (const docPath of USER_FACING_DOCS) {
    test(`${docPath} contains no "${DECOMMISSIONED_PHRASE}" phrase`, () => {
      const content = read(docPath);
      assert.ok(
        !content.includes(DECOMMISSIONED_PHRASE),
        [
          `${docPath} still uses the phrase "${DECOMMISSIONED_PHRASE}".`,
          'The shortener feature has no server component — the extension resolves redirects natively.',
          "Remove or rewrite the passage to describe the native model.",
          "ADR docs (docs/adr/**) and CHANGELOG.md are exempt as historical record.",
        ].join(" ")
      );
    });
  }
});
