/**
 * Regression guard for the v1.10.2 reactive popup status.
 *
 * Before v1.10.2 the popup computed "MUGA is disabled" (or the clean
 * preview) once at open time. Toggling the extension on/off, or adding
 * the current domain to the blacklist-with-::disabled, did not update
 * the popup until it was reopened. These tests pin the reactive
 * re-render wiring so it cannot silently regress.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "../..");
const popupSource = readFileSync(resolve(ROOT, "src/popup/popup.js"), "utf8");
// i18nSource removed — translation data moved to src/lib/locales/*.mjs (#834).

describe("popup reactive status (v1.10.2)", () => {
  test("popup.js imports parseListEntry from cleaner.js", () => {
    assert.ok(
      /import\s*\{[^}]*parseListEntry[^}]*\}\s*from\s*["']\.\.\/lib\/cleaner\.js["']/.test(popupSource),
      "popup.js must import parseListEntry to evaluate per-domain disable entries"
    );
  });

  test("popup.js defines isPerDomainDisabled helper", () => {
    assert.ok(
      /function\s+isPerDomainDisabled\s*\(/.test(popupSource),
      "popup.js must declare isPerDomainDisabled(hostname, blacklist) helper"
    );
  });

  test("popup.js checks per-domain disable and renders muga_disabled_for_domain", () => {
    assert.ok(
      /isPerDomainDisabled\s*\(/.test(popupSource),
      "popup.js must call isPerDomainDisabled before the normal preview"
    );
    assert.ok(
      /t\(\s*["']muga_disabled_for_domain["']/.test(popupSource),
      "popup.js must render the muga_disabled_for_domain i18n key when the domain is opted out"
    );
  });

  test("popup.js registers chrome.storage.onChanged listener for reactivity", () => {
    assert.ok(
      /chrome\.storage\.onChanged\.addListener/.test(popupSource),
      "popup.js must listen to storage changes so the preview updates reactively"
    );
  });

  test("popup.js storage listener watches enabled, blacklist, whitelist at minimum", () => {
    const listenerMatch = popupSource.match(/chrome\.storage\.onChanged\.addListener\(([\s\S]+?)\}\s*\)\s*;/);
    assert.ok(listenerMatch, "storage.onChanged listener body should be findable");
    const body = listenerMatch[1];
    assert.ok(body.includes("changes.enabled"),   "listener must watch changes.enabled");
    assert.ok(body.includes("changes.blacklist"), "listener must watch changes.blacklist (per-domain disable lives here)");
    assert.ok(body.includes("changes.whitelist"), "listener must watch changes.whitelist");
    assert.ok(/showUrlPreview\s*\(/.test(body),   "listener must call showUrlPreview to re-render");
  });

  test("popup.js enabled-toggle change handler also triggers an optimistic re-render", () => {
    // Grab the block following `enabledToggle.addEventListener("change"` until the matching }).
    const idx = popupSource.indexOf('enabledToggle.addEventListener("change"');
    assert.ok(idx !== -1, "enabled-toggle change handler must exist");
    const block = popupSource.slice(idx, idx + 600);
    assert.ok(
      /showUrlPreview\s*\(/.test(block),
      "the enabled-toggle change handler must re-render the preview optimistically (before the storage roundtrip)"
    );
  });

  test("_resetPreviewDom helper exists so re-renders are idempotent", () => {
    assert.ok(
      /function\s+_resetPreviewDom\s*\(/.test(popupSource),
      "popup.js must expose _resetPreviewDom() so repeated showUrlPreview calls don't accumulate stale markup"
    );
    assert.ok(
      /_resetPreviewDom\s*\(\s*\)/.test(popupSource),
      "_resetPreviewDom must be called from showUrlPreview"
    );
  });

  test("muga_disabled_for_domain i18n key is defined in all 4 locales", () => {
    // Translation data moved to per-locale files under src/lib/locales/ (#834).
    // Check each locale file directly for the key with a non-empty value.
    for (const loc of ["en", "es", "pt", "de"]) {
      const localeSource = readFileSync(resolve(ROOT, `src/lib/locales/${loc}.mjs`), "utf8");
      assert.ok(
        /muga_disabled_for_domain\s*:\s*"[^"]+"/.test(localeSource),
        `muga_disabled_for_domain must have a non-empty ${loc} translation in src/lib/locales/${loc}.mjs`
      );
    }
  });
});
