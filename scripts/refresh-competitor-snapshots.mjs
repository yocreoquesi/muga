#!/usr/bin/env node
/**
 * MUGA: refresh-competitor-snapshots — A6 phase 2 (#506).
 *
 * Downloads upstream competitor rule sets and writes vendored
 * snapshots under tests/benchmark/competitors/data/. Each snapshot is
 * committed to the repo so the benchmark stays reproducible offline
 * (CI does not fetch the network for benchmark runs).
 *
 * Run via: `npm run benchmark:refresh-competitors`
 *
 * Output: prints source URL, byte size, and SHA-256 hash of each
 * downloaded snapshot. Reviewers can compare hashes against a known
 * upstream commit when auditing the diff.
 *
 * Adding a new competitor:
 *   1. Append an entry to SNAPSHOTS below (name, url, file).
 *   2. Run this script. The new file lands under data/.
 *   3. Add a docblock entry under "Snapshots" in
 *      tests/benchmark/competitors/README-CONTRACT.txt.
 *   4. Commit the data file alongside the new adapter.
 */

import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..");
const DATA_DIR = join(REPO_ROOT, "tests", "benchmark", "competitors", "data");

const SNAPSHOTS = [
  {
    name: "ClearURLs",
    url: "https://rules2.clearurls.xyz/data.minify.json",
    file: "clearurls.json",
  },
  {
    name: "AdGuard",
    url: "https://filters.adtidy.org/extension/chromium/filters/17.txt",
    file: "adguard.txt",
  },
  {
    name: "Firefox",
    url: "https://firefox.settings.services.mozilla.com/v1/buckets/main/collections/query-stripping/records",
    file: "firefox.json",
  },
  // Future: Brave Shields — its own entry once the matching adapter ships.
];

async function fetchBytes(url) {
  const res = await fetch(url, { headers: { "User-Agent": "muga-benchmark-refresh" } });
  if (!res.ok) {
    throw new Error(`fetch failed: ${url} -> HTTP ${res.status}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  return buf;
}

function sha256(buf) {
  return createHash("sha256").update(buf).digest("hex");
}

async function main() {
  if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true });
  }

  const summary = [];
  for (const s of SNAPSHOTS) {
    process.stdout.write(`refresh-competitor-snapshots: fetching ${s.name} from ${s.url}\n`);
    const buf = await fetchBytes(s.url);
    const dest = join(DATA_DIR, s.file);
    writeFileSync(dest, buf);
    summary.push({
      name: s.name,
      url: s.url,
      file: s.file,
      bytes: buf.length,
      sha256: sha256(buf),
    });
  }

  process.stdout.write("\nSnapshot summary:\n");
  for (const s of summary) {
    process.stdout.write(
      `  ${s.name.padEnd(12)}  ${String(s.bytes).padStart(8)} bytes  sha256=${s.sha256}  -> data/${s.file}\n`,
    );
  }
  process.stdout.write(
    "\nUpdate tests/benchmark/competitors/README-CONTRACT.txt's Snapshots section " +
      "with the date + hashes above before committing.\n",
  );
}

main().catch((err) => {
  process.stderr.write(`refresh-competitor-snapshots failed: ${err.message}\n`);
  process.exit(1);
});
