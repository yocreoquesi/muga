/**
 * MUGA: Web-cleaner-tool dependency-direction gate (#1029, Phase 2,
 * design ADR-3).
 *
 * Enforces the one-way boundary between the extension core (src/) and
 * the standalone web tool (web/, mirrored to landing/clean/):
 *
 *   - web/ (and landing/clean/) MUST NOT import/require/reference src/.
 *   - src/ MUST NOT import/require/reference web/ or landing/clean/.
 *
 * Walks web/**\/*.{js,mjs,html} and landing/clean/**\/*.{js,mjs,html} for
 * specifiers resolving into src/, and src/**\/*.{js,mjs} for specifiers
 * resolving into web/ or landing/clean/.
 *
 * Allowlist: the generated engine copies (web/engine/cleaner-bundle.js,
 * web/engine/domain-rules.json, and their landing/clean/ mirrors) are
 * exempt from the web-> src scan. They are byte copies with zero import
 * statements — the sanctioned boundary artifact itself, not a
 * source-level dependency (see ADR-1/ADR-3).
 *
 * Run with: node tools/check-web-boundary.mjs (npm run check:web-boundary)
 */
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, extname, join, relative } from "node:path";

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, "..");

const ALLOWLIST = new Set([
  "web/engine/cleaner-bundle.js",
  "web/engine/domain-rules.json",
  "landing/clean/engine/cleaner-bundle.js",
  "landing/clean/engine/domain-rules.json",
]);

const SCAN_EXTENSIONS = new Set([".js", ".mjs", ".html"]);

function walk(dir) {
  let out = [];
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out; // directory doesn't exist yet (e.g. landing/clean/ pre-build:web) — nothing to scan
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out = out.concat(walk(full));
    } else if (SCAN_EXTENSIONS.has(extname(entry.name))) {
      out.push(full);
    }
  }
  return out;
}

/**
 * Scans file text for import/require/`src=` specifiers matching a
 * forbidden path segment.
 *
 * @param {string} text File contents.
 * @param {RegExp} forbiddenSegment Pattern matching the forbidden path segment.
 * @returns {string[]} Matched specifier strings (may contain duplicates).
 */
export function findForbiddenReferences(text, forbiddenSegment) {
  const specifiers = [];
  const importRe = /(?:from\s+|require\(|import\()\s*["']([^"']+)["']/g;
  const scriptSrcRe = /\bsrc\s*=\s*["']([^"']+)["']/g;
  for (const re of [importRe, scriptSrcRe]) {
    let match;
    while ((match = re.exec(text)) !== null) {
      if (forbiddenSegment.test(match[1])) specifiers.push(match[1]);
    }
  }
  return specifiers;
}

function checkDirection(rootDirs, forbiddenSegment, forbiddenLabel) {
  const violations = [];
  for (const rootDir of rootDirs) {
    for (const file of walk(join(ROOT, rootDir))) {
      const rel = relative(ROOT, file).split("\\").join("/");
      if (ALLOWLIST.has(rel)) continue;
      const text = readFileSync(file, "utf8");
      const found = findForbiddenReferences(text, forbiddenSegment);
      if (found.length > 0) {
        violations.push(`${rel}: references ${forbiddenLabel} (${found.join(", ")})`);
      }
    }
  }
  return violations;
}

/**
 * Runs the full one-way boundary check.
 * @returns {string[]} Violation descriptions (empty when the boundary holds).
 */
export function checkWebBoundary() {
  return [
    ...checkDirection(["web", "landing/clean"], /(^|\/)src\//, "src/"),
    ...checkDirection(["src"], /(^|\/)(web|landing\/clean)\//, "web/ or landing/clean/"),
  ];
}

function main() {
  const violations = checkWebBoundary();
  if (violations.length > 0) {
    console.error("Dependency-direction violation(s):\n");
    console.error(violations.map((v) => `  - ${v}`).join("\n"));
    process.exit(1);
  }
  console.log("Boundary gate OK: no web/src cross-references found.");
}

if (process.argv[1]?.endsWith("check-web-boundary.mjs")) {
  main();
}
