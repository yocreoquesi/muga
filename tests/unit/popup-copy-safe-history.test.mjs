/**
 * MUGA — #946: popup History "Copy clean" affordances must be copy-safe.
 *
 * Before this fix, the History section's per-entry click-to-copy and the
 * "copy clean URL" icon button both copied `entry.clean` — the value
 * stored at NAVIGATION time (computed with `injectOwnAffiliate` ON). For
 * an `injected` action that value carries MUGA's own affiliate tag, which
 * must never land on the clipboard from a copy affordance.
 *
 * The fix reprocesses `entry.original` through the existing PROCESS_URL
 * message with `skipNotify: true` — the SAME effectivePrefs branch
 * background/service-worker.js#handleProcessUrl already uses for the
 * keyboard-shortcut / context-menu copy paths (injectOwnAffiliate +
 * notifyForeignAffiliate both forced off) — instead of inventing a new
 * message type or a second nav-time value.
 *
 * popup.js is a plain DOMContentLoaded script with no exports and
 * top-level `chrome.*`/`document.*` references, so it cannot be
 * `import`-ed in Node (same constraint documented in
 * popup-copy-with-feedback.test.mjs, which established the pattern this
 * file follows). Structural assertions pin the wiring; the extracted
 * `getCopySafeCleanUrl` helper is additionally exercised BEHAVIORALLY
 * below by evaluating its real source against a fake `chrome.runtime`.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "../..");
const popupSrc = readFileSync(resolve(root, "src/popup/popup.js"), "utf8");

/** Extracts a top-level `async function <name>(...) { ... }` block via brace matching. */
function extractFunctionSource(src, name) {
  const idx = src.indexOf(`async function ${name}`);
  assert.ok(idx !== -1, `${name} must be defined as an async function`);
  let depth = 0;
  let started = false;
  let i = idx;
  for (; i < src.length; i++) {
    if (src[i] === "{") { depth++; started = true; }
    else if (src[i] === "}") {
      depth--;
      if (started && depth === 0) { i++; break; }
    }
  }
  return src.slice(idx, i);
}

/** Builds a callable getCopySafeCleanUrl bound to a fake `chrome` global. */
function buildGetCopySafeCleanUrl(fakeChrome) {
  const fnSrc = extractFunctionSource(popupSrc, "getCopySafeCleanUrl");
  // Intentional: evaluating the real source (not a re-implementation)
  // against injected browser-global stand-ins, matching the vm-harness
  // precedent used for content-script tests (#951).
  const factory = new Function("chrome", `"use strict";\n${fnSrc}\nreturn getCopySafeCleanUrl;`);
  return factory(fakeChrome);
}

describe("#946 — getCopySafeCleanUrl helper (behavioral)", () => {
  test("reprocesses via PROCESS_URL with skipNotify:true and returns the copy-safe cleanUrl", async () => {
    let sentMessage;
    const fakeChrome = {
      runtime: {
        sendMessage: (msg) => {
          sentMessage = msg;
          return Promise.resolve({ cleanUrl: "https://example.com/clean-no-tag", action: "injected" });
        },
      },
    };
    const getCopySafeCleanUrl = buildGetCopySafeCleanUrl(fakeChrome);
    const result = await getCopySafeCleanUrl("https://example.com/raw?tag=x");

    assert.equal(sentMessage.type, "PROCESS_URL");
    assert.equal(sentMessage.url, "https://example.com/raw?tag=x", "must reprocess the ORIGINAL url, not the stale nav-time clean value");
    assert.equal(sentMessage.skipNotify, true, "must mirror handleProcessUrl's copy-safe effectivePrefs branch");
    assert.equal(result, "https://example.com/clean-no-tag");
  });

  test("falls back to the tag-free original (NOT the nav-time clean) when the service worker is unreachable", async () => {
    const fakeChrome = { runtime: { sendMessage: () => Promise.reject(new Error("SW unreachable")) } };
    const getCopySafeCleanUrl = buildGetCopySafeCleanUrl(fakeChrome);
    const result = await getCopySafeCleanUrl("https://example.com/raw?utm_source=x");
    // Degraded path must never leak MUGA's tag: it returns the original (which by
    // construction has no injected tag), not the possibly-tagged nav-time value.
    assert.equal(result, "https://example.com/raw?utm_source=x");
  });

  test("falls back to the tag-free original when the response has no usable cleanUrl", async () => {
    const fakeChrome = { runtime: { sendMessage: () => Promise.resolve({ action: "error", cleanUrl: null }) } };
    const getCopySafeCleanUrl = buildGetCopySafeCleanUrl(fakeChrome);
    const result = await getCopySafeCleanUrl("https://example.com/raw");
    assert.equal(result, "https://example.com/raw");
  });
});

describe("#946 — History copy handlers reprocess via getCopySafeCleanUrl instead of entry.clean directly", () => {
  test("entry-row click-to-copy calls getCopySafeCleanUrl(entry.original)", () => {
    const idx = popupSrc.indexOf('entryDiv.addEventListener("click"');
    assert.ok(idx !== -1, "entryDiv click handler must exist");
    const block = popupSrc.slice(idx, idx + 700);
    assert.ok(
      block.includes("getCopySafeCleanUrl(entry.original)"),
      "must reprocess copy-safe instead of copying entry.clean (the nav-time, possibly-tagged value) directly",
    );
  });

  test("copy-clean icon button calls getCopySafeCleanUrl(entry.original)", () => {
    const idx = popupSrc.indexOf('copyCleanBtn.addEventListener("click"');
    assert.ok(idx !== -1, "copyCleanBtn click handler must exist");
    const block = popupSrc.slice(idx, idx + 500);
    assert.ok(
      block.includes("getCopySafeCleanUrl(entry.original)"),
      "must reprocess copy-safe instead of copying entry.clean directly",
    );
  });

  test("copy-original button is UNCHANGED — still copies entry.original directly (never carried a tag)", () => {
    const idx = popupSrc.indexOf('copyOrigBtn.addEventListener("click"');
    assert.ok(idx !== -1, "copyOrigBtn click handler must exist");
    const block = popupSrc.slice(idx, idx + 400);
    assert.ok(
      block.includes("copyWithFeedback(entry.original,"),
      "copy-original must keep copying entry.original verbatim — it is the raw pre-clean URL by definition, out of scope for #946",
    );
  });
});
