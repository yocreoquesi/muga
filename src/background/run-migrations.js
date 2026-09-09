/**
 * MUGA — one-time migrations, invoked from one place (#1257)
 *
 * Every one-time migration was invoked from three: module scope, `onInstalled`
 * and `onStartup`. On any wake that fires either handler the module-scope call
 * races it, so two or three copies of the same read-modify-write ran at once.
 * Only `migrateConsentToLocal` had a guard, added when this exact class was
 * found before (#1216/#1219); its siblings used the identical call pattern
 * with none.
 *
 * ── Why deleting call sites beats adding guards ─────────────────────────────
 *
 * The three sites were never independent. In MV3 every wake evaluates the
 * module, and `onInstalled`/`onStartup` only fire on wakes -- so module scope
 * already ran on a strict superset of the occasions the handlers did, and the
 * handler calls could not reach a case module scope missed. They were not
 * belt-and-braces; they were the same belt, worn twice, racing itself.
 *
 * The same holds on Firefox MV2, where the persistent background page loads
 * before either handler fires within that lifetime.
 *
 * So this is one call site. The in-flight guard below is not the fix, it is
 * the thing that keeps the fix from silently regressing if a fourth caller
 * ever appears.
 *
 * ── Failure policy ─────────────────────────────────────────────────────────
 *
 * Every migration is best-effort and must never break startup, which is why
 * `Promise.allSettled` is used rather than `all`: one failing migration must
 * not prevent the others from being awaited, and a rejection must not escape
 * as an unhandled rejection at module scope. Two of these were previously
 * called bare -- `migrateStatsToLocal()` awaits a `chrome.storage.local.set`
 * with no internal catch, so a rejection there was an unhandled rejection
 * during startup.
 */

/**
 * Shared in-flight promise, for this worker lifetime.
 *
 * Not cleared on completion. These are once-per-lifetime migrations, so a
 * resolved promise is the correct memo: later callers get it for free, and a
 * migration that failed retries on the next worker spawn, which is what it did
 * before.
 *
 * @type {Promise<void>|null}
 */
let _inFlight = null;

/**
 * Runs every one-time migration exactly once per worker lifetime.
 *
 * Dependencies are injected so this is testable in Node without a `chrome`
 * global -- the reason the concurrency defects in #1257 had no test in the
 * first place was that their call sites lived in a file Node cannot import
 * (#1268).
 *
 * @param {object} migrations each a `() => Promise<unknown>`
 * @returns {Promise<void>} resolves once every migration has settled
 */
export function runOneTimeMigrations(migrations) {
  if (_inFlight) return _inFlight;

  const tasks = Object.entries(migrations);

  _inFlight = Promise.allSettled(
    tasks.map(([, run]) => {
      try {
        return Promise.resolve(run());
      } catch (err) {
        // A migration that throws SYNCHRONOUSLY would otherwise escape the
        // allSettled entirely and take startup with it.
        return Promise.reject(err);
      }
    })
  ).then((results) => {
    results.forEach((result, i) => {
      if (result.status === "rejected") {
        console.warn(`[MUGA] migration ${tasks[i][0]} failed:`, result.reason);
      }
    });
  });

  return _inFlight;
}

/** Test seam: forgets the lifetime memo. */
export function resetMigrationsForTest() {
  _inFlight = null;
}
