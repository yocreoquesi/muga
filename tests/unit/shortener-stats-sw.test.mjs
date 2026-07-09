/**
 * MUGA — Phase 5: native-only shortener resolution in service-worker
 * (ADR-0004 phase 5, #701)
 *
 * Structural source-scan tests, mirroring the service-worker-patterns.test.mjs
 * style (import not possible due to Chrome API bindings).
 *
 * Phase 4 tests for proxy fallback (fetchUnwrap, proxy-client import) are
 * replaced here with native-only assertions. The removed proxy fallback tests
 * are intentionally deleted — not left to assert removed behavior.
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
// #826 PR2: PREF_DEFAULTS moved to prefs.js; migrations moved to storage-migrations.js.
// Source-scan tests that inspect those domains read the new canonical files.
const prefsSource = readFileSync(join(root, "src/lib/prefs.js"), "utf8");
const migrationsSource = readFileSync(join(root, "src/lib/storage-migrations.js"), "utf8");
const require = createRequire(import.meta.url);
const pkg = require("../../package.json");
const mv3 = require("../../src/manifest.json");
const mv2 = require("../../src/manifest.v2.json");

// ── 1. Pref cleanup (phase 5) ────────────────────────────────────────────────

describe("ADR-0004 phase 5: useNativeShortenerResolution removed from PREF_DEFAULTS", () => {
  // #826 PR2: PREF_DEFAULTS lives in prefs.js — scan that file for the content guards.
  test("PREF_DEFAULTS does NOT contain useNativeShortenerResolution (vestigial flag removed)", () => {
    // The flag was the dual-path selector; with proxy gone it is meaningless.
    // It must NOT be in PREF_DEFAULTS — this would re-sync it to all devices.
    assert.ok(
      !/useNativeShortenerResolution\s*:/.test(prefsSource.split("PREF_DEFAULTS")[1]?.split("};")[0] ?? ""),
      "PREF_DEFAULTS must NOT contain useNativeShortenerResolution after phase 5"
    );
  });

  test("PREF_DEFAULTS does NOT contain privacyProxyEnabled (deprecated key removed)", () => {
    const prefsBlock = prefsSource.split("PREF_DEFAULTS")[1]?.split("};")[0] ?? "";
    assert.ok(
      !/privacyProxyEnabled\s*:/.test(prefsBlock),
      "PREF_DEFAULTS must NOT contain privacyProxyEnabled after phase 5"
    );
  });

  test("PREF_DEFAULTS still contains followShortenersEnabled", () => {
    const prefsBlock = prefsSource.split("PREF_DEFAULTS")[1]?.split("};")[0] ?? "";
    assert.ok(
      /followShortenersEnabled\s*:/.test(prefsBlock),
      "PREF_DEFAULTS must contain followShortenersEnabled"
    );
  });
});

// ── 2. Migration function exported from storage-migrations.js ────────────────
// #826 PR2: migrateLegacyProxyPref was extracted to storage-migrations.js and
// is re-exported from storage.js for backward compat. Source-scan checks read
// the canonical implementation file; the re-export keeps all callers unchanged.

describe("ADR-0004 phase 5: migrateLegacyProxyPref exported", () => {
  test("storage-migrations.js exports migrateLegacyProxyPref", async () => {
    // Dynamic import not possible (Chrome APIs not available), so scan source.
    assert.ok(
      migrationsSource.includes("export async function migrateLegacyProxyPref"),
      "storage-migrations.js must export migrateLegacyProxyPref for one-time pref rename on startup"
    );
  });

  test("migration reads privacyProxyEnabled from chrome.storage.sync", () => {
    const fnStart = migrationsSource.indexOf("export async function migrateLegacyProxyPref");
    const fnSlice = migrationsSource.slice(fnStart, fnStart + 2000);
    assert.ok(
      fnSlice.includes("privacyProxyEnabled"),
      "migrateLegacyProxyPref must read privacyProxyEnabled"
    );
  });

  test("migration sets followShortenersEnabled when old pref was true", () => {
    const fnStart = migrationsSource.indexOf("export async function migrateLegacyProxyPref");
    const fnSlice = migrationsSource.slice(fnStart, fnStart + 2000);
    assert.ok(
      fnSlice.includes("followShortenersEnabled"),
      "migrateLegacyProxyPref must set followShortenersEnabled"
    );
  });

  test("migration removes the old privacyProxyEnabled key", () => {
    const fnStart = migrationsSource.indexOf("export async function migrateLegacyProxyPref");
    const fnSlice = migrationsSource.slice(fnStart, fnStart + 2000);
    assert.ok(
      fnSlice.includes('remove("privacyProxyEnabled"') || fnSlice.includes("remove('privacyProxyEnabled'"),
      "migrateLegacyProxyPref must call chrome.storage.sync.remove for privacyProxyEnabled"
    );
  });
});

// ── 3. Service-worker: native-only RESOLVE_SHORTENER handler ─────────────────

describe("ADR-0004 phase 5: service-worker uses RESOLVE_SHORTENER (native-only)", () => {
  test("service-worker handles RESOLVE_SHORTENER message type", () => {
    assert.ok(
      swSource.includes('message.type === "RESOLVE_SHORTENER"'),
      'service-worker must handle "RESOLVE_SHORTENER" message type (phase 5 replacement)'
    );
  });

  test("service-worker does NOT import fetchUnwrap from proxy-client", () => {
    assert.ok(
      !swSource.includes("proxy-client"),
      "service-worker must NOT import from proxy-client.js (file deleted in phase 5)"
    );
    assert.ok(
      !swSource.includes("fetchUnwrap"),
      "service-worker must NOT call fetchUnwrap (proxy removed in phase 5)"
    );
  });

  test("RESOLVE_SHORTENER handler gates on followShortenersEnabled (not privacyProxyEnabled)", () => {
    const handlerStart = swSource.indexOf('"RESOLVE_SHORTENER"');
    assert.ok(handlerStart !== -1, "RESOLVE_SHORTENER handler must be present");
    const handlerSlice = swSource.slice(handlerStart, handlerStart + 2600);
    assert.ok(
      handlerSlice.includes("followShortenersEnabled"),
      "RESOLVE_SHORTENER handler must check followShortenersEnabled"
    );
    assert.ok(
      !handlerSlice.includes("privacyProxyEnabled"),
      "RESOLVE_SHORTENER handler must NOT reference privacyProxyEnabled"
    );
  });

  test("RESOLVE_SHORTENER handler calls resolveShortener (native path only)", () => {
    const handlerStart = swSource.indexOf('"RESOLVE_SHORTENER"');
    const handlerSlice = swSource.slice(handlerStart, handlerStart + 2600);
    assert.ok(
      handlerSlice.includes("resolveShortener"),
      "RESOLVE_SHORTENER handler must call resolveShortener (native resolver)"
    );
  });

  test("RESOLVE_SHORTENER handler calls incrementShortenerStat", () => {
    const handlerStart = swSource.indexOf('"RESOLVE_SHORTENER"');
    const handlerSlice = swSource.slice(handlerStart, handlerStart + 2600);
    assert.ok(
      handlerSlice.includes("incrementShortenerStat"),
      "RESOLVE_SHORTENER handler must call incrementShortenerStat for pass/fail tracking"
    );
  });

  test("RESOLVE_SHORTENER handler validates URL scheme is http or https", () => {
    const handlerStart = swSource.indexOf('"RESOLVE_SHORTENER"');
    const handlerSlice = swSource.slice(handlerStart, handlerStart + 2600);
    assert.ok(
      handlerSlice.includes("invalid_url") || handlerSlice.includes("http:"),
      "RESOLVE_SHORTENER handler must validate URL scheme"
    );
  });

  test("RESOLVE_SHORTENER handler validates hostname is a generic shortener", () => {
    const handlerStart = swSource.indexOf('"RESOLVE_SHORTENER"');
    const handlerSlice = swSource.slice(handlerStart, handlerStart + 2600);
    assert.ok(
      handlerSlice.includes("isGenericShortener"),
      "RESOLVE_SHORTENER handler must check isGenericShortener"
    );
  });

  test("RESOLVE_SHORTENER handler returns true for async response", () => {
    const handlerStart = swSource.indexOf('"RESOLVE_SHORTENER"');
    const handlerSlice = swSource.slice(handlerStart, handlerStart + 2600);
    assert.ok(
      handlerSlice.includes("return true"),
      "RESOLVE_SHORTENER handler must return true to keep message channel open"
    );
  });
});

// ── 4. Migration wired into onStartup and onInstalled ────────────────────────

describe("ADR-0004 phase 5: migrateLegacyProxyPref called on startup", () => {
  test("onStartup listener calls migrateLegacyProxyPref", () => {
    const startupStart = swSource.indexOf("chrome.runtime.onStartup.addListener");
    assert.ok(startupStart !== -1, "onStartup listener must be present");
    const startupSlice = swSource.slice(startupStart, startupStart + 600);
    assert.ok(
      startupSlice.includes("migrateLegacyProxyPref"),
      "onStartup must call migrateLegacyProxyPref"
    );
  });

  test("onInstalled listener calls migrateLegacyProxyPref", () => {
    const installedStart = swSource.indexOf("chrome.runtime.onInstalled.addListener");
    assert.ok(installedStart !== -1, "onInstalled listener must be present");
    const installedSlice = swSource.slice(installedStart, installedStart + 800);
    assert.ok(
      installedSlice.includes("migrateLegacyProxyPref"),
      "onInstalled must call migrateLegacyProxyPref"
    );
  });
});

// ── 5. Proxy artifacts removed ───────────────────────────────────────────────

describe("ADR-0004 phase 5: proxy artifacts removed from service-worker", () => {
  test("service-worker does NOT contain UNWRAP_VIA_PROXY message handler", () => {
    assert.ok(
      !swSource.includes('"UNWRAP_VIA_PROXY"'),
      "service-worker must NOT handle UNWRAP_VIA_PROXY (replaced by RESOLVE_SHORTENER)"
    );
  });

  test("service-worker does NOT contain REFRESH_BUILD_HASH_NOW handler", () => {
    assert.ok(
      !swSource.includes('"REFRESH_BUILD_HASH_NOW"'),
      "service-worker must NOT handle REFRESH_BUILD_HASH_NOW (proxy build-hash endpoint gone)"
    );
  });

  test("service-worker does NOT contain refreshBuildHashIfStale function", () => {
    assert.ok(
      !swSource.includes("refreshBuildHashIfStale"),
      "service-worker must NOT define refreshBuildHashIfStale (proxy decommissioned)"
    );
  });

  test("service-worker does NOT reference unwrap.muga.app", () => {
    assert.ok(
      !swSource.includes("unwrap.muga.app"),
      "service-worker must NOT reference unwrap.muga.app"
    );
  });

  test("service-worker does NOT use privacyProxyEnabled as a code expression", () => {
    // Comments about the migration are permitted. Code references (pref reads,
    // writes, checks) are not. Scan for code patterns, not bare string presence.
    assert.ok(
      !swSource.includes("prefs.privacyProxyEnabled") &&
      !swSource.includes("privacyProxyEnabled:") &&
      !swSource.includes("privacyProxyEnabled =") &&
      !swSource.includes("set({ privacyProxyEnabled"),
      "service-worker must NOT read, write, or set privacyProxyEnabled as a code expression"
    );
  });
});

// ── 6. Version integrity ─────────────────────────────────────────────────────

describe("Version integrity — manifest versions match package.json", () => {
  // Derive the expected version from package.json (the single source of truth,
  // same contract as version-consistency.test.mjs) so this suite validates
  // integrity rather than pinning a specific release that breaks on every bump.
  test("package.json version is semver", () => {
    assert.match(pkg.version, /^\d+\.\d+\.\d+$/, "package.json version must be semver X.Y.Z");
  });

  test("manifest.json version matches package.json", () => {
    assert.equal(mv3.version, pkg.version, "src/manifest.json version must match package.json");
  });

  test("manifest.v2.json version matches package.json", () => {
    assert.equal(mv2.version, pkg.version, "src/manifest.v2.json version must match package.json");
  });

  test("manifest.json version_name matches version (stable release, no beta suffix)", () => {
    assert.equal(
      mv3.version_name,
      pkg.version,
      "MV3 manifest version_name must match package.json version"
    );
  });

  test("manifest.v2.json version_name matches version (stable release, no beta suffix)", () => {
    assert.equal(
      mv2.version_name,
      pkg.version,
      "MV2 manifest version_name must match package.json version"
    );
  });
});

// ── 7. Manifest: unwrap.muga.app removed ─────────────────────────────────────

describe("ADR-0004 phase 5: unwrap.muga.app removed from manifests", () => {
  test("manifest.json does NOT contain unwrap.muga.app in optional_host_permissions", () => {
    const perms = mv3.optional_host_permissions ?? [];
    assert.ok(
      !perms.includes("https://unwrap.muga.app/*"),
      "manifest.json must NOT list https://unwrap.muga.app/* in optional_host_permissions"
    );
  });

  test("manifest.v2.json does NOT contain unwrap.muga.app in optional_permissions", () => {
    const perms = mv2.optional_permissions ?? [];
    assert.ok(
      !perms.includes("https://unwrap.muga.app/*"),
      "manifest.v2.json must NOT list https://unwrap.muga.app/* in optional_permissions"
    );
  });

  test("manifest.json CSP does NOT include unwrap.muga.app in connect-src", () => {
    const csp = mv3.content_security_policy?.extension_pages ?? "";
    assert.ok(
      !csp.includes("unwrap.muga.app"),
      "manifest.json CSP must NOT allow connection to unwrap.muga.app"
    );
  });

  test("manifest.v2.json CSP does NOT include unwrap.muga.app in connect-src", () => {
    const csp = mv2.content_security_policy ?? "";
    assert.ok(
      !csp.includes("unwrap.muga.app"),
      "manifest.v2.json CSP must NOT allow connection to unwrap.muga.app"
    );
  });
});

// ── 8. Shortener stat increments still work (native path) ────────────────────

describe("ADR-0004 phase 4+5: shortener stat increments in native-only handler", () => {
  test("service-worker imports incrementShortenerStat from storage", () => {
    assert.ok(
      swSource.includes("incrementShortenerStat"),
      "service-worker must import and call incrementShortenerStat"
    );
  });

  test("increments pass counter on successful native resolution", () => {
    const handlerStart = swSource.indexOf('"RESOLVE_SHORTENER"');
    assert.ok(handlerStart !== -1, "RESOLVE_SHORTENER handler must be present");
    const handlerSlice = swSource.slice(handlerStart, handlerStart + 2600);
    assert.ok(
      handlerSlice.includes("incrementShortenerStat") && handlerSlice.includes('"pass"'),
      "RESOLVE_SHORTENER handler must call incrementShortenerStat(..., 'pass') on success"
    );
  });

  test("increments fail counter on failed native resolution", () => {
    const handlerStart = swSource.indexOf('"RESOLVE_SHORTENER"');
    const handlerSlice = swSource.slice(handlerStart, handlerStart + 2600);
    assert.ok(
      handlerSlice.includes("incrementShortenerStat") && handlerSlice.includes('"fail"'),
      "RESOLVE_SHORTENER handler must call incrementShortenerStat(..., 'fail') on failure"
    );
  });
});

// ── #922: shortener egress gated on enabled + onboardingDone ─────────────────
//
// Source guards (the service worker has no behavioral unit harness). Before the
// fix the handler only checked followShortenersEnabled, so a disabled or
// non-onboarded extension still performed the live shortener-resolution egress.

// Single source read (regex match) to stay within the #824 source-grep ratchet;
// all further assertions run against the extracted handler region.
describe("#922: RESOLVE_SHORTENER egress gated on enabled + onboarding", () => {
  const handler = swSource.match(/"RESOLVE_SHORTENER"[\s\S]{0,2200}/)?.[0] ?? "";
  const enabledIdx = handler.indexOf("prefs.enabled");
  const onboardingIdx = handler.indexOf("prefs.onboardingDone");
  const resolveIdx = handler.indexOf("resolveShortener");

  test("handler checks prefs.enabled and prefs.onboardingDone", () => {
    assert.ok(enabledIdx !== -1, "handler must check prefs.enabled (extension toggle) before egress");
    assert.ok(onboardingIdx !== -1, "handler must check prefs.onboardingDone (consent gate) before egress");
  });

  test("enabled + onboarding gate is evaluated before resolveShortener (no fetch when gate closed)", () => {
    assert.ok(resolveIdx !== -1, "handler must call resolveShortener");
    assert.ok(
      enabledIdx < resolveIdx && onboardingIdx < resolveIdx,
      "the enabled/onboarding gate must be checked BEFORE resolveShortener so no network egress happens when the gate is closed"
    );
  });

  test("gate-closed early return uses the disabled reason shape", () => {
    const afterGate = handler.slice(enabledIdx, enabledIdx + 220);
    assert.ok(
      afterGate.includes('reason: "disabled"'),
      'the enabled/onboarding gate must early-return { ok: false, reason: "disabled" }'
    );
  });
});
