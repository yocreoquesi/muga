/**
 * MUGA — #969: on a fresh install the onboarding remote-rules disclosure must
 * NOT claim "your other device enabled it".
 *
 * remoteRulesEnabled defaults to true (#888), so on a fresh install the
 * per-device confirmation section surfaces (correct — the user should be able
 * to opt out of the weekly fetch during onboarding). But the copy asserted the
 * value came from another device, which is false when it comes from the default.
 *
 * The fix reads sync WITHOUT defaults to tell a genuinely-synced value apart
 * from the on-by-default fallback, and swaps in accurate copy
 * (ob_remote_rules_desc_default / ob_remote_rules_default_note) for the
 * default-on case while keeping the "other device" wording for a real sync.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import en from "../../src/lib/locales/en.mjs";
import es from "../../src/lib/locales/es.mjs";
import pt from "../../src/lib/locales/pt.mjs";
import de from "../../src/lib/locales/de.mjs";
import fr from "../../src/lib/locales/fr.mjs";
import it from "../../src/lib/locales/it.mjs";
import ja from "../../src/lib/locales/ja.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "../..");
const ONB_JS = readFileSync(resolve(root, "src/onboarding/onboarding.js"), "utf8");
const ONB_HTML = readFileSync(resolve(root, "src/onboarding/onboarding.html"), "utf8");

const LOCALES = { en, es, pt, de, fr, it, ja };
const NEW_KEYS = ["ob_remote_rules_desc_default", "ob_remote_rules_default_note"];

describe("#969 — remote-rules disclosure copy distinguishes default-on from synced", () => {

  test("onboarding.js reads remoteRulesEnabled presence WITHOUT defaults", () => {
    assert.ok(
      /chrome\.storage\.sync\.get\("remoteRulesEnabled",/.test(ONB_JS),
      "must do a raw (no-default) presence read to detect a genuinely synced value",
    );
    assert.ok(
      ONB_JS.includes("remoteRulesSyncedFromDevice"),
      "must compute a remoteRulesSyncedFromDevice signal",
    );
  });

  test("onboarding.js swaps in the default-on copy when NOT synced from another device", () => {
    assert.ok(
      /if \(!remoteRulesSyncedFromDevice\)/.test(ONB_JS),
      "must branch on the not-synced (default-on) case",
    );
    assert.ok(
      ONB_JS.includes('t("ob_remote_rules_desc_default"'),
      "must apply the default-on description",
    );
    assert.ok(
      ONB_JS.includes('t("ob_remote_rules_default_note"'),
      "must apply the default-on note",
    );
  });

  test("the two overridable elements have stable ids", () => {
    assert.ok(ONB_HTML.includes('id="remote-rules-desc"'), "desc element needs an id to override");
    assert.ok(ONB_HTML.includes('id="remote-rules-note"'), "note element needs an id to override");
  });

  test("the default-on copy exists and is non-empty in every locale", () => {
    for (const [code, dict] of Object.entries(LOCALES)) {
      for (const key of NEW_KEYS) {
        assert.ok(
          typeof dict[key] === "string" && dict[key].trim().length > 0,
          `locale "${code}" must define a non-empty "${key}"`,
        );
      }
    }
  });

  test("the default-on copy does not claim another device (EN + ES sanity)", () => {
    assert.ok(!/other device/i.test(en.ob_remote_rules_desc_default), "EN desc must not say 'other device'");
    assert.ok(!/other device/i.test(en.ob_remote_rules_default_note), "EN note must not say 'other device'");
    assert.ok(!/otro dispositivo/i.test(es.ob_remote_rules_desc_default), "ES desc must not say 'otro dispositivo'");
    assert.ok(!/otro dispositivo/i.test(es.ob_remote_rules_default_note), "ES note must not say 'otro dispositivo'");
    // And they DO convey the on-by-default framing.
    assert.ok(/by default/i.test(en.ob_remote_rules_desc_default), "EN desc must convey on-by-default");
    assert.ok(/por defecto/i.test(es.ob_remote_rules_desc_default), "ES desc must convey por defecto");
  });

  test("no user-facing em-dash in the new copy (project copy rule)", () => {
    for (const [code, dict] of Object.entries(LOCALES)) {
      for (const key of NEW_KEYS) {
        assert.ok(!dict[key].includes("—"), `locale "${code}" key "${key}" must not contain an em-dash`);
      }
    }
  });
});
