/**
 * Regression test: manifest description consistency
 *
 * Asserts:
 *   1. Both manifest.json (MV3) and manifest.v2.json (MV2) end with identical
 *      wording — "Open source." — so description drift cannot recur silently.
 *   2. Neither manifest description contains platform-specific manifest version
 *      labels ("MV3", "MV2") that belong only in one but not the other (guards
 *      against re-introducing the "Open source, MV3." vs "Open source." split).
 *   3. The Chrome Web Store description in store-listing.md does not claim
 *      Firefox uses MV3 (the inaccurate "Works on Chrome and Firefox" claim
 *      that implied a single MV3 build).
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..", "..");

const mv3 = JSON.parse(readFileSync(join(ROOT, "src", "manifest.json"), "utf8"));
const mv2 = JSON.parse(readFileSync(join(ROOT, "src", "manifest.v2.json"), "utf8"));
const storeListing = readFileSync(join(ROOT, "docs", "store-listing.md"), "utf8");

describe("manifest description consistency", () => {
  it("both manifests end with the same closing phrase", () => {
    // Extract the terminal phrase after the last '. ' boundary
    const tail = (desc) => desc.trim().split(". ").at(-1).replace(/\.$/, "").trim();

    const mv3Tail = tail(mv3.description);
    const mv2Tail = tail(mv2.description);

    assert.equal(
      mv3Tail,
      mv2Tail,
      `Manifest descriptions diverge at the closing phrase:\n` +
      `  MV3 (manifest.json):    "...${mv3Tail}."\n` +
      `  MV2 (manifest.v2.json): "...${mv2Tail}."\n` +
      "Both manifests must end with identical wording (e.g. 'Open source.')."
    );
  });

  it("manifest.json (MV3) description does not contain 'MV2'", () => {
    assert.ok(
      !mv3.description.includes("MV2"),
      `manifest.json description should not reference MV2: "${mv3.description}"`
    );
  });

  it("manifest.v2.json (MV2) description does not contain 'MV3'", () => {
    assert.ok(
      !mv2.description.includes("MV3"),
      `manifest.v2.json description should not reference MV3: "${mv2.description}"`
    );
  });

  it("Chrome Web Store listing does not claim Firefox uses MV3", () => {
    // Extract Chrome Web Store detailed description section only
    const cwsSectionMatch = storeListing.match(
      /## Chrome Web Store[\s\S]*?(?=## Firefox Add-ons|$)/
    );
    assert.ok(cwsSectionMatch, "Could not locate Chrome Web Store section in store-listing.md");

    const cwsSection = cwsSectionMatch[0];

    // Must not contain a phrase like "Manifest V3. Works on Chrome and Firefox"
    // which implies Firefox uses MV3. The correct form separates the claims:
    // "Manifest V3 on Chrome. Available for Firefox via Manifest V2."
    // Pattern: "Manifest V3" followed by "Works on" and "Firefox" on the same line.
    const hasImpliedMV3ForFirefox = /Manifest V3[^.\n]*Works on[^.\n]*Firefox/i.test(cwsSection);
    assert.ok(
      !hasImpliedMV3ForFirefox,
      "Chrome Web Store description uses 'Built natively for Manifest V3. Works on Chrome and Firefox' " +
      "which implies Firefox uses MV3 — it uses MV2. " +
      "Separate the claims, e.g. 'Manifest V3 on Chrome. Available for Firefox via Manifest V2.'"
    );
  });
});
