/**
 * tools/generate-dnr-rules.mjs
 *
 * Reads TRACKING_PARAMS from src/lib/affiliates.js and writes the DNR rule
 * structure to src/rules/tracking-params.json.
 *
 * Usage:
 *   node tools/generate-dnr-rules.mjs
 *   npm run build:rules
 */

import { readFileSync, writeFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));

const { TRACKING_PARAMS } = await import("../src/lib/affiliates.js");

// Params that appear in domain-rules.json preserveParams are functional on
// some domains and must NOT be stripped globally via DNR.  The content script
// handles them with domain-specific logic instead.
const domainRulesPath = resolve(__dirname, "../src/rules/domain-rules.json");
const domainRules = JSON.parse(readFileSync(domainRulesPath, "utf8"));
const preservedByDomain = new Set();
for (const rule of domainRules) {
  if (rule.preserveParams) {
    for (const p of rule.preserveParams) preservedByDomain.add(p);
  }
}

const filtered = TRACKING_PARAMS.filter((p) => !preservedByDomain.has(p));
const excluded = TRACKING_PARAMS.length - filtered.length;

const dnrRule = [
  {
    id: 1,
    priority: 1,
    action: {
      type: "redirect",
      redirect: {
        transform: {
          queryTransform: {
            removeParams: filtered,
          },
        },
      },
    },
    condition: {
      urlFilter: "*",
      resourceTypes: ["main_frame"],
    },
  },
];

const outputPath = resolve(__dirname, "../src/rules/tracking-params.json");
writeFileSync(outputPath, JSON.stringify(dnrRule, null, 2) + "\n", "utf8");

console.log(
  `Generated tracking-params.json with ${filtered.length} params (${excluded} excluded — handled by domain-rules)`
);
