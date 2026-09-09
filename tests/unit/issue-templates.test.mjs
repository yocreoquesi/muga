/**
 * MUGA — every issue template applies the triage entry label (#1269)
 *
 * Run with: npm test
 *
 * AGENTS.md documents five canonical triage labels. None of the four issue
 * templates applied any of them, so every incoming report arrived OUTSIDE the
 * documented state machine and had to be relabelled by hand before that
 * vocabulary meant anything.
 *
 * Both halves were defensible alone, which is why it survived: templates label
 * by KIND, which is what a reporter can meaningfully answer, and the canonical
 * labels describe triage STATE, which only a maintainer can judge. The gap was
 * that nothing said so, and nothing applied the entry state.
 *
 * So the entry label is now applied by the templates, the other four stay
 * maintainer-set, and AGENTS.md says which is which. This test is what stops
 * the two halves drifting apart again.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEMPLATE_DIR = join(__dirname, "../../.github/ISSUE_TEMPLATE");

const ENTRY_LABEL = "needs-triage";

/** Labels only a maintainer can set, so a template must never apply them. */
const MAINTAINER_ONLY = ["needs-info", "ready-for-agent", "ready-for-human", "wontfix"];

/**
 * Every issue form. `config.yml` is the chooser, not a form, so it declares no
 * labels and is excluded.
 */
const templates = readdirSync(TEMPLATE_DIR)
  .filter((f) => f.endsWith(".yml") && f !== "config.yml");

/**
 * Reads the `labels:` value, which appears in both YAML forms across these
 * files: inline (`labels: ["a", "b"]`) and block (`labels:\n  - a\n  - b`).
 * Parsed without a YAML dependency because the shape is this small and fixed.
 */
function labelsOf(raw) {
  // CRLF is normalised first. Without it the block form fails to parse on a
  // Windows checkout while passing in CI, because git hands the same file back
  // with different line endings on each. A platform-dependent test is worse
  // than no test: green everywhere it is measured, red only on a contributor's
  // machine. This repo has hit EOL drift before.
  const text = raw.replace(/\r\n/g, "\n");
  const inline = text.match(/^labels:\s*\[(.*)\]\s*$/m);
  if (inline) {
    return inline[1].split(",").map((s) => s.trim().replace(/^["']|["']$/g, "")).filter(Boolean);
  }
  const block = text.match(/^labels:\s*\n((?:\s*-\s*.+\n)+)/m);
  if (block) {
    return block[1].split("\n").map((l) => l.replace(/^\s*-\s*/, "").trim()).filter(Boolean);
  }
  return null;
}

describe("#1269 — issue templates enter the documented triage state machine", () => {

  test("there are issue templates to check", () => {
    // Without this, every assertion below would pass by iterating nothing.
    assert.ok(templates.length >= 4, `expected the issue forms, found ${templates.length}`);
  });

  for (const file of templates) {
    const text = readFileSync(join(TEMPLATE_DIR, file), "utf8");
    const labels = labelsOf(text);

    test(`${file} declares labels in a shape this test understands`, () => {
      // Guards the parser: a template switching YAML style must not silently
      // start passing the assertions below by returning null.
      assert.ok(Array.isArray(labels) && labels.length > 0,
        `could not read a labels list from ${file}`);
    });

    test(`${file} applies "${ENTRY_LABEL}"`, () => {
      assert.ok(labels.includes(ENTRY_LABEL),
        `${file} must apply "${ENTRY_LABEL}" so the issue enters triage automatically; ` +
        `it applies: ${labels.join(", ")}`);
    });

    test(`${file} applies no maintainer-only triage label`, () => {
      const wrong = labels.filter((l) => MAINTAINER_ONLY.includes(l));
      assert.deepEqual(wrong, [],
        `${file} applies ${wrong.join(", ")}, which describe triage STATE and can only ` +
        `be judged by a maintainer. A reporter can answer what KIND of thing this is, ` +
        `not what state it should be in.`);
    });
  }

  test("AGENTS.md still documents the entry label as the entry label", () => {
    const agents = readFileSync(join(__dirname, "../../AGENTS.md"), "utf8");
    assert.ok(agents.includes(ENTRY_LABEL), "AGENTS.md must still name the entry label");
    assert.ok(
      /entry state/i.test(agents),
      "AGENTS.md must keep saying which of the five labels is the entry state, or this " +
      "test enforces a convention the docs no longer explain",
    );
  });
});
