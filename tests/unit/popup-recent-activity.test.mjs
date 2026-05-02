/**
 * MUGA — Popup wiring for the "Recent activity" section (#460, A2).
 *
 * The Attribution Ledger Presenter (A1) ships pure view-state. The popup
 * wires it into a `<details id="recent-activity">` block placed BELOW the
 * existing per-page badge area (`#preview`). Each entry shows the cleaned
 * URL (truncated, copyable), an action badge (cleaned / preserved /
 * injected / honored / blocked), and — when applicable — the creator
 * credit and the network attribution (Honor Creator Mode).
 *
 * These tests pin down the surfaces that must exist for A2 to be wired:
 *   - i18n keys (en + es non-empty)
 *   - HTML scaffolding (<details id="recent-activity">, list slot,
 *     empty-state slot)
 *   - JS wiring (imports the view module, reads chrome.storage.local
 *     under "attributionLedger", references the empty-state key)
 *
 * The visual / interactive layer is exercised in the pure renderer test
 * (attribution-ledger-view.test.mjs). A Playwright visual-regression
 * check is intentionally deferred — see the issue acceptance notes.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "../..");

import { makeChromeMock } from "./helpers/chrome-stub.mjs";
globalThis.chrome = makeChromeMock({ hasSession: false, promiseShape: true });

const { TRANSLATIONS } = await import("../../src/lib/i18n.js");

// ── i18n keys ────────────────────────────────────────────────────────────────

const REQUIRED_KEYS = [
  "ledger_section_title",
  "ledger_empty",
  "ledger_badge_cleaned",
  "ledger_badge_preserve_affiliate",
  "ledger_badge_inject_affiliate",
  "ledger_badge_honor_creator",
  "ledger_badge_blocked_opaque",
  "ledger_creator_credit_template",
  "ledger_network_template",
  "ledger_copy_btn_label",
  "ledger_copy_btn_copied",
];

for (const key of REQUIRED_KEYS) {
  test(`i18n: ${key} exists with en + es non-empty`, () => {
    const entry = TRANSLATIONS[key];
    assert.ok(entry, `${key} must exist in TRANSLATIONS`);
    assert.ok(typeof entry.en === "string" && entry.en.length > 0, `${key}.en non-empty`);
    assert.ok(typeof entry.es === "string" && entry.es.length > 0, `${key}.es non-empty`);
  });
}

test("ledger_creator_credit_template references {creator}", () => {
  const k = TRANSLATIONS.ledger_creator_credit_template;
  assert.ok(k.en.includes("{creator}"), "en must include {creator}");
  assert.ok(k.es.includes("{creator}"), "es must include {creator}");
});

test("ledger_network_template references {network}", () => {
  const k = TRANSLATIONS.ledger_network_template;
  assert.ok(k.en.includes("{network}"), "en must include {network}");
  assert.ok(k.es.includes("{network}"), "es must include {network}");
});

// ── HTML surface ─────────────────────────────────────────────────────────────

test("popup.html exposes <details id=\"recent-activity\">", () => {
  const html = readFileSync(resolve(root, "src/popup/popup.html"), "utf8");
  assert.match(html, /id="recent-activity"/, "popup.html must contain #recent-activity");
  assert.match(
    html,
    /<details[^>]*id="recent-activity"/,
    "#recent-activity must be a <details> element so the section is collapsible",
  );
});

test("#recent-activity sits BELOW the per-page badge area (#preview)", () => {
  const html = readFileSync(resolve(root, "src/popup/popup.html"), "utf8");
  const previewIdx = html.indexOf('id="preview"');
  const recentIdx = html.indexOf('id="recent-activity"');
  assert.ok(previewIdx !== -1, "popup.html must contain #preview");
  assert.ok(recentIdx !== -1, "popup.html must contain #recent-activity");
  assert.ok(
    recentIdx > previewIdx,
    "Recent activity must come after #preview (acceptance: BELOW the per-page badge area)",
  );
});

test("popup.html declares list + empty-state slots inside #recent-activity", () => {
  const html = readFileSync(resolve(root, "src/popup/popup.html"), "utf8");
  assert.match(html, /id="recent-activity-list"/, "popup.html must contain #recent-activity-list");
  assert.match(html, /id="recent-activity-empty"/, "popup.html must contain #recent-activity-empty");
});

// ── JS wiring ────────────────────────────────────────────────────────────────

test("popup.js imports the attribution-ledger-view module", () => {
  const popupSrc = readFileSync(resolve(root, "src/popup/popup.js"), "utf8");
  assert.ok(
    /from\s+"\.\.\/lib\/attribution-ledger-view\.js"/.test(popupSrc),
    "popup.js must import from attribution-ledger-view.js",
  );
});

test("popup.js reads the ledger from chrome.storage.local under attributionLedger", () => {
  const popupSrc = readFileSync(resolve(root, "src/popup/popup.js"), "utf8");
  assert.ok(
    /attributionLedger/.test(popupSrc),
    "popup.js must reference the attributionLedger storage key",
  );
});

test("popup.js wires an empty-state via ledger_empty", () => {
  const popupSrc = readFileSync(resolve(root, "src/popup/popup.js"), "utf8");
  assert.ok(
    /ledger_empty/.test(popupSrc),
    "popup.js must reference the ledger_empty i18n key for the empty state",
  );
});
