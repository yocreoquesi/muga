/**
 * MUGA — single-flight rule loading, as a module the tests can import (#1268)
 *
 * `src/background/service-worker.js` makes `chrome.*` calls at module scope, so
 * Node cannot import it. The suite worked around that by testing a copy of this
 * logic written inside `tests/unit/sw-robustness-833.test.mjs`, which says so in
 * its own header: "they exercise pure extracted helpers that mirror the
 * production logic". A mirror that drifts from its original keeps passing while
 * the shipped behaviour changes, and nothing proved the two still matched --
 * unlike the five STRIP tables, which are checked against their generator.
 *
 * So this is not a stronger mirror. It is the logic itself, in a file Node can
 * import, and the mirror is deleted.
 *
 * ── The invariant, from #833 ────────────────────────────────────────────────
 *
 * A service worker wakes on many events and several of them can call into the
 * cleaner at once. Before #833 each concurrent caller kicked off its own fetch
 * and incremented the attempt counter, so three simultaneous wakes could burn
 * the entire retry budget on one cold start. The fix was to share one in-flight
 * promise: the first caller starts the load, the rest await the same promise,
 * and the counter moves once per actual fetch.
 *
 * Retry is the other half. If the load failed and budget remains, the shared
 * promise is dropped so the NEXT independent call starts a fresh attempt --
 * but only after every current caller has finished awaiting it, or the
 * single-flight guarantee would be lost the moment it mattered.
 */

/**
 * Builds a loader that guarantees one in-flight load at a time.
 *
 * @param {object} spec
 * @param {string} spec.label used in the exhausted-budget log line
 * @param {number} spec.maxAttempts fetch attempts before the loader gives up
 * @param {() => boolean} spec.isLoaded whether the caller now has usable rules;
 *   drives the retry decision, and is a callback rather than a return value
 *   because the real loaders assign into module-level state the caller reads
 *   directly
 * @param {() => Promise<any>} spec.fetchAll performs the actual fetch(es)
 * @param {(data: any) => void} spec.apply installs what fetchAll returned
 * @param {() => Promise<any>} [spec.readCache] consulted BEFORE the attempt
 *   budget, so a cache hit costs no attempt. Returns a falsy value on a miss.
 * @param {(data: any) => Promise<void>} [spec.writeCache] called after a
 *   successful fetch; its failure must not fail the load
 * @param {(err: unknown, attempt: number) => void} [spec.onError] failure
 *   reporting, and any state reset the caller needs on a failed load
 * @returns {{ensure: () => Promise<void>, attempts: number, inFlight: boolean, reset: () => void}}
 */
export function createSingleFlightLoader({
  label,
  maxAttempts,
  isLoaded,
  fetchAll,
  apply,
  readCache,
  writeCache,
  onError,
}) {
  let ready = null;
  let attempts = 0;

  async function run() {
    if (readCache) {
      let cached = null;
      try {
        cached = await readCache();
      } catch {
        // A broken cache is a cache miss. Failing the load because the cache
        // could not be read would turn a performance feature into an outage.
        cached = null;
      }
      if (cached) {
        apply(cached);
        return;
      }
    }

    if (attempts >= maxAttempts) {
      console.error(`[MUGA] ${label}: max fetch attempts reached; rules unavailable`);
      return;
    }

    attempts++;
    try {
      const data = await fetchAll();
      apply(data);
      if (writeCache) {
        try {
          await writeCache(data);
        } catch {
          // The rules are already applied. A failed cache write costs the next
          // cold start a fetch, and nothing else.
        }
      }
    } catch (err) {
      // Deliberately NOT nulling `ready` here: the callers already awaiting it
      // would each start their own retry, which is the exact stampede #833
      // removed. ensure() drops it after the await instead.
      if (onError) onError(err, attempts);
    }
  }

  return {
    /**
     * Loads once, shared across concurrent callers, and arms the retry.
     *
     * @returns {Promise<void>}
     */
    async ensure() {
      if (!ready) ready = run();
      await ready;
      if (!isLoaded() && attempts < maxAttempts) {
        ready = null;
      }
    },

    /** Fetch attempts spent. A cache hit costs none. */
    get attempts() {
      return attempts;
    },

    /** Whether a load is in flight or has completed without being reset. */
    get inFlight() {
      return ready !== null;
    },

    /** Test seam: forgets both the shared promise and the attempt budget. */
    reset() {
      ready = null;
      attempts = 0;
    },
  };
}

/**
 * Builds the once-per-lifetime `firstUsed` bootstrap.
 *
 * The other block `sw-robustness-833.test.mjs` mirrored. Two things matter and
 * both are easy to lose in a refactor: it must run its write at most once per
 * worker lifetime, and it must never overwrite a `firstUsed` that already
 * exists. The second is what protects the original timestamp -- the value is
 * "when this user first used MUGA", and a retry that stamps today's date
 * silently destroys it with no way to notice.
 *
 * @param {object} spec
 * @param {() => Promise<{firstUsed?: number}>} spec.getStats
 * @param {(patch: object) => Promise<void>} spec.setStats
 * @param {() => number} [spec.now]
 * @returns {{ensure: () => Promise<void>, done: boolean, reset: () => void}}
 */
export function createFirstUsedBootstrap({ getStats, setStats, now = () => Date.now() }) {
  let done = false;
  let inFlight = null;

  return {
    /**
     * Sets `firstUsed` if it is absent. Idempotent within a lifetime, and
     * best-effort: a storage failure leaves `done` false so a later call
     * retries, because the alternative is losing the stamp entirely.
     *
     * Single-flight for the same reason the rules loader is. The `done` flag
     * alone is not enough: it is set AFTER the await, so three overlapping
     * callers all pass the guard and all write. The service worker calls this
     * from onInstalled, onStartup and the PROCESS_URL fallback, which is
     * exactly the overlap a cold start produces, and it is the concurrency
     * class #1257 is about. Extracting the code is what made it visible --
     * the copy this replaced had no concurrency test, because a copy is only
     * ever tested for what its author already thought of.
     *
     * @returns {Promise<void>}
     */
    async ensure() {
      if (done) return;
      if (inFlight) return inFlight;

      inFlight = (async () => {
        try {
          const stats = await getStats();
          if (!stats.firstUsed) await setStats({ firstUsed: now() });
          done = true;
        } catch {
          // Best-effort by design; the caller keeps its own fallback.
        } finally {
          inFlight = null;
        }
      })();

      return inFlight;
    },

    /** Whether this lifetime has already completed the bootstrap. */
    get done() {
      return done;
    },

    /** Test seam. */
    reset() {
      done = false;
    },
  };
}
