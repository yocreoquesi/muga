#!/usr/bin/env node
/**
 * MUGA — validate-tier2-source.mjs (#1027 Slice 2, PR B3)
 *
 * Validates tools/rules-source/tier2.json against the SAME pure validators
 * the runtime fetch pipeline uses — `validateTier2PayloadShape` and
 * `validateTier2Rules` are imported from `src/lib/remote-tier2-rules.js`,
 * NOT reimplemented, so the CI gate and the runtime can never drift apart
 * (design ADR-7: "single source of truth ... imported by both").
 *
 * Additionally runs (design ADR-7/ADR-8):
 *   - The extended `/allowall|accept/i` structural scan over the RAW JSON
 *     SOURCE TEXT (not just selector strings) — the shipped build-time guard
 *     (`cmp-adapters.test.mjs`) scans only `cmp-adapters.js` and
 *     `cmp-tier2-rules.js`; without this extension the new remote-source
 *     payload class would silently lose the accept-token net.
 *   - A lightweight, DOM-free selector SYNTAX pre-check (charset/bracket/quote
 *     balance). Best-effort only — there is no DOM in CI, so a full CSS parse
 *     stays a runtime check (content script, gate-open).
 *
 * Version/freshness (VERSION_REGRESSION / STALE_PAYLOAD) are intentionally
 * SKIPPED here — those are signing-time concerns, not source-authoring
 * concerns (a source file may be dated during dev). This mirrors
 * `validate-rules-source.mjs`'s `validateParamsForSource` precedent, which
 * skips the same two checks for the identical reason. ADR-7 lists exactly
 * what this validator covers: "shape, caps, id regex, id-collision-with-
 * bundled, remote-vs-remote dup" — version/freshness are not in that list.
 *
 * Usage:
 *   node tools/validate-tier2-source.mjs
 *
 * Environment variables:
 *   MUGA_TIER2_SOURCE_FILE  (optional) Override source file path (tests).
 *
 * Exit codes:
 *   0 — source is valid
 *   1 — validation failure (schema, token-scan, selector-syntax, rules content)
 *   3 — I/O error (cannot read source file)
 *
 * This module is entry-guarded (see bottom of file): importing it for unit
 * tests performs ZERO I/O — `validateTier2SourceContent` and
 * `selectorLooksSyntacticallyValid` are pure functions over already-parsed
 * data. Only `main()` touches the filesystem, and only when this file is
 * run directly (mirrors `tools/build-tier2-rules.mjs`'s entry-guard).
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";

import {
  validateTier2PayloadShape,
  validateTier2Rules,
  BUNDLED_TIER2_IDS,
  TIER2_TOKEN_SCAN_RE,
} from "../src/lib/remote-tier2-rules.js";

// ── Path resolution ──────────────────────────────────────────────────────────

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_SOURCE = join(__dirname, "rules-source", "tier2.json");

function normalizePath(p) {
  // On Windows, file:// URL.pathname starts with /C:/ — normalize.
  if (process.platform === "win32" && p.startsWith("/")) return p.slice(1);
  return p;
}

const SOURCE_FILE = process.env.MUGA_TIER2_SOURCE_FILE
  ? normalizePath(process.env.MUGA_TIER2_SOURCE_FILE)
  : DEFAULT_SOURCE;

// ── DOM-free selector syntax pre-check ──────────────────────────────────────

/**
 * Best-effort, DOM-free CSS selector syntax sanity check: rejects empty
 * strings and unbalanced brackets/parens/quotes. This is NOT a real CSS
 * parse — the service worker and CI both lack a DOM. The authoritative
 * parseability check runs content-side via a real `document.querySelector`
 * try/catch at gate-open (PR B2, `tier2SelectorParses`). This pre-check only
 * catches the most obviously broken shapes at PR-review time.
 *
 * @param {string} sel
 * @returns {boolean}
 */
export function selectorLooksSyntacticallyValid(sel) {
  if (typeof sel !== "string" || sel.trim() === "") return false;

  const OPENERS_TO_CLOSERS = { "[": "]", "(": ")" };
  const CLOSERS = new Set(Object.values(OPENERS_TO_CLOSERS));
  const stack = [];
  let quote = null;

  for (const ch of sel) {
    if (quote) {
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      continue;
    }
    if (OPENERS_TO_CLOSERS[ch]) {
      stack.push(OPENERS_TO_CLOSERS[ch]);
      continue;
    }
    if (CLOSERS.has(ch)) {
      if (stack.pop() !== ch) return false;
    }
  }

  return stack.length === 0 && quote === null;
}

// ── Pure core ────────────────────────────────────────────────────────────────

/**
 * Validates the full content of an unsigned Tier2 source object: shape,
 * the accept-token structural scan over the raw text, the DOM-free selector
 * syntax pre-check, and rules content (caps/id/selector-bounds/token-scan/
 * ADD-only collision) via the SAME validators the runtime uses. Pure — no I/O.
 *
 * @param {unknown} source  - The parsed JSON source object.
 * @param {string}  rawText - The raw (unparsed) JSON source text, for the
 *                            structural accept-token scan.
 * @returns {{ ok: boolean, code?: string, detail?: string }}
 */
export function validateTier2SourceContent(source, rawText) {
  if (source === null || typeof source !== "object" || Array.isArray(source)) {
    return { ok: false, code: "SCHEMA_ERROR", detail: "Source must be a JSON object" };
  }

  /** @type {Record<string, unknown>} */
  const o = /** @type {Record<string, unknown>} */ (source);

  // Source is UNSIGNED — a 'sig' field here means someone accidentally
  // committed a signed/partial output as the source. Reject explicitly,
  // mirroring sign-rules.mjs's identical guard for params.json.
  if (Object.prototype.hasOwnProperty.call(source, "sig")) {
    return {
      ok: false,
      code: "SCHEMA_ERROR",
      detail: "Source file must NOT contain a 'sig' field — sig is added by sign-tier2-rules.mjs",
    };
  }

  // Shape check reuses the runtime's exact validator. The source lacks
  // 'sig' by design, so a placeholder string is supplied only to satisfy the
  // exact-5-key shape check — it never leaves this function.
  const shapeResult = validateTier2PayloadShape({ ...source, sig: "" });
  if (!shapeResult.ok) {
    return {
      ok: false,
      code: shapeResult.code,
      detail: "Top-level shape invalid — expected exactly {schemaVersion, version, published, rules}",
    };
  }

  // Extended structural scan (ADR-7/ADR-8): scans the RAW JSON TEXT, not
  // just selector strings, so an accept-family token hidden anywhere (e.g.
  // in an `id`) is also caught — the runtime's own per-selector scan
  // (inside validateTier2Rules below) only covers selector fields.
  if (TIER2_TOKEN_SCAN_RE.test(rawText)) {
    return {
      ok: false,
      code: "DENYLIST_HIT",
      detail: "Source JSON text contains an accept/allowall token — not allowed in remote-delivered data",
    };
  }

  // DOM-free selector syntax pre-check, every present/reject/openSettings entry.
  const rules = Array.isArray(o.rules) ? /** @type {object[]} */ (o.rules) : [];
  for (const rule of rules) {
    const selectors = [
      ...(Array.isArray(rule?.present) ? rule.present : []),
      ...(Array.isArray(rule?.reject) ? rule.reject : []),
      ...(Array.isArray(rule?.openSettings) ? rule.openSettings : []),
    ];
    for (const sel of selectors) {
      if (typeof sel === "string" && !selectorLooksSyntacticallyValid(sel)) {
        return {
          ok: false,
          code: "SELECTOR_SYNTAX",
          detail: `Selector fails the DOM-free syntax pre-check: ${sel}`,
        };
      }
    }
  }

  // Rules content: caps, id regex/length/uniqueness, selector array bounds,
  // per-selector length + token-scan, ADD-only bundled-id collision. Version
  // and freshness are deliberately bypassed here (signing-time concerns —
  // see file docblock): version is set high and published is "now" so both
  // checks trivially pass, isolating this call to the content checks ADR-7
  // actually assigns to source validation.
  const rulesResult = validateTier2Rules(o.rules, {
    version: 999_999_999,
    published: new Date().toISOString(),
    versionFloor: 0,
    bundledIds: BUNDLED_TIER2_IDS,
    nowMs: Date.now(),
  });
  if (!rulesResult.ok) {
    return { ok: false, code: rulesResult.code, detail: "Rules content validation failed" };
  }

  return { ok: true };
}

// ── I/O boundary (main) ──────────────────────────────────────────────────────

function main() {
  let rawText;
  try {
    rawText = readFileSync(SOURCE_FILE, "utf8");
  } catch (err) {
    console.error(`[validate-tier2-source] ERROR: Cannot read source file "${SOURCE_FILE}": ${err.message}`);
    process.exit(3);
  }

  let source;
  try {
    source = JSON.parse(rawText);
  } catch (err) {
    console.error(`[validate-tier2-source] ERROR: Source file is not valid JSON: ${err.message}`);
    process.exit(1);
  }

  const result = validateTier2SourceContent(source, rawText);
  if (!result.ok) {
    console.error(`[validate-tier2-source] ERROR: [${result.code}] ${result.detail}`);
    process.exit(1);
  }

  console.log(
    `[validate-tier2-source] OK: ${source.rules.length} rule(s) validated successfully ` +
      `(schemaVersion ${source.schemaVersion}, version ${source.version})`
  );
  process.exit(0);
}

// Only run the filesystem-reading main() when invoked directly, so the pure
// functions above can be imported by unit tests without touching the
// filesystem (mirrors tools/build-tier2-rules.mjs's entry-guard).
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
