/**
 * MUGA — bounce-state WRAPPERS parity guard (#725, spin-off from #709 item 6)
 *
 * `src/content/bounce-state-cleaner.js` carries an inline `WRAPPERS` table that
 * must mirror `src/lib/wrapper-engine.js` minus the AFFILIATE_REDIRECT_NETWORKS
 * pass-through bucket (those hosts must NOT have their storage wiped — the
 * network needs landing state to attribute the click).
 *
 * #703 added a test for the INVERSE (no pass-through host leaks into the inline
 * table — bounce-state-affiliate-redirect.test.mjs). Parity in the other
 * direction (every non-pass-through wrapper IS mirrored) was still unenforced:
 * a new wrapper added to wrapper-engine.js without mirroring it here would
 * silently lose storage cleanup on that host.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";

import { WRAPPERS } from "../../src/lib/wrapper-engine.js";
import { isAffiliateRedirectNetwork } from "../../src/lib/opaque-networks.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const BOUNCE_SRC = readFileSync(
  join(__dirname, "../../src/content/bounce-state-cleaner.js"),
  "utf8",
);

// Isolate the inline `const WRAPPERS = [ ... ];` block so host-literal matches
// don't pick up the unrelated INLINE_AFFILIATE_REDIRECT_NETWORKS list.
const wStart = BOUNCE_SRC.indexOf("const WRAPPERS = [");
const wEnd = BOUNCE_SRC.indexOf("];", wStart);
const INLINE_WRAPPERS_SRC = BOUNCE_SRC.slice(wStart, wEnd);

test("inline WRAPPERS block is found in bounce-state-cleaner.js", () => {
  assert.ok(wStart !== -1 && wEnd > wStart, "could not locate the inline const WRAPPERS = [ ... ] table");
});

test("every non-pass-through wrapper host is mirrored in bounce-state inline WRAPPERS (#725)", () => {
  const missing = [];
  for (const wrapper of WRAPPERS) {
    for (const pattern of wrapper.hostPatterns) {
      // Regex host patterns (`^...$`) are the wildcard affiliate-redirect
      // networks (e.g. *.pxf.io) — pass-through by design, never cleaned.
      if (typeof pattern !== "string") continue;
      // Pass-through bucket: must NOT be wiped, so it is correctly absent.
      if (isAffiliateRedirectNetwork(pattern)) continue;
      if (!INLINE_WRAPPERS_SRC.includes(`"${pattern}"`)) {
        missing.push(`${pattern}  (wrapper id: ${wrapper.id})`);
      }
    }
  }
  assert.deepEqual(
    missing,
    [],
    "bounce-state-cleaner.js inline WRAPPERS is missing host(s) present in " +
      "wrapper-engine.js — storage cleanup would silently skip them:\n  " +
      missing.join("\n  "),
  );
});
