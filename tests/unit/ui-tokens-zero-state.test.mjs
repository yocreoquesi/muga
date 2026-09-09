/**
 * MUGA — UI token integrity and the popup's zero state (#1260)
 *
 * Three guards for three defects that shared one property: every one of them
 * was invisible to a reader of the code, because CSS fails silently.
 *
 *   1. A `var(--token)` nobody ever defines. The declaration still "works" —
 *      it falls through to its fallback, so the literal becomes the only value
 *      and the token is decorative. #1260 found `--bg-2` this way; by the time
 *      it was fixed, `--border-strong` had appeared with the same shape.
 *
 *   2. A design-token block copy-pasted into three deploy roots. `--ink-3`
 *      had already drifted in `docs/`, and not harmlessly: at #756D86 it read
 *      3.97:1 on the docs background, below the 4.5:1 AA floor the other two
 *      copies cleared at 5.49:1.
 *
 *   3. Three counters reading 0 with no copy near them, which is what a fresh
 *      install opens on.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
import { isFreshInstall } from "../../src/lib/stats-zero-state.js";
import { TRANSLATIONS, SUPPORTED_LANGS } from "../../src/lib/i18n.js";

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, "../..");
const read = (p) => readFileSync(join(ROOT, p), "utf8");

// ── 1. Every token a stylesheet reads, that stylesheet defines ──────────────

describe("extension stylesheets define every token they read", () => {
  const sheets = [
    "src/popup/popup.css",
    "src/options/options.css",
    "src/onboarding/onboarding.css",
  ];

  for (const sheet of sheets) {
    test(`${sheet}: no var() references an undefined token`, () => {
      const css = read(sheet);
      const defined = new Set([...css.matchAll(/(--[a-z0-9-]+)\s*:/gi)].map((m) => m[1]));
      const used = new Set([...css.matchAll(/var\(\s*(--[a-z0-9-]+)/gi)].map((m) => m[1]));
      const dangling = [...used].filter((t) => !defined.has(t));

      // A fallback does NOT excuse a dangling token: it makes the fallback the
      // only value the rule can ever take, which is the bug wearing a disguise.
      // Either define the token or write the value you actually mean.
      assert.deepStrictEqual(
        dangling,
        [],
        `${sheet} reads ${dangling.join(", ")} but never defines it`,
      );
    });
  }
});

// ── 2. The marketing token block is one block in three files ───────────────

describe("marketing design tokens agree across every surface that ships them", () => {
  // Three deploy roots, three inline copies: the landing page, the web
  // cleaner, and the docs stylesheet. Sharing one file across them is a
  // deploy change; agreeing on the values is not, so this is what holds.
  const SURFACES = [
    { name: "landing/index.html", src: read("landing/index.html") },
    { name: "web/index.html", src: read("web/index.html") },
    { name: "docs/muga-docs.css", src: read("docs/muga-docs.css") },
  ];

  const tokensOf = (src) => {
    const out = new Map();
    for (const [, name, value] of src.matchAll(/(--(?:bg|panel|ink|rule|accent|good|bad)[a-z0-9-]*)\s*:\s*(#[0-9a-f]{3,8})/gi)) {
      if (!out.has(name)) out.set(name, value.toUpperCase());
    }
    return out;
  };

  const [reference, ...rest] = SURFACES.map((s) => ({ ...s, tokens: tokensOf(s.src) }));

  test("the reference surface actually carries the token block", () => {
    assert.ok(reference.tokens.size >= 10, `${reference.name} should define the marketing tokens`);
  });

  for (const surface of rest) {
    test(`${surface.name} matches ${reference.name}`, () => {
      const drift = [];
      for (const [token, value] of reference.tokens) {
        const theirs = surface.tokens.get(token);
        if (theirs !== undefined && theirs !== value) {
          drift.push(`${token}: ${value} here, ${theirs} in ${surface.name}`);
        }
      }
      assert.deepStrictEqual(drift, [], `design tokens have drifted:\n${drift.join("\n")}`);
    });
  }
});

// ── 2b. And the muted text token clears AA where it is read ────────────────

describe("--ink-3 stays readable on the surfaces it is used on", () => {
  // The drift above was not cosmetic: the docs copy sat below the AA floor,
  // and --ink-3 is the token every caption, meta line and placeholder uses.
  const linear = (hex) => {
    const parts = [1, 3, 5]
      .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
      .map((c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)));
    return 0.2126 * parts[0] + 0.7152 * parts[1] + 0.0722 * parts[2];
  };
  const ratio = (a, b) => {
    const [hi, lo] = [linear(a), linear(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
  };

  const inkOf = (src) => /--ink-3\s*:\s*(#[0-9a-f]{6})/i.exec(src)?.[1];
  const BACKGROUNDS = ["#0E0C13", "#14111B", "#1A1622"]; // --bg, --panel, --panel-2

  for (const file of ["landing/index.html", "web/index.html", "docs/muga-docs.css"]) {
    test(`${file}: --ink-3 clears 4.5:1 on every surface it sits on`, () => {
      const ink = inkOf(read(file));
      assert.ok(ink, `${file} should define --ink-3`);
      for (const bg of BACKGROUNDS) {
        const r = ratio(ink, bg);
        assert.ok(
          r >= 4.5,
          `${file}: --ink-3 ${ink} on ${bg} is ${r.toFixed(2)}:1, below the 4.5:1 AA floor`,
        );
      }
    });
  }
});

// ── 3. The popup says something before it has anything to count ────────────

describe("popup zero state (#1260)", () => {
  test("the markup carries the message with its i18n key, hidden by default", () => {
    const html = read("src/popup/popup.html");
    assert.match(html, /id="stats-empty"[^>]*data-i18n="stats_zero_state"[^>]*hidden/);
  });

  test("popup.js reveals it only when the counters are untouched", () => {
    const js = read("src/popup/popup.js");
    assert.ok(js.includes("isFreshInstall"), "popup.js must decide from isFreshInstall");
    assert.match(js, /statsEmpty\.hidden\s*=\s*!isFreshInstall/);
  });

  test("every locale ships the string", () => {
    // TRANSLATIONS is key-major: TRANSLATIONS[key][lang].
    for (const { code } of SUPPORTED_LANGS) {
      const value = TRANSLATIONS.stats_zero_state?.[code];
      assert.ok(typeof value === "string" && value.length > 0, `${code} is missing stats_zero_state`);
    }
  });

  describe("isFreshInstall", () => {
    test("all three counters at zero is fresh", () => {
      assert.equal(isFreshInstall({ urlsCleaned: 0, junkRemoved: 0, referralsSpotted: 0 }), true);
    });

    test("any counter above zero is not", () => {
      assert.equal(isFreshInstall({ urlsCleaned: 1, junkRemoved: 0, referralsSpotted: 0 }), false);
      assert.equal(isFreshInstall({ urlsCleaned: 0, junkRemoved: 3, referralsSpotted: 0 }), false);
      assert.equal(isFreshInstall({ urlsCleaned: 0, junkRemoved: 0, referralsSpotted: 9 }), false);
    });

    test("a missing or unreadable stats object is fresh, because it has nothing to show", () => {
      assert.equal(isFreshInstall(undefined), true);
      assert.equal(isFreshInstall(null), true);
      assert.equal(isFreshInstall({}), true);
    });

    test("a corrupted counter is NOT fresh, so the message cannot contradict the numbers", () => {
      // The tiles render whatever formatStat makes of it. A zero state next to
      // a non-zero tile is worse than no zero state at all.
      assert.equal(isFreshInstall({ urlsCleaned: "12", junkRemoved: 0, referralsSpotted: 0 }), false);
      assert.equal(isFreshInstall({ urlsCleaned: NaN, junkRemoved: 0, referralsSpotted: 0 }), false);
      assert.equal(isFreshInstall([]), true); // an array is not a stats object
    });

    test("stats reset back to zero shows the message again", () => {
      // "Reset stats" writes exactly this object, and the popup should read it
      // the same way it reads a fresh install: there is nothing to show.
      assert.equal(isFreshInstall({ urlsCleaned: 0, junkRemoved: 0, referralsSpotted: 0 }), true);
    });
  });
});
