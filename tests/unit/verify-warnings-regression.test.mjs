/**
 * Regression guards for `sdd-verify` warnings on the remote-rules-update change.
 *
 * Each test pins a specific past defect so it cannot silently return.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "../..");

const swSource = readFileSync(join(ROOT, "src/background/service-worker.js"), "utf8");
const optionsSource = readFileSync(join(ROOT, "src/options/options.js"), "utf8");
const remoteRulesSource = readFileSync(join(ROOT, "src/lib/remote-rules.js"), "utf8");

describe("W-1 regression: GET_STATUS meta is flattened in options.js", () => {
  test("options.js un-nests resp.meta when merging into status", () => {
    // If the spread is just `{ ...status, ...resp }` then `meta` is an opaque
    // object and `status.fetchedAt` / `status.paramCount` stay null.
    // The fix splats `resp.meta` alongside `resp`.
    assert.ok(
      /\.\.\.resp\.meta|\.\.\.\(resp\.meta[^}]*\}\)/.test(optionsSource) ||
        /\.\.\.meta(?:\b|[^.])/.test(optionsSource),
      "options.js should spread resp.meta (or an equivalent flattening) into the status object"
    );
  });

  test("renderRemoteRulesStatus reads fetchedAt/paramCount/lastError at the top level", () => {
    // If the render function reads from a nested .meta path, W-1 is back.
    const renderFn = optionsSource.match(/function renderRemoteRulesStatus[\s\S]+?^\}/m);
    assert.ok(renderFn, "renderRemoteRulesStatus function should exist");
    const body = renderFn[0];
    assert.ok(
      /status\.fetchedAt|status\.paramCount|status\.lastError/.test(body),
      "render should read fetchedAt/paramCount/lastError at top level"
    );
    assert.ok(
      !/status\.meta\.(fetchedAt|paramCount|lastError)/.test(body),
      "render must NOT read status.meta.* — that reintroduces W-1"
    );
  });
});

describe("W-2 regression: fetchWithCap error code preserved", () => {
  test("runRemoteRulesFetch does not coerce all errors to NETWORK_ERROR", () => {
    // The original defect: `err.code === ERR.OVER_CAP ? ERR.NETWORK_ERROR : ERR.NETWORK_ERROR`
    // (identical branches) hid OVER_CAP from the user-visible meta.lastError.
    const badTernary = /err\.code\s*===\s*ERR\.OVER_CAP\s*\?\s*ERR\.NETWORK_ERROR\s*:\s*ERR\.NETWORK_ERROR/;
    assert.ok(
      !badTernary.test(remoteRulesSource),
      "remote-rules.js must not map OVER_CAP to NETWORK_ERROR via identical ternary branches (W-2)"
    );
  });

  test("error code falls back to NETWORK_ERROR only when code is absent", () => {
    // The fix pattern: `err.code || ERR.NETWORK_ERROR`. Any specific code
    // from fetchWithCap (OVER_CAP) or other throws is preserved.
    assert.ok(
      /err\.code\s*\|\|\s*ERR\.NETWORK_ERROR/.test(remoteRulesSource),
      "remote-rules.js should use `err.code || ERR.NETWORK_ERROR` so OVER_CAP survives"
    );
  });
});

describe("W-3 regression: remoteParams merged into prefs cache", () => {
  test("getPrefsWithCache fetches both sync prefs and local remoteParams", () => {
    // If the cache only reads sync storage, processUrl() on the copy/context-menu
    // path sees prefs.remoteParams === undefined and the cleaner falls back to [].
    // Remote params would then only strip on DNR (navigation), violating REQ-MERGE-5.
    assert.ok(
      /getRemoteParams/.test(swSource),
      "service-worker.js should import and call getRemoteParams to merge remote rules into the prefs cache (REQ-MERGE-5)"
    );
    // The merge happens inside getPrefsWithCache's fetch promise.
    const cacheFn = swSource.match(/function getPrefsWithCache[\s\S]+?^\}/m);
    assert.ok(cacheFn, "getPrefsWithCache should exist");
    assert.ok(
      /remote(Params|\.remoteParams)/.test(cacheFn[0]),
      "getPrefsWithCache body must assign remoteParams onto the cached prefs object"
    );
  });

  test("storage.onChanged invalidates the cache on local remoteParams writes", () => {
    // Without this, a remote-rules fetch updates local.remoteParams but the
    // still-cached prefs keep the stale [] — copy-clean strips nothing.
    const listener = swSource.match(/chrome\.storage\.onChanged\.addListener[\s\S]+?^\}\);/m);
    assert.ok(listener, "storage.onChanged listener should exist");
    const body = listener[0];
    assert.ok(
      /area\s*===\s*["']local["']/.test(body) && /remoteParams/.test(body),
      "storage listener must handle local area changes to remoteParams and invalidate the cache"
    );
  });
});

describe("S-3 regression: REMOTE_ERR_KEYS covers NETWORK_ERROR", () => {
  test("options.js REMOTE_ERR_KEYS maps NETWORK_ERROR to an i18n key", () => {
    const map = optionsSource.match(/const REMOTE_ERR_KEYS\s*=\s*Object\.freeze\(\{[\s\S]+?\}\)/);
    assert.ok(map, "REMOTE_ERR_KEYS map should exist");
    assert.ok(
      /NETWORK_ERROR\s*:\s*["']optionsRemoteRulesErrNetwork["']/.test(map[0]),
      "REMOTE_ERR_KEYS must include NETWORK_ERROR so W-2 surfaces with the right i18n message"
    );
  });

  test("REMOTE_ERR_KEYS covers every ERR code from remote-rules.js", () => {
    const errBlock = remoteRulesSource.match(/export const ERR\s*=\s*Object\.freeze\(\{([\s\S]+?)\}\)/);
    assert.ok(errBlock, "ERR constants should exist in remote-rules.js");
    const errNames = Array.from(errBlock[1].matchAll(/^\s*([A-Z_]+)\s*:/gm), m => m[1]);
    assert.ok(errNames.length >= 8, `expected ≥8 error codes, found ${errNames.length}`);
    const map = optionsSource.match(/const REMOTE_ERR_KEYS\s*=\s*Object\.freeze\(\{([\s\S]+?)\}\)/);
    for (const code of errNames) {
      assert.ok(
        new RegExp(`${code}\\s*:\\s*["']`).test(map[1]),
        `REMOTE_ERR_KEYS must include ${code} (found in ERR) so the UI surfaces it with a translated message`
      );
    }
  });
});
