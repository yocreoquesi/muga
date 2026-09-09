/**
 * MUGA — one queue for every whitelist/blacklist mutation (#1257)
 *
 * The whitelist and blacklist are stored as whole arrays, so every change is a
 * read-modify-write and `chrome.storage.sync.set` REPLACES the key rather than
 * merging it. Two writers that read the same array both write back what they
 * read, and whichever lands second silently destroys the other's entry.
 *
 * `service-worker.js` already serialised its own `ADD_TO_WHITELIST` and
 * `ADD_TO_BLACKLIST` handlers against each other with a module-local promise
 * chain. `migratePerSiteDisableToAllowlist` did not use it -- it could not, as
 * the chain lived in a file nothing can import -- and wrote with a raw
 * `chrome.storage.sync.set({ whitelist, blacklist })`. So a user adding a site
 * to their allowlist while that migration was mid-flight could watch the entry
 * disappear, with no error anywhere.
 *
 * The queue is here now, in a module with no imports of its own, so both the
 * handlers and the migration can share it. That is the actual fix: a queue only
 * two of three writers use is not a queue.
 *
 * ── Scope, stated plainly ───────────────────────────────────────────────────
 *
 * This serialises writers WITHIN one JavaScript context. The service worker and
 * the migrations both run there, which is the collision this addresses. It does
 * not coordinate with the options page, which writes its lists through its own
 * context -- that was true before and is unchanged. Cross-context safety would
 * need a storage-level compare-and-swap, and is not what #1257 reports.
 */

/**
 * Tail of the chain. Every enqueued task runs after the previous one settles.
 *
 * @type {Promise<unknown>}
 */
let _queue = Promise.resolve();

/**
 * Runs `task` once every previously enqueued task has settled.
 *
 * The task must perform its READ inside itself. Reading outside and passing a
 * snapshot in reintroduces the race the queue exists to remove: the value would
 * be fetched before the caller's turn and written after it.
 *
 * A failing task does not poison the chain. The rejection is returned to its
 * own caller, while the chain continues from a resolved state -- a migration
 * that fails must not silently stop every later allowlist edit for the life of
 * the worker.
 *
 * @template T
 * @param {() => Promise<T>} task
 * @returns {Promise<T>} whatever the task resolves or rejects with
 */
export function enqueueListMutation(task) {
  const run = _queue.then(task, task);
  _queue = run.then(
    () => {},
    () => {}
  );
  return run;
}

/** Test seam: drops the chain so one test's tail cannot delay the next. */
export function resetListMutationQueueForTest() {
  _queue = Promise.resolve();
}
