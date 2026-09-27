/**
 * MUGA — #1480 regression: allowlist hint must describe what a domain-only
 * entry actually does.
 *
 * wl_hint (the Protected tags & domains hint, src/options/options.html
 * #wl-hint) used to say a domain-only entry ("mysite.com") only leaves
 * affiliates alone. That stopped being true once isSiteFullyExempt
 * (src/lib/cleaner.js, #allowlist-full-inert) started making Step 0 of
 * processUrl return the untouched payload for ANY domain-only entry —
 * tracking-param stripping included, not just affiliate handling — the
 * same behavior as the popup's "Pause cleaning on this site" button
 * (popup.js pause-site-btn -> whitelist entry).
 *
 * These tests pin the corrected wording (every shipped locale) to that
 * real semantic, and pin the underlying behavior itself so a future
 * change to isSiteFullyExempt's contract is caught here too, not just in
 * the copy.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve, join } from "node:path";
import { readdirSync } from "node:fs";

import { isSiteFullyExempt } from "../../src/lib/cleaner.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const localesDir = join(ROOT, "src/lib/locales");

const localeFiles = readdirSync(localesDir).filter((f) => f.endsWith(".mjs"));
const localeModules = {};
for (const file of localeFiles) {
  const code = file.replace(/\.mjs$/, "");
  const mod = await import(pathToFileURL(resolve(localesDir, file)).href);
  localeModules[code] = mod.default;
}

describe("#1480 — isSiteFullyExempt behavior the copy must describe", () => {
  test("a domain-only whitelist entry exempts the WHOLE site, not just affiliates", () => {
    const prefs = { whitelist: ["mysite.com"] };
    assert.equal(
      isSiteFullyExempt("mysite.com", prefs),
      true,
      "a bare domain entry must fully exempt the hostname (#allowlist-full-inert)"
    );
  });

  test("a scoped domain::param::value entry does NOT exempt the whole site", () => {
    const prefs = { whitelist: ["amazon.es::tag::creator-21"] };
    assert.equal(
      isSiteFullyExempt("amazon.es", prefs),
      false,
      "a scoped entry must only protect its own tag, tracking cleaning stays on"
    );
  });
});

describe("#1480 — wl_hint no longer claims a domain-only entry only protects affiliates", () => {
  // The old, wrong claim: "won't touch any affiliate" (en) and its
  // per-locale equivalents, describing the narrower pre-#allowlist-full-
  // inert behavior. None of these substrings may appear in wl_hint again.
  const STALE_AFFILIATE_ONLY_CLAIMS = {
    en: "any affiliate on that site",
    es: "ningún afiliado en esa web",
    de: "keine Affiliates auf dieser Website",
    fr: "aucune affiliation sur ce site",
    it: "alcuna affiliazione su quel sito",
    pt: "nenhum afiliado nesse site",
    ja: "アフィリエイトに一切触れません",
  };

  for (const [lang, staleClaim] of Object.entries(STALE_AFFILIATE_ONLY_CLAIMS)) {
    test(`${lang} wl_hint does not claim the old affiliate-only scope`, () => {
      const value = localeModules[lang]?.wl_hint;
      assert.ok(typeof value === "string" && value.length > 0, `${lang} wl_hint must exist`);
      assert.ok(
        !value.includes(staleClaim),
        `${lang} wl_hint still contains the stale affiliate-only claim: "${staleClaim}"`
      );
    });
  }

  // Every locale's hint must now say a domain-only entry pauses/stops
  // cleaning (matching isSiteFullyExempt), each in its own language.
  const CLEANING_PAUSE_MARKERS = {
    en: "pauses all MUGA URL cleaning",
    es: "pausa toda la limpieza de URLs de MUGA",
    de: "pausiert die gesamte MUGA-URL-Bereinigung",
    fr: "suspend tout le nettoyage d'URL de MUGA",
    it: "mette in pausa tutta la pulizia degli URL di MUGA",
    pt: "pausa toda a limpeza de URLs do MUGA",
    ja: "MUGAのURLクリーニングをすべて一時停止します",
  };

  for (const [lang, marker] of Object.entries(CLEANING_PAUSE_MARKERS)) {
    test(`${lang} wl_hint says a domain-only entry pauses cleaning (URL-cleaner DNA)`, () => {
      const value = localeModules[lang]?.wl_hint;
      assert.ok(typeof value === "string", `${lang} wl_hint must exist`);
      assert.ok(
        value.includes(marker),
        `${lang} wl_hint must include "${marker}"`
      );
    });
  }

  // No em-dashes in any user-facing copy (repo convention).
  for (const [lang, mod] of Object.entries(localeModules)) {
    test(`${lang} wl_hint has no em-dash`, () => {
      const value = mod?.wl_hint;
      if (typeof value !== "string") return; // community locale may be null
      assert.ok(!value.includes("—"), `${lang} wl_hint must not use an em-dash`);
    });
  }
});
