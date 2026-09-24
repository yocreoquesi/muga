/**
 * MUGA — regression guard: user-facing docs must state the shortener
 * feature the way the code ships it (#1254).
 *
 * The docs drifted because nothing tied their prose to `GENERIC_SHORTENERS`
 * or to `PREF_DEFAULTS`. Two public documents told a reader an outbound
 * third-party request feature was off when it ships on, and the privacy
 * policy named 7 of the 19 hosts the extension can contact. This file is
 * the tie.
 *
 *   (A) COUNT CLAIM — any doc that states how many shorteners MUGA follows
 *       must state `GENERIC_SHORTENERS.length`.
 *   (B) EXHAUSTIVE ENUMERATION — the two privacy policies must name every
 *       host in `GENERIC_SHORTENERS`. A policy that names a subset
 *       understates the egress it exists to disclose.
 *   (C) PREF KEYS — a doc that states a pref default (`someKey: value`)
 *       must name a key that exists in `PREF_DEFAULTS`, and no doc may
 *       mention a retired key at all.
 *
 * Run with: npm test
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { GENERIC_SHORTENERS } from "../../src/lib/opaque-networks.js";
import { PREF_DEFAULTS } from "../../src/lib/prefs.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "../..");

const read = (rel) => readFileSync(join(ROOT, rel), "utf8");

/** Every document a user or reviewer can read without cloning the repo. */
const USER_FACING_DOCS = [
  "README.md",
  "docs/faq.md",
  "docs/faq.html",
  "docs/privacy-page.html",
  "docs/transparency.html",
  "docs/tos.html",
  "docs/store-listing.md",
  "src/privacy/privacy.html",
  "src/privacy/tos.html",
  "landing/index.html",
];

/** The privacy policies. These must disclose the full egress surface. */
const PRIVACY_POLICIES = ["docs/privacy-page.html", "src/privacy/privacy.html"];

/**
 * Pref keys removed from PREF_DEFAULTS. Each is documented as retired in
 * src/lib/prefs.js with a "do NOT add it back" note; a doc that still names
 * one is describing a switch the user cannot find.
 */
const RETIRED_PREF_KEYS = [
  "followShortenersEnabled",
  "privacyProxyEnabled",
  "useNativeShortenerResolution",
];

// ── (A) Count claim ───────────────────────────────────────────────────────────

const NUMBER_WORDS = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8,
  nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14,
  fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
  twenty: 20,
};

/**
 * Matches a number immediately qualifying the word "shortener(s)", allowing
 * the adjectives the docs actually use. Adjacency is deliberate: it catches
 * "the eight generic URL shorteners" without matching unrelated sentences
 * that merely contain a number and the word somewhere else.
 */
const COUNT_RE = new RegExp(
  String.raw`\b(\d+|${Object.keys(NUMBER_WORDS).join("|")})\s+` +
    String.raw`(?:fixed\s+|generic\s+|known\s+|opted-in\s+|URL\s+)*shortener`,
  "gi"
);

describe("(A) docs state the real number of shorteners", () => {
  const expected = GENERIC_SHORTENERS.length;

  for (const docPath of USER_FACING_DOCS) {
    test(`${docPath} claims ${expected} shorteners wherever it claims a count`, () => {
      const wrong = [];
      for (const m of read(docPath).matchAll(COUNT_RE)) {
        const token = m[1].toLowerCase();
        const stated = NUMBER_WORDS[token] ?? Number(token);
        if (stated !== expected) wrong.push(`"${m[0].trim()}" states ${stated}`);
      }
      assert.deepStrictEqual(
        wrong,
        [],
        `${docPath} states a shortener count that is not ${expected}:\n  ${wrong.join("\n  ")}\n` +
          "GENERIC_SHORTENERS (src/lib/opaque-networks.js) is the source of truth. " +
          "When that list grows, this test fails until the prose follows it."
      );
    });
  }
});

// ── (B) Exhaustive enumeration in the privacy policies ────────────────────────

describe("(B) the privacy policies enumerate every shortener host", () => {
  for (const docPath of PRIVACY_POLICIES) {
    test(`${docPath} names all ${GENERIC_SHORTENERS.length} hosts`, () => {
      const content = read(docPath);
      const missing = GENERIC_SHORTENERS.filter((host) => !content.includes(host));
      assert.deepStrictEqual(
        missing,
        [],
        `${docPath} does not name ${missing.length} host(s) the extension can contact:\n  ${missing.join("\n  ")}\n` +
          "A privacy policy that lists a subset of the egress surface understates it. " +
          "Add the missing hosts, or remove them from GENERIC_SHORTENERS."
      );
    });
  }
});

// ── (C) Pref keys named in docs ───────────────────────────────────────────────

/**
 * Matches `someKey: value` inside a backtick span or an HTML <code> element.
 * The key must be camelCase (at least one uppercase letter) so that fetch
 * option bags — `redirect: "manual"`, `cache: "no-store"` — do not register
 * as pref claims.
 */
const PREF_CLAIM_RE =
  /(?:`|<code>)[^`<]*?\b([a-z][a-zA-Z0-9]*[A-Z][a-zA-Z0-9]*)\s*:\s*(?:true|false|-?\d+|"[^"]*")/g;

describe("(C) docs name only pref keys that exist", () => {
  for (const docPath of USER_FACING_DOCS) {
    test(`${docPath} states no default for an unknown pref key`, () => {
      const unknown = [
        ...new Set(
          [...read(docPath).matchAll(PREF_CLAIM_RE)]
            .map((m) => m[1])
            .filter((key) => !(key in PREF_DEFAULTS))
        ),
      ];
      assert.deepStrictEqual(
        unknown,
        [],
        `${docPath} states a default for pref key(s) absent from PREF_DEFAULTS:\n  ${unknown.join("\n  ")}\n` +
          "PREF_DEFAULTS (src/lib/prefs.js) is the source of truth for what the user can toggle."
      );
    });

    test(`${docPath} does not mention a retired pref key`, () => {
      const content = read(docPath);
      const found = RETIRED_PREF_KEYS.filter((key) => content.includes(key));
      assert.deepStrictEqual(
        found,
        [],
        `${docPath} mentions retired pref key(s):\n  ${found.join("\n  ")}\n` +
          "These were removed from PREF_DEFAULTS and are documented as retired in src/lib/prefs.js. " +
          "Describe the switch that replaced them instead."
      );
    });
  }
});

// ── (D) Resolution mechanism (#1386) ──────────────────────────────────────────

/**
 * The resolver fetches with `redirect: "follow"` and reads `response.url`
 * (src/lib/native-shortener-resolver.js). A manual redirect yields an opaque
 * response in a service worker, so the `Location` header is never read. A doc
 * that describes the manual/Location mechanism understates the egress: the
 * browser follows the whole chain and also contacts the destination.
 */
const MANUAL_MECHANISM_RE =
  /redirect\s*:\s*(?:"|&quot;|')manual|(?:`|<code>)Location(?:`|<\/code>)\s+header/gi;

describe("(D) docs describe the redirect chain being followed", () => {
  test("the resolver really follows the chain (source of truth)", () => {
    const src = read("src/lib/native-shortener-resolver.js");
    assert.match(src, /redirect:\s*"follow"/);
    assert.match(src, /response\.url/);
  });

  for (const docPath of USER_FACING_DOCS) {
    test(`${docPath} does not describe a manual redirect / Location header read`, () => {
      const found = [...read(docPath).matchAll(MANUAL_MECHANISM_RE)].map((m) => m[0]);
      assert.deepStrictEqual(
        found,
        [],
        `${docPath} describes the retired manual-redirect mechanism:\n  ${found.join("\n  ")}\n` +
          'The resolver uses redirect: "follow" and reads response.url, so the whole chain ' +
          "(including the destination) is contacted."
      );
    });
  }
});

// ── (E) No promised permission prompt (#1431) ─────────────────────────────────

/**
 * Both manifests carry <all_urls>, and neither RESOLVE_SHORTENER nor the
 * remote-rules fetch checks a permission: the Settings switches are the gate,
 * and shortener resolution on open plus remote rules ship ON. A doc that
 * promises a permission prompt before those requests, or says revoking the
 * optional grant stops them, describes a consent step that does not exist.
 */
const PERMISSION_PROMPT_CLAIMS = [
  /asks for your permission/i,
  /requested through your explicit action/i,
  /requested when you (?:turn on|enable)/i,
  /does not revoke the host permissions/i,
  /revoke this permission at any time/i,
  // The Terms' wording (#1386 native review): no browser prompts for it.
  /requests? permission for the shortener/i,
];

describe("(E) docs do not promise a permission prompt the code never shows", () => {
  test("the default-on network features are gated by prefs, not permissions (source of truth)", () => {
    assert.equal(PREF_DEFAULTS.resolveShortenersOnClick, true);
    assert.equal(PREF_DEFAULTS.remoteRulesEnabled, true);
    const mv2 = JSON.parse(read("src/manifest.v2.json"));
    assert.ok(mv2.permissions.includes("<all_urls>"), "Firefox manifest carries <all_urls>");
  });

  for (const docPath of USER_FACING_DOCS) {
    test(`${docPath} promises no permission prompt for default-on requests`, () => {
      const content = read(docPath);
      const found = PERMISSION_PROMPT_CLAIMS.filter((re) => re.test(content)).map(String);
      assert.deepStrictEqual(
        found,
        [],
        `${docPath} promises a permission step the code does not have:\n  ${found.join("\n  ")}\n` +
          "The Settings switches are the gate; <all_urls> already covers the hosts."
      );
    });
  }
});
