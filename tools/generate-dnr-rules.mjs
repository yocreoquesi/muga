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

import { writeFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));

const { TRACKING_PARAMS } = await import("../src/lib/affiliates.js");

const rule = [
  {
    id: 1,
    priority: 1,
    action: {
      type: "redirect",
      redirect: {
        transform: {
          queryTransform: {
            removeParams: TRACKING_PARAMS,
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
writeFileSync(outputPath, JSON.stringify(rule, null, 2) + "\n", "utf8");

console.log(`Generated tracking-params.json with ${TRACKING_PARAMS.length} params`);
