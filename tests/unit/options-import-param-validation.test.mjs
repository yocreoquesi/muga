/**
 * MUGA — Import-path customParam validation (#818)
 *
 * Guards that the settings-import path uses the canonical remote-rules
 * constants (MAX_PARAM_LEN=64, PARAM_FORMAT_RE) instead of the old
 * divergent inline validator that accepted params up to 499 chars.
 *
 * Also guards the affiliate-guard and denylist decisions made in #818:
 * - AFFILIATE_PARAM_GUARD: imported customParams that match affiliate
 *   attribution keys (e.g. "tag") are rejected — accepting them would
 *   silently break MUGA's product promise (preserve affiliate refs).
 * - REMOTE_PARAM_DENYLIST: imported customParams that match protected
 *   navigation/search keys (e.g. "q") are rejected — accepting them
 *   would break legitimate browsing (stripped search queries, etc.).
 *
 * UX: invalid customParams are filtered out (not whole-import-abort),
 * and the caller receives the count of rejected entries so it can show
 * a partial-import toast. Structural failures (bad schema, bad format)
 * still abort the whole import via the existing throw path.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import {
  MAX_PARAM_LEN,
  PARAM_FORMAT_RE,
  REMOTE_PARAM_DENYLIST,
  AFFILIATE_PARAM_GUARD,
} from "../../src/lib/remote-rules.js";

import { isValidCustomParam } from "../../src/lib/validation.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OPTIONS_SOURCE = readFileSync(
  join(__dirname, "../../src/options/options.js"),
  "utf8"
);
const VALIDATION_SOURCE = readFileSync(
  join(__dirname, "../../src/lib/validation.js"),
  "utf8"
);
const I18N_SOURCE = readFileSync(
  join(__dirname, "../../src/lib/i18n.js"),
  "utf8"
);

// ── T1: canonical constants ───────────────────────────────────────────────────

describe("T1 remote-rules.js exports canonical param constants", () => {
  test("MAX_PARAM_LEN is 64", () => {
    assert.strictEqual(MAX_PARAM_LEN, 64);
  });

  test("PARAM_FORMAT_RE accepts valid param chars", () => {
    assert.ok(PARAM_FORMAT_RE.test("ref_code"));
    assert.ok(PARAM_FORMAT_RE.test("promo.id"));
    assert.ok(PARAM_FORMAT_RE.test("abc-123"));
    assert.ok(PARAM_FORMAT_RE.test("a1B2c3"));
  });

  test("PARAM_FORMAT_RE rejects invalid chars", () => {
    assert.ok(!PARAM_FORMAT_RE.test("ref code"));
    assert.ok(!PARAM_FORMAT_RE.test("ref<code>"));
    assert.ok(!PARAM_FORMAT_RE.test("ref;drop"));
    assert.ok(!PARAM_FORMAT_RE.test("ref=bad"));
  });

  test("REMOTE_PARAM_DENYLIST contains protected nav/search keys", () => {
    assert.ok(REMOTE_PARAM_DENYLIST.has("q"));
    assert.ok(REMOTE_PARAM_DENYLIST.has("id"));
    assert.ok(REMOTE_PARAM_DENYLIST.has("token"));
    assert.ok(REMOTE_PARAM_DENYLIST.has("search"));
  });

  test("AFFILIATE_PARAM_GUARD contains affiliate attribution keys", () => {
    assert.ok(AFFILIATE_PARAM_GUARD.has("tag"));
    assert.ok(AFFILIATE_PARAM_GUARD.has("campid"));
    assert.ok(AFFILIATE_PARAM_GUARD.has("clickid"));
  });
});

// ── T2: isValidCustomParam in validation.js ───────────────────────────────────

describe("T2 isValidCustomParam — exported from validation.js", () => {
  test("accepts 64-char param (boundary: MAX_PARAM_LEN)", () => {
    const param = "a".repeat(64);
    assert.ok(isValidCustomParam(param), `64-char param must be accepted (MAX_PARAM_LEN=${MAX_PARAM_LEN})`);
  });

  test("rejects 65-char param (exceeds MAX_PARAM_LEN)", () => {
    const param = "a".repeat(65);
    assert.ok(!isValidCustomParam(param), "65-char param must be rejected");
  });

  test("rejects 200-char param (old limit was 499 — regression guard)", () => {
    const param = "a".repeat(200);
    assert.ok(!isValidCustomParam(param), "200-char param must be rejected by canonical validator");
  });

  test("accepts typical valid params", () => {
    assert.ok(isValidCustomParam("ref_code"));
    assert.ok(isValidCustomParam("promo.id"));
    assert.ok(isValidCustomParam("campaign-123"));
    assert.ok(isValidCustomParam("utm_source"));
  });

  test("rejects empty string", () => {
    assert.ok(!isValidCustomParam(""));
  });

  test("rejects invalid chars (spaces, angle brackets, semicolons)", () => {
    assert.ok(!isValidCustomParam("ref code"));
    assert.ok(!isValidCustomParam("ref<code>"));
    assert.ok(!isValidCustomParam("ref;drop"));
    assert.ok(!isValidCustomParam("ref=bad"));
  });

  test("rejects non-string types", () => {
    assert.ok(!isValidCustomParam(null));
    assert.ok(!isValidCustomParam(undefined));
    assert.ok(!isValidCustomParam(42));
    assert.ok(!isValidCustomParam([]));
  });

  // Denylist checks
  test("rejects REMOTE_PARAM_DENYLIST entries (e.g. 'q', 'id', 'token')", () => {
    assert.ok(!isValidCustomParam("q"), "denylist: 'q' must be rejected");
    assert.ok(!isValidCustomParam("id"), "denylist: 'id' must be rejected");
    assert.ok(!isValidCustomParam("token"), "denylist: 'token' must be rejected");
    assert.ok(!isValidCustomParam("search"), "denylist: 'search' must be rejected");
  });

  // Affiliate-guard checks
  test("rejects AFFILIATE_PARAM_GUARD entries (e.g. 'tag', 'campid')", () => {
    assert.ok(!isValidCustomParam("tag"), "affiliate-guard: 'tag' must be rejected (product promise)");
    assert.ok(!isValidCustomParam("campid"), "affiliate-guard: 'campid' must be rejected");
    assert.ok(!isValidCustomParam("clickid"), "affiliate-guard: 'clickid' must be rejected");
  });

  test("denylist check is case-insensitive", () => {
    assert.ok(!isValidCustomParam("Q"), "denylist check must be case-insensitive");
    assert.ok(!isValidCustomParam("Token"), "denylist check must be case-insensitive");
    assert.ok(!isValidCustomParam("TAG"), "affiliate-guard check must be case-insensitive");
  });
});

// ── T3: validation.js source guards ──────────────────────────────────────────

describe("T3 validation.js source — exports and canonical imports", () => {
  test("exports isValidCustomParam as a named export", () => {
    assert.ok(
      VALIDATION_SOURCE.includes("export function isValidCustomParam("),
      "isValidCustomParam must be a named export in validation.js"
    );
  });

  test("imports MAX_PARAM_LEN from remote-rules.js", () => {
    assert.ok(
      VALIDATION_SOURCE.includes("MAX_PARAM_LEN"),
      "validation.js must reference MAX_PARAM_LEN"
    );
    assert.ok(
      VALIDATION_SOURCE.includes("remote-rules.js"),
      "validation.js must import from remote-rules.js"
    );
  });

  test("imports PARAM_FORMAT_RE from remote-rules.js", () => {
    assert.ok(
      VALIDATION_SOURCE.includes("PARAM_FORMAT_RE"),
      "validation.js must reference PARAM_FORMAT_RE"
    );
  });

  test("imports REMOTE_PARAM_DENYLIST from remote-rules.js", () => {
    assert.ok(
      VALIDATION_SOURCE.includes("REMOTE_PARAM_DENYLIST"),
      "validation.js must import REMOTE_PARAM_DENYLIST for denylist guard"
    );
  });

  test("imports AFFILIATE_PARAM_GUARD from remote-rules.js", () => {
    assert.ok(
      VALIDATION_SOURCE.includes("AFFILIATE_PARAM_GUARD"),
      "validation.js must import AFFILIATE_PARAM_GUARD for affiliate-guard"
    );
  });

  test("does not contain inline length limit (no magic 499 or 500 for custom param)", () => {
    // The old inline isValidParam had `e.length < 500` — that must be gone
    // (the only length check should delegate to MAX_PARAM_LEN)
    assert.ok(
      !VALIDATION_SOURCE.includes("length < 500"),
      "validation.js must not use a hardcoded 500 length limit for custom params"
    );
  });
});

// ── T4: options.js source guards ─────────────────────────────────────────────

describe("T4 options.js — uses isValidCustomParam, no inline validator", () => {
  test("imports isValidCustomParam from validation.js", () => {
    assert.ok(
      OPTIONS_SOURCE.includes("isValidCustomParam"),
      "options.js must reference isValidCustomParam"
    );
  });

  test("no inline isValidParam definition remains", () => {
    assert.ok(
      !OPTIONS_SOURCE.includes("const isValidParam ="),
      "options.js must not contain the old inline isValidParam definition"
    );
  });

  test("import path uses isValidCustomParam (not old inline validator)", () => {
    // The import block should call isValidCustomParam, not the old inline one
    assert.ok(
      OPTIONS_SOURCE.includes("isValidCustomParam"),
      "import path must call isValidCustomParam"
    );
  });

  test("import path filters invalid customParams (not whole-abort)", () => {
    // The new behavior: filter invalid entries, count rejections, import the rest.
    // Guard: the import path must NOT throw when only some customParams are invalid.
    // We verify the source uses .filter() on customParams (not .every() for abort).
    // Note: blacklist/whitelist still use the structural .every(isValidListEntry) check.
    assert.ok(
      OPTIONS_SOURCE.includes("filter(isValidCustomParam)") ||
      OPTIONS_SOURCE.includes("filter(p => isValidCustomParam(p)"),
      "import path must filter customParams (not abort-on-any-invalid)"
    );
  });

  test("import path reports rejected customParam count to user", () => {
    // Guard that the skipped-count variable exists in the import handler
    assert.ok(
      OPTIONS_SOURCE.includes("skipped") || OPTIONS_SOURCE.includes("rejected"),
      "import path must track and report the count of rejected customParams"
    );
  });
});

// ── T5: i18n — partial import toast key ──────────────────────────────────────

describe("T5 i18n.js — import_params_skipped key exists", () => {
  test("TRANSLATIONS contains import_params_skipped key", () => {
    assert.ok(
      I18N_SOURCE.includes("import_params_skipped"),
      "i18n.js must contain an import_params_skipped key for the partial-import toast"
    );
  });

  test("import_params_skipped has at minimum an English translation", () => {
    // Check that the key has an 'en' entry with {n} placeholder
    const match = I18N_SOURCE.match(/import_params_skipped[^}]+en:\s*"([^"]+)"/);
    assert.ok(
      match,
      "import_params_skipped must have an English translation"
    );
    assert.ok(
      match[1].includes("{n}"),
      'import_params_skipped English translation must contain "{n}" placeholder for count'
    );
  });
});
