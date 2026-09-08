/**
 * MUGA — regression guard: user-facing docs must not reference the
 * decommissioned `unwrap.muga.app` Cloudflare Worker (#886), and must not
 * use present-tense "Privacy Proxy" language for the shortener feature.
 *
 * Scope: every prose document under docs/ and src/privacy/, plus the
 * root-level ones. The list used to be hand-maintained, which is how
 * docs/affiliate-test-harness.md kept a live `unwrap.muga.app` reference
 * for two releases without failing anything (#1254): it was simply never
 * added. Discovering the files removes that failure mode — a new document
 * is covered the moment it is written.
 *
 * Exempt: docs/adr/** and CHANGELOG.md — they legitimately reference the
 * decommissioned Worker as historical record.
 *
 * Run with: npm test
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "../..");

function read(relPath) {
  return readFileSync(join(root, relPath), "utf8");
}

/** Directories walked in full. */
const DOC_ROOTS = ["docs", "src/privacy"];

/** Documents outside those roots that are just as public. */
const EXTRA_DOCS = ["README.md", "CONTRIBUTING.md", "landing/index.html"];

/**
 * ADRs are the historical record of the decommissioning itself, so they are
 * the one place the dead hostname belongs.
 */
const EXEMPT_DIRS = [join("docs", "adr")];

const PROSE_EXTENSIONS = [".md", ".html"];

function collectDocs(relDir) {
  const out = [];
  const absDir = join(root, relDir);
  for (const entry of readdirSync(absDir, { withFileTypes: true })) {
    const relPath = join(relDir, entry.name);
    if (entry.isDirectory()) {
      if (EXEMPT_DIRS.includes(relPath)) continue;
      out.push(...collectDocs(relPath));
    } else if (PROSE_EXTENSIONS.some((ext) => entry.name.endsWith(ext))) {
      out.push(relPath);
    }
  }
  return out;
}

const USER_FACING_DOCS = [
  ...DOC_ROOTS.flatMap((dir) => collectDocs(dir)),
  ...EXTRA_DOCS,
].map((p) => relative(root, join(root, p)).split(sep).join("/"));

describe("the guard covers the documents it claims to", () => {
  test("discovery finds docs/ and src/privacy/ prose, and skips docs/adr", () => {
    assert.ok(
      USER_FACING_DOCS.includes("docs/affiliate-test-harness.md"),
      "discovery must reach docs/affiliate-test-harness.md — the file the hand-maintained list omitted"
    );
    assert.ok(
      USER_FACING_DOCS.includes("src/privacy/privacy.html"),
      "discovery must reach the in-package privacy policy"
    );
    assert.ok(
      !USER_FACING_DOCS.some((p) => p.startsWith("docs/adr/")),
      "docs/adr/** is the historical record and stays exempt"
    );
  });
});

/**
 * Behaviour MUGA removed, and the wording that still described it. Each
 * entry is a claim a reader could act on that is no longer true.
 *
 * `pattern` is matched against the whole document. Keep every pattern
 * narrow enough that the historical framing of the same removal ("the
 * versioned re-acceptance engine was removed") stays legal — the ban is on
 * describing retired behaviour as current, not on naming it.
 */
const RETIRED_CLAIMS = [
  {
    label: "the decommissioned unwrap.muga.app Worker",
    pattern: /unwrap\.muga\.app/,
    why: [
      "This Worker was decommissioned in ADR-0004 (v2.2.0 / 2026-06-01).",
      "Shortener resolution is now native (src/lib/native-shortener-resolver.js).",
      "Update the doc to describe the native model: no MUGA server, no signed envelope.",
    ],
  },
  {
    label: 'present-tense "Privacy Proxy" language',
    pattern: /Privacy Proxy/,
    why: [
      "The shortener feature has no server component; the extension resolves redirects natively.",
      "Remove or rewrite the passage to describe the native model.",
    ],
  },
  {
    label: "a Terms re-acceptance or re-onboarding flow",
    pattern: /re-(?:acceptance|onboarding) flow/i,
    why: [
      "ADR-0007 removed the versioned re-acceptance engine in 3.0.0 (#1203).",
      "Updating the Terms does not re-prompt and does not gate any feature.",
      'Describe the uBlock Origin model instead, or refer to the engine in the past tense ("was removed").',
    ],
  },
  {
    label: 'the retired "denoise extension" identity',
    pattern: /denoise extension/i,
    why: [
      'The product identity is the store name: "MUGA: URL Cleaner. Remove tracking".',
      "See the manifest's own name and description for the canonical wording.",
    ],
  },
];

for (const { label, pattern, why } of RETIRED_CLAIMS) {
  describe(`User-facing docs must not describe ${label}`, () => {
    for (const docPath of USER_FACING_DOCS) {
      test(`${docPath} is free of ${label}`, () => {
        const match = read(docPath).match(pattern);
        assert.strictEqual(
          match,
          null,
          [
            `${docPath} still describes ${label} (matched ${JSON.stringify(match?.[0])}).`,
            ...why,
            "ADR docs (docs/adr/**) and CHANGELOG.md are exempt as historical record.",
          ].join(" ")
        );
      });
    }
  });
}
