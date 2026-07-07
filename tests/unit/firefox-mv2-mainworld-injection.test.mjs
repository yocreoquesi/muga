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
 * WINDOW-NAME DEFUSER — still uses the `<script src=...>` injection (its
 * CSP-immune port is a follow-up). Its injection contract is still pinned here.
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

  test("window-name-defuser-mainworld.js is web-accessible in MV2 (still <script src>'d)", () => {
    assert.ok(
      mv2Manifest.web_accessible_resources.includes("content/window-name-defuser-mainworld.js"),
      "MV2 must expose window-name-defuser-mainworld.js so its isolated-world dispatcher can <script src> it",
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

describe("window-name-defuser.js still injects the mainworld script on MV2 (pending CSP-immune port)", () => {
  test("gates the inject on manifest_version === 2", () => {
    assert.match(
      winNameDefuserSrc,
      /manifest_version[^]*===[^]*2/,
      "window-name-defuser.js must check manifest_version === 2 before injecting",
    );
  });

  test("injects the matching mainworld script via chrome.runtime.getURL", () => {
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

  test("appends the script synchronously (async=false) so it runs before page scripts", () => {
    assert.match(
      winNameDefuserSrc,
      /\.async\s*=\s*false/,
      "window-name-defuser.js must set script.async=false so the page-world wrap installs before any page script runs",
    );
  });
});
