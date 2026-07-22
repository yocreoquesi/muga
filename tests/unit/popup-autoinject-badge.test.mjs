/**
 * MUGA — Popup passive badge for auto-injected affiliate tags
 * (affiliate-autoinject-notice, ADR-c "passive" surface).
 *
 * Modeled on popup-honored-creator-badge.test.mjs / popup-preserved-creator.test.mjs:
 * the badge is hidden by default, reset every render, and renders whenever
 * `result.autoInjected` was present on the last landing — INDEPENDENT of
 * `notifyForeignAffiliate` (the popup preview call always forces that pref
 * off; the badge must not be gated on it, since it is a passive surface the
 * user only sees by opening the popup, never an interruption).
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "../..");

import { makeChromeMock } from "./helpers/chrome-stub.mjs";
globalThis.chrome = makeChromeMock({ hasSession: false, promiseShape: true });

const { TRANSLATIONS } = await import("../../src/lib/i18n.js");
const { isAutoInjectedTagPresent } = await import("../../src/lib/affiliates.js");

describe("autoinject_badge i18n key", () => {
  test("exists with en + es, references {platform}", () => {
    assert.ok(Object.prototype.hasOwnProperty.call(TRANSLATIONS, "autoinject_badge"));
    const k = TRANSLATIONS.autoinject_badge;
    assert.ok(typeof k.en === "string" && k.en.length > 0);
    assert.ok(typeof k.es === "string" && k.es.length > 0);
    assert.ok(k.en.includes("{platform}"));
    assert.ok(k.es.includes("{platform}"));
  });
});

describe("popup.html — #preview-autoinject slot", () => {
  const html = readFileSync(resolve(root, "src/popup/popup.html"), "utf8");

  test("popup.html exposes #preview-autoinject inside #preview, hidden by default", () => {
    assert.match(html, /id="preview-autoinject"[^>]*hidden/, "must be hidden by default");
    const previewOpenIdx = html.indexOf('id="preview"');
    const badgeIdx = html.indexOf('id="preview-autoinject"');
    const previewCloseIdx = html.indexOf("</section>", previewOpenIdx);
    assert.ok(badgeIdx > previewOpenIdx && badgeIdx < previewCloseIdx, "#preview-autoinject must live inside #preview");
  });
});

describe("popup.js — autoInjected badge wiring", () => {
  const popupSrc = readFileSync(resolve(root, "src/popup/popup.js"), "utf8");

  test("renders the badge when result.autoInjected is present", () => {
    assert.match(popupSrc, /result\.autoInjected/, "popup.js must consult result.autoInjected");
    assert.match(popupSrc, /autoinject_badge/, "popup.js must reference the autoinject_badge i18n key");
    assert.match(popupSrc, /\{platform\}/, "popup.js must substitute the {platform} placeholder");
  });

  test("badge render is NOT gated on notifyForeignAffiliate (passive surface, ADR-c)", () => {
    const idx = popupSrc.indexOf("result.autoInjected");
    assert.ok(idx > -1);
    const block = popupSrc.slice(Math.max(0, idx - 300), idx + 300);
    assert.ok(
      !/notifyForeignAffiliate/.test(block),
      "the autoInjected badge branch must not check notifyForeignAffiliate — it renders regardless",
    );
  });

  test("_resetPreviewDom clears the preview-autoinject badge", () => {
    const fnIdx = popupSrc.indexOf("function _resetPreviewDom");
    assert.ok(fnIdx !== -1, "popup.js must define _resetPreviewDom");
    const slice = popupSrc.slice(fnIdx, fnIdx + 4000);
    assert.ok(slice.includes("preview-autoinject"), "_resetPreviewDom must reset the preview-autoinject slot");
  });

  test("LOW-2: badge branch also gates on the tag still being present in cleanUrl", () => {
    // The badge render must require BOTH result.autoInjected AND that the exact
    // flagged pair still lives in result.cleanUrl — otherwise it surfaces a
    // stale signal (e.g. under stripAllAffiliates or a post-Remove re-nav where
    // the tag was already stripped).
    assert.match(popupSrc, /import\s*\{[^}]*isAutoInjectedTagPresent[^}]*\}\s*from\s*"\.\.\/lib\/affiliates\.js"/,
      "popup.js must import isAutoInjectedTagPresent");
    const idx = popupSrc.indexOf("if (result.autoInjected &&");
    assert.ok(idx > -1, "badge branch must AND-gate on the presence check");
    const block = popupSrc.slice(idx, idx + 200);
    assert.match(block, /isAutoInjectedTagPresent\(result\.cleanUrl,\s*result\.autoInjected\.param,\s*result\.autoInjected\.value\)/,
      "badge branch must call isAutoInjectedTagPresent(cleanUrl, param, value)");
  });
});

describe("isAutoInjectedTagPresent — badge visibility (LOW-2 behavioral)", () => {
  test("badge SHOWS: tag survived in the cleaned URL", () => {
    assert.equal(
      isAutoInjectedTagPresent("https://www.amazon.es/dp/B08N5WRWNW?tag=eleinst-21", "tag", "eleinst-21"),
      true,
    );
  });

  test("badge HIDDEN: tag was stripped from the cleaned URL", () => {
    assert.equal(
      isAutoInjectedTagPresent("https://www.amazon.es/dp/B08N5WRWNW", "tag", "eleinst-21"),
      false,
    );
  });
});
