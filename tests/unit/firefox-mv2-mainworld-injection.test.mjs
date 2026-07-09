/**
 * MUGA — Firefox MV2 page-world wrap contract (#509 / B12, #1026).
 *
 * Chrome MV3 loads `history-defuser-mainworld.js` and
 * `window-name-defuser-mainworld.js` automatically via the `world: "MAIN"`
 * content-script directive in `src/manifest.json`. Firefox MV2 has no such
 * directive and does not support `world: "MAIN"` at all, so these two files
 * are Chrome-MV3-only: they are NOT part of `src/manifest.v2.json` at all
 * (neither as a content script nor as a web-accessible resource). Each
 * isolated-world dispatcher installs the page-world wrap itself instead.
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
 * created for the window-name wrap either.
 *
 * #1026 follow-up: the two *-mainworld.js files used to also be loaded on
 * Firefox as an ordinary ISOLATED content_scripts group (a leftover from the
 * old `<script>`-injection mechanism). They have no manifest_version guard
 * and no wrappedJSObject use, so on Firefox they ran against the Xray-wrapped
 * isolated-sandbox window and did nothing real, while also registering their
 * nonce listener too late to ever open the gate. They have been removed from
 * `src/manifest.v2.json` entirely; the mainworld script stays Chrome-MV3-only
 * (world:MAIN).
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

describe("Firefox MV2 does not load the Chrome-only mainworld scripts (#1026)", () => {
  test("manifest.v2.json declares web_accessible_resources as an array", () => {
    assert.ok(Array.isArray(mv2Manifest.web_accessible_resources),
      "MV2 web_accessible_resources must be an array");
  });

  test("manifest.v2.json content_scripts do not reference the *-mainworld.js files", () => {
    // These files have no manifest_version guard and no wrappedJSObject use
    // (they can't reach the page window from world:MAIN on Chrome). Loading
    // them as an ordinary ISOLATED content script on Firefox (as a leftover
    // second content_scripts group) makes them run against the Xray-wrapped
    // isolated-sandbox window, where their wraps are inert, and registers
    // their nonce listener too late to ever open the gate (#1026). They must
    // not appear anywhere in MV2's content_scripts.
    const allMv2Js = (mv2Manifest.content_scripts || []).flatMap((e) => e.js || []);
    assert.ok(
      !allMv2Js.includes("content/history-defuser-mainworld.js"),
      "MV2 content_scripts must NOT include history-defuser-mainworld.js",
    );
    assert.ok(
      !allMv2Js.includes("content/window-name-defuser-mainworld.js"),
      "MV2 content_scripts must NOT include window-name-defuser-mainworld.js",
    );
  });

  test("manifest.v2.json web_accessible_resources do not expose the *-mainworld.js files", () => {
    // These entries only existed for the old <script>-injection mechanism,
    // which is gone. The mainworld files are Chrome-MV3-only now, so Firefox
    // has no reason to expose them as web-accessible resources.
    assert.ok(
      !mv2Manifest.web_accessible_resources.includes("content/history-defuser-mainworld.js"),
      "MV2 web_accessible_resources must NOT include history-defuser-mainworld.js",
    );
    assert.ok(
      !mv2Manifest.web_accessible_resources.includes("content/window-name-defuser-mainworld.js"),
      "MV2 web_accessible_resources must NOT include window-name-defuser-mainworld.js",
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
