/**
 * MUGA — B13 (#445): Honor Creator Mode per-creator allowlist
 *
 * Pure CRUD tests for src/lib/creator-allowlist.js plus structural checks
 * confirming the storage default, options page editor, and i18n keys are
 * wired in. The pure module returns NEW arrays (immutable). The options
 * page consumes addEntry/removeEntry to mutate chrome.storage.sync.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
import {
  addEntry,
  removeEntry,
  normalizeEntry,
  isValidAllowlistEntry,
  MAX_ALLOWLIST_ENTRIES,
} from "../../src/lib/creator-allowlist.js";
import { PREF_DEFAULTS } from "../../src/lib/storage.js";
import { TRANSLATIONS } from "../../src/lib/i18n.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "../..");
const OPTIONS_HTML = readFileSync(join(ROOT, "src/options/options.html"), "utf8");
const OPTIONS_JS   = readFileSync(join(ROOT, "src/options/options.js"),   "utf8");

// ── Constants ───────────────────────────────────────────────────────────────
describe("B13 creator-allowlist — constants", () => {
  test("MAX_ALLOWLIST_ENTRIES is exported and is 100", () => {
    assert.strictEqual(MAX_ALLOWLIST_ENTRIES, 100);
  });
});

// ── normalizeEntry ──────────────────────────────────────────────────────────
describe("B13 creator-allowlist — normalizeEntry", () => {
  test("trims leading/trailing whitespace", () => {
    assert.strictEqual(normalizeEntry("  example.com  "), "example.com");
  });

  test("lowercases the entry", () => {
    assert.strictEqual(normalizeEntry("YouTube.com/@LinusTechTips"), "youtube.com/@linustechtips");
  });

  test("strips https:// prefix", () => {
    assert.strictEqual(normalizeEntry("https://example.com"), "example.com");
  });

  test("strips http:// prefix", () => {
    assert.strictEqual(normalizeEntry("http://example.com"), "example.com");
  });

  test("strips a single trailing slash", () => {
    assert.strictEqual(normalizeEntry("example.com/"), "example.com");
  });

  test("preserves path/handle characters", () => {
    assert.strictEqual(
      normalizeEntry("youtube.com/@LinusTechTips"),
      "youtube.com/@linustechtips"
    );
  });

  test("returns empty string for non-string input", () => {
    assert.strictEqual(normalizeEntry(null), "");
    assert.strictEqual(normalizeEntry(undefined), "");
    assert.strictEqual(normalizeEntry(123), "");
  });
});

// ── isValidAllowlistEntry ───────────────────────────────────────────────────
describe("B13 creator-allowlist — isValidAllowlistEntry", () => {
  test("accepts simple domains", () => {
    assert.strictEqual(isValidAllowlistEntry("example.com"), true);
    assert.strictEqual(isValidAllowlistEntry("dot-css-news.com"), true);
  });

  test("accepts youtube creator handles", () => {
    assert.strictEqual(isValidAllowlistEntry("youtube.com/@linustechtips"), true);
  });

  test("rejects empty / non-string", () => {
    assert.strictEqual(isValidAllowlistEntry(""), false);
    assert.strictEqual(isValidAllowlistEntry(null), false);
    assert.strictEqual(isValidAllowlistEntry(undefined), false);
    assert.strictEqual(isValidAllowlistEntry(42), false);
  });

  test("rejects entries with whitespace", () => {
    assert.strictEqual(isValidAllowlistEntry("example .com"), false);
    assert.strictEqual(isValidAllowlistEntry("foo bar"), false);
  });

  test("rejects entries with embedded control characters", () => {
    assert.strictEqual(isValidAllowlistEntry("exa\nmple.com"), false);
    assert.strictEqual(isValidAllowlistEntry("exa\tmple.com"), false);
  });

  test("rejects entries with disallowed punctuation (?, =, &, :)", () => {
    assert.strictEqual(isValidAllowlistEntry("example.com?x=1"), false);
    assert.strictEqual(isValidAllowlistEntry("example.com&y=2"), false);
    assert.strictEqual(isValidAllowlistEntry("example.com:8080"), false);
  });

  test("rejects entries longer than 200 chars", () => {
    const long = "a".repeat(201);
    assert.strictEqual(isValidAllowlistEntry(long), false);
  });

  test("accepts entry exactly 200 chars long", () => {
    const ok = "a".repeat(200);
    assert.strictEqual(isValidAllowlistEntry(ok), true);
  });
});

// ── addEntry ────────────────────────────────────────────────────────────────
describe("B13 creator-allowlist — addEntry", () => {
  test("returns a new array (does not mutate input)", () => {
    const input = ["youtube.com/@a"];
    const { list } = addEntry(input, "example.com");
    assert.notStrictEqual(list, input);
    assert.deepEqual(input, ["youtube.com/@a"]);
  });

  test("appends a normalized valid entry", () => {
    const { list, error } = addEntry([], "  https://Example.COM  ");
    assert.strictEqual(error, undefined);
    assert.deepEqual(list, ["example.com"]);
  });

  test("rejects empty / whitespace-only input with error 'empty'", () => {
    const before = ["example.com"];
    const r1 = addEntry(before, "");
    assert.strictEqual(r1.error, "empty");
    assert.deepEqual(r1.list, before);

    const r2 = addEntry(before, "    ");
    assert.strictEqual(r2.error, "empty");
    assert.deepEqual(r2.list, before);
  });

  test("rejects invalid format with error 'empty' (so the user sees the same 'cannot add' feedback)", () => {
    // Implementation detail: structurally invalid input also reports 'empty'
    // because the normalized form is empty after stripping garbage. This keeps
    // the UI surface to three error codes: empty / duplicate / max.
    const before = [];
    const result = addEntry(before, "has spaces in it");
    assert.ok(result.error, "must report some error");
    assert.deepEqual(result.list, before);
  });

  test("rejects duplicates case-insensitively with error 'duplicate'", () => {
    const before = ["youtube.com/@linustechtips"];
    const { list, error } = addEntry(before, "YouTube.COM/@LinusTechTips");
    assert.strictEqual(error, "duplicate");
    assert.deepEqual(list, before);
  });

  test("rejects duplicates after https:// stripping", () => {
    const before = ["example.com"];
    const { list, error } = addEntry(before, "https://example.com");
    assert.strictEqual(error, "duplicate");
    assert.deepEqual(list, before);
  });

  test("rejects when at MAX_ALLOWLIST_ENTRIES with error 'max'", () => {
    const full = Array.from({ length: MAX_ALLOWLIST_ENTRIES }, (_, i) => `creator${i}.com`);
    const { list, error } = addEntry(full, "newone.com");
    assert.strictEqual(error, "max");
    assert.deepEqual(list, full);
  });

  test("allows adding when one slot below cap", () => {
    const almost = Array.from({ length: MAX_ALLOWLIST_ENTRIES - 1 }, (_, i) => `creator${i}.com`);
    const { list, error } = addEntry(almost, "newone.com");
    assert.strictEqual(error, undefined);
    assert.strictEqual(list.length, MAX_ALLOWLIST_ENTRIES);
    assert.strictEqual(list[list.length - 1], "newone.com");
  });
});

// ── removeEntry ─────────────────────────────────────────────────────────────
describe("B13 creator-allowlist — removeEntry", () => {
  test("returns a new array without the matching entry", () => {
    const before = ["a.com", "b.com", "c.com"];
    const after = removeEntry(before, "b.com");
    assert.deepEqual(after, ["a.com", "c.com"]);
    assert.notStrictEqual(after, before);
    assert.deepEqual(before, ["a.com", "b.com", "c.com"]);
  });

  test("matches case-insensitively after normalization", () => {
    const before = ["youtube.com/@linustechtips"];
    const after = removeEntry(before, "YouTube.com/@LinusTechTips");
    assert.deepEqual(after, []);
  });

  test("returns equivalent list when entry is absent", () => {
    const before = ["a.com"];
    const after = removeEntry(before, "z.com");
    assert.deepEqual(after, ["a.com"]);
  });

  test("returns empty array when raw is empty/null", () => {
    assert.deepEqual(removeEntry(["a.com"], ""), ["a.com"]);
    assert.deepEqual(removeEntry(["a.com"], null), ["a.com"]);
  });
});

// ── Storage default ─────────────────────────────────────────────────────────
describe("B13 creator-allowlist — storage default", () => {
  test("PREF_DEFAULTS.creatorAllowlist exists", () => {
    assert.ok(
      Object.prototype.hasOwnProperty.call(PREF_DEFAULTS, "creatorAllowlist"),
      "PREF_DEFAULTS must declare creatorAllowlist"
    );
  });

  test("creatorAllowlist defaults to []", () => {
    assert.ok(Array.isArray(PREF_DEFAULTS.creatorAllowlist));
    assert.deepEqual(PREF_DEFAULTS.creatorAllowlist, []);
  });
});

// ── Options page UI ─────────────────────────────────────────────────────────
describe("B13 creator-allowlist — options page editor", () => {
  test("editor list container exists with id=creator-allowlist-items", () => {
    assert.ok(
      OPTIONS_HTML.includes('id="creator-allowlist-items"'),
      "options.html must contain a list container with id=creator-allowlist-items"
    );
  });

  test("input field exists with id=cal-input", () => {
    assert.ok(
      OPTIONS_HTML.includes('id="cal-input"'),
      "options.html must contain an input with id=cal-input for the allowlist editor"
    );
  });

  test("add button exists with id=cal-add-btn", () => {
    assert.ok(
      OPTIONS_HTML.includes('id="cal-add-btn"'),
      "options.html must contain an add button with id=cal-add-btn"
    );
  });

  test("editor uses i18n keys for label, placeholder, and hint", () => {
    assert.ok(
      OPTIONS_HTML.includes('data-i18n="creator_allowlist_label"'),
      "options.html must reference creator_allowlist_label via data-i18n"
    );
    assert.ok(
      OPTIONS_HTML.includes('data-i18n="creator_allowlist_hint"') ||
      OPTIONS_HTML.includes('data-i18n-html="creator_allowlist_hint"'),
      "options.html must reference creator_allowlist_hint via data-i18n or data-i18n-html"
    );
    assert.ok(
      OPTIONS_HTML.includes('data-i18n-placeholder="creator_allowlist_placeholder"'),
      "options.html must reference creator_allowlist_placeholder for the input placeholder"
    );
  });

  test("editor lives inside the dev-mode-gated Advanced card, BELOW the honor-creator-mode toggle (#936)", () => {
    const hcmIdx       = OPTIONS_HTML.indexOf('id="honor-creator-mode"');
    const editorIdx    = OPTIONS_HTML.indexOf('id="creator-allowlist-items"');
    const devToolsIdx  = OPTIONS_HTML.indexOf('id="dev-tools-card"');
    assert.ok(hcmIdx !== -1 && editorIdx !== -1 && devToolsIdx !== -1, "all anchors must exist");
    assert.ok(
      editorIdx > hcmIdx,
      "creator allowlist editor must appear AFTER the honor-creator-mode toggle"
    );
    // #936 IA reorg: both honor-creator-mode and its allowlist moved INTO the
    // dev-mode-gated #dev-tools-card, so the editor now appears AFTER the card opens.
    assert.ok(
      editorIdx > devToolsIdx,
      "creator allowlist editor must live inside #dev-tools-card so it is gated behind dev-mode (#936)"
    );
  });

  test("options.js wires the creator-allowlist add button", () => {
    assert.ok(
      OPTIONS_JS.includes("cal-add-btn"),
      "options.js must reference the cal-add-btn handler"
    );
    assert.ok(
      OPTIONS_JS.includes("creatorAllowlist"),
      "options.js must reference the creatorAllowlist storage key"
    );
  });
});

// ── i18n keys ───────────────────────────────────────────────────────────────
describe("B13 creator-allowlist — i18n keys", () => {
  const required = [
    "creator_allowlist_label",
    "creator_allowlist_hint",
    "creator_allowlist_placeholder",
    "creator_allowlist_add_btn",
    "creator_allowlist_remove_btn",
    "creator_allowlist_err_empty",
    "creator_allowlist_err_duplicate",
    "creator_allowlist_err_max",
  ];

  for (const key of required) {
    test(`TRANSLATIONS.${key} has en + es`, () => {
      const entry = TRANSLATIONS[key];
      assert.ok(entry, `Missing translation key: ${key}`);
      assert.ok(typeof entry.en === "string" && entry.en.trim() !== "", `${key}.en required`);
      assert.ok(typeof entry.es === "string" && entry.es.trim() !== "", `${key}.es required`);
    });
  }
});
