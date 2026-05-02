/** MUGA: Benchmark corpus loader — reads JSON files and flattens entries. */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Load all corpus JSON files from a directory and return a flat list of
 * entries with category attached. Each entry: { url, category, expectedAction, expectedClean?, notes? }
 *
 * @param {string} corpusDir absolute path to the corpus directory
 * @returns {{ entries: Array<object>, files: string[] }}
 */
export function loadCorpus(corpusDir) {
  const files = readdirSync(corpusDir).filter((name) => name.endsWith(".json")).sort();
  const entries = [];
  for (const filename of files) {
    const path = join(corpusDir, filename);
    const raw = readFileSync(path, "utf8");
    const file = JSON.parse(raw);
    if (!Array.isArray(file.entries)) continue;
    for (const e of file.entries) {
      entries.push({ ...e, category: file.category });
    }
  }
  return { entries, files };
}
