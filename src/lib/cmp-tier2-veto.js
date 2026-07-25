/**
 * MUGA: Cookie Consent Minimizer — Tier 2 runtime semantic click-veto
 * (#1027, Slice 2 / PR A — cookie-consent-tier2-remote)
 *
 * Pure, DOM-free module. NOT loaded as a content script — see AGENTS.md
 * (content scripts cannot use ES module imports). Hand-copied, byte-for-byte
 * modulo indentation, into src/content/cookie-noise.js under a
 * `@sync:cmp-tier2-veto` block, kept in sync by
 * tests/unit/cookie-noise-sync.test.mjs — same pattern as the existing
 * `@sync:cmp-tier2` copy of `resolveTier2Reject` in src/lib/cmp-adapters.js.
 *
 * ── The load-bearing safety piece ───────────────────────────────────────────
 *
 * This is the ONLY layer in the Tier 2 reject-click chain that inspects the
 * real-world CONSEQUENCE of a click (what the target control's accessible
 * name says it does) rather than rule/selector metadata. Every other layer
 * (closed rule shape, structural guards, runtime shape/cap validation for
 * remote data) constrains metadata; a CSS selector string carries no
 * inherent meaning of its own, so only this veto generalizes across unknown
 * selectors and CMPs — including a selector that is well-formed, signed, and
 * within every cap, but simply resolves to the wrong element (e.g. a
 * mis-curated remote rule pointing `reject` at an "Accept all" button).
 * Applies IDENTICALLY to bundled and remote-origin rules — there is no
 * exemption path for either origin (design.md ADR-1).
 *
 * ── EXEMPT from the `/allowall|accept/i` structural guard ───────────────────
 *
 * tests/unit/cmp-adapters.test.mjs's closed-action structural guard scans
 * EXACTLY two files: src/lib/cmp-adapters.js and src/lib/cmp-tier2-rules.js
 * (the rule/adapter DATA and decision files, which must never name an
 * accept-family action). This file is DELIBERATELY NOT in that scan and
 * must NEVER be added to it: `VETO_WORDS.deny` legitimately contains
 * accept/agree words in every covered locale — they are this module's
 * TEETH, not a violation. A future maintainer who "helpfully" adds this
 * file to that scan would break the build; a future maintainer who instead
 * strips the accept words to make such a scan pass would silently disable
 * the absolute accept-veto. The teeth test in
 * tests/unit/cmp-tier2-veto.test.mjs guards against exactly that: it
 * asserts `deny` is non-empty and contains known accept words, and that
 * `reject`/`settings` are DISJOINT from `deny`.
 *
 * ── Word-list distribution: BUNDLED, never remote (design.md ADR-2) ────────
 *
 * `VETO_WORDS` ships bundled in the extension, exactly like this file — it
 * is never fetched, never remote-signed. The safety ORACLE (is this click
 * safe?) must not be remotely mutable: a signing-key compromise that could
 * ship an empty `deny` list (disabling the absolute veto) or an
 * accept-poisoned `reject` list would defeat the entire never-accept chain
 * in a single payload. Coverage data (which selectors to look at) can be
 * remote; the safety decision itself must not be. Adding a new locale's
 * words is therefore a release event — acceptable, because the positive
 * "require a role word" gate degrades an uncovered locale to a coverage
 * gap (fail-closed no-op), never a wrong click.
 *
 * @typedef {object} ClickVetoResult
 * @property {boolean} allow - true only when the accessible name is
 *   non-empty, matches no accept/agree word, AND matches the role's
 *   required positive word.
 * @property {string} reason - one of "empty-name", "accept-word",
 *   "no-reject-word", "no-settings-word", "unknown-role", "ok".
 */

// @sync:cmp-tier2-veto:start

/**
 * NFC-normalizes, lowercases, and whitespace-collapses `raw` into `name`;
 * `folded` additionally strips Unicode combining diacritical marks (NFD +
 * `/\p{Diacritic}/gu` removal) so accented and de-accented variants of the
 * same word both match. Never throws — a non-string or unnormalizable input
 * degrades to `{ name: "", folded: "" }`, which the empty-name veto branch
 * in computeClickVeto below already treats as VETO.
 * @param {*} raw
 * @returns {{ name: string, folded: string }}
 */
function normalizeAccessibleName(raw) {
  const input = typeof raw === "string" ? raw : "";
  let name = "";
  try {
    name = input.normalize("NFC").toLowerCase().replace(/\s+/g, " ").trim();
  } catch {
    name = "";
  }
  let folded = name;
  try {
    folded = name.normalize("NFD").replace(/\p{Diacritic}/gu, "").replace(/\s+/g, " ").trim();
  } catch {
    folded = name;
  }
  return { name, folded };
}

// Accept/agree words across every covered locale (en/es/de/fr/it/ja/pt).
// THIS IS THE VETO'S TEETH — see the file docblock's guard-exemption note
// above and the teeth test in tests/unit/cmp-tier2-veto.test.mjs. Any word
// here matching a candidate's accessible name is an ABSOLUTE veto,
// role-independent — it wins over every allowlist match below. Every entry
// is already lowercase and diacritic-normalized (no combining marks), the
// same shape normalizeAccessibleName produces, so a bare `folded` substring
// check is always sufficient regardless of the source text's own accents.
const DENY_WORDS = Object.freeze([
  // en
  "accept",
  "accept all",
  "allow",
  "allow all",
  "agree",
  "i agree",
  // es
  "aceptar",
  "aceptar todo",
  "aceptar todas",
  // de
  "akzeptieren",
  "alle akzeptieren",
  "zustimmen",
  // fr
  "accepter",
  "tout accepter",
  // it
  "accetta",
  "accetta tutti",
  // pt
  "aceitar",
  "aceitar tudo",
  // ja
  "同意",
  "同意する",
  "すべてに同意",
]);

// Reject/decline/necessary-only words — REQUIRED positive match for a
// `role: "reject"` candidate (see computeClickVeto's precedence below).
// DISJOINT from DENY_WORDS by construction (asserted by the teeth test).
const REJECT_WORDS = Object.freeze([
  // en
  "reject",
  "reject all",
  "decline",
  "decline all",
  "refuse",
  "necessary only",
  "only necessary",
  // es
  "rechazar",
  "rechazar todo",
  "solo necesarias",
  // de
  "ablehnen",
  "alle ablehnen",
  "nur notwendige",
  // fr
  "refuser",
  "tout refuser",
  // it
  "rifiuta",
  "solo necessari",
  // pt
  "recusar",
  "somente necessarios",
  // ja
  "拒否",
  "すべて拒否",
]);

// Settings/preferences/manage words — REQUIRED positive match for a
// `role: "openSettings"` candidate. DISJOINT from DENY_WORDS by
// construction (asserted by the teeth test).
const SETTINGS_WORDS = Object.freeze([
  // en
  "settings",
  "preferences",
  "manage",
  "manage options",
  "customize",
  "more options",
  // es
  "ajustes",
  "preferencias",
  "gestionar",
  // de
  "einstellungen",
  "verwalten",
  // fr
  "gerer",
  "personnaliser",
  // it
  "impostazioni",
  "personalizza",
  // pt
  "gerenciar",
  // ja
  "設定",
  "環境設定",
]);

/**
 * The veto's bundled word lists (see the file docblock's "Word-list
 * distribution" section — BUNDLED, never remote). Passed explicitly into
 * computeClickVeto (dependency-injected, not read as a module-level
 * implicit global) so the pure function stays trivially testable with
 * adversarial fixtures.
 */
const VETO_WORDS = Object.freeze({
  deny: DENY_WORDS,
  reject: REJECT_WORDS,
  settings: SETTINGS_WORDS,
});

/**
 * True when the normalized `w` occurs as a substring of either `name` or
 * `folded` — substring (not word-boundary/token) matching is deliberate: it
 * is the safe/greedy direction for the absolute DENY set ("Accept only
 * necessary" must veto on the substring "accept" even though "necessary" is
 * a reject hint) and is the only workable form for CJK scripts, which have
 * no word boundaries. Never throws.
 * @param {string} name
 * @param {string} folded
 * @param {ReadonlyArray<string>} words
 * @returns {boolean}
 */
function matchesAny(name, folded, words) {
  const list = Array.isArray(words) ? words : [];
  for (const w of list) {
    if (typeof w !== "string" || w.length === 0) continue;
    if (name.indexOf(w) !== -1 || folded.indexOf(w) !== -1) return true;
  }
  return false;
}

/**
 * The semantic click-veto (LOAD-BEARING — see the file docblock). Decides
 * whether a candidate control is safe to click, given its full accessible
 * name and the ROLE the dispatcher intends to use it for.
 *
 * Precedence, evaluated strictly in order — first hit returns:
 *   1. Empty/whitespace-only `accessibleName` -> VETO ("empty-name").
 *      Covers icon-only / no-text controls and detached/hostile elements.
 *   2. Any `wordLists.deny` entry matches -> VETO ("accept-word"). Absolute
 *      and role-independent — wins over every allowlist match below.
 *   3. Role-specific positive gate (the required word must be PRESENT):
 *      - `role === "reject"` requires a `wordLists.reject` match, else
 *        VETO ("no-reject-word").
 *      - `role === "openSettings"` requires a `wordLists.settings` match,
 *        else VETO ("no-settings-word").
 *      - any other role -> VETO ("unknown-role").
 *   4. Otherwise -> ALLOW ("ok").
 *
 * The only allow path is: non-empty name AND no accept word AND the role's
 * required positive word present. Absence of signal always resolves to "do
 * not click" — fail-closed by construction. Pure; never throws.
 * @param {*} accessibleName
 * @param {"reject"|"openSettings"} role
 * @param {{ deny: ReadonlyArray<string>, reject: ReadonlyArray<string>, settings: ReadonlyArray<string> }} wordLists
 * @returns {ClickVetoResult}
 */
function computeClickVeto(accessibleName, role, wordLists) {
  const { name, folded } = normalizeAccessibleName(accessibleName);
  if (name.length === 0) return { allow: false, reason: "empty-name" };

  const lists = wordLists && typeof wordLists === "object" ? wordLists : {};
  if (matchesAny(name, folded, lists.deny)) return { allow: false, reason: "accept-word" };

  if (role === "reject") {
    if (!matchesAny(name, folded, lists.reject)) return { allow: false, reason: "no-reject-word" };
    return { allow: true, reason: "ok" };
  }
  if (role === "openSettings") {
    if (!matchesAny(name, folded, lists.settings)) return { allow: false, reason: "no-settings-word" };
    return { allow: true, reason: "ok" };
  }
  return { allow: false, reason: "unknown-role" };
}
// @sync:cmp-tier2-veto:end

export { normalizeAccessibleName, computeClickVeto, VETO_WORDS };
