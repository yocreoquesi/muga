/** MUGA: Unit tests for the benchmark corpus shape and integrity. */

import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { loadCorpus } from "../benchmark/lib/corpus-loader.mjs";
import { validateCorpusFile, _internals } from "../benchmark/lib/runner-core.mjs";
import { readFileSync, readdirSync } from "node:fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CORPUS_DIR = join(__dirname, "..", "benchmark", "corpus");

test("benchmark corpus — loads at least 100 entries", () => {
  const { entries, files } = loadCorpus(CORPUS_DIR);
  assert.ok(files.length >= 5, `expected at least 5 corpus files, got ${files.length}`);
  assert.ok(entries.length >= 100, `expected at least 100 corpus entries, got ${entries.length}`);
});

test("benchmark corpus — each file passes validateCorpusFile", () => {
  const files = readdirSync(CORPUS_DIR).filter((f) => f.endsWith(".json"));
  for (const filename of files) {
    const raw = readFileSync(join(CORPUS_DIR, filename), "utf8");
    const file = JSON.parse(raw);
    const v = validateCorpusFile(file);
    assert.ok(v.ok, `${filename} validation errors: ${v.errors.join("; ")}`);
  }
});

test("benchmark corpus — every URL is unique across the whole corpus", () => {
  const { entries } = loadCorpus(CORPUS_DIR);
  const seen = new Set();
  const dupes = [];
  for (const e of entries) {
    if (seen.has(e.url)) dupes.push(e.url);
    seen.add(e.url);
  }
  assert.deepEqual(dupes, [], `duplicate URLs in corpus: ${dupes.join(", ")}`);
});

test("benchmark corpus — every category label is in the allowed set", () => {
  const { entries } = loadCorpus(CORPUS_DIR);
  const allowed = _internals.ALLOWED_CATEGORIES;
  for (const e of entries) {
    assert.ok(allowed.has(e.category), `unknown category "${e.category}" on ${e.url}`);
  }
});

test("benchmark corpus — every URL parses as a real URL", () => {
  const { entries } = loadCorpus(CORPUS_DIR);
  for (const e of entries) {
    assert.doesNotThrow(() => new URL(e.url), `unparseable URL: ${e.url}`);
  }
});

test("benchmark corpus — every entry has an expectedAction in the allowed set", () => {
  const { entries } = loadCorpus(CORPUS_DIR);
  const allowed = _internals.ALLOWED_ACTIONS;
  for (const e of entries) {
    assert.ok(allowed.has(e.expectedAction), `unknown expectedAction "${e.expectedAction}" on ${e.url}`);
  }
});
