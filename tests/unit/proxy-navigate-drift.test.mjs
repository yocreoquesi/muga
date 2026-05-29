/**
 * MUGA — proxy-navigate drift guard (#724, spin-off from #709 item 3)
 *
 * `src/lib/proxy-navigate.js` (`handleProxyNavigation`) is the pure,
 * unit-tested version of the privacy-proxy navigation logic. The runtime
 * copy lives inline in `src/content/cleaner.js` (content scripts are IIFEs
 * and can't import ES modules). The two differ structurally — the lib takes
 * an `opts` object, the inline copy uses closure vars — so byte/AST equality
 * is impossible. Instead this pins the shared CONTRACT both copies must agree
 * on. Drift in any invariant (message type, timeout, cap, scheme guard) breaks
 * one path while the other keeps working — exactly the silent divergence #709
 * item 3 flagged.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const LIB = readFileSync(join(__dirname, "../../src/lib/proxy-navigate.js"), "utf8");
const CONTENT = readFileSync(join(__dirname, "../../src/content/cleaner.js"), "utf8");

// Isolate the inline proxy block in cleaner.js so generic fragments (e.g. the
// literal 2000, which appears in many length caps) are matched only here.
const proxyStart = CONTENT.indexOf("SYNC NOTE: the proxy-navigation logic");
const proxyEnd = CONTENT.indexOf("navigate(cleanUrl, opensNewTab)", proxyStart);
const CONTENT_PROXY = CONTENT.slice(proxyStart, proxyEnd);

// Fragments that must be byte-identical in BOTH copies.
const SHARED = [
  { name: "UNWRAP_VIA_PROXY message type", frag: '{ type: "UNWRAP_VIA_PROXY", url' },
  { name: "timeout rejection error", frag: 'new Error("proxy-navigate timeout")' },
  { name: "response ok gate", frag: "response?.ok === true" },
  { name: "destination scheme guard", frag: 'dest.startsWith("https://") || dest.startsWith("http://")' },
];

describe("#724 — proxy-navigate.js ↔ cleaner.js inline copy contract", () => {
  for (const { name, frag } of SHARED) {
    test(`shared invariant present in both copies: ${name}`, () => {
      assert.ok(
        LIB.includes(frag),
        `src/lib/proxy-navigate.js drifted — missing ${name}: ${frag}`,
      );
      assert.ok(
        CONTENT_PROXY.includes(frag),
        `src/content/cleaner.js inline proxy copy drifted — missing ${name}: ${frag}`,
      );
    });
  }

  test("both copies cap the destination at 2000 chars", () => {
    assert.ok(LIB.includes("MAX_DESTINATION_LENGTH = 2000"), "lib must define MAX_DESTINATION_LENGTH = 2000");
    assert.ok(LIB.includes("dest.length <= MAX_DESTINATION_LENGTH"), "lib must enforce the cap");
    assert.ok(CONTENT_PROXY.includes("dest.length <= 2000"), "inline copy must enforce the 2000-char cap");
  });

  test("both copies use the same 6000ms outer timeout", () => {
    assert.ok(LIB.includes("DEFAULT_TIMEOUT_MS = 6000"), "lib must default the outer timeout to 6000ms");
    assert.ok(CONTENT_PROXY.includes("_PROXY_TIMEOUT_MS = 6000"), "inline copy must use a 6000ms outer timeout");
  });
});
