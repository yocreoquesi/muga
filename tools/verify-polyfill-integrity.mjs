/**
 * MUGA — tools/verify-polyfill-integrity.mjs
 *
 * Verifies that the SHA-256 hash of src/lib/browser-polyfill.min.js matches
 * the expected value documented in src/manifest.json and src/manifest.v2.json.
 *
 * Usage: node tools/verify-polyfill-integrity.mjs
 * Exit code 0 = OK, exit code 1 = mismatch or file not found.
 *
 * Resolves #97.
 */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

// Expected SHA-256 hash of browser-polyfill.min.js (hex)
// Update this constant whenever the polyfill is upgraded.
// sha256: a2093810df8e00393ee4d3adc243ea82d7e56471b40f0f66b64f8980da944094
const EXPECTED_HASH = "a2093810df8e00393ee4d3adc243ea82d7e56471b40f0f66b64f8980da944094";

const polyfillPath = join(root, "src", "lib", "browser-polyfill.min.js");

let content;
try {
  content = readFileSync(polyfillPath);
} catch (err) {
  console.error(`ERROR: Could not read polyfill file: ${polyfillPath}`);
  console.error(err.message);
  process.exit(1);
}

const actual = createHash("sha256").update(content).digest("hex");

if (actual !== EXPECTED_HASH) {
  console.error("INTEGRITY CHECK FAILED for browser-polyfill.min.js");
  console.error(`  Expected: ${EXPECTED_HASH}`);
  console.error(`  Actual:   ${actual}`);
  console.error(
    "If the polyfill was intentionally upgraded, update EXPECTED_HASH in tools/verify-polyfill-integrity.mjs."
  );
  process.exit(1);
}

console.log(`OK: browser-polyfill.min.js integrity verified (sha256: ${actual})`);
