/**
 * MUGA — regression guard: checkable facts on muga.app and rules.muga.app
 * must match the product (#1412, #1420).
 *
 *   (A) The landing's release footer dates the version the way CHANGELOG.md
 *       does.
 *   (B) The landing does not promise a default "Creator referral preserved"
 *       toast. The only affiliate toast is opt-in (notifyForeignAffiliate
 *       defaults to false); by default the popup says so instead.
 *   (C) Every published surface states the same language story: 7 UI
 *       languages, English and Spanish maintained by the author, the other
 *       five AI-assisted, no gaps (key parity is enforced by tests).
 *
 * The "N+ tracking patterns" count on the landing is covered by
 * tracking-count-claims.test.mjs.
 *
 * Run with: npm test
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { PREF_DEFAULTS } from "../../src/lib/prefs.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "../..");
const read = (rel) => readFileSync(join(ROOT, rel), "utf8");

const LANDING = read("landing/index.html");

describe("(A) landing footer release date matches CHANGELOG", () => {
  test("the published date is the CHANGELOG date for that version", () => {
    const m = LANDING.match(/v(\d+\.\d+\.\d+) · published (\d{4}-\d{2}-\d{2})/);
    assert.ok(m, "landing footer should state 'vX.Y.Z · published YYYY-MM-DD'");
    const [, version, date] = m;
    const entry = read("CHANGELOG.md").match(
      new RegExp(`## \\[${version.replace(/\./g, "\\.")}\\] - (\\d{4}-\\d{2}-\\d{2})`)
    );
    assert.ok(entry, `CHANGELOG.md has no section for ${version}`);
    assert.equal(date, entry[1], `landing dates v${version} ${date}, CHANGELOG says ${entry[1]}`);
  });
});

describe("(B) landing describes the default preserved-referral feedback", () => {
  test("source of truth: the affiliate toast is opt-in", () => {
    assert.equal(PREF_DEFAULTS.notifyForeignAffiliate, false);
  });
  test("no default toast is promised", () => {
    const text = LANDING.replace(/<[^>]+>/g, " ");
    const sentences = text.split(/(?<=[.!?])\s+|\n/);
    const bad = sentences
      .filter((s) => /\btoast\b/i.test(s) && !/opt-in|optional|if you turn|turn (?:it )?on/i.test(s))
      .map((s) => s.replace(/\s+/g, " ").trim())
      .filter(Boolean);
    assert.deepStrictEqual(bad, [], "the toast is opt-in; say so wherever it is mentioned");
  });
  test("the landing does not claim the popup surfaces a preserved-referral line (removed, #1462-adjacent)", () => {
    // The popup's "Looks like a creator referral. Kept." box was removed
    // entirely (maintainer request 2026-09-24): the popup says nothing about
    // whether a referral was kept. The landing must not claim otherwise.
    assert.ok(
      !/tells you in the popup/i.test(LANDING),
      "landing must not claim the popup surfaces a preserved-referral line"
    );
    assert.ok(
      !LANDING.includes("Looks like a creator referral. Kept."),
      "landing must not quote the removed popup line"
    );
  });
});

describe("(C) one language statement everywhere", () => {
  const locales = readdirSync(join(ROOT, "src/lib/locales")).filter((f) => f.endsWith(".mjs"));
  test("source of truth: 7 locale modules ship", () => {
    assert.equal(locales.length, 7);
  });

  const SURFACES = ["docs/index.html", "README.md", "landing/index.html"];
  const STALE = [
    /EN \+ ES/,
    /bilingual/i,
    /not machine-translated/i,
    /community-contributed/i,
    /fall back to English/i,
  ];
  for (const surface of SURFACES) {
    test(`${surface} carries no stale language claim`, () => {
      const text = read(surface);
      const found = STALE.filter((re) => re.test(text)).map(String);
      assert.deepStrictEqual(found, [], `${surface} contradicts the in-app "AI-assisted translation" note`);
    });
  }
  test("docs/index.html states the real language count", () => {
    assert.ok(read("docs/index.html").includes(`${locales.length} languages`));
  });
});
