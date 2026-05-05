/**
 * MUGA — Firefox MV2 page-world injection contract (#509 / B12).
 *
 * Chrome MV3 loads `history-defuser-mainworld.js` and
 * `window-name-defuser-mainworld.js` automatically via the
 * `world: "MAIN"` content-script directive in `src/manifest.json`.
 * Firefox MV2 (the manifest currently shipped to AMO) has no such
 * directive — the page-world wrap must be injected by the matching
 * isolated-world content script as a `<script src=...>` element
 * pointing at the extension's web-accessible resource.
 *
 * This test pins three facts that must hold together for the
 * Firefox path to actually wrap the page world:
 *
 *   1. The MV2 `web_accessible_resources` array exposes both
 *      mainworld scripts so the page can load them by URL.
 *   2. Each isolated-world dispatcher contains the inject helper
 *      gated on `manifest_version === 2` (so MV3 doesn't double-
 *      bootstrap).
 *   3. Each isolated-world dispatcher names the matching mainworld
 *      file in the `chrome.runtime.getURL` argument — typo-proofs
 *      the linkage between the two halves.
 *
 * If any of these break, Firefox users silently lose the active-
 * defense layer (B10/B11) — the unit tests stub the page world so
 * they don't catch this; only Playwright Firefox would, and that
 * spec is a follow-up to this slice.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");

const mv2Manifest = JSON.parse(readFileSync(resolve(ROOT, "src/manifest.v2.json"), "utf8"));
const mv3Manifest = JSON.parse(readFileSync(resolve(ROOT, "src/manifest.json"), "utf8"));
const histDefuserSrc = readFileSync(resolve(ROOT, "src/content/history-defuser.js"), "utf8");
const winNameDefuserSrc = readFileSync(resolve(ROOT, "src/content/window-name-defuser.js"), "utf8");

describe("Firefox MV2 web_accessible_resources expose the mainworld scripts (#509)", () => {
  test("manifest.v2.json declares web_accessible_resources as an array", () => {
    assert.ok(Array.isArray(mv2Manifest.web_accessible_resources),
      "MV2 web_accessible_resources must be an array");
  });

  test("history-defuser-mainworld.js is web-accessible in MV2", () => {
    assert.ok(
      mv2Manifest.web_accessible_resources.includes("content/history-defuser-mainworld.js"),
      "MV2 must expose history-defuser-mainworld.js so the isolated-world script can <script src> it",
    );
  });

  test("window-name-defuser-mainworld.js is web-accessible in MV2", () => {
    assert.ok(
      mv2Manifest.web_accessible_resources.includes("content/window-name-defuser-mainworld.js"),
      "MV2 must expose window-name-defuser-mainworld.js for the same reason",
    );
  });

  test("MV3 keeps the world: 'MAIN' content_scripts entry — native page-world load (no inject needed)", () => {
    // MV3 doesn't need web_accessible_resources for the mainworld
    // scripts — it loads them as content scripts with world: MAIN.
    // This test is a regression guard: removing the world: MAIN entry
    // would silently break Chrome.
    const mainWorldEntries = (mv3Manifest.content_scripts || []).filter((e) => e.world === "MAIN");
    assert.ok(
      mainWorldEntries.length > 0,
      "MV3 manifest must have at least one content_scripts entry with world: 'MAIN'",
    );
    const allMainJs = mainWorldEntries.flatMap((e) => e.js || []);
    assert.ok(allMainJs.includes("content/history-defuser-mainworld.js"));
    assert.ok(allMainJs.includes("content/window-name-defuser-mainworld.js"));
  });
});

describe("Isolated-world dispatchers inject the mainworld script when running on MV2 (#509)", () => {
  test("history-defuser.js gates the inject on manifest_version === 2", () => {
    assert.match(
      histDefuserSrc,
      /manifest_version[^]*===[^]*2/,
      "history-defuser.js must check manifest_version === 2 before injecting",
    );
  });

  test("history-defuser.js injects the matching mainworld script via chrome.runtime.getURL", () => {
    assert.match(
      histDefuserSrc,
      /chrome\.runtime\.getURL\(["'`]content\/history-defuser-mainworld\.js["'`]\)/,
      "history-defuser.js must reference the mainworld resource by exact path",
    );
    assert.match(
      histDefuserSrc,
      /document\.createElement\(["'`]script["'`]\)/,
      "history-defuser.js must create a <script> element to inject the wrap",
    );
  });

  test("window-name-defuser.js gates the inject on manifest_version === 2", () => {
    assert.match(
      winNameDefuserSrc,
      /manifest_version[^]*===[^]*2/,
      "window-name-defuser.js must check manifest_version === 2 before injecting",
    );
  });

  test("window-name-defuser.js injects the matching mainworld script via chrome.runtime.getURL", () => {
    assert.match(
      winNameDefuserSrc,
      /chrome\.runtime\.getURL\(["'`]content\/window-name-defuser-mainworld\.js["'`]\)/,
      "window-name-defuser.js must reference the mainworld resource by exact path",
    );
    assert.match(
      winNameDefuserSrc,
      /document\.createElement\(["'`]script["'`]\)/,
      "window-name-defuser.js must create a <script> element to inject the wrap",
    );
  });

  test("inject helpers append the script synchronously (async=false) so it runs before page scripts", () => {
    for (const [name, src] of [["history-defuser.js", histDefuserSrc], ["window-name-defuser.js", winNameDefuserSrc]]) {
      assert.match(
        src,
        /\.async\s*=\s*false/,
        `${name} must set script.async=false so the page-world wrap installs before any page script runs`,
      );
    }
  });
});
