/**
 * MUGA — #1100: mugaPrevVersion was never written, so the migration banner
 * could never fire.
 *
 * The popup's migration banner (src/lib/migration-prompt.js, wired in
 * popup.js's readState) computes a version delta by reading
 * `mugaPrevVersion` from chrome.storage.local and comparing it against
 * chrome.runtime.getManifest().version. Nothing wrote that key, so the read
 * always fell back to `currentVersion` (see popup.js:446), previousVersion
 * === currentVersion held forever, and evaluateMigrations() (which requires
 * previousVersion <= entry.fromVersion AND currentVersion >= entry.toVersion)
 * could never see a real upgrade window once a migration entry was added to
 * MIGRATIONS.
 *
 * The fix adds persistPrevVersion(details), called from the onInstalled
 * listener, which writes `mugaPrevVersion`:
 *   - on "update": the REAL prior version, from chrome's own
 *     details.previousVersion (only populated on update).
 *   - on "install" (first run): the current version — no meaningful prior
 *     version exists yet, so no delta / no migration fires, matching the
 *     pre-fix default behavior for a fresh install.
 *
 * service-worker.js is browser-only (top-level chrome.* calls) and cannot be
 * imported directly in Node, so — following the established pattern in this
 * suite (see onboarding-tab-dedup-967.test.mjs) — persistPrevVersion is
 * extracted via source-slicing and exercised against a fake chrome.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { evaluateMigrations } from "../../src/lib/migration-evaluator.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "../..");
const SW_SOURCE = readFileSync(resolve(root, "src/background/service-worker.js"), "utf8");

/** Extracts a top-level `[async ]function <name>(...) { ... }` block via brace matching. */
function extractFunctionSource(src, name) {
  const asyncIdx = src.indexOf(`async function ${name}`);
  const idx = asyncIdx !== -1 ? asyncIdx : src.indexOf(`function ${name}`);
  assert.ok(idx !== -1, `${name} must be defined`);
  let depth = 0;
  let started = false;
  let i = idx;
  for (; i < src.length; i++) {
    if (src[i] === "{") { depth++; started = true; }
    else if (src[i] === "}") {
      depth--;
      if (started && depth === 0) { i++; break; }
    }
  }
  return src.slice(idx, i);
}

const persistPrevVersionSrc = extractFunctionSource(SW_SOURCE, "persistPrevVersion");
const keyConstMatch = SW_SOURCE.match(/const MUGA_PREV_VERSION_KEY\s*=\s*"[^"]+";/);
assert.ok(keyConstMatch, "MUGA_PREV_VERSION_KEY constant must be defined");

/** Builds a callable persistPrevVersion bound to a fake `chrome`. */
function buildPersistPrevVersion(fakeChrome) {
  const factory = new Function(
    "chrome",
    `"use strict";
     ${keyConstMatch[0]}
     ${persistPrevVersionSrc}
     return persistPrevVersion;`,
  );
  return factory(fakeChrome);
}

/** Minimal chrome.storage.local + runtime stub backed by an in-memory store. */
function makeFakeChrome({ manifestVersion, initialStore = {} } = {}) {
  const store = { ...initialStore };
  const fakeChrome = {
    storage: {
      local: {
        set: (obj, cb) => { Object.assign(store, obj); cb && cb(); },
      },
    },
    runtime: {
      lastError: null,
      getManifest: () => ({ version: manifestVersion }),
    },
  };
  return { fakeChrome, store };
}

describe("#1100 — persistPrevVersion writes mugaPrevVersion", () => {
  test("on install (no details.previousVersion): seeds mugaPrevVersion with the current version", async () => {
    const { fakeChrome, store } = makeFakeChrome({ manifestVersion: "2.6.0" });
    const persistPrevVersion = buildPersistPrevVersion(fakeChrome);

    await persistPrevVersion({ reason: "install" });

    assert.strictEqual(
      store.mugaPrevVersion,
      "2.6.0",
      "a fresh install has no meaningful prior version — seed with current so no false delta fires",
    );
  });

  test("on update: persists the REAL previous version supplied by Chrome", async () => {
    const { fakeChrome, store } = makeFakeChrome({ manifestVersion: "2.6.0" });
    const persistPrevVersion = buildPersistPrevVersion(fakeChrome);

    await persistPrevVersion({ reason: "update", previousVersion: "2.5.0" });

    assert.strictEqual(
      store.mugaPrevVersion,
      "2.5.0",
      "an update must persist the actual prior version, not the current one",
    );
  });

  test("update with a missing details.previousVersion falls back to the current version", async () => {
    // Defensive: some browsers may theoretically omit previousVersion even on
    // "update". Falling back to currentVersion is the safe no-false-delta default.
    const { fakeChrome, store } = makeFakeChrome({ manifestVersion: "2.6.0" });
    const persistPrevVersion = buildPersistPrevVersion(fakeChrome);

    await persistPrevVersion({ reason: "update" });

    assert.strictEqual(store.mugaPrevVersion, "2.6.0");
  });

  test("onInstalled listener calls persistPrevVersion before reading prefs", () => {
    const onInstalledPos = SW_SOURCE.indexOf("chrome.runtime.onInstalled.addListener");
    assert.ok(onInstalledPos !== -1, "onInstalled.addListener must be present");
    // Window bumped 400 -> 900 (browsewrap Phase 1): the listener grew the
    // implicit-accept-on-install branch (recordImplicitAcceptOnInstall) and
    // its explanatory comment between persistPrevVersion and the prefs read.
    const block = SW_SOURCE.slice(onInstalledPos, onInstalledPos + 900);
    const persistIdx = block.indexOf("persistPrevVersion(details)");
    const prefsIdx = block.indexOf("getPrefsWithCache()");
    assert.ok(persistIdx !== -1, "onInstalled handler must call persistPrevVersion(details)");
    assert.ok(
      persistIdx < prefsIdx,
      "persistPrevVersion should run early in the onInstalled handler",
    );
  });
});

describe("#1100 — end-to-end: a persisted version delta makes evaluateMigrations see the upgrade window", () => {
  test("a migration whose window spans the persisted delta is now returned as pending", () => {
    // Before the fix, mugaPrevVersion was never written, so the popup always
    // read back previousVersion === currentVersion (see popup.js:446-448's
    // `stored.mugaPrevVersion || currentVersion` fallback) and no migration
    // could ever fire. After the fix, an "update" event persists the REAL
    // prior version, so a migration entry whose window spans the upgrade is
    // now detected.
    const { fakeChrome, store } = makeFakeChrome({ manifestVersion: "2.6.0" });
    const persistPrevVersion = buildPersistPrevVersion(fakeChrome);

    return persistPrevVersion({ reason: "update", previousVersion: "2.5.0" }).then(() => {
      // Mirrors popup.js's readState fallback shape exactly.
      const currentVersion = "2.6.0";
      const previousVersion = store.mugaPrevVersion || currentVersion;

      assert.notStrictEqual(
        previousVersion,
        currentVersion,
        "a version delta must now be observable — this was impossible before the fix",
      );

      const testMigration = {
        id: "test-migration-1100",
        fromVersion: "2.5.0",
        toVersion: "2.6.0",
        proposedValue: { someFeatureEnabled: true },
      };

      const pending = evaluateMigrations({
        previousVersion,
        currentVersion,
        responses: {},
        prefs: {}, // someFeatureEnabled not yet set — migration should fire
        migrations: [testMigration],
      });

      assert.strictEqual(pending.length, 1, "the migration must be surfaced now that the delta is real");
      assert.strictEqual(pending[0].id, "test-migration-1100");
    });
  });

  test("regression repro: without persistence, previousVersion === currentVersion and no migration ever fires", () => {
    // Reproduces the pre-#1100-fix shape: mugaPrevVersion was never written,
    // so previousVersion falls back to currentVersion every time.
    const currentVersion = "2.6.0";
    const previousVersion = undefined /* never persisted */ || currentVersion;

    const testMigration = {
      id: "test-migration-1100",
      fromVersion: "2.5.0",
      toVersion: "2.6.0",
      proposedValue: { someFeatureEnabled: true },
    };

    const pending = evaluateMigrations({
      previousVersion,
      currentVersion,
      responses: {},
      prefs: {},
      migrations: [testMigration],
    });

    assert.strictEqual(
      pending.length,
      0,
      "proves the bug: with no persisted previous version, the migration can never fire",
    );
  });
});
