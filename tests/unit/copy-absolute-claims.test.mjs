/**
 * MUGA — coverage and preservation are never stated as absolutes (#1259)
 *
 * Run with: npm test
 *
 * The product rule: nothing about cleaning coverage or creator-referral
 * preservation may be claimed absolutely, because both are best-effort. MUGA
 * strips the tracking patterns it knows. It does not know all of them, it
 * never will, and saying otherwise sets up a promise the code cannot keep.
 *
 * The hedge was already written, and written well, on the landing page: "It is
 * a best-effort intention, not a guarantee." It appeared nowhere inside the
 * extension, because the wording was retyped by hand on every surface and was
 * therefore present where someone remembered it and absent where they did not.
 * Nothing connected the sentences to each other, which is what this file is.
 *
 * ── What is NOT banned, and why the distinction matters ────────────────────
 *
 * An absolute is fine when MUGA actually controls the outcome. "MUGA never
 * adds its own tag" is a promise about MUGA's own behaviour and it is kept in
 * code. "Zero telemetry" is the same. So is "Remove all third-party affiliate
 * tags", the label on the strip-all toggle: "all" there names the MODE the
 * user picked (all of them, rather than keeping creator ones), not a claim
 * that MUGA can find every tag in existence.
 *
 * What is banned is an absolute about what MUGA can DETECT out in the world,
 * which is the half that depends on an open-ended set nobody controls.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "../..");

/**
 * English is where this copy is authored; the other six locales are
 * translations of it. Catching the claim at the source stops it before it is
 * ever translated six ways, which is how "450+" reached all 7 files.
 */
const SURFACES = ["src/lib/locales/en.mjs", "landing/index.html"];

/** Absolute claims about what MUGA can detect or preserve. */
const BANNED = [
  { re: /every (?:URL|link)/i, why: "states coverage as total; MUGA cleans the patterns it knows" },
  { re: /leaving none behind/i, why: "an absolute detection guarantee" },
  { re: /(?:are|is) never touched/i, why: "absolute preservation; say what MUGA does and why instead" },
  { re: /strips? (?:all|every) tracking/i, why: "states coverage as total" },
  { re: /catches everything/i, why: "states detection as total" },
];

// There is deliberately NO allowlist.
//
// #1259 proposes one, "for deterministic user-authored semantics such as the
// blocklist and protected-list labels, which are correctly absolute". That is
// the right instinct against its own broader ban list. This one is narrower:
// every pattern above describes MUGA detecting something out in the world, so
// none of the legitimate absolutes trips it.
//
// Checked rather than assumed. "Remove all third-party affiliate tags" (the
// strip-all toggle's label, where "all" names the MODE the user picked),
// "MUGA never adds its own" and "zero telemetry" all pass untouched, because
// each is a promise about MUGA's own behaviour that the code keeps.
//
// A first draft did carry an allowlist. Its own safety check then failed:
// every entry was inert, and one was short enough ("zero telemetry", 14 chars)
// that stripping it from a whole file was a bigger risk than the exemption was
// worth. An allowlist that exempts nothing is the kind of dead weight that
// later hides a real violation, so it is gone. If the ban list ever widens to
// cover MUGA's own behaviour, add exemptions THEN, and assert each one is
// actually needed.

describe("#1259 — no absolute coverage or preservation claims", () => {

  for (const surface of SURFACES) {
    test(`${surface}: makes no absolute claim about what MUGA detects`, () => {
      const text = readFileSync(join(ROOT, surface), "utf8");

      const violations = BANNED
        .filter(({ re }) => re.test(text))
        .map(({ re, why }) => `${text.match(re)[0]}  (${why})`);

      assert.deepEqual(
        violations, [],
        `${surface} states best-effort behaviour as a guarantee:\n  ` +
        violations.join("\n  ") +
        `\nCoverage and preservation are best-effort. Say what MUGA does and ` +
        `admit the limit, the way landing/index.html already does: ` +
        `"a best-effort intention, not a guarantee".`,
      );
    });
  }

  test("the legitimate absolutes are still present and still pass", () => {
    // Pins the distinction the ban list rests on. If a future pattern ever
    // starts matching MUGA's own promises, this fails and says which.
    const en = readFileSync(join(ROOT, "src/lib/locales/en.mjs"), "utf8");
    for (const kept of [
      "Remove all third-party affiliate tags",  // a MODE the user chose
      "never adds its own",                     // MUGA's own behaviour
      "zero telemetry",
    ]) {
      assert.ok(en.includes(kept), `expected en.mjs to still say "${kept}"`);
      const tripped = BANNED.filter(({ re }) => re.test(kept));
      assert.deepEqual(
        tripped.map(({ re }) => String(re)), [],
        `"${kept}" is a promise MUGA keeps in code, not a coverage claim, and must not be banned`,
      );
    }
  });

  test("the landing page still carries the canonical hedge", () => {
    // The sentence the rest of this rule is derived from. If it is ever
    // deleted, the wording this test points contributors at goes with it.
    const landing = readFileSync(join(ROOT, "landing/index.html"), "utf8");
    assert.ok(
      landing.includes("best-effort intention, not a guarantee"),
      "landing/index.html must keep the canonical best-effort sentence",
    );
  });
});
