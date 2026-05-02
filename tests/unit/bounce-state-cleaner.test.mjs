/**
 * MUGA — Tests for the Bounce State Cleaner (#447 / B17).
 *
 * The cleaner runs only on intermediary "bounce" hosts (affiliate-network
 * redirectors, social-link wrappers, privacy proxies — anything the Wrapper
 * Engine recognizes). When the user briefly lands on one of those hosts,
 * the cleaner wipes that origin's localStorage + sessionStorage so the
 * intermediary can't persist tracking state across visits.
 *
 * The module under test is a PURE factory — `createBounceStateCleaner` —
 * with three injection points:
 *   - `wrapperEngine` :: { detectWrapper(href) -> entry|null }
 *     Authoritative source of "is this an intermediary host?".
 *   - `storageLike` and `sessionStorageLike` :: stubs of the Web Storage
 *     API (clear / length / getItem / key / removeItem). Tests inject
 *     simple Map-backed stubs.
 *
 * No DOM, no chrome.*, no jsdom — project rule is no third-party test libs.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createBounceStateCleaner } from "../../src/lib/bounce-state-cleaner.js";

// ── Helpers ────────────────────────────────────────────────────────────────

/**
 * Stub Wrapper Engine. `matches` is a list of substrings; if any of them
 * appears in the URL string, `detectWrapper` returns a fake entry object.
 * Otherwise null. Mirrors the real detectWrapper's "string|null" contract.
 */
function makeWrapperEngine(matches) {
  return {
    detectWrapper(href) {
      if (typeof href !== "string") return null;
      for (const m of matches) {
        if (href.includes(m)) return { id: "stub", name: "stub" };
      }
      return null;
    },
  };
}

/**
 * Map-backed Web Storage stub. Implements the surface the cleaner touches:
 * `clear()`, `length`, `getItem`, `key`, `removeItem`, `setItem`. Tests
 * pre-seed with `setItem` and then inspect via `length` after `clear()`.
 */
function makeStorage(seed = {}) {
  const map = new Map(Object.entries(seed));
  return {
    get length() { return map.size; },
    key(i) {
      const keys = [...map.keys()];
      return i >= 0 && i < keys.length ? keys[i] : null;
    },
    getItem(k) { return map.has(k) ? map.get(k) : null; },
    setItem(k, v) { map.set(k, String(v)); },
    removeItem(k) { map.delete(k); },
    clear() { map.clear(); },
    // Test-only mirror.
    get __size() { return map.size; },
  };
}

/**
 * Storage stub whose `clear()` throws — used to verify the cleaner swallows
 * exceptions instead of bubbling them up to its caller (defensive contract).
 */
function makeThrowingStorage() {
  return {
    get length() { return 5; },
    key() { return null; },
    getItem() { return null; },
    setItem() { /* noop */ },
    removeItem() { /* noop */ },
    clear() { throw new Error("storage clear blew up"); },
  };
}

// ── isIntermediary ────────────────────────────────────────────────────────

describe("createBounceStateCleaner — isIntermediary", () => {
  test("returns true when wrapperEngine.detectWrapper returns an entry", () => {
    const cleaner = createBounceStateCleaner({
      wrapperEngine: makeWrapperEngine(["awin1.com"]),
      storageLike: makeStorage(),
      sessionStorageLike: makeStorage(),
    });
    assert.equal(
      cleaner.isIntermediary("https://awin1.com/cread.php?p=https%3A%2F%2Fmerchant.example%2F"),
      true
    );
  });

  test("returns false when wrapperEngine.detectWrapper returns null", () => {
    const cleaner = createBounceStateCleaner({
      wrapperEngine: makeWrapperEngine(["awin1.com"]),
      storageLike: makeStorage(),
      sessionStorageLike: makeStorage(),
    });
    assert.equal(cleaner.isIntermediary("https://example.com/article"), false);
  });

  test("returns false for non-string input (no throw)", () => {
    const cleaner = createBounceStateCleaner({
      wrapperEngine: makeWrapperEngine(["awin1.com"]),
      storageLike: makeStorage(),
      sessionStorageLike: makeStorage(),
    });
    assert.equal(cleaner.isIntermediary(undefined), false);
    assert.equal(cleaner.isIntermediary(null), false);
    assert.equal(cleaner.isIntermediary(123), false);
  });
});

// ── cleanCurrent ──────────────────────────────────────────────────────────

describe("createBounceStateCleaner — cleanCurrent", () => {
  test("calls clear() on both storages and returns the prior counts", () => {
    const local = makeStorage({ a: "1", b: "2", c: "3" });
    const session = makeStorage({ x: "y" });
    const cleaner = createBounceStateCleaner({
      wrapperEngine: makeWrapperEngine([]),
      storageLike: local,
      sessionStorageLike: session,
    });
    const result = cleaner.cleanCurrent();
    assert.equal(local.__size, 0);
    assert.equal(session.__size, 0);
    assert.equal(result.localCleared, 3);
    assert.equal(result.sessionCleared, 1);
  });

  test("empty storages return counts of 0 and do not throw", () => {
    const local = makeStorage();
    const session = makeStorage();
    const cleaner = createBounceStateCleaner({
      wrapperEngine: makeWrapperEngine([]),
      storageLike: local,
      sessionStorageLike: session,
    });
    const result = cleaner.cleanCurrent();
    assert.equal(result.localCleared, 0);
    assert.equal(result.sessionCleared, 0);
  });

  test("missing/null storage references are tolerated (no throw, count of 0)", () => {
    const cleaner = createBounceStateCleaner({
      wrapperEngine: makeWrapperEngine([]),
      storageLike: null,
      sessionStorageLike: undefined,
    });
    const result = cleaner.cleanCurrent();
    assert.equal(result.localCleared, 0);
    assert.equal(result.sessionCleared, 0);
  });

  test("clear() throws are caught — counts reported as 0, no surface to caller", () => {
    const cleaner = createBounceStateCleaner({
      wrapperEngine: makeWrapperEngine([]),
      storageLike: makeThrowingStorage(),
      sessionStorageLike: makeThrowingStorage(),
    });
    assert.doesNotThrow(() => {
      const result = cleaner.cleanCurrent();
      // Throwing path: report 0 cleared. The caller learns nothing was
      // wiped, which is honest.
      assert.equal(result.localCleared, 0);
      assert.equal(result.sessionCleared, 0);
    });
  });
});

// ── cleanIfIntermediary ───────────────────────────────────────────────────

describe("createBounceStateCleaner — cleanIfIntermediary", () => {
  test("non-intermediary URL → both storages untouched", () => {
    const local = makeStorage({ a: "1" });
    const session = makeStorage({ b: "2" });
    const cleaner = createBounceStateCleaner({
      wrapperEngine: makeWrapperEngine(["awin1.com"]),
      storageLike: local,
      sessionStorageLike: session,
    });
    const result = cleaner.cleanIfIntermediary("https://example.com/article");
    assert.equal(result.cleaned, false);
    assert.equal(local.__size, 1);
    assert.equal(session.__size, 1);
  });

  test("intermediary URL → both storages cleared", () => {
    const local = makeStorage({ a: "1", b: "2" });
    const session = makeStorage({ x: "y" });
    const cleaner = createBounceStateCleaner({
      wrapperEngine: makeWrapperEngine(["awin1.com"]),
      storageLike: local,
      sessionStorageLike: session,
    });
    const result = cleaner.cleanIfIntermediary(
      "https://awin1.com/cread.php?p=https%3A%2F%2Fmerchant.example%2F"
    );
    assert.equal(result.cleaned, true);
    assert.equal(result.localCleared, 2);
    assert.equal(result.sessionCleared, 1);
    assert.equal(local.__size, 0);
    assert.equal(session.__size, 0);
  });

  test("malformed URL → no throw, no-op (storages untouched)", () => {
    const local = makeStorage({ a: "1" });
    const session = makeStorage({ b: "2" });
    const cleaner = createBounceStateCleaner({
      wrapperEngine: makeWrapperEngine(["awin1.com"]),
      storageLike: local,
      sessionStorageLike: session,
    });
    let result;
    assert.doesNotThrow(() => {
      result = cleaner.cleanIfIntermediary("::::not a url::::");
    });
    assert.equal(result.cleaned, false);
    assert.equal(local.__size, 1);
    assert.equal(session.__size, 1);
  });

  test("non-string input → no throw, no-op", () => {
    const local = makeStorage({ a: "1" });
    const session = makeStorage({ b: "2" });
    const cleaner = createBounceStateCleaner({
      wrapperEngine: makeWrapperEngine(["awin1.com"]),
      storageLike: local,
      sessionStorageLike: session,
    });
    assert.doesNotThrow(() => cleaner.cleanIfIntermediary(undefined));
    assert.doesNotThrow(() => cleaner.cleanIfIntermediary(null));
    assert.equal(local.__size, 1);
    assert.equal(session.__size, 1);
  });

  test("wrapperEngine.detectWrapper that throws → no surface to caller, no-op", () => {
    const local = makeStorage({ a: "1" });
    const session = makeStorage({ b: "2" });
    const cleaner = createBounceStateCleaner({
      wrapperEngine: {
        detectWrapper() { throw new Error("engine boom"); },
      },
      storageLike: local,
      sessionStorageLike: session,
    });
    let result;
    assert.doesNotThrow(() => {
      result = cleaner.cleanIfIntermediary("https://anything.example/");
    });
    assert.equal(result.cleaned, false);
    assert.equal(local.__size, 1);
    assert.equal(session.__size, 1);
  });
});

// ── Factory contract ──────────────────────────────────────────────────────

describe("createBounceStateCleaner — factory contract", () => {
  test("returns the documented public surface", () => {
    const cleaner = createBounceStateCleaner({
      wrapperEngine: makeWrapperEngine([]),
      storageLike: makeStorage(),
      sessionStorageLike: makeStorage(),
    });
    assert.equal(typeof cleaner.isIntermediary, "function");
    assert.equal(typeof cleaner.cleanCurrent, "function");
    assert.equal(typeof cleaner.cleanIfIntermediary, "function");
  });

  test("missing wrapperEngine → cleanIfIntermediary is a no-op (defensive)", () => {
    const local = makeStorage({ a: "1" });
    const session = makeStorage({ b: "2" });
    const cleaner = createBounceStateCleaner({
      wrapperEngine: null,
      storageLike: local,
      sessionStorageLike: session,
    });
    let result;
    assert.doesNotThrow(() => {
      result = cleaner.cleanIfIntermediary("https://awin1.com/cread.php?p=x");
    });
    assert.equal(result.cleaned, false);
    assert.equal(local.__size, 1);
    assert.equal(session.__size, 1);
  });
});
