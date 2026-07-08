/**
 * MUGA — Firefox MV2 page-world wrap contract (#509 / B12).
 *
 * Chrome MV3 loads `history-defuser-mainworld.js` and
 * `window-name-defuser-mainworld.js` automatically via the `world: "MAIN"`
 * content-script directive in `src/manifest.json`. Firefox MV2 has no such
 * directive, so each isolated-world dispatcher must install the page-world
 * wrap itself.
 *
 * HISTORY DEFUSER — CSP-immune wrap (fixed): the previous `<script src=...>`
 * injection was silently blocked by strict page CSPs (e.g. Amazon), so
 * pushState "section" navigations were never cleaned on Firefox. It now wraps
 * `history.pushState`/`replaceState` directly from the isolated world via
 * Firefox's `window.wrappedJSObject` + `exportFunction` — no `<script>`
 * element, so no CSP can block it. This test pins that mechanism and, crucially,
 * asserts NO `<script>` element is created for the history wrap.
 *
 * WINDOW-NAME DEFUSER — CSP-immune wrap (fixed #509 / B12): same story. The
 * `<script src=...>` injection of window-name-defuser-mainworld.js was blocked
 * by strict page CSPs, so `window.name` was never defused on those sites.
 * window-name-defuser.js now installs the page-world `window.name` accessor
 * directly via `window.wrappedJSObject` + `exportFunction` — no `<script>`
 * element. This test pins that mechanism and asserts NO `<script>` element is
 * created for the window-name wrap either. The mainworld script stays for
 * Chrome MV3 (world:MAIN) and remains web-accessible in MV2 for parity with
 * history-defuser-mainworld.js.
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

  test("window-name-defuser-mainworld.js stays web-accessible in MV2 (parity with history)", () => {
    // The isolated-world dispatcher no longer <script src>-injects it (the
    // CSP-immune port wraps window.name via wrappedJSObject instead), but the
    // entry is retained for parity with history-defuser-mainworld.js and is
    // harmless — it only exposes an already-public source file.
    assert.ok(
      mv2Manifest.web_accessible_resources.includes("content/window-name-defuser-mainworld.js"),
      "MV2 keeps window-name-defuser-mainworld.js web-accessible for parity",
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

describe("history-defuser.js wraps the page world CSP-immune on MV2 (#509)", () => {
  test("gates the Firefox wrap on manifest_version === 2", () => {
    assert.match(
      histDefuserSrc,
      /manifest_version[^]*===[^]*2/,
      "history-defuser.js must check manifest_version === 2 before wrapping",
    );
  });

  test("wraps pushState/replaceState via wrappedJSObject + exportFunction (not a <script>)", () => {
    assert.match(
      histDefuserSrc,
      /window\.wrappedJSObject/,
      "history-defuser.js must reach the page world via window.wrappedJSObject",
    );
    assert.match(
      histDefuserSrc,
      /exportFunction/,
      "history-defuser.js must inject the wrap via Firefox's exportFunction",
    );
    assert.match(histDefuserSrc, /pushState/, "history-defuser.js must wrap pushState");
    assert.match(histDefuserSrc, /replaceState/, "history-defuser.js must wrap replaceState");
  });

  test("CSP-immunity guarantee — history-defuser.js creates NO <script> element", () => {
    // The whole point of the fix: a strict page CSP (Amazon) blocks an injected
    // <script src="moz-extension://...">. Wrapping via wrappedJSObject creates no
    // <script>, so nothing for the CSP to block. This assertion is the regression
    // guard against a future revert to the injection approach.
    assert.doesNotMatch(
      histDefuserSrc,
      /document\.createElement\(["'`]script["'`]\)/,
      "history-defuser.js must NOT create a <script> element — that reintroduces the CSP-block bug",
    );
  });
});

describe("window-name-defuser.js wraps the page world CSP-immune on MV2 (#509)", () => {
  test("gates the Firefox wrap on manifest_version === 2", () => {
    assert.match(
      winNameDefuserSrc,
      /manifest_version[^]*===[^]*2/,
      "window-name-defuser.js must check manifest_version === 2 before wrapping",
    );
  });

  test("wraps window.name via wrappedJSObject + exportFunction (not a <script>)", () => {
    assert.match(
      winNameDefuserSrc,
      /window\.wrappedJSObject/,
      "window-name-defuser.js must reach the page world via window.wrappedJSObject",
    );
    assert.match(
      winNameDefuserSrc,
      /exportFunction/,
      "window-name-defuser.js must inject the wrap via Firefox's exportFunction",
    );
    assert.match(
      winNameDefuserSrc,
      /Object\.defineProperty\s*\(\s*pageWindow\s*,\s*["'`]name["'`]/,
      "window-name-defuser.js must redefine window.name on the page-world object",
    );
  });

  test("CSP-immunity guarantee — window-name-defuser.js creates NO <script> element", () => {
    // The whole point of the fix: a strict page CSP blocks an injected
    // <script src="moz-extension://...">. Wrapping via wrappedJSObject creates
    // no <script>, so nothing for the CSP to block. This assertion is the
    // regression guard against a future revert to the injection approach.
    assert.doesNotMatch(
      winNameDefuserSrc,
      /document\.createElement\(["'`]script["'`]\)/,
      "window-name-defuser.js must NOT create a <script> element — that reintroduces the CSP-block bug",
    );
    assert.doesNotMatch(
      winNameDefuserSrc,
      /chrome\.runtime\.getURL\(["'`]content\/window-name-defuser-mainworld\.js["'`]\)/,
      "window-name-defuser.js must NOT load the mainworld resource by URL — the wrap is inline now",
    );
  });
});
