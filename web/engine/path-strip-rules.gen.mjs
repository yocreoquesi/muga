/** MUGA: Generated ES module mirror of src/rules/path-strip-rules.json.
 *
 * A plain named-export copy of the path-strip rules used by
 * web/engine/adapter.js, so the web tool can `import { PATH_STRIP_RULES }
 * from "./path-strip-rules.gen.mjs"` instead of a JSON module import with
 * an import attribute, which has limited support in older browsers.
 *
 * DO NOT EDIT BY HAND. Regenerate via `npm run build:web`
 * (tools/build-web.mjs), sourced from src/rules/path-strip-rules.json.
 */
export const PATH_STRIP_RULES = [
  {
    "domain": "amazon",
    "domainPattern": "(?:^|\\.)amazon\\.(?:com|co\\.uk|co\\.jp|com\\.au|com\\.br|com\\.mx|de|es|fr|in|it|nl|pl|se|sg|ca)$",
    "pathPatterns": [
      "\\/[^/]+\\/dp\\/([A-Za-z0-9]{10})",
      "(\\/dp\\/[A-Za-z0-9]{10})\\/.+",
      "(\\/gp\\/product\\/[A-Za-z0-9]{10})\\/.+",
      "/ref=[^/]*$"
    ],
    "replacements": [
      "/dp/$1",
      "$1/",
      "$1/",
      ""
    ],
    "flags": [
      "",
      "",
      "",
      ""
    ],
    "fallbackPathname": "/",
    "note": "Amazon path-strip — all TLDs. Migrated from cleanAmazonPath() in src/lib/cleaner.js:243-251 (issue #625). Pass 4: /ref=[^/]*$ anchored to pathname end — only trailing ref markers stripped, not mid-path /ref= segments (#831). domainPattern enumerates the exact known Amazon TLDs (#1094): the previous `[a-z.]+$` suffix matched any multi-label TLD, so amazon.com.attacker.net and amazon.attacker.net were treated as Amazon and had their paths rewritten. Mirrors the #734 AliExpress lookalike fix (anchor to known real hosts, not an open-ended character class)."
  }
];
