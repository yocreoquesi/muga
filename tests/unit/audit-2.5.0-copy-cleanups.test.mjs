/**
 * MUGA — audit 2.5.0 copy + low-severity cleanups (#1046, #1048).
 *
 * Behavioral where the target is importable (locale data, parseListEntry) and
 * source guards for the browser-only UI wiring, matching the repo convention.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import en from "../../src/lib/locales/en.mjs";
import es from "../../src/lib/locales/es.mjs";
import de from "../../src/lib/locales/de.mjs";
import fr from "../../src/lib/locales/fr.mjs";
import it from "../../src/lib/locales/it.mjs";
import ja from "../../src/lib/locales/ja.mjs";
import pt from "../../src/lib/locales/pt.mjs";
import { parseListEntry } from "../../src/lib/cleaner.js";

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, "../..");
const LOCALES = { en, es, de, fr, it, ja, pt };

// ── #1046: i18n + UI copy ────────────────────────────────────────────────────

describe("shortener-resolver-expansion — disclosure is illustrative, no hard host count", () => {
  test("en does not claim a specific host count", () => {
    assert.ok(!/\bseven\b/i.test(en.follow_shorteners_disclosure));
    assert.ok(!/\beight\b/i.test(en.follow_shorteners_disclosure));
  });
  test("es does not claim a specific host count", () => {
    assert.ok(!/\bsiete\b/i.test(es.follow_shorteners_disclosure));
    assert.ok(!/\bocho\b/i.test(es.follow_shorteners_disclosure));
  });
});

describe("#1046 — es cp_placeholder keeps the literal token ref_code", () => {
  test("es uses ref_code, not the mistranslated ref_codigo", () => {
    assert.ok(es.cp_placeholder.includes("ref_code"));
    assert.ok(!es.cp_placeholder.includes("ref_codigo"));
  });
});

describe("#1046 — de milestone_500 is translated", () => {
  test("de milestone_500 is not the verbatim English string", () => {
    assert.notEqual(de.milestone_500, "MUGA: Drain the Swamp Pro");
    assert.ok(de.milestone_500.trim().length > 0);
  });
});

describe("#1046 — entropy score label is localized with a {score} placeholder", () => {
  test("every locale defines entropy_score_label with a {score} placeholder", () => {
    for (const [code, dict] of Object.entries(LOCALES)) {
      assert.ok(typeof dict.entropy_score_label === "string" && dict.entropy_score_label.trim(), `${code} missing entropy_score_label`);
      assert.ok(dict.entropy_score_label.includes("{score}"), `${code} entropy_score_label must carry {score}`);
    }
  });
  test("popup.js renders the score via t(), not a hardcoded English literal", () => {
    const popup = readFileSync(join(ROOT, "src/popup/popup.js"), "utf8");
    assert.ok(
      /t\(\s*["']entropy_score_label["']\s*,\s*lang\s*\)/.test(popup),
      "popup.js must resolve the entropy score label through t('entropy_score_label', lang)",
    );
    assert.ok(!/`score \$\{flag\.score\}`/.test(popup), "popup.js must not hardcode the English 'score' literal");
  });
});

describe("#1046 — every locale defines debug_export_confirm", () => {
  test("debug_export_confirm exists and is non-empty in every locale", () => {
    for (const [code, dict] of Object.entries(LOCALES)) {
      assert.ok(typeof dict.debug_export_confirm === "string" && dict.debug_export_confirm.trim(), `${code} missing debug_export_confirm`);
    }
  });
  test("no user-facing em-dash in the new copy", () => {
    for (const [code, dict] of Object.entries(LOCALES)) {
      for (const key of ["entropy_score_label", "debug_export_confirm"]) {
        assert.ok(!dict[key].includes("—"), `${code}.${key} must not contain an em-dash`);
      }
    }
  });
});

// ── #1048: low-severity code cleanups ────────────────────────────────────────

describe("#1048 — parseListEntry lowercases the param key, preserves value case", () => {
  test("a mixed-case param is lowercased so it matches real lowercase query params", () => {
    const e = parseListEntry("Amazon.ES::UTM_Source::YouTuber-21");
    assert.equal(e.domain, "amazon.es");
    assert.equal(e.param, "utm_source");
    assert.equal(e.value, "YouTuber-21", "the affiliate VALUE stays case-sensitive");
  });
  test("domain-only and disabled entries are unaffected", () => {
    assert.deepEqual(parseListEntry("amazon.es"), { domain: "amazon.es", param: null, value: null });
    assert.equal(parseListEntry("amazon.es::disabled").param, "disabled");
  });
});

describe("#1048 — onboarding CTA has a double-submit guard", () => {
  const onboarding = readFileSync(join(ROOT, "src/onboarding/onboarding.js"), "utf8");
  test("an in-flight flag guards the async completion", () => {
    assert.ok(/submitInFlight/.test(onboarding), "onboarding must track an in-flight submit flag");
    assert.ok(/if\s*\(\s*submitInFlight\s*\)\s*return/.test(onboarding), "a second click while in flight must return early");
  });
});

describe("#1048 — auth-path exemption precedence is deliberate and ordered before the blacklist wipe", () => {
  const cleaner = readFileSync(join(ROOT, "src/lib/cleaner.js"), "utf8");
  test("the AUTH_PATH_RE exemption runs before the domain-only blacklist strip-everything branch", () => {
    const authIdx = cleaner.indexOf("AUTH_PATH_RE.test(");
    const wipeIdx = cleaner.indexOf("parsedBlacklist.some(e => !e.param");
    assert.ok(authIdx !== -1 && wipeIdx !== -1, "both branches must exist");
    assert.ok(authIdx < wipeIdx, "the auth-path exemption must precede the blacklist full-wipe so it wins on /checkout etc.");
  });
});
