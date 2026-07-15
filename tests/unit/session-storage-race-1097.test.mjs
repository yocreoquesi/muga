/**
 * MUGA — #1097: badge/history read-modify-write race on chrome.storage.session.
 *
 * updateTabBadge() and appendHistory() in service-worker.js each do a
 * read -> mutate -> write cycle against chrome.storage.session (badge totals,
 * per-page counters, session history). Unlike the whitelist/blacklist
 * mutations (serialized via `_listMutationQueue`), these two cycles used to
 * run un-serialized. In MV3, chrome.storage.session is real async IPC (not a
 * synchronous in-memory Map), so two of these cycles racing on the same tab
 * can each read the pre-update value before either write lands — the second
 * write clobbers the first and the badge undercounts (or a history entry is
 * silently dropped).
 *
 * The fix adds `withSessionMutation`, a small serialization queue mirroring
 * the shape of `_listMutationQueue` (service-worker.js) and
 * `createMutex`/`withSyncMutation` (src/options/sync-mutation.js), and routes
 * both updateTabBadge and appendHistory through it.
 *
 * service-worker.js is browser-only (top-level chrome.* calls) and cannot be
 * imported directly in Node, so — following the established pattern in this
 * suite (see onboarding-tab-dedup-967.test.mjs, sw-robustness-833.test.mjs) —
 * the real production functions are extracted via source-slicing and bound to
 * a fake, artificially-delayed chrome.storage.session double that reproduces
 * the async-IPC race deterministically.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

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

const withSessionMutationSrc = extractFunctionSource(SW_SOURCE, "withSessionMutation");
const updateTabBadgeSrc = extractFunctionSource(SW_SOURCE, "updateTabBadge");
const appendHistorySrc = extractFunctionSource(SW_SOURCE, "appendHistory");
const historyMaxMatch = SW_SOURCE.match(/const HISTORY_MAX\s*=\s*\d+;/);
assert.ok(historyMaxMatch, "HISTORY_MAX constant must be defined");

/**
 * Builds a fresh { updateTabBadge, appendHistory, withSessionMutation } bound
 * to fake sessionStorage/getPrefsWithCache/toolbarBus dependencies, with its
 * own private `_sessionMutationQueue` (fresh per call — tests never share
 * queue state).
 */
function buildSessionHelpers({ sessionStorage, getPrefsWithCache, toolbarBus }) {
  const factory = new Function(
    "sessionStorage", "getPrefsWithCache", "toolbarBus",
    `"use strict";
     let _sessionMutationQueue = Promise.resolve();
     ${historyMaxMatch[0]}
     ${withSessionMutationSrc}
     ${updateTabBadgeSrc}
     ${appendHistorySrc}
     return { updateTabBadge, appendHistory, withSessionMutation };`,
  );
  return factory(sessionStorage, getPrefsWithCache, toolbarBus);
}

/**
 * Fake chrome.storage.session double with a configurable artificial delay on
 * both get() and set(), to deterministically reproduce the interleaving that
 * real async IPC allows (a synchronous in-memory Map never would).
 */
function makeFakeSessionStorage({ delayMs = 5 } = {}) {
  const store = {};
  const tick = () => (delayMs ? new Promise((r) => setTimeout(r, delayMs)) : Promise.resolve());
  return {
    get: async (query) => {
      await tick();
      const result = {};
      for (const [k, def] of Object.entries(query)) {
        result[k] = Object.prototype.hasOwnProperty.call(store, k) ? store[k] : def;
      }
      return result;
    },
    set: async (items) => {
      await tick();
      Object.assign(store, items);
    },
    getStore: () => store,
  };
}

function noopToolbarBus() {
  const emitted = [];
  return { emit: (e) => emitted.push(e), emitted };
}

describe("#1097 — SW defines the session-storage mutation queue", () => {
  test("withSessionMutation is defined as a module-level helper", () => {
    assert.ok(
      /function withSessionMutation\(/.test(SW_SOURCE),
      "service-worker.js must define withSessionMutation",
    );
  });

  test("updateTabBadge routes its read-modify-write cycle through withSessionMutation", () => {
    assert.ok(
      updateTabBadgeSrc.includes("withSessionMutation("),
      "updateTabBadge must serialize its badge read-modify-write cycle",
    );
  });

  test("appendHistory routes its read-modify-write cycle through withSessionMutation", () => {
    assert.ok(
      appendHistorySrc.includes("withSessionMutation("),
      "appendHistory must serialize its history read-modify-write cycle",
    );
  });
});

describe("#1097 — updateTabBadge: concurrent clean events never lose an update", () => {
  test("two concurrent updateTabBadge calls on the same tab sum correctly", async () => {
    const sessionStorage = makeFakeSessionStorage();
    const { updateTabBadge } = buildSessionHelpers({
      sessionStorage,
      getPrefsWithCache: async () => ({}),
      toolbarBus: noopToolbarBus(),
    });

    await Promise.all([
      updateTabBadge(42, 3),
      updateTabBadge(42, 4),
    ]);

    assert.strictEqual(sessionStorage.getStore().tab_42, 7, "per-page count must reflect both updates");
    assert.strictEqual(sessionStorage.getStore().tab_badge_42, 7, "per-tab badge total must reflect both updates");
  });

  test("five concurrent updateTabBadge calls on the same tab all land, in call order", async () => {
    const sessionStorage = makeFakeSessionStorage();
    const { updateTabBadge } = buildSessionHelpers({
      sessionStorage,
      getPrefsWithCache: async () => ({}),
      toolbarBus: noopToolbarBus(),
    });

    await Promise.all([1, 2, 3, 4, 5].map((n) => updateTabBadge(7, n)));

    assert.strictEqual(sessionStorage.getStore().tab_badge_7, 1 + 2 + 3 + 4 + 5);
    assert.strictEqual(sessionStorage.getStore().tab_7, 1 + 2 + 3 + 4 + 5);
  });

  test("emits urlCleaned with the correct running total for each call", async () => {
    const sessionStorage = makeFakeSessionStorage();
    const toolbarBus = noopToolbarBus();
    const { updateTabBadge } = buildSessionHelpers({
      sessionStorage,
      getPrefsWithCache: async () => ({}),
      toolbarBus,
    });

    await updateTabBadge(5, 2);
    await updateTabBadge(5, 3);

    assert.deepStrictEqual(
      toolbarBus.emitted.map((e) => e.total),
      [2, 5],
      "each emit must carry the correctly-serialized running total",
    );
  });
});

describe("#1097 — appendHistory: concurrent clean events never drop an entry", () => {
  test("two concurrent appendHistory calls both land in session history", async () => {
    const sessionStorage = makeFakeSessionStorage();
    const { appendHistory } = buildSessionHelpers({
      sessionStorage,
      getPrefsWithCache: async () => ({}),
      toolbarBus: noopToolbarBus(),
    });

    await Promise.all([
      appendHistory("https://a.example/?utm_source=x", "https://a.example/"),
      appendHistory("https://b.example/?utm_source=y", "https://b.example/"),
    ]);

    const history = sessionStorage.getStore().history;
    assert.strictEqual(history.length, 2, "both concurrent appends must be present, none dropped");
    const originals = history.map((e) => e.original).sort();
    assert.deepStrictEqual(originals, ["https://a.example/?utm_source=x", "https://b.example/?utm_source=y"]);
  });
});

describe("#1097 — regression repro: an UNSERIALIZED cycle drops updates (proves the queue is load-bearing)", () => {
  test("two concurrent badge increments without the queue can lose an update", async () => {
    // Mirrors the pre-#1097-fix shape of updateTabBadge's badge-total cycle:
    // read -> compute -> write, with no serialization at all.
    const sessionStorage = makeFakeSessionStorage();
    async function unserializedIncrement(tabId, junkRemoved) {
      const key = `tab_badge_${tabId}`;
      const data = await sessionStorage.get({ [key]: 0 });
      const next = data[key] + junkRemoved;
      await sessionStorage.set({ [key]: next });
      return next;
    }

    await Promise.all([
      unserializedIncrement(99, 3),
      unserializedIncrement(99, 4),
    ]);

    // Without serialization, both reads observe 0 (their get() calls overlap
    // before either set() lands), so the last write to land wins and one
    // increment is silently lost. This is exactly the #1097 bug.
    assert.notStrictEqual(
      sessionStorage.getStore().tab_badge_99,
      7,
      "an unserialized read-modify-write cycle must lose an update under concurrency — proves the fix is load-bearing",
    );
  });
});

describe("#1097 — withSessionMutation: extracted serialization helper", () => {
  test("mutations queued through the same helper instance run strictly in call order", async () => {
    const { withSessionMutation } = buildSessionHelpers({
      sessionStorage: makeFakeSessionStorage(),
      getPrefsWithCache: async () => ({}),
      toolbarBus: noopToolbarBus(),
    });

    const order = [];
    await Promise.all(
      ["a", "b", "c"].map((item, i) =>
        withSessionMutation(async () => {
          await new Promise((r) => setTimeout(r, (3 - i) * 5)); // earlier calls resolve slower
          order.push(item);
        }),
      ),
    );

    assert.deepStrictEqual(order, ["a", "b", "c"], "mutations must be invoked in call order, not completion order");
  });

  test("a throwing mutation does not permanently poison the queue (self-healing)", async () => {
    const { withSessionMutation } = buildSessionHelpers({
      sessionStorage: makeFakeSessionStorage(),
      getPrefsWithCache: async () => ({}),
      toolbarBus: noopToolbarBus(),
    });

    let secondRan = false;
    await withSessionMutation(async () => { throw new Error("boom"); }).catch(() => {});
    await withSessionMutation(async () => { secondRan = true; });

    assert.strictEqual(secondRan, true, "the queue must keep running mutations after an earlier one rejects");
  });

  test("returns the value the queued function resolves to", async () => {
    const { withSessionMutation } = buildSessionHelpers({
      sessionStorage: makeFakeSessionStorage(),
      getPrefsWithCache: async () => ({}),
      toolbarBus: noopToolbarBus(),
    });

    const result = await withSessionMutation(async () => 42);
    assert.strictEqual(result, 42);
  });
});
