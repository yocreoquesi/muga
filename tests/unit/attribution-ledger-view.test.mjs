/**
 * MUGA — Unit tests for attribution-ledger-view (#460, A2).
 *
 * Pure rendering layer that sits between the presenter (A1) and the popup
 * DOM. Takes the view-state from `presentLedger()` plus an `i18n(key)`
 * function and returns a list of plain objects ready for DOM building. No
 * `document`, no `chrome.*`, no DOM nodes — just data → data, so the popup
 * keeps the createElement/textContent boundary intact and the rendering
 * logic stays trivially testable.
 *
 * Coverage:
 *   - empty ledger → empty array
 *   - one row per event type with the right copy fields
 *   - URL truncation rule is consistent (long URLs get a tooltip-friendly
 *     `urlDisplay` while the full URL is preserved as `url` for clipboard)
 *   - i18n function receives the keys the presenter emits
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  createLedger,
  pushEvent,
  presentLedger,
} from "../../src/lib/attribution-ledger.js";

import { renderEntries } from "../../src/lib/attribution-ledger-view.js";

// Stub i18n: returns a deterministic "i18n(<key>)" string and records calls
// so individual assertions can verify the right keys flowed through.
function makeStubI18n() {
  const calls = [];
  function i18n(key, vars) {
    calls.push({ key, vars: vars || null });
    if (vars && Object.keys(vars).length > 0) {
      const parts = Object.entries(vars).map(([k, v]) => `${k}=${v}`).join(",");
      return `i18n(${key};${parts})`;
    }
    return `i18n(${key})`;
  }
  i18n.calls = calls;
  return i18n;
}

describe("renderEntries — empty + shape", () => {
  test("empty ledger view-state → empty array", () => {
    const view = presentLedger(createLedger());
    const i18n = makeStubI18n();
    const out = renderEntries(view, i18n);
    assert.ok(Array.isArray(out));
    assert.equal(out.length, 0);
    assert.equal(i18n.calls.length, 0, "no i18n calls when nothing to render");
  });

  test("non-object view-state → empty array (defensive)", () => {
    const i18n = makeStubI18n();
    assert.deepEqual(renderEntries(null, i18n), []);
    assert.deepEqual(renderEntries(undefined, i18n), []);
    assert.deepEqual(renderEntries({}, i18n), []);
  });
});

describe("renderEntries — one row per event type", () => {
  test('"clean" event renders badge text via ledger_badge_cleaned', () => {
    const ledger = pushEvent(createLedger(), { type: "clean", url: "https://example.com/a" });
    const i18n = makeStubI18n();
    const [row] = renderEntries(presentLedger(ledger), i18n);
    assert.equal(row.url, "https://example.com/a");
    assert.equal(row.urlDisplay, "https://example.com/a");
    assert.equal(row.badgeText, "i18n(ledger_badge_cleaned)");
    assert.equal(row.creatorCreditText, undefined);
    assert.equal(row.networkText, undefined);
    assert.ok(i18n.calls.some(c => c.key === "ledger_badge_cleaned"));
  });

  test('"navigate" event renders no badge / creator / network', () => {
    const ledger = pushEvent(createLedger(), { type: "navigate", url: "https://news.example/" });
    const [row] = renderEntries(presentLedger(ledger), makeStubI18n());
    assert.equal(row.url, "https://news.example/");
    assert.equal(row.badgeText, undefined);
    assert.equal(row.creatorCreditText, undefined);
    assert.equal(row.networkText, undefined);
  });

  test('"preserve-affiliate" event renders affiliate badge + network', () => {
    const ledger = pushEvent(createLedger(), {
      type: "preserve-affiliate",
      url: "https://shop.example/?tag=alice-21",
      network: "amazon",
    });
    const i18n = makeStubI18n();
    const [row] = renderEntries(presentLedger(ledger), i18n);
    assert.equal(row.badgeText, "i18n(ledger_badge_preserve_affiliate)");
    assert.equal(row.networkText, "i18n(ledger_network_template;network=amazon)");
    assert.ok(i18n.calls.some(c => c.key === "ledger_badge_preserve_affiliate"));
    assert.ok(i18n.calls.some(c => c.key === "ledger_network_template" && c.vars?.network === "amazon"));
  });

  test('a stray "inject-affiliate" event is dropped (unknown type, removed in drop-affiliate-injection PR 1a)', () => {
    const ledger = pushEvent(createLedger(), {
      type: "inject-affiliate",
      url: "https://shop.example/?tag=ours",
      network: "ebay",
    });
    const i18n = makeStubI18n();
    const rows = renderEntries(presentLedger(ledger), i18n);
    assert.deepEqual(rows, [], "unrecognized event type must not render a row");
  });

  test('"honor-creator" event renders honor badge + network + creator credit', () => {
    const ledger = pushEvent(createLedger(), {
      type: "honor-creator",
      url: "https://go.skimresources.com/?id=42",
      network: "skimlinks",
      creator: "youtube.com/@LinusTechTips",
    });
    const i18n = makeStubI18n();
    const [row] = renderEntries(presentLedger(ledger), i18n);
    assert.equal(row.badgeText, "i18n(ledger_badge_honor_creator)");
    assert.equal(
      row.networkText,
      "i18n(ledger_network_template;network=skimlinks)",
      "honor-creator must show the network name (acceptance criterion)",
    );
    assert.equal(
      row.creatorCreditText,
      "i18n(ledger_creator_credit_template;creator=youtube.com/@LinusTechTips)",
      "honor-creator must show the creator credit",
    );
  });

  test('"blocked-opaque" event renders blocked badge', () => {
    const ledger = pushEvent(createLedger(), { type: "blocked-opaque", url: "https://t.co/abc" });
    const i18n = makeStubI18n();
    const [row] = renderEntries(presentLedger(ledger), i18n);
    assert.equal(row.badgeText, "i18n(ledger_badge_blocked_opaque)");
    assert.equal(row.networkText, undefined);
    assert.equal(row.creatorCreditText, undefined);
  });
});

describe("renderEntries — URL truncation", () => {
  test("short URLs pass through unchanged in urlDisplay", () => {
    const url = "https://example.com/a?b=1";
    const ledger = pushEvent(createLedger(), { type: "clean", url });
    const [row] = renderEntries(presentLedger(ledger), makeStubI18n());
    assert.equal(row.url, url, "raw url preserved for clipboard");
    assert.equal(row.urlDisplay, url, "short urls render as-is");
  });

  test("long URLs are truncated for display but preserve full url for copy", () => {
    const long = "https://example.com/" + "x".repeat(200) + "?utm_source=newsletter";
    const ledger = pushEvent(createLedger(), { type: "clean", url: long });
    const [row] = renderEntries(presentLedger(ledger), makeStubI18n());
    assert.equal(row.url, long, "raw url is preserved verbatim for copy");
    assert.notEqual(row.urlDisplay, long, "urlDisplay must be truncated for long urls");
    assert.ok(
      row.urlDisplay.endsWith("…"),
      "truncation must end with an ellipsis (single Unicode char)",
    );
    assert.ok(
      row.urlDisplay.length < long.length,
      "urlDisplay shorter than original",
    );
    assert.ok(
      row.urlDisplay.length <= 80,
      "urlDisplay capped (default truncation rule ≤ 80 chars including ellipsis)",
    );
  });

  test("truncation rule is consistent across event types (deterministic)", () => {
    const long = "https://example.com/" + "y".repeat(150);
    const i18n = makeStubI18n();
    const a = renderEntries(presentLedger(pushEvent(createLedger(), { type: "navigate", url: long })), i18n)[0];
    const b = renderEntries(presentLedger(pushEvent(createLedger(), { type: "clean", url: long })), i18n)[0];
    const c = renderEntries(presentLedger(pushEvent(createLedger(), { type: "honor-creator", url: long, network: "n", creator: "c" })), i18n)[0];
    assert.equal(a.urlDisplay, b.urlDisplay);
    assert.equal(b.urlDisplay, c.urlDisplay);
  });
});

describe("renderEntries — order preserved", () => {
  test("preserves insertion order of pushEvent calls", () => {
    let l = createLedger();
    l = pushEvent(l, { type: "clean", url: "https://1.example/" });
    l = pushEvent(l, { type: "navigate", url: "https://2.example/" });
    l = pushEvent(l, { type: "blocked-opaque", url: "https://3.example/" });
    const rows = renderEntries(presentLedger(l), makeStubI18n());
    assert.deepEqual(
      rows.map(r => r.url),
      ["https://1.example/", "https://2.example/", "https://3.example/"],
    );
  });
});
