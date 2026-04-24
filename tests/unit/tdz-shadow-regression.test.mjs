/**
 * TDZ-shadow regression guard.
 *
 * When an imported function is shadowed by a local `const` of the same name,
 * reading the function on the right-hand side of the declaration triggers a
 * ReferenceError (Temporal Dead Zone): the const is hoisted and marks the
 * name as uninitialized until the assignment completes.
 *
 * A prior PR landed `const isFirefox = isFirefox();` in popup.js and
 * options.js, which broke both surfaces at runtime (unit tests did not catch
 * it because they assert against source strings, not execution). This test
 * guards against the pattern recurring for any imported identifier.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");

// Files most likely to shadow imports and run in a browser context.
const TARGETS = [
  "src/popup/popup.js",
  "src/options/options.js",
  "src/onboarding/onboarding.js",
  "src/background/service-worker.js",
];

function extractNamedImports(source) {
  // Matches: import { a, b as c, d } from "...";
  const names = new Set();
  const importRe = /import\s*\{([^}]+)\}\s*from\s*["'][^"']+["']/g;
  let m;
  while ((m = importRe.exec(source)) !== null) {
    const body = m[1];
    for (const part of body.split(",")) {
      const trimmed = part.trim();
      if (!trimmed) continue;
      const asMatch = trimmed.match(/\bas\s+([A-Za-z_$][\w$]*)$/);
      const localName = asMatch ? asMatch[1] : trimmed.replace(/^\*\s*as\s+/, "");
      names.add(localName);
    }
  }
  return names;
}

for (const relPath of TARGETS) {
  test(`TDZ shadow guard: ${relPath}`, () => {
    const source = readFileSync(resolve(root, relPath), "utf8");
    const imports = extractNamedImports(source);

    for (const name of imports) {
      // Pattern: `const <name> = <name>(` — TDZ ReferenceError on execution.
      const shadowRe = new RegExp(
        `\\b(?:const|let|var)\\s+${name}\\s*=\\s*${name}\\s*\\(`,
        "g"
      );
      const match = source.match(shadowRe);
      assert.equal(
        match,
        null,
        `${relPath} shadows imported '${name}' in a TDZ-triggering pattern: '${match?.[0]}'. ` +
          `Use \`import { ${name} as detect${name.replace(/^./, c => c.toUpperCase())} }\` ` +
          `or rename the local variable.`
      );
    }
  });
}
