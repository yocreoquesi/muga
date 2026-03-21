/**
 * MUGA — Unit tests for the getPrefsWithCache pattern (src/background/service-worker.js)
 *
 * service-worker.js cannot be imported in Node.js — it calls chrome.* APIs at
 * the module top level. Instead, the shared-promise cache pattern is replicated
 * here as a standalone factory function, and the tests exercise that pattern
 * directly.
 *
 * Also tests that _parsedBlacklist / _parsedWhitelist are pre-parsed with
 * parseListEntry, which IS importable from src/lib/cleaner.js.
 *
 * Run with: npm test
 *
 * Coverage:
 *   - First call triggers exactly one fetch
 *   - Second concurrent call (before first resolves) shares the same promise
 *   - After resolution, both callers receive the identical object
 *   - After cache invalidation (cachedPrefs = null, prefsFetchPromise = null),
 *     the next call triggers a new fetch
 *   - _parsedBlacklist and _parsedWhitelist are pre-parsed from parseListEntry
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { parseListEntry } from "../../src/lib/cleaner.js";

// ---------------------------------------------------------------------------
// Minimal in-file implementation that mirrors the getPrefsWithCache pattern
// from service-worker.js.  Returns a factory so each test gets isolated state.
// ---------------------------------------------------------------------------

/**
 * Creates a self-contained cache instance backed by the provided `fetchPrefs`
 * function.  Returns { getPrefsWithCache, invalidate }.
 *
 * @param {() => Promise<object>} fetchPrefs  - replaces getPrefs() from storage.js
 */
function makePrefsCache(fetchPrefs) {
  let cachedPrefs = null;
  let prefsFetchPromise = null;

  function getPrefsWithCache() {
    if (cachedPrefs) return Promise.resolve(cachedPrefs);
    if (!prefsFetchPromise) {
      prefsFetchPromise = fetchPrefs().then(prefs => {
        prefs._parsedBlacklist = (prefs.blacklist || []).map(parseListEntry);
        prefs._parsedWhitelist = (prefs.whitelist || []).map(parseListEntry);
        cachedPrefs = prefs;
        prefsFetchPromise = null;
        return prefs;
      });
    }
    return prefsFetchPromise;
  }

  function invalidate() {
    cachedPrefs = null;
    prefsFetchPromise = null;
  }

  return { getPrefsWithCache, invalidate };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("getPrefsWithCache — shared-promise deduplication", () => {
  test("first call triggers the underlying fetch exactly once", async () => {
    let callCount = 0;
    const { getPrefsWithCache } = makePrefsCache(() => {
      callCount++;
      return Promise.resolve({ enabled: true, blacklist: [], whitelist: [] });
    });

    await getPrefsWithCache();
    assert.equal(callCount, 1);
  });

  test("two concurrent calls share a single promise — fetch called only once", async () => {
    let callCount = 0;
    const { getPrefsWithCache } = makePrefsCache(() => {
      callCount++;
      return Promise.resolve({ enabled: true, blacklist: [], whitelist: [] });
    });

    const [r1, r2] = await Promise.all([getPrefsWithCache(), getPrefsWithCache()]);

    assert.equal(callCount, 1, "fetch must be called only once despite two concurrent callers");
    assert.equal(r1, r2, "both callers must receive the identical object reference");
  });

  test("after resolution, subsequent call returns cached value without re-fetching", async () => {
    let callCount = 0;
    const { getPrefsWithCache } = makePrefsCache(() => {
      callCount++;
      return Promise.resolve({ enabled: true, blacklist: [], whitelist: [] });
    });

    const first = await getPrefsWithCache();
    const second = await getPrefsWithCache();

    assert.equal(callCount, 1);
    assert.equal(first, second);
  });

  test("after invalidation, next call triggers a new fetch", async () => {
    let callCount = 0;
    const { getPrefsWithCache, invalidate } = makePrefsCache(() => {
      callCount++;
      return Promise.resolve({ enabled: true, blacklist: [], whitelist: [] });
    });

    await getPrefsWithCache();   // fetch #1
    assert.equal(callCount, 1);

    invalidate();                // simulate chrome.storage.onChanged

    await getPrefsWithCache();   // fetch #2
    assert.equal(callCount, 2, "a new fetch must be triggered after invalidation");
  });

  test("both callers receive the same object after concurrent resolution", async () => {
    const sharedPrefs = { enabled: false, blacklist: [], whitelist: [] };
    const { getPrefsWithCache } = makePrefsCache(() => Promise.resolve(sharedPrefs));

    const [a, b] = await Promise.all([getPrefsWithCache(), getPrefsWithCache()]);
    assert.equal(a, b);
    assert.equal(a.enabled, false);
  });
});

describe("getPrefsWithCache — _parsedBlacklist and _parsedWhitelist pre-parsing", () => {
  test("_parsedBlacklist is populated from parseListEntry", async () => {
    const { getPrefsWithCache } = makePrefsCache(() =>
      Promise.resolve({
        blacklist: ["amazon.es", "amazon.es::tag::badtag-21"],
        whitelist: [],
      })
    );

    const prefs = await getPrefsWithCache();

    assert.ok(Array.isArray(prefs._parsedBlacklist));
    assert.equal(prefs._parsedBlacklist.length, 2);

    // domain-only entry
    assert.deepEqual(prefs._parsedBlacklist[0], { domain: "amazon.es", param: null, value: null });

    // specific affiliate entry
    assert.deepEqual(prefs._parsedBlacklist[1], { domain: "amazon.es", param: "tag", value: "badtag-21" });
  });

  test("_parsedWhitelist is populated from parseListEntry", async () => {
    const { getPrefsWithCache } = makePrefsCache(() =>
      Promise.resolve({
        blacklist: [],
        whitelist: ["amazon.es::tag::youtuber-21"],
      })
    );

    const prefs = await getPrefsWithCache();

    assert.ok(Array.isArray(prefs._parsedWhitelist));
    assert.equal(prefs._parsedWhitelist.length, 1);
    assert.deepEqual(prefs._parsedWhitelist[0], { domain: "amazon.es", param: "tag", value: "youtuber-21" });
  });

  test("empty blacklist and whitelist produce empty parsed arrays", async () => {
    const { getPrefsWithCache } = makePrefsCache(() =>
      Promise.resolve({ blacklist: [], whitelist: [] })
    );

    const prefs = await getPrefsWithCache();
    assert.deepEqual(prefs._parsedBlacklist, []);
    assert.deepEqual(prefs._parsedWhitelist, []);
  });

  test("missing blacklist/whitelist keys default to empty arrays", async () => {
    const { getPrefsWithCache } = makePrefsCache(() =>
      Promise.resolve({ enabled: true })  // no blacklist / whitelist keys
    );

    const prefs = await getPrefsWithCache();
    assert.deepEqual(prefs._parsedBlacklist, []);
    assert.deepEqual(prefs._parsedWhitelist, []);
  });

  test("www. prefix is stripped from domain when parsing", async () => {
    const { getPrefsWithCache } = makePrefsCache(() =>
      Promise.resolve({
        blacklist: ["www.example.com"],
        whitelist: [],
      })
    );

    const prefs = await getPrefsWithCache();
    assert.equal(prefs._parsedBlacklist[0].domain, "example.com");
  });
});

describe("parseListEntry — imported from cleaner.js", () => {
  test("domain-only entry", () => {
    assert.deepEqual(parseListEntry("amazon.es"), { domain: "amazon.es", param: null, value: null });
  });

  test("domain + param + value entry", () => {
    assert.deepEqual(
      parseListEntry("amazon.es::tag::youtuber-21"),
      { domain: "amazon.es", param: "tag", value: "youtuber-21" }
    );
  });

  test("www. prefix stripped from domain", () => {
    assert.deepEqual(parseListEntry("www.example.com"), { domain: "example.com", param: null, value: null });
  });

  test("whitespace around parts is trimmed", () => {
    assert.deepEqual(
      parseListEntry("  amazon.es  ::  tag  ::  youtuber-21  "),
      { domain: "amazon.es", param: "tag", value: "youtuber-21" }
    );
  });
});
