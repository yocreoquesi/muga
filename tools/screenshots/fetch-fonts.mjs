/**
 * MUGA: download Archivo + IBM Plex Mono into tools/screenshots/fonts/ for the
 * store-image renderer. Ported from the brand kit's fetch-fonts.mjs.
 *
 * The fonts are fetched, not committed: the folder is gitignored so the repo
 * does not vendor third-party font files. render.mjs calls this on first run.
 * Latin subset, plus a tiny symbol subset (arrows, middle dot, check mark)
 * that the latin files lack. Each Plex weight gets its own symbol face:
 * Chrome groups faces by identical weight descriptors, so a "400 600" range
 * face would shadow the latin ones.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36";
export const FONT_DIR = new URL("./fonts/", import.meta.url);

// Every file fetchFonts() writes into FONT_DIR. Exported so render.mjs can
// verify the cache is complete instead of trusting fonts.css alone (#1489):
// a run interrupted after fonts.css was written but before every woff2 was
// downloaded must be detected and re-fetched.
export const FONT_FILES = [
  "fonts.css",
  "Archivo-var.woff2",
  "Archivo-sym.woff2",
  "IBMPlexMono-400.woff2",
  "IBMPlexMono-500.woff2",
  "IBMPlexMono-600.woff2",
  "IBMPlexMono-sym.woff2",
];

/**
 * Pure decision: does `existing` (basenames present in the font cache dir)
 * contain every file fetchFonts() is expected to produce? (#1489)
 * @param {string[]} existing
 * @returns {boolean}
 */
export function isFontCacheComplete(existing) {
  const have = new Set(existing);
  return FONT_FILES.every((f) => have.has(f));
}

/**
 * fetch() that fails loudly on a non-2xx response instead of letting an
 * error body (404/500 HTML) be written to disk as CSS or a font file (#1489).
 * @param {string} u
 * @param {RequestInit} [opts]
 * @returns {Promise<Response>}
 */
export async function fetchOk(u, opts) {
  const res = await fetch(u, opts);
  if (!res.ok) throw new Error(`fetch-fonts: ${res.status} ${res.statusText} fetching ${u}`);
  return res;
}

const get = async (u) => (await fetchOk(u, { headers: { "User-Agent": UA } })).text();
const save = async (src, name) => writeFileSync(new URL(name, FONT_DIR), Buffer.from(await (await fetchOk(src)).arrayBuffer()));
const latin = (css) => css.split("/*").slice(1).filter((b) => b.slice(0, b.indexOf("*/")).trim() === "latin");
const url = (b) => /url\((https:[^)]+)\)/.exec(b)[1];

/**
 * Download every face and write fonts.css next to them.
 * @returns {Promise<void>}
 */
export async function fetchFonts() {
  mkdirSync(FONT_DIR, { recursive: true });
  let css = "/* MUGA store images: local font faces (latin subset + symbol subset) */\n";
  // Archivo is variable: one file covers 400-800.
  const arch = latin(await get("https://fonts.googleapis.com/css2?family=Archivo:wght@400..800"))[0];
  await save(url(arch), "Archivo-var.woff2");
  css += "@font-face{font-family:'Archivo';font-style:normal;font-weight:400 800;font-display:block;src:url('Archivo-var.woff2') format('woff2');}\n";
  for (const w of [400, 500, 600]) {
    const b = latin(await get(`https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@${w}`))[0];
    await save(url(b), `IBMPlexMono-${w}.woff2`);
    css += `@font-face{font-family:'IBM Plex Mono';font-style:normal;font-weight:${w};font-display:block;src:url('IBMPlexMono-${w}.woff2') format('woff2');}\n`;
  }
  const T = encodeURIComponent("→←≈✓×↗↓↑·…");
  const RANGE = "U+b7, U+d7, U+2026, U+2190-2193, U+2197, U+2248, U+2713";
  await save(url(await get(`https://fonts.googleapis.com/css2?family=Archivo:wght@400..800&text=${T}`)), "Archivo-sym.woff2");
  await save(url(await get(`https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400&text=${T}`)), "IBMPlexMono-sym.woff2");
  css += `@font-face{font-family:'Archivo';font-style:normal;font-weight:400 800;font-display:block;src:url('Archivo-sym.woff2') format('woff2');unicode-range:${RANGE};}\n`;
  for (const w of [400, 500, 600]) css += `@font-face{font-family:'IBM Plex Mono';font-style:normal;font-weight:${w};font-display:block;src:url('IBMPlexMono-sym.woff2') format('woff2');unicode-range:${RANGE};}\n`;
  writeFileSync(new URL("fonts.css", FONT_DIR), css);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await fetchFonts();
  console.log("fonts written to", fileURLToPath(FONT_DIR));
}
