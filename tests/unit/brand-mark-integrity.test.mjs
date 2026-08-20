/**
 * MUGA: the brand mark is one drawing, kept in one place.
 *
 * There are two SVGs of it, and they exist for different reasons:
 * src/icons/muga-mark.svg is the canonical mark, drawn in currentColor so each
 * surface tints it, and tools/brand/muga-mark-square.svg centres the same paths
 * on a 128x128 canvas with the purple baked in, which is what the store PNGs
 * are rendered from. Two files, one drawing — so they must not drift.
 *
 * This is not hypothetical bookkeeping. Working out which asset was authoritative
 * cost a real detour: src/icons/newicon.png is a design-tool upload that IS a
 * different drawing (longer vertical drop, longer arrow shaft) and is excluded
 * from both store builds, and tools/brand-assets.html generated a "bold M with
 * bottom stripe" from the retired denoise identity while exporting it under the
 * shipped icon filenames. Only one of the files here is the mark; the tests
 * below say which, in a way that survives the next person's memory.
 *
 * Run with: npm test
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..", "..");

const CANONICAL = "src/icons/muga-mark.svg";
const SQUARE = "tools/brand/muga-mark-square.svg";

/** Every `d="…"` in a file, whitespace-normalised. */
function pathData(rel) {
  const svg = readFileSync(join(ROOT, rel), "utf8");
  return [...svg.matchAll(/\sd="([^"]+)"/g)].map((m) => m[1].replace(/\s+/g, " ").trim());
}

describe("brand mark integrity", () => {
  test("the canonical mark and the square source are the same drawing", () => {
    const canonical = pathData(CANONICAL);
    const square = pathData(SQUARE);

    assert.ok(canonical.length > 0, `${CANONICAL} must contain path data`);
    assert.deepEqual(
      square,
      canonical,
      `${SQUARE} renders the store icons and ${CANONICAL} renders every screen and favicon. ` +
        `Different path data means the extension and its store listing would ship different logos.`,
    );
  });

  test("the mark is a two-path drawing: the stroke and the arrow head", () => {
    // A guard against a "simplification" that flattens or drops one of them —
    // the arrow head is a separate filled path and is the half that carries the
    // "you land where you meant to" half of the mark's meaning.
    assert.equal(pathData(CANONICAL).length, 2);
  });

  test("the canonical mark carries no baked-in colour at all", () => {
    // currentColor is why one file serves a dark landing, a light popup and a
    // favicon. Checking that *some* attribute says currentColor is too weak:
    // the mark has two paths and three colour attributes between them, so a
    // partial change would slip through. Assert the absence of any literal
    // colour instead. The square source under tools/brand/ is the opposite by
    // design — it bakes the purple in precisely because it is rasterised.
    const svg = readFileSync(join(ROOT, CANONICAL), "utf8");
    const baked = [...svg.matchAll(/(?:stroke|fill)="(#[0-9a-fA-F]{3,8}|rgba?\([^"]*\))"/g)].map((m) => m[0]);
    assert.deepEqual(
      baked,
      [],
      `${CANONICAL} must stay tintable; these bake a colour in: ${baked.join(", ")}`,
    );
    assert.ok(/currentColor/.test(svg), `${CANONICAL} must actually use currentColor`);
  });

  test("the retired brand-assets generator stays deleted", () => {
    // It drew a "bold M with bottom stripe" under the retired denoise identity
    // and exported it as muga-128.png / muga-48.png / muga-16.png — the shipped
    // filenames. Running it would have overwritten the real icons with a design
    // two releases out of date. tools/brand/README.md documents the replacement.
    assert.equal(
      existsSync(join(ROOT, "tools/brand-assets.html")),
      false,
      "tools/brand-assets.html generated a retired mark under the shipped icon filenames",
    );
  });

  test("newicon.png is excluded from both store builds", () => {
    // It is a different drawing and must never reach a bundle.
    const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
    for (const target of ["build:chrome", "build:firefox"]) {
      assert.ok(
        pkg.scripts[target].includes("icons/newicon.png"),
        `${target} must keep excluding icons/newicon.png — it is a design upload, not the mark`,
      );
    }
  });
});
