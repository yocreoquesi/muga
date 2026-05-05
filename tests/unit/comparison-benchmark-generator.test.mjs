/**
 * MUGA — Comparison.html benchmark section generator (#461).
 *
 * The generator at tools/generate-comparison-benchmark.mjs reads
 * the latest benchmark JSON report and replaces the bytes between
 * <!-- BENCHMARK_START --> and <!-- BENCHMARK_END --> markers in
 * docs/comparison.html. Tests pin three things:
 *
 *   1. The marker contract is intact — comparison.html ALWAYS has
 *      both markers (even when no benchmark has been run).
 *   2. The renderer is pure: same report → same HTML output, with
 *      no environmental dependencies.
 *   3. The injector is surgical: bytes outside the markers are
 *      preserved exactly. (A regex-y replace on the whole file
 *      could clobber the hand-written feature matrix; this test
 *      is the regression guard.)
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "../..");
const COMPARISON_PATH = join(REPO_ROOT, "docs", "comparison.html");

const {
  renderBenchmarkSection,
  injectBenchmarkSection,
} = await import("../../tools/generate-comparison-benchmark.mjs");

describe("comparison.html marker contract (#461)", () => {
  test("docs/comparison.html contains both BENCHMARK markers", () => {
    const html = readFileSync(COMPARISON_PATH, "utf8");
    assert.ok(html.includes("<!-- BENCHMARK_START"), "comparison.html must carry the start marker");
    assert.ok(html.includes("<!-- BENCHMARK_END -->"), "comparison.html must carry the end marker");
  });

  test("BENCHMARK_START appears exactly once", () => {
    const html = readFileSync(COMPARISON_PATH, "utf8");
    const matches = html.match(/<!-- BENCHMARK_START/g) || [];
    assert.equal(matches.length, 1, "exactly one BENCHMARK_START marker must exist");
  });

  test("BENCHMARK_END appears exactly once", () => {
    const html = readFileSync(COMPARISON_PATH, "utf8");
    const matches = html.match(/<!-- BENCHMARK_END -->/g) || [];
    assert.equal(matches.length, 1, "exactly one BENCHMARK_END marker must exist");
  });

  test("markers appear in order (start before end)", () => {
    const html = readFileSync(COMPARISON_PATH, "utf8");
    const startIdx = html.indexOf("<!-- BENCHMARK_START");
    const endIdx = html.indexOf("<!-- BENCHMARK_END -->");
    assert.ok(startIdx < endIdx, "BENCHMARK_START must appear before BENCHMARK_END");
  });
});

describe("renderBenchmarkSection — purity + structure", () => {
  const sampleReport = {
    generatedAt: "2026-05-05T12:00:00.000Z",
    runner: "muga",
    totalEntries: 100,
    matched: 100,
    mismatched: 0,
    matchRate: 100,
    byCategory: {
      "utm": { total: 30, matched: 30, mismatched: 0, matchRate: 100 },
      "amazon-affiliate-preserve": { total: 10, matched: 10, mismatched: 0, matchRate: 100 },
    },
    mismatches: [],
    byCompetitor: {
      adguard:   { total: 100, withExpectedClean: 80, changedFromInput: 50, matchedExpectedClean: 40, matchRate: 50 },
      clearurls: { total: 100, withExpectedClean: 80, changedFromInput: 45, matchedExpectedClean: 35, matchRate: 43.75 },
      firefox:   { total: 100, withExpectedClean: 80, changedFromInput: 15, matchedExpectedClean: 12, matchRate: 15 },
    },
  };

  test("output starts with the BENCHMARK_START marker and ends with BENCHMARK_END", () => {
    const out = renderBenchmarkSection(sampleReport);
    assert.match(out, /^<!-- BENCHMARK_START/);
    assert.ok(out.endsWith("<!-- BENCHMARK_END -->"));
  });

  test("MUGA appears as the first row of the summary table", () => {
    const out = renderBenchmarkSection(sampleReport);
    const tableStart = out.indexOf("<tbody>");
    const mugaIdx = out.indexOf("MUGA", tableStart);
    const adguardIdx = out.indexOf("adguard", tableStart);
    assert.ok(mugaIdx !== -1 && adguardIdx !== -1);
    assert.ok(mugaIdx < adguardIdx, "MUGA must render before any competitor row");
  });

  test("competitors are sorted by match rate descending", () => {
    const out = renderBenchmarkSection(sampleReport);
    const adguardIdx = out.indexOf("<code>adguard</code>");
    const clearurlsIdx = out.indexOf("<code>clearurls</code>");
    const firefoxIdx = out.indexOf("<code>firefox</code>");
    assert.ok(adguardIdx > 0);
    assert.ok(clearurlsIdx > adguardIdx, "clearurls (43.75%) should render after adguard (50%)");
    assert.ok(firefoxIdx > clearurlsIdx, "firefox (15%) should render after clearurls (43.75%)");
  });

  test("category breakdown lists every byCategory key", () => {
    const out = renderBenchmarkSection(sampleReport);
    for (const cat of Object.keys(sampleReport.byCategory)) {
      assert.ok(out.includes(cat), `byCategory key "${cat}" must appear in output`);
    }
  });

  test("renderer is pure — same input produces identical output", () => {
    const a = renderBenchmarkSection(sampleReport);
    const b = renderBenchmarkSection(sampleReport);
    assert.equal(a, b);
  });

  test("renderer escapes user-controlled strings to avoid HTML injection", () => {
    const adversarial = {
      ...sampleReport,
      byCategory: { "<script>alert(1)</script>": { total: 1, matched: 0, mismatched: 1, matchRate: 0 } },
      mismatches: [{ url: '<img src=x onerror=alert(1)>', expected: 'a"b', actual: '&amp;' }],
    };
    const out = renderBenchmarkSection(adversarial);
    assert.ok(!out.includes("<script>alert(1)</script>"),
      "raw <script> must not survive into the output");
    assert.ok(!out.includes("<img src=x onerror"),
      "raw event-handler injection must not survive");
    assert.ok(out.includes("&lt;script&gt;"),
      "the script tag must be HTML-escaped");
  });

  test("includes the corpus link to the github repo", () => {
    const out = renderBenchmarkSection(sampleReport);
    assert.match(out, /github\.com\/yocreoquesi\/muga\/tree\/main\/tests\/benchmark\/corpus/);
  });
});

describe("injectBenchmarkSection — surgical replacement", () => {
  const before = "<html>\n<body>\n<h1>hello</h1>\n";
  const after = "\n<footer>existing footer</footer>\n</body>\n</html>";

  test("replaces only the bytes between markers", () => {
    const original = `${before}<!-- BENCHMARK_START\n     placeholder -->\n  <p>old</p>\n<!-- BENCHMARK_END -->${after}`;
    const generated = `<!-- BENCHMARK_START — new -->\n  <h2>NEW</h2>\n<!-- BENCHMARK_END -->`;
    const result = injectBenchmarkSection(original, generated);
    assert.ok(result.startsWith(before), "bytes before markers must be untouched");
    assert.ok(result.endsWith(after), "bytes after markers must be untouched");
    assert.ok(result.includes("<h2>NEW</h2>"), "new content must appear");
    assert.ok(!result.includes("<p>old</p>"), "old content must be replaced");
  });

  test("throws if BENCHMARK_START is missing", () => {
    assert.throws(() => injectBenchmarkSection("no markers here", "<!-- BENCHMARK_START x -->\n<!-- BENCHMARK_END -->"));
  });

  test("throws if BENCHMARK_END is missing", () => {
    assert.throws(() => injectBenchmarkSection("<!-- BENCHMARK_START a -->\nno end", "<!-- BENCHMARK_START x -->\n<!-- BENCHMARK_END -->"));
  });

  test("idempotent: injecting the same generated content twice yields the same source", () => {
    const original = `${before}<!-- BENCHMARK_START a -->\nold content\n<!-- BENCHMARK_END -->${after}`;
    const generated = `<!-- BENCHMARK_START — fresh -->\n  <h2>FRESH</h2>\n<!-- BENCHMARK_END -->`;
    const once = injectBenchmarkSection(original, generated);
    const twice = injectBenchmarkSection(once, generated);
    assert.equal(once, twice);
  });
});
