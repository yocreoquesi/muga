/**
 * MUGA: DOM-free loader for the real content-script bundle (web-cleaner-tool
 * #1029, ADR-6).
 *
 * `src/content/cleaner-bundle.js` is an esbuild IIFE that reads the bare
 * `window` global and attaches `window.__mugaCleaner` to it (see
 * src/content/cleaner-bundle-src.mjs). An esbuild IIFE has no top-level
 * import/export, so it is a syntactically valid ES module body — dynamically
 * importing it executes the IIFE without eval/new Function (forbidden by
 * AGENTS.md).
 *
 * Setting `globalThis.window` makes the bare identifier `window` resolve to
 * it from any module in this process (global-object property lookup, not a
 * module-scoped binding), so no jsdom/vm sandbox is needed.
 *
 * Usage:
 *   import { engine } from "./helpers/load-web-engine.mjs";
 *   engine.processUrl(...)
 */
globalThis.window ??= {};

await import("../../../src/content/cleaner-bundle.js");

export const engine = globalThis.window.__mugaCleaner;
