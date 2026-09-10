/**
 * MUGA — Developer tools has its own gate, independent of Advanced (#1271 item 1)
 *
 * Background: a0b72be (the earlier pass on #1271) folded the Developer tools
 * group under a collapsed <details> INSIDE the same dev-mode-gated
 * #dev-tools-card as real settings, reasoning that a second persisted flag
 * was "the heavier answer" to a complaint about blast radius, not
 * persistence. The issue stayed open because a collapsed disclosure is not
 * a separate gate: flipping Advanced to reach a real setting (e.g. Honor
 * Creator Mode) still handed the user a panel one click away from replaying
 * onboarding and re-firing notifications.
 *
 * This file pins the fix: devToolsMode is a SEPARATE device-local flag
 * (src/lib/storage.js getDevToolsMode/setDevToolsMode), the Developer tools
 * group lives in its own #section-dev-tools/#dev-tools-panel outside
 * #dev-tools-card, and options.js wires the two gates through disjoint
 * functions (syncDevTools vs syncDevToolsPanel) that never reference each
 * other's checkbox or panel id. None of these assertions could pass against
 * a0b72be, where there was exactly one gate (#dev-mode) and no
 * getDevToolsMode/setDevToolsMode export at all.
 *
 * Storage-accessor tests below are genuine behavioural round-trips against
 * a stateful in-memory chrome.storage stub (not source-string inspection).
 * The DOM-wiring tests follow the codebase's established pattern for
 * options.html/options.js (browser-only, covered by source guards — see
 * tests/unit/options-write-path-override.test.mjs and
 * tests/unit/honor-creator-mode.test.mjs).
 */

import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, "../..");

const optionsHtml = readFileSync(join(ROOT, "src/options/options.html"), "utf8");
const optionsJs = readFileSync(join(ROOT, "src/options/options.js"), "utf8");

// ── Stateful in-memory chrome.storage stub (installed per test) ────────────

function makeArea(store) {
  return {
    get: (defaults, cb) => {
      const result = {};
      if (typeof defaults === "string") {
        result[defaults] = store.has(defaults) ? store.get(defaults) : undefined;
      } else if (Array.isArray(defaults)) {
        for (const k of defaults) result[k] = store.has(k) ? store.get(k) : undefined;
      } else if (defaults && typeof defaults === "object") {
        for (const [k, v] of Object.entries(defaults)) {
          result[k] = store.has(k) ? store.get(k) : v;
        }
      }
      cb && cb(result);
    },
    set: (data, cb) => {
      for (const [k, v] of Object.entries(data)) store.set(k, v);
      cb && cb();
    },
  };
}

function installChromeStub() {
  const syncStore = new Map();
  const localStore = new Map();
  globalThis.chrome = {
    storage: { sync: makeArea(syncStore), local: makeArea(localStore) },
    runtime: { lastError: null },
  };
  return { syncStore, localStore };
}

// ── Real behavioural round-trip: getDevToolsMode/setDevToolsMode ───────────

describe("storage.js — devToolsMode is a separate device-local flag", () => {
  let stores;
  let storage;

  beforeEach(async () => {
    stores = installChromeStub();
    // Cache-bust so each test gets a fresh module instance bound to its own stub.
    storage = await import("../../src/lib/storage.js?cb=" + Math.random());
  });

  test("getDevToolsMode defaults to false", async () => {
    assert.strictEqual(await storage.getDevToolsMode(), false);
  });

  test("setDevToolsMode/getDevToolsMode round-trip through chrome.storage.local", async () => {
    await storage.setDevToolsMode(true);
    assert.strictEqual(await storage.getDevToolsMode(), true);
    assert.strictEqual(stores.localStore.get("devToolsMode"), true);
    // Never synced.
    assert.strictEqual(stores.syncStore.has("devToolsMode"), false);
  });

  test("devToolsMode and devMode are independent keys: flipping one leaves the other untouched", async () => {
    await storage.setDevMode(true);
    assert.strictEqual(await storage.getDevToolsMode(), false, "devToolsMode must stay off when only devMode is set");

    await storage.setDevToolsMode(true);
    assert.strictEqual(await storage.getDevMode(), true, "devMode must be unaffected by setDevToolsMode");
    assert.strictEqual(await storage.getDevToolsMode(), true);

    await storage.setDevMode(false);
    assert.strictEqual(await storage.getDevToolsMode(), true, "turning devMode off must not turn devToolsMode off");
  });

  test("devToolsMode is NOT in PREF_DEFAULTS (not a synced pref)", () => {
    assert.strictEqual(
      Object.prototype.hasOwnProperty.call(storage.PREF_DEFAULTS, "devToolsMode"),
      false,
      "devToolsMode must not be in PREF_DEFAULTS — it lives in chrome.storage.local like devMode"
    );
  });
});

// ── DOM wiring: two gates, two panels, no cross-reference ──────────────────

describe("options.html — Developer tools lives outside the Advanced/dev-mode gate", () => {
  const cardIdx = optionsHtml.indexOf('id="dev-tools-card"');
  // #dev-tools-card nests its own <section id="follow-shorteners">...</section>
  // BEFORE Import/Export, so indexOf("</section>", cardIdx) would find that
  // inner close instead of the real end of #section-dev. Anchor on
  // #import-file instead: it is the last control inside #dev-tools-card, with
  // no further nested <section> after it, so the next </section> found from
  // there is the genuine close of the Advanced section.
  const importFileIdx = optionsHtml.indexOf('id="import-file"');
  const advancedSectionCloseIdx = optionsHtml.indexOf("</section>", importFileIdx);
  const devToolsSectionIdx = optionsHtml.indexOf('id="section-dev-tools"');
  const devToolsPanelIdx = optionsHtml.indexOf('id="dev-tools-panel"');
  const devToolsModeCheckboxIdx = optionsHtml.indexOf('id="dev-tools-mode"');
  const qaControlIdx = optionsHtml.indexOf('id="dev-preview-notify-btn"');

  test("all anchors exist", () => {
    assert.ok(cardIdx !== -1, "#dev-tools-card must still exist (Advanced panel)");
    assert.ok(importFileIdx !== -1, "#import-file must still exist inside #dev-tools-card");
    assert.ok(advancedSectionCloseIdx !== -1, "the Advanced section must close");
    assert.ok(devToolsSectionIdx !== -1, "#section-dev-tools must exist");
    assert.ok(devToolsPanelIdx !== -1, "#dev-tools-panel must exist");
    assert.ok(devToolsModeCheckboxIdx !== -1, "#dev-tools-mode checkbox must exist");
    assert.ok(qaControlIdx !== -1, "the preview-affiliate-notification QA button must exist");
  });

  test("#section-dev-tools starts AFTER the Advanced (#section-dev) section closes", () => {
    assert.ok(
      devToolsSectionIdx > advancedSectionCloseIdx,
      "Developer tools must be a sibling section, not nested inside Advanced"
    );
  });

  test("Developer tools QA controls live inside #section-dev-tools, not inside #dev-tools-card", () => {
    assert.ok(
      qaControlIdx > devToolsSectionIdx,
      "QA controls (e.g. #dev-preview-notify-btn) must live inside #section-dev-tools"
    );
    assert.ok(
      qaControlIdx > advancedSectionCloseIdx,
      "QA controls must live AFTER the Advanced section closes — never nested inside #dev-tools-card"
    );
  });

  test("#dev-tools-mode has its own aria-label, distinct from #dev-mode", () => {
    assert.ok(
      optionsHtml.includes('data-i18n-aria-label="aria_dev_tools_mode"'),
      "the #dev-tools-mode row must carry data-i18n-aria-label=\"aria_dev_tools_mode\""
    );
  });

  test("#dev-tools-panel starts hidden the same way #dev-tools-card does (dev-tools-hidden class)", () => {
    const panelTagStart = optionsHtml.indexOf("<div", optionsHtml.lastIndexOf("\n", devToolsPanelIdx));
    const panelTag = optionsHtml.slice(panelTagStart, optionsHtml.indexOf(">", panelTagStart) + 1);
    assert.ok(panelTag.includes("dev-tools-hidden"), "#dev-tools-panel must start with class=\"dev-tools-hidden\"");
  });

  test("the old dev-tools-disclosure <details> wrapper is gone — the toggle is the gate now", () => {
    // Scoped to the dev-tools-disclosure class specifically: options.html
    // legitimately uses <details> elsewhere (e.g. the remote-rules changelog),
    // so this must not be a blanket "no <details> anywhere" assertion.
    assert.ok(!optionsHtml.includes("dev-tools-disclosure"), "the dev-tools-disclosure <details> wrapper must be removed");
  });
});

describe("options.js — syncDevTools and syncDevToolsPanel never cross-reference each other's ids", () => {
  function extractFunctionBody(source, name) {
    const start = source.indexOf(`function ${name}(`);
    assert.ok(start !== -1, `function ${name} must exist in options.js`);
    const braceStart = source.indexOf("{", start);
    let depth = 0;
    let i = braceStart;
    for (; i < source.length; i++) {
      if (source[i] === "{") depth++;
      else if (source[i] === "}") {
        depth--;
        if (depth === 0) break;
      }
    }
    return source.slice(start, i + 1);
  }

  const syncDevToolsBody = extractFunctionBody(optionsJs, "syncDevTools");
  const syncDevToolsPanelBody = extractFunctionBody(optionsJs, "syncDevToolsPanel");

  test("syncDevTools only touches #dev-mode / #dev-tools-card", () => {
    assert.ok(syncDevToolsBody.includes('"dev-mode"'));
    assert.ok(syncDevToolsBody.includes('"dev-tools-card"'));
    assert.ok(!syncDevToolsBody.includes('"dev-tools-mode"'), "syncDevTools must not reference #dev-tools-mode");
    assert.ok(!syncDevToolsBody.includes('"dev-tools-panel"'), "syncDevTools must not reference #dev-tools-panel");
  });

  test("syncDevToolsPanel only touches #dev-tools-mode / #dev-tools-panel", () => {
    assert.ok(syncDevToolsPanelBody.includes('"dev-tools-mode"'));
    assert.ok(syncDevToolsPanelBody.includes('"dev-tools-panel"'));
    assert.ok(!syncDevToolsPanelBody.includes('"dev-mode"'), "syncDevToolsPanel must not reference #dev-mode");
    assert.ok(!syncDevToolsPanelBody.includes('"dev-tools-card"'), "syncDevToolsPanel must not reference #dev-tools-card");
  });

  test("options.js imports getDevToolsMode/setDevToolsMode from storage.js", () => {
    assert.ok(optionsJs.includes("getDevToolsMode"), "options.js must import getDevToolsMode");
    assert.ok(optionsJs.includes("setDevToolsMode"), "options.js must import setDevToolsMode");
  });

  test("the #dev-tools-mode checkbox is bound with its own change listener (not reused from #dev-mode)", () => {
    assert.ok(
      optionsJs.includes('document.getElementById("dev-tools-mode")'),
      "options.js must bind #dev-tools-mode independently"
    );
  });
});

// ── Copy: advanced_mode_hint no longer promises developer tools ────────────

describe("advanced_mode_hint no longer mentions developer tools (#1271 item 1)", () => {
  function readLocale(code) {
    const src = readFileSync(join(ROOT, `src/lib/locales/${code}.mjs`), "utf8");
    const m = src.match(/advanced_mode_hint:\s*"([^"]*)"/);
    assert.ok(m, `${code}.mjs must define advanced_mode_hint`);
    return m[1];
  }

  test("en: advanced_mode_hint does not mention developer tools", () => {
    const hint = readLocale("en");
    assert.ok(!/developer/i.test(hint), `en advanced_mode_hint must not promise developer tools, got: "${hint}"`);
  });

  test("es: advanced_mode_hint does not mention developer tools", () => {
    const hint = readLocale("es");
    assert.ok(
      !/desarroll/i.test(hint),
      `es advanced_mode_hint must not promise developer tools, got: "${hint}"`
    );
  });

  test("all 7 locales define aria_dev_tools_mode with a non-empty value", () => {
    for (const code of ["en", "es", "de", "fr", "it", "ja", "pt"]) {
      const src = readFileSync(join(ROOT, `src/lib/locales/${code}.mjs`), "utf8");
      const m = src.match(/aria_dev_tools_mode:\s*"([^"]*)"/);
      assert.ok(m, `${code}.mjs must define aria_dev_tools_mode`);
      assert.ok(m[1].trim().length > 0, `${code}.mjs aria_dev_tools_mode must not be empty`);
    }
  });
});
