/**
 * MUGA — regression guard: every route the repo offers a would-be
 * contributor or consumer must lead somewhere that exists (#1432, #1433).
 *
 *   - GitHub Discussions is disabled on the repository, so neither the issue
 *     chooser nor CONTRIBUTING may send questions there, and with blank
 *     issues disabled a Question template must exist.
 *   - The EU ODR platform was discontinued on 20 July 2025 (Regulation (EU)
 *     2024/3228), so neither copy of the Terms may point to it.
 *
 * Run with: npm test
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "../..");
const read = (rel) => readFileSync(join(ROOT, rel), "utf8");

describe("#1433 questions have a working route", () => {
  const config = read(".github/ISSUE_TEMPLATE/config.yml");
  test("issue chooser does not link to Discussions", () => {
    assert.ok(!/\/discussions/.test(config));
  });
  test("CONTRIBUTING does not link to Discussions", () => {
    assert.ok(!/\/discussions/.test(read("CONTRIBUTING.md")));
  });
  test("with blank issues off, a Question template exists", () => {
    const blankOff = /blank_issues_enabled:\s*false/.test(config);
    const hasQuestion = readdirSync(join(ROOT, ".github/ISSUE_TEMPLATE")).some((f) =>
      /^name:\s*Question/m.test(read(`.github/ISSUE_TEMPLATE/${f}`))
    );
    assert.ok(!blankOff || hasQuestion, "no route left for a general question");
  });
});

describe("#1432 the Terms do not point to the discontinued ODR platform", () => {
  for (const doc of ["docs/tos.html", "src/privacy/tos.html"]) {
    test(doc, () => {
      const html = read(doc);
      assert.ok(!/ec\.europa\.eu\/consumers\/odr/.test(html));
      assert.ok(!/Online Dispute Resolution/.test(html));
    });
  }
});
