/**
 * MUGA: Serialized "read current -> mutate -> write back" helper for
 * chrome.storage.sync (#928)
 *
 * Consolidates a pattern that used to be duplicated across five call sites
 * in options.js: the tracking-categories toggle, the blacklist/whitelist/
 * customParams add + remove handlers, and the creator-allowlist add +
 * remove handlers. Each of those independently re-read a sync-storage key,
 * mutated it, and wrote it back — and only two of the five call sites
 * serialized concurrent calls through a lock, so rapid/concurrent edits to
 * the other keys (most notably the categories toggle) could silently drop
 * a write.
 *
 * `withSyncMutation` composes with a caller-supplied lock (see createMutex)
 * rather than owning locking itself, so call sites that must already share
 * one queue (e.g. blacklist/whitelist/customParams) keep doing so, while
 * call sites that are independent of each other (creator allowlist,
 * tracking categories) get their own queue.
 *
 * The storage get/set functions are dependency-injected (defaulting to
 * chrome.storage.sync and the MUGA setPrefs helper) so this module stays
 * importable and unit-testable without a browser/extension environment.
 */

import { setPrefs as defaultSetPrefs } from "../lib/storage.js";

/**
 * Creates an independent serialization queue. Mutations queued through the
 * SAME `withLock` function returned here run strictly one after another (in
 * call order), even if an earlier call is still pending. Mutations queued
 * through DIFFERENT `createMutex()` instances are fully independent and may
 * interleave freely with each other.
 *
 * @returns {(fn: () => Promise<any>) => Promise<any>} withLock
 */
export function createMutex() {
  let chain = Promise.resolve();
  return function withLock(fn) {
    chain = chain.then(fn, fn);
    return chain;
  };
}

/**
 * Serializes a "re-read current value -> mutate -> write back" cycle
 * against a single storage key, through the supplied lock.
 *
 * `mutateFn` receives the current stored value and returns the new value to
 * persist. Returning `undefined` signals "no change" — the write is skipped
 * and `withSyncMutation` itself resolves to `undefined`, so the caller can
 * tell an aborted mutation (e.g. duplicate entry, cap reached, validation
 * failure) apart from a successful one.
 *
 * `set` may resolve to `false` instead of throwing to report a failed write
 * (this is `setPrefs`'s own contract — it already logs the underlying error
 * and returns a boolean rather than rejecting). `withSyncMutation` treats
 * that `false` the same way it treats an aborted mutation: it resolves to
 * `undefined` rather than the (never-persisted) `next` value, so a caller
 * that only checks `result !== undefined` before re-rendering never displays
 * a change that silently failed to save (#1430). Every existing call site
 * already treats `undefined` as "don't re-render," so this does not change
 * their behavior on the abort path — it only stops them from treating a
 * failed write as a success.
 *
 * @param {(fn: () => Promise<any>) => Promise<any>} withLock - lock function from createMutex()
 * @param {string} key - the storage key to read/write
 * @param {*} defaultValue - default passed when reading the current value
 * @param {(current: any) => (any | Promise<any>)} mutateFn - computes the new value, or returns
 *   `undefined` to abort without writing
 * @param {object} [deps]
 * @param {(query: object) => Promise<object>} [deps.get] - storage getter, defaults to chrome.storage.sync.get
 * @param {(values: object) => Promise<*>} [deps.set] - storage setter, defaults to setPrefs; a resolved
 *   `false` is treated as a failed write (see above)
 * @returns {Promise<*>} the new value that was persisted, or `undefined` if the mutation was aborted,
 *   the read failed, or the write failed
 */
export function withSyncMutation(withLock, key, defaultValue, mutateFn, deps = {}) {
  const get = deps.get || ((query) => chrome.storage.sync.get(query));
  const set = deps.set || defaultSetPrefs;

  return withLock(async () => {
    let stored;
    try {
      stored = await get({ [key]: defaultValue });
    } catch (err) {
      console.error(`[MUGA] load ${key}:`, err);
      return undefined;
    }

    const next = await mutateFn(stored[key]);
    if (next === undefined) return undefined;

    try {
      const saved = await set({ [key]: next });
      if (saved === false) return undefined; // write reported failure — do not claim success
    } catch (err) {
      console.error(`[MUGA] save ${key}:`, err);
      return undefined; // write threw — same "not actually saved" outcome as a false return
    }
    return next;
  });
}
