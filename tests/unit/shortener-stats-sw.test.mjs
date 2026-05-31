/**
 * MUGA — Phase 4: shortener counter wiring in service-worker + default flip
 * (ADR-0004 phase 4, #700)
 *
 * Structural source-scan tests, mirroring the service-worker-privacy-proxy.test.mjs
 * style (import not possible due to Chrome API bindings).
 *
 * Tests RED-first.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "../..");

const swSource = readFileSync(join(root, "src/background/service-worker.js"), "utf8");
const storageSource = readFileSync(join(root, "src/lib/storage.js"), "utf8");
const require = createRequire(import.meta.url);
const pkg = require("../../package.json");
const mv3 = require("../../src/manifest.json");
const mv2 = require("../../src/manifest.v2.json");

// ── 1. Default flip ──────────────────────────────────────────────────────────

describe("ADR-0004 phase 4: useNativeShortenerResolution default is true", () => {
  test("PREF_DEFAULTS has useNativeShortenerResolution: true", () => {
    // Match the line: `  useNativeShortenerResolution: true`
    assert.ok(
      /useNativeShortenerResolution\s*:\s*true/.test(storageSource),
      "storage.js PREF_DEFAULTS must have useNativeShortenerResolution: true (phase 4 default flip)"
    );
  });

  test("PREF_DEFAULTS no longer has useNativeShortenerResolution: false", () => {
    // The value must not be false anymore
    const match = storageSource.match(/useNativeShortenerResolution\s*:\s*(\w+)/);
    assert.ok(match, "useNativeShortenerResolution must be in PREF_DEFAULTS");
    assert.notEqual(match[1], "false", "useNativeShortenerResolution must not be false (phase 4 flips the default)");
  });
});

// ── 2. Shortener stat increments in service worker ───────────────────────────

describe("ADR-0004 phase 4: shortener stat increments in service-worker", () => {
  test("service-worker imports incrementShortenerStat from storage", () => {
    assert.ok(
      swSource.includes("incrementShortenerStat"),
      "service-worker must import and call incrementShortenerStat"
    );
  });

  test("increments pass counter on successful native resolution", () => {
    const handlerStart = swSource.indexOf('"UNWRAP_VIA_PROXY"');
    assert.ok(handlerStart !== -1, "UNWRAP_VIA_PROXY handler must be present");
    const handlerSlice = swSource.slice(handlerStart, handlerStart + 4000);
    assert.ok(
      handlerSlice.includes("incrementShortenerStat") && handlerSlice.includes('"pass"'),
      "UNWRAP_VIA_PROXY handler must call incrementShortenerStat(..., 'pass') on success"
    );
  });

  test("increments fail counter on failed native resolution", () => {
    const handlerStart = swSource.indexOf('"UNWRAP_VIA_PROXY"');
    const handlerSlice = swSource.slice(handlerStart, handlerStart + 4000);
    assert.ok(
      handlerSlice.includes("incrementShortenerStat") && handlerSlice.includes('"fail"'),
      "UNWRAP_VIA_PROXY handler must call incrementShortenerStat(..., 'fail') on failure"
    );
  });

  test("pass/fail increments are only called on native path (useNativeShortenerResolution branch)", () => {
    // The dual-path selector is the condition; stat increments must be inside the native branch
    const handlerStart = swSource.indexOf('"UNWRAP_VIA_PROXY"');
    const handlerSlice = swSource.slice(handlerStart, handlerStart + 4000);
    const nativePathIdx = handlerSlice.indexOf("useNativeShortenerResolution");
    const statCallIdx = handlerSlice.indexOf("incrementShortenerStat");
    assert.ok(nativePathIdx !== -1, "UNWRAP_VIA_PROXY handler must reference useNativeShortenerResolution");
    assert.ok(statCallIdx > nativePathIdx, "incrementShortenerStat must appear AFTER the useNativeShortenerResolution check");
  });
});

// ── 3. Beta version ──────────────────────────────────────────────────────────

describe("ADR-0004 phase 4: beta version 2.2.0-beta.1", () => {
  test("package.json version is 2.2.0 (numeric; Chrome manifest cannot carry the beta suffix)", () => {
    assert.equal(pkg.version, "2.2.0", "package.json must be 2.2.0 for phase 4 beta");
  });

  test("manifest.json version is 2.2.0 (Chrome requires numeric-only version)", () => {
    assert.equal(mv3.version, "2.2.0", "src/manifest.json version must be 2.2.0");
  });

  test("manifest.v2.json version is 2.2.0", () => {
    assert.equal(mv2.version, "2.2.0", "src/manifest.v2.json version must be 2.2.0");
  });

  test("manifest.json has version_name 2.2.0-beta.1", () => {
    assert.equal(
      mv3.version_name,
      "2.2.0-beta.1",
      "MV3 manifest must have version_name: '2.2.0-beta.1' for human-readable beta display"
    );
  });

  test("manifest.v2.json has version_name 2.2.0-beta.1", () => {
    assert.equal(
      mv2.version_name,
      "2.2.0-beta.1",
      "MV2 manifest must have version_name: '2.2.0-beta.1'"
    );
  });
});

// ── 4. Proxy fallback preserved ──────────────────────────────────────────────

describe("ADR-0004 phase 4: proxy fallback intact (not removed)", () => {
  test("service-worker still imports fetchUnwrap from proxy-client", () => {
    assert.ok(
      swSource.includes("fetchUnwrap") && swSource.includes("proxy-client"),
      "proxy-client.js import must remain (phase 5 removes it, not phase 4)"
    );
  });

  test("UNWRAP_VIA_PROXY handler still has the proxy path (fetchUnwrap call)", () => {
    const handlerStart = swSource.indexOf('"UNWRAP_VIA_PROXY"');
    const handlerSlice = swSource.slice(handlerStart, handlerStart + 4000);
    assert.ok(
      handlerSlice.includes("fetchUnwrap"),
      "proxy fallback (fetchUnwrap) must remain in the UNWRAP_VIA_PROXY handler"
    );
  });
});
