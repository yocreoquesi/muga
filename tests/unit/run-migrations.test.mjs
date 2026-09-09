/**
 * MUGA — one-time migrations run once, from one place (#1257)
 *
 * Every migration was invoked from module scope, from `onInstalled` AND from
 * `onStartup`, so any wake that fired either handler raced the module-scope
 * call: two or three copies of the same read-modify-write at once. Only
 * `migrateConsentToLocal` had a guard, added when this class was found before
 * (#1216/#1219); its siblings used the identical call pattern with none.
 *
 * There was no test, because the call sites lived in `service-worker.js`,
 * which Node cannot import (#1268). That is the connection worth stating: the
 * unimportable file is not merely awkward to test, it is where this kind of
 * defect accumulates.
 *
 * Run with: npm test
 */

import { describe, test, beforeEach } from "node:test";
import assert from "node:assert/strict";

import {
  runOneTimeMigrations,
  resetMigrationsForTest,
} from "../../src/background/run-migrations.js";

beforeEach(() => {
  resetMigrationsForTest();
});

describe("runOneTimeMigrations", () => {
  test("runs every migration it is given", async () => {
    const ran = [];
    await runOneTimeMigrations({
      a: async () => { ran.push("a"); },
      b: async () => { ran.push("b"); },
      c: async () => { ran.push("c"); },
    });
    assert.deepStrictEqual(ran.sort(), ["a", "b", "c"]);
  });

  test("three overlapping callers run each migration exactly once", async () => {
    // The defect, stated as a test. Module scope, onInstalled and onStartup all
    // fired on the same wake, and each started its own copy of every migration.
    let runs = 0;
    const migrations = {
      slow: async () => {
        runs++;
        await new Promise((r) => setImmediate(r));
      },
    };

    await Promise.all([
      runOneTimeMigrations(migrations),
      runOneTimeMigrations(migrations),
      runOneTimeMigrations(migrations),
    ]);

    assert.strictEqual(runs, 1, "three callers on one wake must produce one run, not three");
  });

  test("a later caller reuses the completed run rather than repeating it", async () => {
    let runs = 0;
    const migrations = { once: async () => { runs++; } };

    await runOneTimeMigrations(migrations);
    await runOneTimeMigrations(migrations);

    assert.strictEqual(runs, 1, "these are once-per-lifetime; a resolved memo is the right answer");
  });

  test("a concurrent write is not lost to a duplicate migration pass", async () => {
    // The user-visible shape of the bug: a migration reads a list, the user
    // adds an entry, the migration writes back what it read. With one pass the
    // interleaving still exists but is bounded; with three passes racing each
    // other it is a lottery. This asserts one pass.
    let list = ["a"];
    let passes = 0;

    const migration = async () => {
      passes++;
      const snapshot = [...list];
      await new Promise((r) => setImmediate(r)); // the window
      list = snapshot;                            // write-back, clobbering
    };

    const running = Promise.all([
      runOneTimeMigrations({ migration }),
      runOneTimeMigrations({ migration }),
    ]);
    list.push("added-by-user");
    await running;

    assert.strictEqual(passes, 1, "only one read-modify-write window may exist");
  });
});

describe("runOneTimeMigrations — failure never breaks startup", () => {
  test("one rejecting migration does not stop the others", async () => {
    const ran = [];
    await runOneTimeMigrations({
      first: async () => { ran.push("first"); },
      boom: async () => { throw new Error("storage gone"); },
      last: async () => { ran.push("last"); },
    });
    assert.deepStrictEqual(ran.sort(), ["first", "last"]);
  });

  test("a rejection is settled, not left to escape as an unhandled rejection", async () => {
    // migrateStatsToLocal awaits a chrome.storage.local.set with no internal
    // catch, and used to be called bare at module scope. A rejection there was
    // an unhandled rejection during startup.
    const seen = [];
    const onUnhandled = (err) => seen.push(err);
    process.on("unhandledRejection", onUnhandled);

    await runOneTimeMigrations({ boom: async () => { throw new Error("bare"); } });
    await new Promise((r) => setImmediate(r));
    process.off("unhandledRejection", onUnhandled);

    assert.deepStrictEqual(seen, []);
  });

  test("a SYNCHRONOUS throw is caught too", async () => {
    // allSettled only settles promises. A migration that throws before
    // returning one would otherwise take startup down with it.
    const ran = [];
    await runOneTimeMigrations({
      sync_boom: () => { throw new Error("thrown before any promise"); },
      after: async () => { ran.push("after"); },
    });
    assert.deepStrictEqual(ran, ["after"]);
  });

  test("the failure is reported rather than swallowed", async () => {
    const warnings = [];
    const realWarn = console.warn;
    console.warn = (...args) => warnings.push(args.join(" "));
    try {
      await runOneTimeMigrations({ named_migration: async () => { throw new Error("why"); } });
    } finally {
      console.warn = realWarn;
    }

    assert.ok(
      warnings.some((w) => w.includes("named_migration")),
      "a silent best-effort failure is indistinguishable from a migration that never ran"
    );
  });
});
