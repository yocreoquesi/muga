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
 * ── openSettings ALSO vetoes on a save-family word (PR A review follow-up,
 * folded into PR B2) ────────────────────────────────────────────────────
 *
 * Once remote rules make `openSettings` reachable in production (PR B2), a
 * mis-curated or hostile remote rule could point `openSettings` at a
 * control whose accessible name is something like "Save my preferences" —
 * a settings-word match ("preferences") would otherwise let it pass the
 * positive gate below, but clicking it PERSISTS whatever consent state is
 * currently selected, which is not a neutral settings-opening action (the
 * two-step hop is only safe because opening a panel grants nothing by
 * itself — see the openSettings role's docblock in computeClickVeto).
 * `VETO_WORDS.save` is therefore checked, role-scoped to `openSettings`
 * only (it does not apply to `reject`), IN ADDITION TO the existing
 * require-a-settings-word gate: a target must match a settings word AND
 * must NOT match a save word to be clicked. Legit settings-openers like
 * "Manage preferences" or "Cookie settings" contain no save word and are
 * unaffected.
 *
 * ── The `"save"` role — a narrow, invariant-gated veto exception
 * (cookie-consent-toggle-reject, design.md ADR-4) ───────────────────────
 *
 * `role === "save"` is the ONLY role that can ever be allowed while also
 * matching a word from `VETO_WORDS.save` — every other role treats a save
 * word as irrelevant noise. It requires BOTH a `wordLists.save` match AND
 * `context.saveInvariantSatisfied === true` (see
 * src/lib/cmp-tier2-save-invariant.js's `computeSaveInvariant` — the
 * fail-closed re-verification that every non-essential toggle is off
 * before this flag can ever be true). The absolute accept-denylist check
 * (step 2 below) still runs FIRST and unconditionally wins: an "Accept
 * all"-labelled control passed in with `role: "save"` and
 * `saveInvariantSatisfied: true` is STILL vetoed — the invariant only ever
 * relaxes the save-word requirement, never the accept-word ban. `context`
 * is a 4th, DEFAULTED parameter (`context = {}`) so `computeClickVeto.length`
 * stays `3` — the existing structural guard (see
 * tests/unit/cookie-noise-sync.test.mjs's "spec scenario 5" test) keeps
 * passing unmodified. Only `context.saveInvariantSatisfied` is ever read;
 * any other field (e.g. an `origin`/`source`/rule-provenance marker) is
 * inert — there is no code path here that branches on it (see
 * tests/unit/cmp-tier2-veto.test.mjs's dedicated no-origin-exemption test).
 *
 * @typedef {object} ClickVetoResult
 * @property {boolean} allow - true only when the accessible name is
 *   non-empty, matches no accept/agree word, AND matches the role's
 *   required positive word (and, for openSettings, matches no save word;
 *   for save, ALSO requires context.saveInvariantSatisfied === true).
 * @property {string} reason - one of "empty-name", "accept-word",
 *   "no-reject-word", "no-settings-word", "save-word", "no-save-word",
 *   "save-invariant-unsatisfied", "unknown-role", "ok".
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
  "abgelehnt",
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
  "gestisci",
  "gestione",
  "opzioni",
  "preferenze",
  // pt
  "gerenciar",
  // ja
  "設定",
  "環境設定",
]);

// Save/persist words — checked ONLY for a `role: "openSettings"` candidate,
// IN ADDITION TO the SETTINGS_WORDS positive gate (see the file docblock's
// "openSettings ALSO vetoes on a save-family word" section). A
// settings-OPENER must not double as a consent-committing "Save" action.
// DISJOINT from DENY_WORDS and REJECT_WORDS by construction (asserted by
// the teeth test) — it deliberately overlaps with SETTINGS_WORDS in
// spirit (a "save preferences" phrase legitimately contains a settings
// word too), which is expected: the save check runs as an ADDITIONAL veto
// step, not a replacement for the settings gate.
const SAVE_WORDS = Object.freeze([
  // en
  "save",
  "save preferences",
  "save settings",
  "save my preferences",
  "save choices",
  // es
  "guardar",
  "guardar preferencias",
  "guardar mis preferencias",
  // de
  "speichern",
  "einstellungen speichern",
  // fr
  "enregistrer",
  "enregistrer mes preferences",
  // it
  "salva",
  "salva le preferenze",
  // pt
  "salvar",
  "salvar preferencias",
  // ja
  "保存",
  "保存する",
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
  save: SAVE_WORDS,
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
 *      and role-independent — wins over every allowlist match below,
 *      INCLUDING a `role === "save"` candidate with a satisfied invariant
 *      (design.md ADR-4: a mis-curated "Save" selector that actually
 *      resolves to "Accept all" is still vetoed).
 *   3. Role-specific positive gate (the required word must be PRESENT):
 *      - `role === "reject"` requires a `wordLists.reject` match, else
 *        VETO ("no-reject-word").
 *      - `role === "openSettings"` requires a `wordLists.settings` match,
 *        else VETO ("no-settings-word"); IN ADDITION, if `wordLists.save`
 *        also matches -> VETO ("save-word") — a settings-OPENER must not
 *        double as a consent-committing "Save" action (see the file
 *        docblock's "openSettings ALSO vetoes on a save-family word"
 *        section). Checked AFTER the settings-word gate passes, since a
 *        save-labelled control (e.g. "Save my preferences") typically
 *        also contains a settings word and would otherwise clear step 3.
 *      - `role === "save"` requires a `wordLists.save` match, else VETO
 *        ("no-save-word"); IN ADDITION, requires
 *        `context.saveInvariantSatisfied === true`, else VETO
 *        ("save-invariant-unsatisfied") — see the file docblock's `"save"`
 *        role section. Only `context.saveInvariantSatisfied` is ever read;
 *        no other field of `context` (e.g. an origin/source marker)
 *        affects the outcome.
 *      - any other role -> VETO ("unknown-role").
 *   4. Otherwise -> ALLOW ("ok").
 *
 * The only allow path is: non-empty name AND no accept word AND the role's
 * required positive word present (AND, for openSettings, no save word
 * present; for save, ALSO the invariant flag). Absence of signal always
 * resolves to "do not click" — fail-closed by construction. Pure; never
 * throws.
 * @param {*} accessibleName
 * @param {"reject"|"openSettings"|"save"} role
 * @param {{ deny: ReadonlyArray<string>, reject: ReadonlyArray<string>, settings: ReadonlyArray<string>, save: ReadonlyArray<string> }} wordLists
 * @param {{ saveInvariantSatisfied?: boolean }} [context] - defaulted so
 *   `computeClickVeto.length` stays `3`; only `saveInvariantSatisfied` is
 *   ever honored (design.md ADR-4 — no origin/source exemption).
 * @returns {ClickVetoResult}
 */
function computeClickVeto(accessibleName, role, wordLists, context = {}) {
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
    if (matchesAny(name, folded, lists.save)) return { allow: false, reason: "save-word" };
    return { allow: true, reason: "ok" };
  }
  if (role === "save") {
    if (!matchesAny(name, folded, lists.save)) return { allow: false, reason: "no-save-word" };
    const ctx = context && typeof context === "object" ? context : {};
    if (ctx.saveInvariantSatisfied !== true) return { allow: false, reason: "save-invariant-unsatisfied" };
    return { allow: true, reason: "ok" };
  }
  return { allow: false, reason: "unknown-role" };
}
// @sync:cmp-tier2-veto:end

export { normalizeAccessibleName, computeClickVeto, VETO_WORDS };
