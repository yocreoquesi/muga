#!/usr/bin/env node
// Builds amo-metadata.json from two sources:
//   - version.release_notes  <- CHANGELOG content piped on stdin, truncated to
//     stay under AMO's 3000-char hard cap with a link back to the GitHub Release.
//   - name / summary / description <- the AMO section of docs/store-listing.md
//     (see tools/amo-listing-metadata.mjs). web-ext spreads this whole object
//     into the PUT /addon/{id}/ body, so the listing copy ships with the
//     release instead of being hand-edited in the dashboard afterwards.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { buildAmoListing } from "./amo-listing-metadata.mjs";

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

  // Listing copy is rebuilt from docs/store-listing.md on every release, so
  // the file is the source of truth and the dashboard is the mirror, not the
  // other way round. buildAmoListing throws on an over-limit name or summary
  // rather than truncating: failing here is cheaper than publishing marketing
  // copy that was silently cut.
  const listing = buildAmoListing();
  Object.assign(meta, listing);

  fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2) + "\n");
  console.log(
    `amo-metadata.json updated with release notes for v${version} (${notes.length}/${AMO_RELEASE_NOTES_HARD_LIMIT} chars)`,
  );
  console.log(
    `  listing: name ${listing.name["en-US"].length} chars, ` +
      `summary ${listing.summary["en-US"].length} chars, ` +
      `description ${listing.description["en-US"].length} chars`,
  );
}
