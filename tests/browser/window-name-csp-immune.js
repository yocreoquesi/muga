/**
 * MUGA — window.name CSP-immune defuser smoke (#509 / B12).
 *
 * Runs in the PAGE world (a same-origin script, allowed by this page's strict
 * `script-src 'self'` CSP). It writes values into `window.name` and reads them
 * back, asserting MUGA's page-world accessor cleans URL-shaped tracking payloads
 * while leaving non-URL round-trips untouched.
 *
 * This exercises the LIVE extension — there is no MUGA code here. On Firefox the
 * accessor comes from window-name-defuser.js (wrappedJSObject + exportFunction);
 * on Chrome MV3 it comes from window-name-defuser-mainworld.js (world:MAIN).
 * Both must survive this page's CSP because neither creates a <script> element.
 */
(function () {
  "use strict";

  var isFirefox = /firefox/i.test(navigator.userAgent);

  // Does the page-world window.name carry MUGA's accessor at all? On Firefox
  // this is the direct signal that the wrappedJSObject redefine was accepted.
  function accessorInstalled() {
    try {
      var d = Object.getOwnPropertyDescriptor(window, "name");
      return !!(d && typeof d.get === "function");
    } catch (_e) {
      return false;
    }
  }

  // Each case: write `input` into window.name, read it back, compare to expect.
  // `expect` is a function(readback) => boolean so we can assert "changed" vs
  // "unchanged" precisely.
  var CASES = [
    {
      id: "A",
      title: "URL with utm_source is cleaned on read (the real assertion)",
      input: "https://example.com/p?utm_source=newsletter&id=42",
      check: function (out) {
        return out === "https://example.com/p?id=42";
      },
      expectText: "https://example.com/p?id=42",
    },
    {
      id: "B",
      title: "Non-URL token round-trips verbatim (no collateral damage)",
      input: "frame-handshake-token-abc123",
      check: function (out) { return out === "frame-handshake-token-abc123"; },
      expectText: "frame-handshake-token-abc123 (unchanged)",
    },
    {
      id: "C",
      title: "Clean URL (no tracking params) is left unchanged",
      input: "https://example.com/p?id=1",
      check: function (out) { return out === "https://example.com/p?id=1"; },
      expectText: "https://example.com/p?id=1 (unchanged)",
    },
    {
      id: "D",
      title: "JSON cross-frame payload passes through untouched",
      input: '{"channel":"oauth","nonce":"xyz"}',
      check: function (out) { return out === '{"channel":"oauth","nonce":"xyz"}'; },
      expectText: '{"channel":"oauth","nonce":"xyz"} (unchanged)',
    },
    {
      id: "E",
      title: "Second write updates the stored value (read returns latest)",
      input: "https://a.test/?utm_medium=x",
      check: function (out) { return out === "https://a.test/"; },
      expectText: "https://a.test/",
    },
    // ── audit-2026-07 S3: surviving params must keep their EXACT bytes ────────
    // The old URLSearchParams.toString() rebuild re-encoded every survivor
    // (%20 -> +, !()~ -> %XX), corrupting a signature/token in a neighbour.
    // These cases FAIL on the old code and PASS on the raw-query splice.
    {
      id: "F",
      title: "S3: a %20 in a surviving param is NOT turned into '+'",
      input: "https://example.com/p?sig=ab%20cd&utm_source=x",
      check: function (out) { return out === "https://example.com/p?sig=ab%20cd"; },
      expectText: "https://example.com/p?sig=ab%20cd (old code gave ...sig=ab+cd)",
    },
    {
      id: "G",
      title: "S3: !()~ in a surviving param are NOT percent-encoded",
      input: "https://example.com/p?tok=a!b(c)~d*e&fbclid=z",
      check: function (out) { return out === "https://example.com/p?tok=a!b(c)~d*e"; },
      expectText: "https://example.com/p?tok=a!b(c)~d*e (old code percent-encoded !()~)",
    },
    {
      id: "H",
      title: "S3: a hash-router pseudo-query in the fragment is left untouched",
      input: "https://example.com/#/route?utm_source=x",
      check: function (out) { return out === "https://example.com/#/route?utm_source=x"; },
      expectText: "https://example.com/#/route?utm_source=x (unchanged — '?' is in the fragment)",
    },
  ];

  function esc(s) {
    return String(s).replace(/[&<>]/g, function (c) {
      return c === "&" ? "&amp;" : c === "<" ? "&lt;" : "&gt;";
    });
  }

  function renderEnv() {
    var env = document.getElementById("env");
    env.innerHTML =
      "browser: <strong>" + (isFirefox ? "Firefox" : "Chromium/other") + "</strong>" +
      " · path exercised: <strong>" +
      (isFirefox ? "wrappedJSObject (isolated)" : "world:MAIN (mainworld)") + "</strong>" +
      " · accessor installed: <strong>" + (accessorInstalled() ? "yes" : "no") + "</strong>";
  }

  function run() {
    var results = document.getElementById("results");
    results.innerHTML = "";
    var passed = 0;

    CASES.forEach(function (c) {
      // Write, then read back through the accessor.
      window.name = c.input;
      var out = window.name;
      var ok = false;
      try { ok = c.check(out); } catch (_e) { ok = false; }
      if (ok) passed++;

      var div = document.createElement("div");
      div.className = "case " + (ok ? "pass" : "fail");
      div.innerHTML =
        '<div class="case-title"><span class="tag ' + (ok ? "pass" : "fail") + '">' +
        (ok ? "PASS" : "FAIL") + "</span>Case " + c.id + " — " + esc(c.title) + "</div>" +
        '<div class="kv"><span class="k">wrote</span>' + esc(c.input) + "</div>" +
        '<div class="kv"><span class="k">read back</span>' + esc(out) + "</div>" +
        '<div class="kv"><span class="k">expected</span>' + esc(c.expectText) + "</div>";
      results.appendChild(div);
    });

    // Reset window.name so a re-run starts clean.
    window.name = "";

    var summary = document.getElementById("summary");
    var all = passed === CASES.length;
    summary.className = all ? "pass" : "fail";
    summary.textContent = passed + " / " + CASES.length + " passed" +
      (all ? "  ✓ CSP-immune defuser working" :
        "  ✗ check that MUGA is enabled + onboarded, and (Firefox) that 'accessor installed' is yes");
  }

  renderEnv();
  document.getElementById("run").addEventListener("click", run);
})();
