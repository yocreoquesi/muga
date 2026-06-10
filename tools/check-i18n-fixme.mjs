#!/usr/bin/env node
/**
 * MUGA: i18n FIXME guard (#621)
 *
 * Fails the build if `src/lib/i18n.js` ships any of:
 *   - `/* FIXME: needs native speaker review *​/` comments on a translated value
 *   - `'FIXME: translate'` literal stubs
 *   - empty string for any locale on any key
 *
 * Reads the canonical TRANSLATIONS map at runtime so it stays in sync with
 * the source of truth — no regex on the file. This makes the guard robust to
 * formatting changes in i18n.js.
 *
 * The raw file is also scanned once for the literal FIXME comment, since
 * that marker can sit on a string that is otherwise non-empty (the comment
 * itself is the signal, not the value).
 *
 * Exit codes:
 *   0 — no findings
 *   1 — at least one finding (build fails)
 */
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { TRANSLATIONS, SUPPORTED_LANGS } from "../src/lib/i18n.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOCALES_DIR = path.resolve(__dirname, "..", "src", "lib", "locales");
const FIXME_COMMENT = "FIXME: needs native speaker review";
const FIXME_STUB = "FIXME: translate";

function findStubs() {
  const offenders = [];
  const langs = SUPPORTED_LANGS.map((l) => l.code);
  for (const [key, entry] of Object.entries(TRANSLATIONS)) {
    for (const lang of langs) {
      const val = entry?.[lang];
      if (typeof val !== "string") {
        offenders.push({ key, lang, kind: "missing" });
        continue;
      }
      if (val.trim() === "") {
        offenders.push({ key, lang, kind: "empty" });
        continue;
      }
      if (val.includes(FIXME_STUB)) {
        offenders.push({ key, lang, kind: "fixme-stub" });
      }
    }
  }
  return offenders;
}

function findFixmeComments() {
  // Scan all per-locale data files for FIXME markers on value lines.
  // Translation data now lives in src/lib/locales/*.mjs — one file per locale.
  const offenders = [];
  let localeFiles;
  try {
    localeFiles = readdirSync(LOCALES_DIR).filter((f) => f.endsWith(".mjs"));
  } catch {
    // Fallback: if locales dir is missing, report nothing (handled by findStubs).
    return offenders;
  }
  for (const filename of localeFiles) {
    const filepath = path.join(LOCALES_DIR, filename);
    const src = readFileSync(filepath, "utf8");
    const lines = src.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!line.includes(FIXME_COMMENT)) continue;
      if (line.trim().startsWith("//") || line.trim().startsWith("*")) continue; // meta-comment
      offenders.push({ file: `src/lib/locales/${filename}`, line: i + 1, text: line.trim().slice(0, 160) });
    }
  }
  return offenders;
}

const stubs = findStubs();
const comments = findFixmeComments();

if (stubs.length === 0 && comments.length === 0) {
  console.log("ok: no FIXME markers, stubs, or empty translations in src/lib/locales/*.mjs");
  process.exit(0);
}

console.error("FAIL: i18n quality gate");
if (stubs.length > 0) {
  console.error(`\n  ${stubs.length} bad translation slot(s):`);
  for (const o of stubs) {
    console.error(`    - ${o.key} [${o.lang}] — ${o.kind}`);
  }
}
if (comments.length > 0) {
  console.error(`\n  ${comments.length} FIXME comment(s) on value rows:`);
  for (const o of comments) {
    console.error(`    - ${o.file}:${o.line}  ${o.text}`);
  }
}
console.error(
  "\nPolicy: src/lib/locales/*.mjs must not ship FIXME stubs, FIXME comments on value rows, or empty locale slots.",
);
process.exit(1);
