#!/usr/bin/env node
/**
 * MUGA — sign-rules.mjs
 *
 * CLI tool to sign tools/rules-source/params.json and emit
 * docs/rules/v1/params.json with an Ed25519 signature.
 *
 * Usage:
 *   MUGA_SIGNING_KEY_PATH=/path/to/key.pem node tools/sign-rules.mjs
 *
 * Environment variables:
 *   MUGA_SIGNING_KEY_PATH  (required) Path to the Ed25519 private key PEM file.
 *                          Do NOT pass key material via CLI args — shell history leakage.
 *   MUGA_SOURCE_FILE       (optional) Override source file path (for testing).
 *   MUGA_OUTPUT_FILE       (optional) Override output file path (for testing).
 *
 * Exit codes:
 *   0 — success
 *   1 — validation error in source (schema, format, denylist, malformed JSON)
 *   2 — signing setup error (missing MUGA_SIGNING_KEY_PATH, unreadable key, bad PEM)
 *   3 — I/O error (cannot read source file, cannot write output file)
 *
 * Security rules:
 *   - Private key path is ONLY accepted via MUGA_SIGNING_KEY_PATH env var.
 *   - Key material never logged, never on stdout.
 *   - No npm dependencies — uses node:crypto and node:fs only.
 */

import { sign as cryptoSign, createPrivateKey, createHash } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

// #708: the denylist + affiliate guard live in src/lib/remote-rules.js as the
// authoritative source. Importing here avoids the drift surface that the
// previous inline copies created. The file is browser-targeted ESM but its
// constant exports are pure data — no chrome/window references — so Node
// imports cleanly. Sibling tools/validate-rules-source.mjs already does this.
import {
  REMOTE_PARAM_DENYLIST,
  AFFILIATE_PARAM_GUARD,
  MIN_PARAM_LEN,
  canonicalScopedMessage,
} from "../src/lib/remote-rules.js";

// #1221: the same generated set the runtime guard reads, so signing and the
// extension cannot drift apart on what a host protects.
import { PRESERVED_PARAMS, PRESERVED_BY_HOST } from "../src/rules/preserve-params.data.js";

// The built-ins the extension already ships. Imported for the same
// no-drift reason as the set above: the runtime decides what a published param
// can do by comparing against this exact list.
import { TRACKING_PARAMS } from "../src/lib/affiliates.js";

// ── Path resolution ──────────────────────────────────────────────────────────

const DEFAULT_SOURCE = new URL("../tools/rules-source/params.json", import.meta.url).pathname;
const DEFAULT_OUTPUT = new URL("../docs/rules/v1/params.json", import.meta.url).pathname;

// On Windows, URL.pathname starts with /C:/ — normalize that
function normalizePath(p) {
  if (process.platform === "win32" && p.startsWith("/")) {
    return p.slice(1);
  }
  return p;
}

const SOURCE_FILE = process.env.MUGA_SOURCE_FILE || normalizePath(DEFAULT_SOURCE);
const OUTPUT_FILE = process.env.MUGA_OUTPUT_FILE || normalizePath(DEFAULT_OUTPUT);

const PARAM_FORMAT_RE = /^[a-zA-Z0-9_.\-]+$/;
const MAX_PARAM_LEN = 64;

// ── Validation ───────────────────────────────────────────────────────────────

/**
 * Validates the unsigned source shape.
 * Source must have version (integer), published (string), params (string[]).
 * Source must NOT have a 'sig' field — it is unsigned input.
 *
 * @param {unknown} obj
 * @returns {{ ok: boolean, error?: string }}
 */
function validateSource(obj) {
  if (obj === null || typeof obj !== "object" || Array.isArray(obj)) {
    return { ok: false, error: "Source must be a JSON object" };
  }

  /** @type {Record<string, unknown>} */
  const o = /** @type {Record<string, unknown>} */ (obj);

  if (Object.prototype.hasOwnProperty.call(o, "sig")) {
    return {
      ok: false,
      error: "Source file must NOT contain a 'sig' field — use the unsigned source",
    };
  }

  if (
    !Object.prototype.hasOwnProperty.call(o, "version") ||
    typeof o.version !== "number" ||
    !Number.isInteger(o.version)
  ) {
    return { ok: false, error: "Missing or invalid 'version' field (must be an integer)" };
  }

  if (
    !Object.prototype.hasOwnProperty.call(o, "published") ||
    typeof o.published !== "string"
  ) {
    return { ok: false, error: "Missing or invalid 'published' field (must be an ISO-8601 string)" };
  }

  if (
    !Object.prototype.hasOwnProperty.call(o, "params") ||
    !Array.isArray(o.params) ||
    !/** @type {unknown[]} */ (o.params).every(p => typeof p === "string")
  ) {
    return { ok: false, error: "Missing or invalid 'params' field (must be an array of strings)" };
  }

  // Validate each param
  for (const param of /** @type {string[]} */ (o.params)) {
    if (param.length < 1 || param.length > MAX_PARAM_LEN) {
      return {
        ok: false,
        error: `Param "${param}" violates length constraint [1, ${MAX_PARAM_LEN}]`,
      };
    }
    if (!PARAM_FORMAT_RE.test(param)) {
      return {
        ok: false,
        error: `Param "${param}" contains invalid characters. Allowed: [a-zA-Z0-9_.\\-]`,
      };
    }
    const lower = param.toLowerCase();
    if (REMOTE_PARAM_DENYLIST.has(lower)) {
      return {
        ok: false,
        error: `Param "${param}" is in REMOTE_PARAM_DENYLIST and must not be published`,
      };
    }
    if (AFFILIATE_PARAM_GUARD.has(lower)) {
      return {
        ok: false,
        error: `Param "${param}" is in AFFILIATE_PARAM_GUARD and must not be published`,
      };
    }
    // Checked last, mirroring validateParams step 4b: the denylist and the
    // affiliate guard are full of short names and carry the more specific
    // diagnosis, so they must report first. What survives to here is a short
    // name nobody has classified — and the payload cannot express a host scope,
    // so publishing one applies it to every site (#1217).
    // #1221. Placed BEFORE the length floor: a preserved name carries the more
    // specific diagnosis (a host declared it needs this param), and unlike
    // "too short" it names an actual protection being overridden. The global
    // payload cannot express a host scope, so publishing this name strips it on
    // the very hosts that declared they need it.
    //
    // Asked only of a name the remote channel can actually apply. The runtime
    // runs `filterAgainstBuiltin` BEFORE `filterAgainstPreserved`, so a param
    // the extension already ships is removed from the remote list before the
    // preserve filter ever sees it — publishing it cannot override anybody's
    // preserveParams, because it is never applied from this channel at all.
    // Refusing on one is a false positive, and a load-bearing one: `utm_source`
    // and `utm_medium` are both built-ins that some host declares, so the guard
    // as first written could not sign the committed source, and the publish
    // workflow would have failed on the next push touching it.
    //
    // The guard itself is unchanged for every name this channel does apply,
    // which is where it protects against #1212's failure class.
    if (!BUILTIN_SET.has(lower) && PRESERVED_SET.has(lower)) {
      return {
        ok: false,
        error: `Param "${param}" is declared in some host's preserveParams in src/rules/domain-rules.json and must not be published to the global channel — it would be stripped on the hosts that protect it (#1221). Grep domain-rules.json for it to see which hosts.`,
      };
    }
    if (param.length < MIN_PARAM_LEN) {
      return {
        ok: false,
        error: `Param "${param}" is shorter than ${MIN_PARAM_LEN} characters. Names this short are host-scoped upstream and would apply globally here; put it in src/rules/domain-rules.json instead (#1217)`,
      };
    }
  }

  // -- Scoped facts (#1221 slice 1) -----------------------------------------
  // Optional. Absent means a params-only payload, exactly as before.
  //
  // REFUSES rather than filters, unlike the runtime's `validateScopedFacts`.
  // The asymmetry is the same one the preserveParams guard uses: at the runtime
  // a bad fact must not cost every other host its cleaning, but HERE a bad fact
  // means someone is about to publish a mistake, and publishing it silently
  // minus the bad entry would hide that.
  if (Object.prototype.hasOwnProperty.call(o, "scoped")) {
    if (!Array.isArray(o.scoped)) {
      return { ok: false, error: "'scoped' must be an array of { param, hosts } facts" };
    }
    for (const fact of /** @type {unknown[]} */ (o.scoped)) {
      if (fact === null || typeof fact !== "object" || Array.isArray(fact)) {
        return { ok: false, error: "Each 'scoped' entry must be an object { param, hosts }" };
      }
      const f = /** @type {Record<string, unknown>} */ (fact);
      const param = f.param;
      if (typeof param !== "string" || param.length < 1 || param.length > MAX_PARAM_LEN) {
        return { ok: false, error: "A scoped fact has a missing or over-long 'param'" };
      }
      if (!PARAM_FORMAT_RE.test(param)) {
        return { ok: false, error: `Scoped param "${param}" contains invalid characters` };
      }
      const lower = param.toLowerCase();
      // ABSOLUTE, and the one guard a host scope does not relax: #1212 was an
      // affiliate id applied to the wrong host, and a scoped fact naming an
      // affiliate param is that same catastrophe with a smaller blast radius.
      if (AFFILIATE_PARAM_GUARD.has(lower)) {
        return { ok: false, error: `Scoped param "${param}" is in AFFILIATE_PARAM_GUARD and must not be published at any scope` };
      }
      if (REMOTE_PARAM_DENYLIST.has(lower)) {
        return { ok: false, error: `Scoped param "${param}" is in REMOTE_PARAM_DENYLIST — these names are functional on any host, so a scope does not make them safe` };
      }
      if (!Array.isArray(f.hosts) || f.hosts.length === 0) {
        return { ok: false, error: `Scoped param "${param}" must name at least one host` };
      }
      for (const h of /** @type {unknown[]} */ (f.hosts)) {
        if (typeof h !== "string" || !SCOPED_HOST_RE.test(h.toLowerCase())) {
          return { ok: false, error: `Scoped param "${param}" has an invalid host: ${String(h)}` };
        }
        if (hostPreserves(h.toLowerCase(), lower)) {
          return {
            ok: false,
            error: `Scoped fact "${param}" @ ${h} collides with that host's preserveParams in src/rules/domain-rules.json (#1221)`,
          };
        }
      }
    }
  }

  return { ok: true };
}

/** Same hostname shape the runtime validator accepts. */
const SCOPED_HOST_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;

/**
 * Suffix-walked preserve check, mirroring the runtime's `_hostPreserves`.
 * `domain-rules.json` is matched by hostname suffix, so an entry for
 * `youtube.com` governs `www.youtube.com`; a direct key lookup would let the
 * protection be bypassed by spelling the host with a subdomain.
 *
 * @param {string} host
 * @param {string} param
 * @returns {boolean}
 */
function hostPreserves(host, param) {
  let candidate = host;
  for (;;) {
    const own = PRESERVED_BY_HOST[candidate];
    if (own && own.includes(param)) return true;
    const dot = candidate.indexOf(".");
    if (dot === -1) return false;
    candidate = candidate.slice(dot + 1);
    if (!candidate.includes(".")) return false;
  }
}

/** Lowercased `preserveParams` union — see src/rules/preserve-params.data.js (#1221). */
const PRESERVED_SET = new Set(PRESERVED_PARAMS.map((p) => p.toLowerCase()));

/**
 * Lowercased built-ins the extension already ships.
 *
 * The same set `filterAgainstBuiltin` dedupes the remote list against, which is
 * why a name in here is inert on this channel however it is published.
 */
const BUILTIN_SET = new Set([...TRACKING_PARAMS].map((p) => p.toLowerCase()));

// ── Canonical message ─────────────────────────────────────────────────────────

/**
 * Derives the canonical signed message per REQ-VERIFY-3.
 * Format: `${version}|${published}|${params.join(",")}`
 *
 * @param {number}   version
 * @param {string}   published
 * @param {string[]} params
 * @returns {string}
 */
function canonicalMessage(version, published, params) {
  return `${version}|${published}|${params.join(",")}`;
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  // 1. Load the private key from env var (exit 2 if missing or unreadable)
  const keyPath = process.env.MUGA_SIGNING_KEY_PATH;
  if (!keyPath) {
    console.error("[sign-rules] ERROR: MUGA_SIGNING_KEY_PATH env var is not set.");
    console.error("  Set it to the path of the Ed25519 private key PEM file.");
    process.exit(2);
  }

  let privateKey;
  try {
    const keyPem = readFileSync(keyPath, "utf8");
    privateKey = createPrivateKey({ key: keyPem, format: "pem" });
  } catch (err) {
    console.error(`[sign-rules] ERROR: Cannot read private key from "${keyPath}": ${err.message}`);
    process.exit(2);
  }

  // 2. Read the source file (exit 3 on I/O error)
  let rawSource;
  try {
    rawSource = readFileSync(SOURCE_FILE, "utf8");
  } catch (err) {
    console.error(`[sign-rules] ERROR: Cannot read source file "${SOURCE_FILE}": ${err.message}`);
    process.exit(3);
  }

  // 3. Parse and validate the source (exit 1 on validation error)
  let source;
  try {
    source = JSON.parse(rawSource);
  } catch (err) {
    console.error(`[sign-rules] ERROR: Source file is not valid JSON: ${err.message}`);
    process.exit(1);
  }

  const validation = validateSource(source);
  if (!validation.ok) {
    console.error(`[sign-rules] ERROR: Source validation failed: ${validation.error}`);
    process.exit(1);
  }

  // 4. Sign the canonical message
  const canonical = canonicalMessage(source.version, source.published, source.params);
  const msgBuf = Buffer.from(canonical, "utf8");

  let sigBuf;
  try {
    sigBuf = cryptoSign(null, msgBuf, privateKey);
  } catch (err) {
    console.error(`[sign-rules] ERROR: Signing failed: ${err.message}`);
    process.exit(2);
  }

  // Encode as base64url (URL-safe, no padding) per design §2
  const sigBase64url = sigBuf
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

  // 5. Write the signed output (exit 3 on I/O error)
  const output = {
    version: source.version,
    published: source.published,
    params: source.params,
    sig: sigBase64url,
  };

  // #1221: the scoped section carries its OWN signature. `sig` above is left
  // byte-identical to what it has always been, over the same canonical string,
  // because a payload signed over an EXTENDED canonical was measured to fail
  // verification on every currently deployed version — which would stop them
  // receiving even the global rules they get today. Old versions ignore both
  // new keys (validatePayloadShape does not reject unknown ones) and keep going.
  if (Array.isArray(source.scoped) && source.scoped.length > 0) {
    const scopedCanonical = canonicalScopedMessage(
      source.version, source.published, source.scoped
    );
    let scopedSigBuf;
    try {
      scopedSigBuf = cryptoSign(null, Buffer.from(scopedCanonical, "utf8"), privateKey);
    } catch (err) {
      console.error(`[sign-rules] ERROR: Scoped signing failed: ${err.message}`);
      process.exit(2);
    }
    output.scoped = source.scoped;
    output.scopedSig = scopedSigBuf
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
  }

  try {
    mkdirSync(dirname(OUTPUT_FILE), { recursive: true });
    writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2) + "\n", "utf8");
  } catch (err) {
    console.error(`[sign-rules] ERROR: Cannot write output to "${OUTPUT_FILE}": ${err.message}`);
    process.exit(3);
  }

  // 6. Emit a one-line summary (stdout only, no key material)
  const sha256 = createHash("sha256")
    .update(JSON.stringify(output))
    .digest("hex");

  console.log(JSON.stringify({
    input: SOURCE_FILE,
    output: OUTPUT_FILE,
    version: source.version,
    paramCount: source.params.length,
    sha256,
  }));

  process.exit(0);
}

main().catch(err => {
  console.error("[sign-rules] Unexpected error:", err.message);
  process.exit(3);
});
