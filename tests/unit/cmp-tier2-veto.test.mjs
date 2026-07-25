/**
 * MUGA — Cookie Consent Minimizer: cmp-tier2-veto.js (#1027, Slice 2 / PR A)
 *
 * Pure-logic tests for the Tier 2 runtime semantic click-veto — the
 * load-bearing safety piece described in design.md ADR-1. No DOM, no
 * chrome.*, no globals; accessible names are injected as plain strings,
 * matching the pure-module contract described in src/lib/cmp-tier2-veto.js.
 *
 * Four groups:
 *   1. normalizeAccessibleName — NFC/lowercase/whitespace-collapse + NFD
 *      diacritic-stripped `folded` form.
 *   2. computeClickVeto adversarial battery — the four fail-closed cases
 *      (empty, icon-only, both-match, neither-match) plus multi-locale
 *      (en/es/de/fr/it/ja/pt) reject/settings/deny coverage.
 *   3. TEETH/shape test — `deny` is non-empty and contains known accept
 *      words; `reject`/`settings` are DISJOINT from `deny`; every entry is
 *      lowercase and diacritic-normalized (load-bearing — protects the
 *      veto's teeth from ever being silently emptied).
 *   4. Guard-exemption confirmation — the `/allowall|accept/i` structural
 *      guard in tests/unit/cmp-adapters.test.mjs scans ONLY
 *      cmp-adapters.js and cmp-tier2-rules.js, never this file.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
import { normalizeAccessibleName, computeClickVeto, VETO_WORDS } from "../../src/lib/cmp-tier2-veto.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── normalizeAccessibleName ──────────────────────────────────────────────

describe("normalizeAccessibleName", () => {
  test("lowercases and trims", () => {
    const { name } = normalizeAccessibleName("  Reject All  ");
    assert.equal(name, "reject all");
  });

  test("collapses internal whitespace runs to a single space", () => {
    const { name } = normalizeAccessibleName("Reject\n\t  All");
    assert.equal(name, "reject all");
  });

  test("folded strips diacritics via NFD + combining-mark removal", () => {
    const { name, folded } = normalizeAccessibleName("Acceptér");
    assert.equal(name, "acceptér");
    assert.equal(folded, "accepter");
  });

  test("folded of an already-unaccented string equals name", () => {
    const { name, folded } = normalizeAccessibleName("Reject all");
    assert.equal(folded, name);
  });

  test("non-string input never throws, degrades to empty strings", () => {
    for (const input of [null, undefined, 42, {}, []]) {
      assert.doesNotThrow(() => normalizeAccessibleName(input));
      const { name, folded } = normalizeAccessibleName(input);
      assert.equal(name, "");
      assert.equal(folded, "");
    }
  });

  test("whitespace-only input normalizes to an empty name", () => {
    const { name } = normalizeAccessibleName("   \n\t  ");
    assert.equal(name, "");
  });
});

// ── computeClickVeto — adversarial battery ───────────────────────────────

describe("computeClickVeto — the four required fail-closed cases", () => {
  test("empty accessible name -> VETO (empty-name)", () => {
    const result = computeClickVeto("", "reject", VETO_WORDS);
    assert.equal(result.allow, false);
    assert.equal(result.reason, "empty-name");
  });

  test("whitespace-only accessible name -> VETO (empty-name)", () => {
    const result = computeClickVeto("   ", "reject", VETO_WORDS);
    assert.equal(result.allow, false);
    assert.equal(result.reason, "empty-name");
  });

  test("icon-only control (no accessible name at all) -> VETO (empty-name)", () => {
    const result = computeClickVeto(undefined, "reject", VETO_WORDS);
    assert.equal(result.allow, false);
    assert.equal(result.reason, "empty-name");
  });

  test("name matching BOTH deny and reject words -> DENY wins -> VETO (accept-word)", () => {
    const result = computeClickVeto("Reject all / Accept all", "reject", VETO_WORDS);
    assert.equal(result.allow, false);
    assert.equal(result.reason, "accept-word");
  });

  test("name matching NEITHER deny nor the role's positive set -> VETO (no-reject-word)", () => {
    const result = computeClickVeto("Learn more", "reject", VETO_WORDS);
    assert.equal(result.allow, false);
    assert.equal(result.reason, "no-reject-word");
  });

  test("neutral name on an openSettings role -> VETO (no-settings-word)", () => {
    const result = computeClickVeto("Learn more", "openSettings", VETO_WORDS);
    assert.equal(result.allow, false);
    assert.equal(result.reason, "no-settings-word");
  });

  test("unknown role -> VETO (unknown-role), even with an otherwise-clean reject name", () => {
    const result = computeClickVeto("Reject all", "save", VETO_WORDS);
    assert.equal(result.allow, false);
    assert.equal(result.reason, "unknown-role");
  });
});

describe("computeClickVeto — reject role: selector-wrongly-matches-accept-labelled aborted", () => {
  test("a reject-role candidate honestly labelled 'Reject all' -> allow", () => {
    const result = computeClickVeto("Reject all", "reject", VETO_WORDS);
    assert.equal(result.allow, true);
    assert.equal(result.reason, "ok");
  });

  test("a reject-role candidate whose selector resolved to 'Accept all' -> VETO, never clicked", () => {
    const result = computeClickVeto("Accept all", "reject", VETO_WORDS);
    assert.equal(result.allow, false);
    assert.equal(result.reason, "accept-word");
  });

  test('"Accept only necessary" vetoes on the accept substring even though "necessary" is a reject hint', () => {
    const result = computeClickVeto("Accept only necessary", "reject", VETO_WORDS);
    assert.equal(result.allow, false);
    assert.equal(result.reason, "accept-word");
  });

  test("a generic selector (e.g. .btn-primary) resolving to an 'Accept all' button is vetoed identically to a reject-labelled selector mismatch", () => {
    // Simulates the spec's hostile-payload scenario: the selector itself
    // carries no semantic meaning, only the resolved accessible name does.
    const result = computeClickVeto("Accept all", "reject", VETO_WORDS);
    assert.equal(result.allow, false);
  });
});

describe("computeClickVeto — openSettings role", () => {
  test("a settings-labelled opener -> allow", () => {
    const result = computeClickVeto("Manage options", "openSettings", VETO_WORDS);
    assert.equal(result.allow, true);
    assert.equal(result.reason, "ok");
  });

  test("an opener also labelled with an accept word -> VETO (accept-deny still applies)", () => {
    const result = computeClickVeto("Accept and manage settings", "openSettings", VETO_WORDS);
    assert.equal(result.allow, false);
    assert.equal(result.reason, "accept-word");
  });

  test("an opener with neither a settings word nor an accept word -> VETO (no-settings-word)", () => {
    const result = computeClickVeto("Continue", "openSettings", VETO_WORDS);
    assert.equal(result.allow, false);
    assert.equal(result.reason, "no-settings-word");
  });
});

describe("computeClickVeto — multi-locale reject coverage (en/es/de/fr/it/ja/pt)", () => {
  const REJECT_ALLOWS = [
    ["en", "Reject all"],
    ["en", "Decline all"],
    ["en", "Only necessary"],
    ["es", "Rechazar todo"],
    ["es", "Solo necesarias"],
    ["de", "Alle ablehnen"],
    ["de", "Nur notwendige"],
    ["fr", "Tout refuser"],
    ["it", "Rifiuta"],
    ["it", "Solo necessari"],
    ["pt", "Recusar"],
    ["ja", "拒否"],
    ["ja", "すべて拒否"],
  ];

  for (const [locale, label] of REJECT_ALLOWS) {
    test(`${locale}: "${label}" -> allow (reject role)`, () => {
      const result = computeClickVeto(label, "reject", VETO_WORDS);
      assert.equal(result.allow, true, `expected "${label}" to be allowed, got reason "${result.reason}"`);
    });
  }
});

describe("computeClickVeto — multi-locale deny (accept) coverage (en/es/de/fr/it/ja/pt)", () => {
  const DENY_LABELS = [
    ["en", "Accept all"],
    ["es", "Aceptar todo"],
    ["de", "Alle akzeptieren"],
    ["fr", "Tout accepter"],
    ["it", "Accetta tutti"],
    ["pt", "Aceitar tudo"],
    ["ja", "同意する"],
  ];

  for (const [locale, label] of DENY_LABELS) {
    test(`${locale}: "${label}" -> VETO (accept-word) on a reject role`, () => {
      const result = computeClickVeto(label, "reject", VETO_WORDS);
      assert.equal(result.allow, false);
      assert.equal(result.reason, "accept-word");
    });

    test(`${locale}: "${label}" -> VETO (accept-word) on an openSettings role`, () => {
      const result = computeClickVeto(label, "openSettings", VETO_WORDS);
      assert.equal(result.allow, false);
      assert.equal(result.reason, "accept-word");
    });
  }
});

describe("computeClickVeto — multi-locale settings coverage (en/es/de/fr/it/pt/ja)", () => {
  const SETTINGS_ALLOWS = [
    ["en", "Settings"],
    ["en", "Manage options"],
    ["es", "Ajustes"],
    ["es", "Preferencias"],
    ["de", "Einstellungen"],
    ["fr", "Gérer"],
    ["it", "Impostazioni"],
    ["pt", "Gerenciar"],
    ["ja", "設定"],
  ];

  for (const [locale, label] of SETTINGS_ALLOWS) {
    test(`${locale}: "${label}" -> allow (openSettings role)`, () => {
      const result = computeClickVeto(label, "openSettings", VETO_WORDS);
      assert.equal(result.allow, true, `expected "${label}" to be allowed, got reason "${result.reason}"`);
    });
  }
});

describe("computeClickVeto — malformed input fails closed, never throws", () => {
  test("garbage wordLists (null/undefined/non-object) -> VETO, never throws", () => {
    for (const garbage of [null, undefined, 42, "x", []]) {
      assert.doesNotThrow(() => computeClickVeto("Reject all", "reject", garbage));
      const result = computeClickVeto("Reject all", "reject", garbage);
      assert.equal(result.allow, false);
    }
  });

  test("wordLists with non-array fields -> VETO, never throws", () => {
    assert.doesNotThrow(() => computeClickVeto("Reject all", "reject", { deny: null, reject: "x", settings: 42 }));
  });

  test("wordLists arrays containing non-string/empty entries are skipped, never throw", () => {
    const weird = { deny: [null, "", 42, "accept"], reject: [undefined, "reject"], settings: ["settings"] };
    assert.doesNotThrow(() => computeClickVeto("Reject all", "reject", weird));
    const result = computeClickVeto("Reject all", "reject", weird);
    assert.equal(result.allow, true);
  });
});

// ── TEETH / shape test (load-bearing) ────────────────────────────────────

describe("VETO_WORDS — teeth/shape guard (load-bearing)", () => {
  test("deny is non-empty", () => {
    assert.ok(Array.isArray(VETO_WORDS.deny) && VETO_WORDS.deny.length > 0);
  });

  test("deny contains known accept words across covered locales", () => {
    const KNOWN_ACCEPT_WORDS = ["accept", "aceptar", "akzeptieren", "accepter", "accetta", "aceitar", "同意"];
    for (const word of KNOWN_ACCEPT_WORDS) {
      assert.ok(VETO_WORDS.deny.includes(word), `deny must contain the known accept word "${word}"`);
    }
  });

  test("reject is non-empty and DISJOINT from deny", () => {
    assert.ok(Array.isArray(VETO_WORDS.reject) && VETO_WORDS.reject.length > 0);
    const denySet = new Set(VETO_WORDS.deny);
    for (const word of VETO_WORDS.reject) {
      assert.ok(!denySet.has(word), `reject word "${word}" must not also be a deny word`);
    }
  });

  test("settings is non-empty and DISJOINT from deny", () => {
    assert.ok(Array.isArray(VETO_WORDS.settings) && VETO_WORDS.settings.length > 0);
    const denySet = new Set(VETO_WORDS.deny);
    for (const word of VETO_WORDS.settings) {
      assert.ok(!denySet.has(word), `settings word "${word}" must not also be a deny word`);
    }
  });

  test("every entry in every list is already lowercase", () => {
    for (const list of [VETO_WORDS.deny, VETO_WORDS.reject, VETO_WORDS.settings]) {
      for (const word of list) {
        assert.equal(word, word.toLowerCase(), `"${word}" must be lowercase`);
      }
    }
  });

  // Scoped to Latin-script entries: `\p{Diacritic}` also matches Japanese
  // dakuten/handakuten (voiced-sound combining marks), so naively NFD-folding
  // a precomposed CJK entry (e.g. "べ") would alter it into a DIFFERENT kana
  // ("へ") rather than merely stripping an accent — that is not the "already
  // folded" property this check is after. Real matching is unaffected
  // (computeClickVeto checks the candidate's unfolded `name` first, which
  // never decomposes CJK), so this is a test-scoping fix, not a veto bug.
  test("every Latin-script entry is already diacritic-normalized (folding is a no-op)", () => {
    const hasCJK = (s) => /[぀-ヿ㐀-鿿]/.test(s);
    for (const list of [VETO_WORDS.deny, VETO_WORDS.reject, VETO_WORDS.settings]) {
      for (const word of list) {
        if (hasCJK(word)) continue;
        const folded = word.normalize("NFD").replace(/\p{Diacritic}/gu, "");
        assert.equal(folded, word, `"${word}" must already be diacritic-normalized`);
      }
    }
  });

  test("all three lists are frozen (immutable at the object and array level)", () => {
    assert.ok(Object.isFrozen(VETO_WORDS));
    assert.ok(Object.isFrozen(VETO_WORDS.deny));
    assert.ok(Object.isFrozen(VETO_WORDS.reject));
    assert.ok(Object.isFrozen(VETO_WORDS.settings));
  });
});

// ── Guard-exemption confirmation (task 3.1) ──────────────────────────────
//
// The closed-action structural guard in tests/unit/cmp-adapters.test.mjs
// scans EXACTLY src/lib/cmp-adapters.js and src/lib/cmp-tier2-rules.js (see
// its own `FORBIDDEN = /allowall|accept/i` describe block) — it must never
// be widened to include this file (see this module's own file docblock
// below). Manually confirmed during PR A implementation: the guard's two
// `readFileSync(...)` targets are unchanged and do not include
// cmp-tier2-veto.js. A dedicated regression test for a SIBLING test file's
// scan scope was deliberately NOT added here — it would be a source-string
// assertion against test-suite structure, blocked by the #824
// source-grep ratchet (tests/unit/source-grep-ratchet.test.mjs); the teeth
// test above already gives cmp-tier2-veto.js its own strong regression
// coverage (deny non-empty + contains accept words + disjoint allowlists),
// which is the actual safety property this exemption protects.

describe("cmp-tier2-veto.js — confirmed EXEMPT from the /allowall|accept/i structural guard", () => {
  test("this module's own docblock documents the exemption", () => {
    const source = readFileSync(join(__dirname, "../../src/lib/cmp-tier2-veto.js"), "utf8");
    assert.ok(source.includes("EXEMPT from the `/allowall|accept/i` structural guard"));
  });
});
