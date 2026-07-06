/**
 * E2E: rt.com "load comments" break diagnosis (#1006) — HARDENED
 *
 * Reporter rugabunda: on rt.com article pages, clicking "load comments"
 * loads NO comments when MUGA is enabled, but works fine when MUGA is
 * disabled. This spec is a synthetic, deterministic harness that isolates
 * MUGA's four active-defense content scripts (all gated on the single
 * `muga:history-gate` CustomEvent) as candidate culprits, using stub pages
 * that expose exactly one tracking-bearing surface a comment widget could
 * plausibly read back.
 *
 * WHAT THIS HARNESS PROVES — AND WHAT IT DOES NOT
 * ------------------------------------------------
 * An earlier version of this spec had every scenario key its "widget"
 * uniquely on `utm_source` — THE canonical tracking param MUGA strips
 * everywhere. "All three break" was therefore a tautology: MUGA strips
 * utm_source, so of course a widget that uniquely reads utm_source back
 * breaks. That says nothing about whether a REALISTIC comment widget breaks.
 *
 * This hardened version separates two very different claims:
 *
 *   (A) STRIP-NAME-COLLISION demonstrations (LINK/HISTORY/WINDOWNAME).
 *       These show what happens ONLY IF a site's functional flow depends on
 *       a param whose NAME is in MUGA's strip list (here utm_source). They
 *       are worst-case collisions, NOT proof of rt.com's actual cause. A
 *       widget that uniquely keys on a stripped param is pathological.
 *
 *   (B) REALISTIC NEGATIVE CONTROLS (LINK-FUNCTIONAL, LINK-PARTIAL,
 *       HISTORY-FUNCTIONAL, WINNAME-URL-NOTRACK, WINNAME-JSON). Real comment
 *       widgets key on FUNCTIONAL ids (thread/room/spot/token/id), not on
 *       tracking params. These SHOULD survive under full active defense. If
 *       any of them breaks under ACTIVE, that is a genuine by-default bug and
 *       the assertion here will FAIL loudly rather than be forced green.
 *
 *   (C) LAYER DISAMBIGUATION MATRIX. For the collision-LINK and LINK-PARTIAL
 *       surfaces we run FOUR pref states and log each result:
 *         1. full-ACTIVE            (activeDefenseEnabled:true,  dnrEnabled:true)
 *         2. active-defense OFF     (activeDefenseEnabled:false, dnrEnabled:true)  [#1010]
 *         3. DNR OFF only           (dnrEnabled:false, activeDefenseEnabled:true)
 *         4. fully INERT            (whitelist:[host])                              [#1011]
 *       Interpretation: if a broken scenario RECOVERS when
 *       activeDefenseEnabled:false, the culprit is the content-script layer.
 *       If it still breaks with only DNR turned off, DNR is implicated.
 *
 * DNR CANNOT BE REPRODUCED ON THESE SURFACES (hard limitation)
 * ------------------------------------------------------------
 * These synthetic surfaces (anchor href / history.pushState / window.name)
 * are driven PURELY in-page. DNR (declarativeNetRequest) acts on real
 * OUTBOUND NETWORK REQUESTS; it does NOT intercept a same-origin JS read of
 * a page.route-stubbed value. So for THESE scenarios the observable effect is
 * attributable ENTIRELY to the active-defense content-script layer, and the
 * `dnrEnabled:false` matrix row behaves identically to full-ACTIVE (the gate
 * itself does not read dnrEnabled — see src/content/history-defuser.js
 * readPrefsAndGate). A genuine DNR-level break of a REAL comment-API network
 * request CANNOT be reproduced with page.route stubs; it would require a live
 * network capture (see rt-comments-repro-live.spec.mjs, gated behind
 * MUGA_LIVE_TESTS, and unreachable from this sandbox). This harness therefore
 * RULES DNR OUT for the client-side surfaces and cannot rule it in or out for
 * a real network request.
 *
 * GATE SYNCHRONISATION NOTE
 * -------------------------
 * window.__mugaHistoryDefused is set unconditionally at the top of
 * history-defuser-mainworld.js's IIFE — it proves the main-world scripts
 * INSTALLED, not that the (async) gate opened/closed. Each stub page also
 * registers its OWN listener for the real `muga:history-gate` event and
 * exposes window.__testGateSeen / window.__testGateEnabled. Because Chrome
 * runs document_start content scripts strictly before ANY page script
 * (including inline <head> scripts), and same-node listeners fire in
 * registration order, our probe observes the event AFTER all four content
 * scripts have fully processed it. window.__testGateEnabled thus records the
 * gate's final enabled/disabled decision for the current pref state, letting
 * us ASSERT that activeDefenseEnabled:false really flips the gate closed and
 * that whitelist really makes the host exempt — proving each matrix row is a
 * real, distinct configuration and not a silent no-op.
 */

import { test, expect } from "./fixtures.mjs";
import { waitForDnrPropagation } from "./helpers/index.mjs";

const LINK_COLLISION_HOST = "muga-test-comments-link-collision.invalid";
const LINK_FUNCTIONAL_HOST = "muga-test-comments-link-functional.invalid";
const LINK_PARTIAL_HOST = "muga-test-comments-link-partial.invalid";
const HISTORY_COLLISION_HOST = "muga-test-comments-history-collision.invalid";
const HISTORY_FUNCTIONAL_HOST = "muga-test-comments-history-functional.invalid";
const WINNAME_COLLISION_HOST = "muga-test-comments-winname-collision.invalid";
const WINNAME_URL_HOST = "muga-test-comments-winname-url.invalid";
const WINNAME_JSON_HOST = "muga-test-comments-winname-json.invalid";
const STRUCTURAL_HOST = "muga-test-comments-structural.invalid";

/** Inline probe registered before any scenario-specific script. See file docblock. */
const GATE_PROBE_SCRIPT = `
  <script>
    window.__testGateSeen = false;
    window.__testGateEnabled = null;
    document.addEventListener("muga:history-gate", (e) => {
      window.__testGateSeen = true;
      window.__testGateEnabled = !!(e && e.detail && e.detail.enabled);
    });
  </script>
`;

/**
 * Writes prefs directly to chrome.storage, mirroring the pattern used by
 * sibling active-defense specs (history-defuser.spec.mjs etc). Always writes
 * an EXPLICIT value for every field this harness varies (whitelist,
 * activeDefenseEnabled, dnrEnabled) so a state transition on the SAME
 * persistent context can never inherit residue from the previous state.
 *
 * - whitelist: [] by default; [host] makes MUGA fully inert on that host
 *   (#1011 isSiteFullyExempt -> gate closes for all four active-defense scripts).
 * - activeDefenseEnabled: true by default; false makes the FOUR active-defense
 *   content scripts pass-through while DNR/network cleaning stays ON (#1010).
 * - dnrEnabled: true by default; false disables the network-layer DNR rules
 *   (no observable effect on the in-page synthetic surfaces here — see docblock).
 */
async function setPrefs(
  context,
  extensionId,
  { whitelist = [], activeDefenseEnabled = true, dnrEnabled = true } = {}
) {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/popup/popup.html`);
  await page.evaluate(
    (prefs) =>
      new Promise((resolve) => {
        chrome.storage.sync.set(
          {
            enabled: true,
            onboardingDone: true,
            whitelist: prefs.whitelist,
            activeDefenseEnabled: prefs.activeDefenseEnabled,
            dnrEnabled: prefs.dnrEnabled,
          },
          () => {
            chrome.storage.local.set(
              {
                mugaConsent: {
                  onboardingDone: true,
                  consentVersion: "1.1",
                  consentDate: Date.now(),
                },
              },
              resolve
            );
          }
        );
      }),
    { whitelist, activeDefenseEnabled, dnrEnabled }
  );
  await page.close();
  // Prefs broadcast has no observable signal after storage.set resolves.
  // Centralised in waitForDnrPropagation so the debt is greppable (#824).
  await waitForDnrPropagation(page);
}

/**
 * The four disambiguation states. `gateEnabled` is the gate's expected final
 * decision: active-defense is ON only when activeDefenseEnabled !== false AND
 * the host is not exempt (empty whitelist). dnrEnabled does NOT affect the
 * gate (it governs the separate network layer), which is exactly why the
 * dnr-OFF row must still report the gate OPEN.
 */
function makeStates(host) {
  return [
    { name: "full-ACTIVE", prefs: { activeDefenseEnabled: true, dnrEnabled: true, whitelist: [] }, gateEnabled: true },
    { name: "activeDefense-OFF", prefs: { activeDefenseEnabled: false, dnrEnabled: true, whitelist: [] }, gateEnabled: false },
    { name: "dnr-OFF", prefs: { activeDefenseEnabled: true, dnrEnabled: false, whitelist: [] }, gateEnabled: true },
    { name: "INERT-whitelist", prefs: { activeDefenseEnabled: true, dnrEnabled: true, whitelist: [host] }, gateEnabled: false },
  ];
}

/**
 * Generic "Load comments" anchor whose OWN click handler reads
 * event.currentTarget.getAttribute("href") and decides LOADED vs NO COMMENTS
 * by whether `keyParam` still equals `expectValue` in that href. The anchor
 * pre-exists at page load so dom-link-rewriter.js's MutationObserver
 * rewriteAll() pass gets to rewrite it before the click, and
 * dom-link-rewriter-click.js's capture-phase strip runs on the click itself.
 *
 * The href is ABSOLUTE on purpose: both rewriters' urlCleaner() prefer
 * window.__mugaCleaner.processUrl, whose first step is `new URL(rawUrl)` with
 * NO base (src/lib/cleaner.js unwrapAndExtract). That THROWS on a relative
 * href, is caught internally, and returns the string untouched — so a
 * relative href would silently bypass the rewriters and give a false
 * negative. An absolute href faithfully exercises the mechanism the two
 * rewriters actually implement, and a real comment "load" endpoint is
 * commonly absolute anyway.
 */
async function stubLinkWidget(page, host, { href, keyParam, expectValue }) {
  await page.route(`**://${host}/**`, (route) =>
    route.fulfill({
      status: 200,
      contentType: "text/html",
      body: `<!doctype html><html><head>${GATE_PROBE_SCRIPT}</head><body>
        <a id="comments" href="${href}">Load comments</a>
        <div id="result"></div>
        <script>
          document.getElementById("comments").addEventListener("click", (event) => {
            // Avoid a real navigation to an unstubbed path — the point is the
            // href VALUE the widget reads, not an actual load.
            event.preventDefault();
            const raw = event.currentTarget.getAttribute("href");
            let val = null;
            try {
              val = new URL(raw, location.href).searchParams.get(${JSON.stringify(keyParam)});
            } catch {
              // malformed href — treated as "functional key did not survive"
            }
            document.getElementById("result").textContent =
              val === ${JSON.stringify(expectValue)} ? "COMMENTS LOADED" : "NO COMMENTS";
          });
        </script>
      </body></html>`,
    })
  );
}

/**
 * Generic history widget: a button whose click handler calls history.pushState
 * with `pushUrl`, then reads `keyParam` back a microtask later. Isolates
 * history-defuser-mainworld.js, which wraps pushState/replaceState
 * synchronously in the page world.
 */
async function stubHistoryWidget(page, host, { pushUrl, keyParam, expectValue }) {
  await page.route(`**://${host}/**`, (route) =>
    route.fulfill({
      status: 200,
      contentType: "text/html",
      body: `<!doctype html><html><head>${GATE_PROBE_SCRIPT}</head><body>
        <button id="push-btn">Load comments</button>
        <div id="result"></div>
        <script>
          document.getElementById("push-btn").addEventListener("click", () => {
            history.pushState({}, "", ${JSON.stringify(pushUrl)});
            queueMicrotask(() => {
              const val = new URLSearchParams(location.search).get(${JSON.stringify(keyParam)});
              document.getElementById("result").textContent =
                val === ${JSON.stringify(expectValue)} ? "COMMENTS LOADED" : "NO COMMENTS";
            });
          });
        </script>
      </body></html>`,
    })
  );
}

/**
 * Generic window.name widget: a button whose click handler writes `nameValue`
 * into window.name, reads it straight back as `raw`, and decides LOADED vs
 * NO COMMENTS by evaluating `checkExpr` (a boolean JS expression over `raw`).
 * Isolates window-name-defuser-mainworld.js, which cleans ON READ via a
 * property getter, synchronously, but ONLY when the value looksLikeHttpUrl
 * (non-URL payloads pass through verbatim).
 */
async function stubWinNameWidget(page, host, { nameValue, checkExpr }) {
  await page.route(`**://${host}/**`, (route) =>
    route.fulfill({
      status: 200,
      contentType: "text/html",
      body: `<!doctype html><html><head>${GATE_PROBE_SCRIPT}</head><body>
        <button id="name-btn">Load comments</button>
        <div id="result"></div>
        <script>
          document.getElementById("name-btn").addEventListener("click", () => {
            window.name = ${JSON.stringify(nameValue)};
            const raw = window.name;
            let loaded = false;
            try { loaded = (${checkExpr}); } catch { loaded = false; }
            document.getElementById("result").textContent =
              loaded ? "COMMENTS LOADED" : "NO COMMENTS";
          });
        </script>
      </body></html>`,
    })
  );
}

/**
 * Waits for BOTH the historical install flag AND our own gate-seen probe.
 * The first mirrors sibling active-defense specs (proves main-world scripts
 * installed); the second proves the gate event was fully processed by all
 * four content scripts, so window.__testGateEnabled now holds the gate's
 * final decision for the current pref state.
 */
async function waitForGateSettled(page) {
  await page.waitForFunction(() => window.__mugaHistoryDefused === true, { timeout: 10000 });
  await page.waitForFunction(() => window.__testGateSeen === true, { timeout: 10000 });
}

/** Clicks the trigger and returns the settled "COMMENTS LOADED" / "NO COMMENTS" text. */
async function clickAndReadResult(page, selector) {
  await page.locator(selector).click();
  await expect
    .poll(async () => page.evaluate(() => document.getElementById("result").textContent), { timeout: 5000 })
    .not.toBe("");
  return page.evaluate(() => document.getElementById("result").textContent);
}

/**
 * Runs one widget through all four disambiguation states on the same
 * persistent context. `stubFn(page)` installs the scenario stub;
 * `triggerSelector` is the element to click. Returns an array of
 * { state, expectedGate, gateEnabled, result } and logs a [MATRIX] line per
 * state.
 */
async function runMatrix(context, extensionId, host, stubFn, triggerSelector, label) {
  const states = makeStates(host);
  const rows = [];
  for (const state of states) {
    await setPrefs(context, extensionId, state.prefs);
    const page = await context.newPage();
    await stubFn(page);
    await page.goto(`https://${host}/index.html`);
    await waitForGateSettled(page);
    const gateEnabled = await page.evaluate(() => window.__testGateEnabled);
    const result = await clickAndReadResult(page, triggerSelector);
    await page.close();
    rows.push({ state: state.name, expectedGate: state.gateEnabled, gateEnabled, result });
    console.log(
      `[MATRIX] ${label} | state=${state.name} | gate.enabled=${gateEnabled} (expected ${state.gateEnabled}) | result=${result}`
    );
  }
  return rows;
}

test.describe("rt.com comment-load break diagnosis (#1006)", () => {
  // ── (A) + (C): STRIP-NAME-COLLISION LINK, full 4-state matrix ──────────
  test("LINK collision (widget keys uniquely on stripped utm_source): layer matrix", async ({
    context,
    extensionId,
  }) => {
    const host = LINK_COLLISION_HOST;
    const rows = await runMatrix(
      context,
      extensionId,
      host,
      (page) =>
        stubLinkWidget(page, host, {
          // Widget keys UNIQUELY on utm_source — the pathological collision case.
          href: `https://${host}/api/comments?thread=42&utm_source=web`,
          keyParam: "utm_source",
          expectValue: "web",
        }),
      "#comments",
      "LINK-COLLISION"
    );

    // Interpretation: the collision widget survives ONLY when the gate is
    // CLOSED (active-defense pass-through), i.e. when the stripped param is
    // left intact. Recovery under activeDefense-OFF pinpoints the
    // content-script layer as the culprit; still-broken under dnr-OFF shows
    // DNR is NOT the cause for this in-page surface.
    for (const row of rows) {
      expect(row.gateEnabled).toBe(row.expectedGate); // pref really flips the gate
      const expectedResult = row.gateEnabled ? "NO COMMENTS" : "COMMENTS LOADED";
      expect(row.result).toBe(expectedResult);
    }

    const recoversWithActiveDefenseOff =
      rows.find((r) => r.state === "activeDefense-OFF")?.result === "COMMENTS LOADED";
    const brokenWithDnrOff = rows.find((r) => r.state === "dnr-OFF")?.result === "NO COMMENTS";
    console.log(
      `[MATRIX] LINK-COLLISION verdict: recovers under activeDefense-OFF=${recoversWithActiveDefenseOff} ` +
        `(=> content-script layer is the culprit); still broken under dnr-OFF=${brokenWithDnrOff} ` +
        `(=> DNR NOT implicated for this in-page surface)`
    );
  });

  // ── (B) + (C): LINK-PARTIAL negative control, full 4-state matrix ──────
  test("LINK partial (realistic widget keys on functional thread, href also carries utm_source): layer matrix", async ({
    context,
    extensionId,
  }) => {
    const host = LINK_PARTIAL_HOST;
    const rows = await runMatrix(
      context,
      extensionId,
      host,
      (page) =>
        stubLinkWidget(page, host, {
          // The CRUX: href carries a tracking param, but the widget keys on the
          // FUNCTIONAL id (thread), not on utm_source. MUGA strips utm_source
          // yet keeps thread=42, so the widget still works in EVERY state.
          href: `https://${host}/api/comments?thread=42&utm_source=web`,
          keyParam: "thread",
          expectValue: "42",
        }),
      "#comments",
      "LINK-PARTIAL"
    );

    // Negative control: a realistic widget survives even a strip COLLISION as
    // long as it does not UNIQUELY key on the stripped param. Expect LOADED in
    // all four states. If any state breaks, that is a real by-default bug and
    // this assertion FAILS loudly (we do not force it green).
    for (const row of rows) {
      expect(row.gateEnabled).toBe(row.expectedGate);
      expect(row.result).toBe("COMMENTS LOADED");
    }
    console.log(
      "[MATRIX] LINK-PARTIAL verdict: realistic widget keyed on a functional id SURVIVES in all 4 states, " +
        "including full-ACTIVE — strip-name collisions alone do NOT break realistic widgets."
    );
  });

  // ── (B): LINK-FUNCTIONAL negative control (no tracking param at all) ────
  test("LINK functional (realistic widget keys on thread, href has no tracking param): survives ACTIVE", async ({
    context,
    extensionId,
  }) => {
    const host = LINK_FUNCTIONAL_HOST;
    await setPrefs(context, extensionId); // full-ACTIVE
    const page = await context.newPage();
    await stubLinkWidget(page, host, {
      href: `https://${host}/api/comments?thread=42&spot_id=abc`,
      keyParam: "thread",
      expectValue: "42",
    });
    await page.goto(`https://${host}/index.html`);
    await waitForGateSettled(page);
    const gate = await page.evaluate(() => window.__testGateEnabled);
    const result = await clickAndReadResult(page, "#comments");
    await page.close();

    console.log(`[REPRO] LINK-FUNCTIONAL: ACTIVE(gate=${gate})=${result}`);
    // Negative control: no tracking param present, widget keys on thread.
    // Expect LOADED under full active defense. A break here is a real bug.
    expect(gate).toBe(true);
    expect(result).toBe("COMMENTS LOADED");
  });

  // ── (A): STRIP-NAME-COLLISION HISTORY demonstration ────────────────────
  test("HISTORY collision (widget keys uniquely on stripped utm_source): ACTIVE vs INERT", async ({
    context,
    extensionId,
  }) => {
    const host = HISTORY_COLLISION_HOST;
    const stub = (page) =>
      stubHistoryWidget(page, host, {
        pushUrl: "/thread?id=99&utm_source=web",
        keyParam: "utm_source",
        expectValue: "web",
      });

    await setPrefs(context, extensionId); // full-ACTIVE
    const activePage = await context.newPage();
    await stub(activePage);
    await activePage.goto(`https://${host}/index.html`);
    await waitForGateSettled(activePage);
    const activeGate = await activePage.evaluate(() => window.__testGateEnabled);
    const activeResult = await clickAndReadResult(activePage, "#push-btn");
    await activePage.close();

    await setPrefs(context, extensionId, { whitelist: [host] }); // INERT
    const inertPage = await context.newPage();
    await stub(inertPage);
    await inertPage.goto(`https://${host}/index.html`);
    await waitForGateSettled(inertPage);
    const inertGate = await inertPage.evaluate(() => window.__testGateEnabled);
    const inertResult = await clickAndReadResult(inertPage, "#push-btn");
    await inertPage.close();

    console.log(
      `[REPRO] HISTORY-COLLISION: ACTIVE(gate=${activeGate})=${activeResult} INERT(gate=${inertGate})=${inertResult}`
    );
    // Collision on a stripped param: breaks under ACTIVE, survives when inert.
    expect(activeGate).toBe(true);
    expect(activeResult).toBe("NO COMMENTS");
    expect(inertGate).toBe(false);
    expect(inertResult).toBe("COMMENTS LOADED");
  });

  // ── (B): HISTORY-FUNCTIONAL negative control ───────────────────────────
  test("HISTORY functional (realistic widget keys on id, no tracking param): survives ACTIVE", async ({
    context,
    extensionId,
  }) => {
    const host = HISTORY_FUNCTIONAL_HOST;
    await setPrefs(context, extensionId); // full-ACTIVE
    const page = await context.newPage();
    await stubHistoryWidget(page, host, {
      pushUrl: "/thread?id=99&sort=newest",
      keyParam: "id",
      expectValue: "99",
    });
    await page.goto(`https://${host}/index.html`);
    await waitForGateSettled(page);
    const gate = await page.evaluate(() => window.__testGateEnabled);
    const result = await clickAndReadResult(page, "#push-btn");
    await page.close();

    console.log(`[REPRO] HISTORY-FUNCTIONAL: ACTIVE(gate=${gate})=${result}`);
    // Negative control: no tracking param present, widget keys on id. Expect
    // LOADED under full active defense. A break here is a real bug.
    expect(gate).toBe(true);
    expect(result).toBe("COMMENTS LOADED");
  });

  // ── (A): STRIP-NAME-COLLISION WINDOWNAME demonstration ─────────────────
  test("WINDOWNAME collision (URL in window.name keyed uniquely on stripped utm_source): ACTIVE vs INERT", async ({
    context,
    extensionId,
  }) => {
    const host = WINNAME_COLLISION_HOST;
    const stub = (page) =>
      stubWinNameWidget(page, host, {
        nameValue: "https://cdn.example/widget?room=7&utm_source=web",
        checkExpr: 'new URL(raw).searchParams.get("utm_source") === "web"',
      });

    await setPrefs(context, extensionId); // full-ACTIVE
    const activePage = await context.newPage();
    await stub(activePage);
    await activePage.goto(`https://${host}/index.html`);
    await waitForGateSettled(activePage);
    const activeGate = await activePage.evaluate(() => window.__testGateEnabled);
    const activeResult = await clickAndReadResult(activePage, "#name-btn");
    await activePage.close();

    await setPrefs(context, extensionId, { whitelist: [host] }); // INERT
    const inertPage = await context.newPage();
    await stub(inertPage);
    await inertPage.goto(`https://${host}/index.html`);
    await waitForGateSettled(inertPage);
    const inertGate = await inertPage.evaluate(() => window.__testGateEnabled);
    const inertResult = await clickAndReadResult(inertPage, "#name-btn");
    await inertPage.close();

    console.log(
      `[REPRO] WINDOWNAME-COLLISION: ACTIVE(gate=${activeGate})=${activeResult} INERT(gate=${inertGate})=${inertResult}`
    );
    // URL in window.name that uniquely keys on a stripped param: cleaned on
    // read under ACTIVE (looksLikeHttpUrl true), survives when inert.
    expect(activeGate).toBe(true);
    expect(activeResult).toBe("NO COMMENTS");
    expect(inertGate).toBe(false);
    expect(inertResult).toBe("COMMENTS LOADED");
  });

  // ── (B): WINNAME-URL-NOTRACK negative control ──────────────────────────
  test("WINNAME url-no-track (URL in window.name with only functional params): survives ACTIVE", async ({
    context,
    extensionId,
  }) => {
    const host = WINNAME_URL_HOST;
    await setPrefs(context, extensionId); // full-ACTIVE
    const page = await context.newPage();
    await stubWinNameWidget(page, host, {
      nameValue: "https://cdn.example/widget?room=7&token=xyz",
      // Both functional params must round-trip unchanged.
      checkExpr:
        'new URL(raw).searchParams.get("room") === "7" && new URL(raw).searchParams.get("token") === "xyz"',
    });
    await page.goto(`https://${host}/index.html`);
    await waitForGateSettled(page);
    const gate = await page.evaluate(() => window.__testGateEnabled);
    const result = await clickAndReadResult(page, "#name-btn");
    await page.close();

    console.log(`[REPRO] WINNAME-URL-NOTRACK: ACTIVE(gate=${gate})=${result}`);
    // Negative control: looksLikeHttpUrl true, but no param name is in the
    // strip set, so cleanUrl leaves the URL unchanged. Expect LOADED.
    expect(gate).toBe(true);
    expect(result).toBe("COMMENTS LOADED");
  });

  // ── (B): WINNAME-JSON negative control (property-accessor verbatim path) ─
  test("WINNAME json (non-URL JSON payload in window.name): exact round-trip under ACTIVE", async ({
    context,
    extensionId,
  }) => {
    const host = WINNAME_JSON_HOST;
    const jsonValue = '{"room":7,"token":"xyz"}';
    await setPrefs(context, extensionId); // full-ACTIVE
    const page = await context.newPage();
    await stubWinNameWidget(page, host, {
      nameValue: jsonValue,
      // Exact verbatim round-trip AND parseable to the original object.
      checkExpr:
        "raw === " +
        JSON.stringify(jsonValue) +
        ' && JSON.parse(raw).room === 7 && JSON.parse(raw).token === "xyz"',
    });
    await page.goto(`https://${host}/index.html`);
    await waitForGateSettled(page);
    const gate = await page.evaluate(() => window.__testGateEnabled);
    const result = await clickAndReadResult(page, "#name-btn");
    await page.close();

    console.log(`[REPRO] WINNAME-JSON: ACTIVE(gate=${gate})=${result}`);
    // looksLikeHttpUrl is FALSE for a JSON string, so the getter returns it
    // verbatim. This tests the property-accessor structural side effect: a
    // non-URL payload must survive byte-for-byte even with the gate OPEN.
    expect(gate).toBe(true);
    expect(result).toBe("COMMENTS LOADED");
  });

  // ── (D): STRUCTURAL PROBE of the window.name property accessor ──────────
  test("STRUCTURAL: window.name accessor descriptor / typeof / delete-and-reset behave normally under ACTIVE", async ({
    context,
    extensionId,
  }) => {
    const host = STRUCTURAL_HOST;
    await setPrefs(context, extensionId); // full-ACTIVE — gate open, accessor live
    const page = await context.newPage();
    await page.route(`**://${host}/**`, (route) =>
      route.fulfill({
        status: 200,
        contentType: "text/html",
        body: `<!doctype html><html><head>${GATE_PROBE_SCRIPT}</head><body>
          <button id="probe-btn">probe</button>
          <div id="result"></div>
          <script>
            document.getElementById("probe-btn").addEventListener("click", () => {
              const out = {};
              const d = Object.getOwnPropertyDescriptor(window, "name");
              out.hasDescriptor = !!d;
              out.configurable = !!(d && d.configurable);
              out.enumerable = !!(d && d.enumerable);
              out.getterIsFn = !!(d && typeof d.get === "function");
              out.setterIsFn = !!(d && typeof d.set === "function");

              // typeof after writing a plain (non-URL) value.
              window.name = "structuralProbeValue";
              out.typeofName = typeof window.name;
              out.plainRoundTrip = window.name === "structuralProbeValue";

              // A URL value is cleaned on read, but only the tracking param is
              // removed — the functional part must survive intact.
              window.name = "https://x.example/p?utm_source=web&keep=1";
              let cleanedHasUtm = true, cleanedKeepsFunctional = false;
              try {
                const u = new URL(window.name);
                cleanedHasUtm = u.searchParams.has("utm_source");
                cleanedKeepsFunctional = u.searchParams.get("keep") === "1";
              } catch {}
              out.urlCleanedOnRead = cleanedHasUtm === false;
              out.urlKeepsFunctional = cleanedKeepsFunctional;

              // delete then re-set must behave normally (configurable:true).
              out.deleteReturned = (delete window.name);
              window.name = "afterDelete";
              out.reSetRoundTrip = window.name === "afterDelete";

              document.getElementById("result").textContent = JSON.stringify(out);
            });
          </script>
        </body></html>`,
      })
    );
    await page.goto(`https://${host}/index.html`);
    await waitForGateSettled(page);
    const gate = await page.evaluate(() => window.__testGateEnabled);
    await page.locator("#probe-btn").click();
    await expect
      .poll(async () => page.evaluate(() => document.getElementById("result").textContent), { timeout: 5000 })
      .not.toBe("");
    const probe = JSON.parse(await page.evaluate(() => document.getElementById("result").textContent));
    await page.close();

    console.log(`[STRUCTURAL] window.name probe under ACTIVE(gate=${gate}): ${JSON.stringify(probe)}`);

    // The accessor must be a well-formed, configurable, enumerable get/set
    // pair (so page code can still redefine or delete it if needed).
    expect(gate).toBe(true);
    expect(probe.hasDescriptor).toBe(true);
    expect(probe.configurable).toBe(true);
    expect(probe.enumerable).toBe(true);
    expect(probe.getterIsFn).toBe(true);
    expect(probe.setterIsFn).toBe(true);
    // Normal string semantics preserved.
    expect(probe.typeofName).toBe("string");
    expect(probe.plainRoundTrip).toBe(true);
    // Cleaning is surgical: strips the tracking param, keeps the functional one.
    expect(probe.urlCleanedOnRead).toBe(true);
    expect(probe.urlKeepsFunctional).toBe(true);
    // delete + re-set works (configurable accessor does not brick the property).
    expect(probe.deleteReturned).toBe(true);
    expect(probe.reSetRoundTrip).toBe(true);
  });
});
