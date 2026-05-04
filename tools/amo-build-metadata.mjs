#!/usr/bin/env node
// Builds amo-metadata.json release_notes from CHANGELOG content piped on stdin.
// Truncates to stay under AMO's 3000-char hard cap with a link back to the
// GitHub Release for the full notes.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

export const AMO_RELEASE_NOTES_HARD_LIMIT = 3000;
const SAFE_BUDGET = 2900;

export function truncateForAmo(rawNotes, version, max = SAFE_BUDGET) {
  const suffix = `\n\n…full release notes: https://github.com/yocreoquesi/muga/releases/tag/v${version}`;
  const trimmed = rawNotes.replace(/\s+$/, "");
  if (trimmed.length <= max) return trimmed;

  const budget = max - suffix.length;
  let cut = trimmed.lastIndexOf("\n", budget);
  if (cut < budget * 0.5) cut = budget;
  return trimmed.slice(0, cut).replace(/\s+$/, "") + suffix;
}

function isMain() {
  const entry = process.argv[1] ? path.resolve(process.argv[1]) : "";
  return entry === fileURLToPath(import.meta.url);
}

if (isMain()) {
  const version = process.argv[2];
  if (!version) {
    console.error("Usage: node tools/amo-build-metadata.mjs <version>  (CHANGELOG slice on stdin)");
    process.exit(1);
  }
  const raw = fs.readFileSync(0, "utf8");
  const notes = truncateForAmo(raw, version);
  if (notes.length > AMO_RELEASE_NOTES_HARD_LIMIT) {
    console.error(
      `FATAL: release_notes still exceeds ${AMO_RELEASE_NOTES_HARD_LIMIT} chars after truncation: ${notes.length}`,
    );
    process.exit(1);
  }
  const metaPath = path.join(ROOT, "amo-metadata.json");
  const meta = JSON.parse(fs.readFileSync(metaPath, "utf8"));
  meta.version.release_notes = { "en-US": notes };
  fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2) + "\n");
  console.log(
    `amo-metadata.json updated with release notes for v${version} (${notes.length}/${AMO_RELEASE_NOTES_HARD_LIMIT} chars)`,
  );
}
