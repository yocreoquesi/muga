/**
 * MUGA — regression guard: the FAQ's "verify it yourself" citations must
 * survive edits, and the programs it names as preserved must be preserved
 * (#1434).
 *
 *   (A) No line-number citations (`file.js:123`, `#L123`) in docs/faq.*.
 *       They rot with every edit; cite a symbol in a file instead.
 *   (B) Each symbol the FAQ cites is still exported by the file it names.
 *   (C) Programs the FAQ names as preserved via AFFILIATE_PATTERNS are in
 *       that table; deprecated programs (Booking, Humble Bundle) are not
 *       named at all.
 *
 * Run with: npm test
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { AFFILIATE_PATTERNS } from "../../src/lib/affiliates.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "../..");
const read = (rel) => readFileSync(join(ROOT, rel), "utf8");

const FAQS = ["docs/faq.md", "docs/faq.html"];

describe("(A) no line-number citations", () => {
  const LINE_CITE = /\.(?:js|mjs|html|json)(?::\d+|#L\d+)/g;
  for (const doc of FAQS) {
    test(doc, () => {
      const found = [...read(doc).matchAll(LINE_CITE)].map((m) => m[0]);
      assert.deepStrictEqual(found, [], `${doc} cites line numbers; cite a symbol instead`);
    });
  }
});

describe("(B) cited symbols exist where the FAQ says", () => {
  const CITED = [
    ["TRACKING_PARAMS", "src/lib/affiliates-data.js"],
    ["AFFILIATE_PATTERNS", "src/lib/affiliates.js"],
    ["verifySignature", "src/lib/remote-rules.js"],
    ["runRemoteRulesFetch", "src/lib/remote-rules.js"],
    ["fetchWithCap", "src/lib/remote-rules.js"],
    ["remoteRulesEnabled", "src/lib/prefs.js"],
  ];
  for (const [symbol, file] of CITED) {
    test(`${symbol} in ${file}`, () => {
      assert.match(read(file), new RegExp(`(?:export (?:async )?(?:function|const) ${symbol}\\b|^\\s*${symbol}:)`, "m"));
      for (const doc of FAQS) {
        assert.ok(read(doc).includes(symbol), `${doc} should cite ${symbol}`);
      }
    });
  }
});

describe("(C) named programs are really preserved", () => {
  const ids = AFFILIATE_PATTERNS.map((p) => p.id);
  test("source of truth: Booking and Humble Bundle are not in AFFILIATE_PATTERNS", () => {
    assert.ok(!ids.some((id) => /booking|humble/i.test(id)));
  });
  for (const doc of FAQS) {
    test(`${doc} does not name deprecated programs as preserved`, () => {
      const text = read(doc);
      assert.ok(!/\bBooking\b/.test(text), "Booking is deprecated in src/rules/manifest.json");
      assert.ok(!/Humble Bundle/.test(text), "Humble Bundle is deprecated in src/rules/manifest.json");
    });
  }
});
