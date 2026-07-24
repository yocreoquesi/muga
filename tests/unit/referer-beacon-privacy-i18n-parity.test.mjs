/**
 * MUGA — referer-beacon-privacy PR 4: i18n parity guard (task 4.11).
 *
 * Unlike i18n-completeness.test.mjs (which only requires en + es), this
 * change's design (D6) requires every new key to be mirrored across ALL 7
 * supported locales (task 4.8), and requires no em-dashes anywhere in the
 * new copy (D6 honest-copy constraint, "no em-dashes" rule).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { TRANSLATIONS, SUPPORTED_LANGS } from "../../src/lib/i18n.js";

// Every new key introduced by the referer-beacon-privacy Options UI slice
// (section title, both toggle labels/hints/aria-labels, the affiliate nudge,
// the shared "view settings" link, the blocklist disclosure line, the
// one-time migration notice, and the onboarding blurb).
const NEW_KEYS = [
  "section_aggressive_privacy",
  "row_suppress_referer_label",
  "row_suppress_referer_hint",
  "aria_suppress_referer",
  "row_block_beacons_label",
  "row_block_beacons_hint",
  "aria_block_beacons",
  "nudge_aggressive_privacy_text",
  "aggressive_privacy_view_link",
  "disclosure_blocklist_referer_beacon",
  "notice_blocklist_referer_beacon_text",
  "ob_aggressive_privacy_title",
  "ob_aggressive_privacy_desc",
];

test("every new referer-beacon-privacy key exists in TRANSLATIONS", () => {
  for (const key of NEW_KEYS) {
    assert.ok(
      Object.prototype.hasOwnProperty.call(TRANSLATIONS, key),
      `TRANSLATIONS is missing new key "${key}"`,
    );
  }
});

test("every new referer-beacon-privacy key has a non-empty value in all 7 supported locales", () => {
  for (const key of NEW_KEYS) {
    const entry = TRANSLATIONS[key];
    assert.ok(entry, `TRANSLATIONS["${key}"] must exist`);
    for (const { code } of SUPPORTED_LANGS) {
      assert.ok(
        typeof entry[code] === "string" && entry[code].trim().length > 0,
        `TRANSLATIONS["${key}"]["${code}"] is missing or empty`,
      );
    }
  }
});

test("no new referer-beacon-privacy string contains an em-dash", () => {
  const offenders = [];
  for (const key of NEW_KEYS) {
    const entry = TRANSLATIONS[key];
    if (!entry) continue;
    for (const { code } of SUPPORTED_LANGS) {
      const value = entry[code];
      if (typeof value === "string" && value.includes("—")) {
        offenders.push(`${key}.${code}`);
      }
    }
  }
  assert.deepEqual(offenders, [], `em-dash found in: ${offenders.join(", ")}`);
});
