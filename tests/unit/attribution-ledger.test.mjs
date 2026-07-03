/**
 * MUGA — Unit tests for attribution-ledger presenter (#454, A1).
 *
 * The presenter is a pure module: caller passes pipeline events in via an
 * immutable ledger, popup view-state comes back. No DOM, no storage, no
 * subscriptions. The "stream of pipeline events" is just an array — the
 * caller (popup, etc.) decides how/when to push.
 *
 * Coverage:
 *   - createLedger: defaults + custom capacity
 *   - pushEvent: append, ring-buffer eviction, immutability, validation
 *   - presentLedger: per-event-type mapping, optional fields, empty case
 *   - fromCleanerResult: maps each processUrl action → event shape
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import {
  DEFAULT_LEDGER_CAPACITY,
  EVENT_TYPES,
  createLedger,
  pushEvent,
  presentLedger,
  fromCleanerResult,
} from "../../src/lib/attribution-ledger.js";
import { processUrl } from "../../src/lib/cleaner.js";

const require = createRequire(import.meta.url);
const domainRules = require("../../src/rules/domain-rules.json");

const URL_A = "https://example.com/article";
const URL_B = "https://shop.example/product?utm_source=x";

describe("createLedger", () => {
  test("default capacity is 10", () => {
    assert.equal(DEFAULT_LEDGER_CAPACITY, 10);
    const ledger = createLedger();
    assert.equal(ledger.capacity, 10);
    assert.deepEqual(ledger.events, []);
  });

  test("custom capacity is respected", () => {
    const ledger = createLedger(3);
    assert.equal(ledger.capacity, 3);
    assert.deepEqual(ledger.events, []);
  });

  test("EVENT_TYPES is the full set the popup may receive", () => {
    assert.deepEqual(
      [...EVENT_TYPES].sort(),
      [
        "blocked-opaque",
        "clean",
        "honor-creator",
        "inject-affiliate",
        "navigate",
        "preserve-affiliate",
      ],
    );
  });
});

describe("pushEvent", () => {
  test("appends a valid event and returns a new ledger (immutability)", () => {
    const a = createLedger();
    const b = pushEvent(a, { type: "navigate", url: URL_A });
    assert.notEqual(a, b);
    assert.deepEqual(a.events, []);
    assert.equal(b.events.length, 1);
    assert.equal(b.events[0].type, "navigate");
    assert.equal(b.events[0].url, URL_A);
  });

  test("ignores events with unknown type (returns ledger unchanged)", () => {
    const a = createLedger();
    const b = pushEvent(a, { type: "garbage", url: URL_A });
    assert.equal(a, b);
    assert.deepEqual(b.events, []);
  });

  test("ignores non-object / null events", () => {
    const a = createLedger();
    assert.equal(pushEvent(a, null), a);
    assert.equal(pushEvent(a, undefined), a);
    assert.equal(pushEvent(a, "navigate"), a);
    assert.equal(pushEvent(a, 42), a);
  });

  test("ignores events without a type field", () => {
    const a = createLedger();
    const b = pushEvent(a, { url: URL_A });
    assert.equal(a, b);
  });

  test("evicts oldest when over capacity (ring buffer)", () => {
    let ledger = createLedger(3);
    for (let i = 0; i < 5; i++) {
      ledger = pushEvent(ledger, { type: "navigate", url: `${URL_A}?n=${i}` });
    }
    assert.equal(ledger.events.length, 3);
    // Most recent three retained, in chronological order (oldest → newest).
    assert.deepEqual(
      ledger.events.map(e => e.url),
      [`${URL_A}?n=2`, `${URL_A}?n=3`, `${URL_A}?n=4`],
    );
  });

  test("11th event evicts the first (default capacity = 10)", () => {
    let ledger = createLedger();
    for (let i = 0; i < 11; i++) {
      ledger = pushEvent(ledger, { type: "navigate", url: `${URL_A}?n=${i}` });
    }
    assert.equal(ledger.events.length, 10);
    assert.equal(ledger.events[0].url, `${URL_A}?n=1`);
    assert.equal(ledger.events[9].url, `${URL_A}?n=10`);
  });

  test("preserves auxiliary fields (network, creator) on the event", () => {
    let ledger = createLedger();
    ledger = pushEvent(ledger, {
      type: "honor-creator",
      url: URL_A,
      network: "skimlinks",
      creator: "youtube.com/@foo",
    });
    assert.equal(ledger.events[0].network, "skimlinks");
    assert.equal(ledger.events[0].creator, "youtube.com/@foo");
  });
});

describe("presentLedger", () => {
  test("empty ledger maps to empty entries", () => {
    const view = presentLedger(createLedger());
    assert.deepEqual(view, { entries: [] });
  });

  test("navigate event → { url, decision: 'navigate' }", () => {
    let ledger = createLedger();
    ledger = pushEvent(ledger, { type: "navigate", url: URL_A });
    const view = presentLedger(ledger);
    assert.equal(view.entries.length, 1);
    assert.deepEqual(view.entries[0], { url: URL_A, decision: "navigate" });
  });

  test("clean event → carries a badge i18n key", () => {
    let ledger = createLedger();
    ledger = pushEvent(ledger, { type: "clean", url: URL_B });
    const [entry] = presentLedger(ledger).entries;
    assert.equal(entry.url, URL_B);
    assert.equal(entry.decision, "clean");
    // Badge is an i18n KEY, not translated text — popup translates.
    assert.equal(typeof entry.badge, "string");
    assert.ok(entry.badge.length > 0);
    assert.ok(!entry.badge.includes(" "), "badge must be an i18n key, not a sentence");
  });

  test("preserve-affiliate event → carries network", () => {
    let ledger = createLedger();
    ledger = pushEvent(ledger, {
      type: "preserve-affiliate",
      url: URL_A,
      network: "amazon",
    });
    const [entry] = presentLedger(ledger).entries;
    assert.equal(entry.decision, "preserve-affiliate");
    assert.equal(entry.network, "amazon");
    assert.equal(entry.creatorCredit, undefined);
  });

  test("inject-affiliate event → carries network", () => {
    let ledger = createLedger();
    ledger = pushEvent(ledger, {
      type: "inject-affiliate",
      url: URL_A,
      network: "amazon",
    });
    const [entry] = presentLedger(ledger).entries;
    assert.equal(entry.decision, "inject-affiliate");
    assert.equal(entry.network, "amazon");
  });

  test("honor-creator event → carries network + creatorCredit", () => {
    let ledger = createLedger();
    ledger = pushEvent(ledger, {
      type: "honor-creator",
      url: URL_A,
      network: "skimlinks",
      creator: "youtube.com/@foo",
    });
    const [entry] = presentLedger(ledger).entries;
    assert.equal(entry.decision, "honor-creator");
    assert.equal(entry.network, "skimlinks");
    assert.equal(entry.creatorCredit, "youtube.com/@foo");
  });

  test("blocked-opaque event → just url + decision, no extras", () => {
    let ledger = createLedger();
    ledger = pushEvent(ledger, { type: "blocked-opaque", url: URL_A });
    const [entry] = presentLedger(ledger).entries;
    assert.equal(entry.decision, "blocked-opaque");
    assert.equal(entry.url, URL_A);
    assert.equal(entry.network, undefined);
    assert.equal(entry.creatorCredit, undefined);
    assert.equal(entry.badge, undefined);
  });

  test("entries appear in chronological order (oldest first)", () => {
    let ledger = createLedger();
    ledger = pushEvent(ledger, { type: "navigate", url: "https://a.test/" });
    ledger = pushEvent(ledger, { type: "clean", url: "https://b.test/" });
    ledger = pushEvent(ledger, { type: "navigate", url: "https://c.test/" });
    const urls = presentLedger(ledger).entries.map(e => e.url);
    assert.deepEqual(urls, [
      "https://a.test/",
      "https://b.test/",
      "https://c.test/",
    ]);
  });

  test("returned view state does not alias internal arrays (defensive copy)", () => {
    let ledger = createLedger();
    ledger = pushEvent(ledger, { type: "navigate", url: URL_A });
    const view = presentLedger(ledger);
    view.entries.push({ url: "mutation", decision: "navigate" });
    // Pushing again from the original ledger should NOT see the mutation —
    // ledger.events must remain length 1.
    assert.equal(ledger.events.length, 1);
  });
});

describe("fromCleanerResult", () => {
  test("action='honored-creator' → honor-creator event with network + creator", () => {
    const ev = fromCleanerResult("https://wrap.example/", {
      action: "honored-creator",
      network: "skimlinks",
      creator: "youtube.com/@foo",
    });
    assert.deepEqual(ev, {
      type: "honor-creator",
      url: "https://wrap.example/",
      network: "skimlinks",
      creator: "youtube.com/@foo",
    });
  });

  test("action='cleaned' → clean event", () => {
    const ev = fromCleanerResult(URL_B, { action: "cleaned" });
    assert.equal(ev.type, "clean");
    assert.equal(ev.url, URL_B);
  });

  test("action='injected' → inject-affiliate event with network when present", () => {
    const ev = fromCleanerResult(URL_A, {
      action: "injected",
      preservedAffiliate: { group: "amazon" },
    });
    assert.equal(ev.type, "inject-affiliate");
    assert.equal(ev.url, URL_A);
    assert.equal(ev.network, "amazon");
  });

  test("action='detected_foreign' → preserve-affiliate event", () => {
    const ev = fromCleanerResult(URL_A, {
      action: "detected_foreign",
      detectedAffiliate: { pattern: { group: "aliexpress" } },
    });
    assert.equal(ev.type, "preserve-affiliate");
    assert.equal(ev.url, URL_A);
    assert.equal(ev.network, "aliexpress");
  });

  test("action='untouched' → navigate event", () => {
    const ev = fromCleanerResult(URL_A, { action: "untouched" });
    assert.equal(ev.type, "navigate");
    assert.equal(ev.url, URL_A);
  });

  test("action='blacklisted' → clean event (params stripped)", () => {
    const ev = fromCleanerResult(URL_A, { action: "blacklisted" });
    assert.equal(ev.type, "clean");
  });

  test("returns null for unrecognized actions (defensive)", () => {
    assert.equal(fromCleanerResult(URL_A, { action: "what" }), null);
    assert.equal(fromCleanerResult(URL_A, null), null);
    assert.equal(fromCleanerResult(URL_A, {}), null);
  });

  test("end-to-end: cleaner result → pushEvent → presentLedger entry", () => {
    const result = {
      action: "honored-creator",
      network: "skimlinks",
      creator: "youtube.com/@foo",
    };
    const ev = fromCleanerResult("https://wrap.example/", result);
    let ledger = createLedger();
    ledger = pushEvent(ledger, ev);
    const [entry] = presentLedger(ledger).entries;
    assert.equal(entry.decision, "honor-creator");
    assert.equal(entry.network, "skimlinks");
    assert.equal(entry.creatorCredit, "youtube.com/@foo");
  });
});

// ── #946: copy-safe action table ─────────────────────────────────────────────
// Every user-facing COPY/SHARE affordance (including the Recent-activity
// ledger's per-row "Copy" button, which copies `row.url` sourced straight
// from these events) must put the cleanest SAFE form of a URL on the
// clipboard: tracking stripped, third-party creator attribution preserved,
// and — critically — no MUGA-injected affiliate tag. Before this fix,
// `cleaned`/`blacklisted` stored the raw pre-clean rawUrl (tracking noise
// intact) and `injected` stored result.cleanUrl verbatim (MUGA's own tag
// intact) — both wrong for a copy/share affordance.
const NAV_PREFS = Object.freeze({
  enabled: true,
  onboardingDone: true,
  injectOwnAffiliate: true,
  notifyForeignAffiliate: false,
  stripAllAffiliates: false,
  blacklist: [],
  whitelist: [],
  disabledCategories: [],
});

describe("fromCleanerResult — #946 copy-safe action table", () => {
  test("'cleaned' uses result.cleanUrl (tracking-stripped), NOT the raw pre-clean url", () => {
    const raw = "https://shop.example/product?utm_source=newsletter&id=1";
    const clean = "https://shop.example/product?id=1";
    const ev = fromCleanerResult(raw, { action: "cleaned", cleanUrl: clean });
    assert.equal(ev.url, clean);
    assert.notEqual(ev.url, raw, "must not store the raw URL carrying tracking noise");
  });

  test("'blacklisted' uses result.cleanUrl, NOT the raw pre-clean url", () => {
    const raw = "https://shop.example/product?tag=blocked";
    const clean = "https://shop.example/product";
    const ev = fromCleanerResult(raw, { action: "blacklisted", cleanUrl: clean });
    assert.equal(ev.url, clean);
    assert.notEqual(ev.url, raw);
  });

  test("'injected' derives a TAGLESS url via ctx reprocessing (real processUrl, injection re-forced off)", () => {
    const raw = "https://www.amazon.com/dp/B00X?utm_source=newsletter";
    const navResult = processUrl(raw, NAV_PREFS, domainRules);
    assert.equal(navResult.action, "injected", "sanity: this URL really gets MUGA's tag injected at navigation time");
    assert.ok(navResult.cleanUrl.includes("tag="), "sanity: the real nav result carries our tag");

    const ev = fromCleanerResult(raw, navResult, { prefs: NAV_PREFS, domainRules });
    assert.equal(ev.type, "inject-affiliate");
    assert.ok(!ev.url.includes("tag="), "ledger must never store MUGA's own injected tag");
    assert.ok(!ev.url.includes("utm_source"), "tracking noise must still be stripped from the derived copy-safe url");
  });

  test("'injected' without ctx falls back to the pre-injection rawUrl (backward compatible, still tag-free)", () => {
    const ev = fromCleanerResult(URL_A, { action: "injected", preservedAffiliate: { group: "amazon" } });
    assert.equal(ev.url, URL_A, "no ctx supplied — falls back to rawUrl rather than crashing or using a tagged cleanUrl");
  });

  test("'detected_foreign' preserves the third-party creator tag via result.cleanUrl", () => {
    const raw = "https://www.amazon.com/dp/B00X?utm_source=x&tag=creator-21";
    const foreignResult = processUrl(raw, { ...NAV_PREFS, notifyForeignAffiliate: true }, domainRules);
    assert.equal(foreignResult.action, "detected_foreign");

    const ev = fromCleanerResult(raw, foreignResult);
    assert.equal(ev.type, "preserve-affiliate");
    assert.equal(ev.url, foreignResult.cleanUrl);
    assert.ok(ev.url.includes("tag=creator-21"), "third-party creator tag must survive");
    assert.ok(!ev.url.includes("utm_source"), "unrelated tracking noise is still stripped");
  });

  test("'honored-creator' uses result.cleanUrl — the unmodified wrapper", () => {
    const wrapper = "https://go.skimresources.com/?id=abc&url=https://dest.example";
    const ev = fromCleanerResult(wrapper, {
      action: "honored-creator", cleanUrl: wrapper, network: "skimlinks", creator: "yt/@x",
    });
    assert.equal(ev.url, wrapper);
  });
});
