/**
 * Path-rules fixture for unit tests that exercise path-strip or
 * path-affiliate behavior (Amazon path cleaning, Bookshop creator-referral
 * detection, Bookshop affiliate injection).
 *
 * Import only in test blocks that ASSERT on path-rules behavior.
 * All other processUrl() / unwrapAndExtract() call sites use the defaulted
 * [] params — no import needed there.
 *
 * Usage:
 *   import { pathStripRulesFixture, pathAffiliateRulesFixture }
 *     from "./helpers/path-rules-fixture.mjs";
 *   processUrl(url, prefs, domainRules, cb, tracker, referrer,
 *              pathStripRulesFixture, pathAffiliateRulesFixture);
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const RULES_DIR = join(__dirname, "../../../src/rules");

export const pathStripRulesFixture = JSON.parse(
  readFileSync(join(RULES_DIR, "path-strip-rules.json"), "utf8"),
);

export const pathAffiliateRulesFixture = JSON.parse(
  readFileSync(join(RULES_DIR, "path-affiliate-rules.json"), "utf8"),
);
