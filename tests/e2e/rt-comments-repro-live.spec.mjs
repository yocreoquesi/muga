/**
 * E2E (LIVE, gated): rt.com "load comments" real-page repro (#1006)
 *
 * This spec is the best-effort companion to rt-comments-repro.spec.mjs's
 * synthetic scenarios. It drives a REAL Chromium (extension loaded,
 * onboarded) against the actual reported URL:
 *
 *   https://www.rt.com/news/642594-germany-rt-ban-censorship/
 *
 * It is NEVER run in normal CI - gated behind MUGA_LIVE_TESTS - because it
 * depends on live network access to a real third-party site, which is not
 * guaranteed to be reachable from every sandbox/CI runner. When it can run,
 * it instruments the page (history hooks, a href MutationObserver, a
 * window.name read/write log, and a message-event log) BEFORE touching the
 * comment widget, then inspects the DOM to find the actual trigger element
 * and log what mechanism rt.com's real comment widget uses. This inspection
 * IS the diagnosis of the real-world mechanism; the synthetic spec is the
 * deterministic CI-safe repro of the underlying MUGA behaviour.
 *
 * Run with:
 *   MUGA_LIVE_TESTS=1 npx playwright test tests/e2e/rt-comments-repro-live.spec.mjs
 */

import { test, expect } from "./fixtures.mjs";
import { waitForDnrPropagation } from "./helpers/index.mjs";

const RT_URL = "https://www.rt.com/news/642594-germany-rt-ban-censorship/";
const RT_HOST = "www.rt.com";

async function setPrefs(context, extensionId, { whitelist } = {}) {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/popup/popup.html`);
  await page.evaluate(
    (wl) =>
      new Promise((resolve) => {
        const syncPrefs = { enabled: true, onboardingDone: true };
        if (wl) syncPrefs.whitelist = wl;
        chrome.storage.sync.set(syncPrefs, () => {
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
        });
      }),
    whitelist ?? null
  );
  await page.close();
  // Prefs broadcast has no observable signal after storage.set resolves.
  // Centralised in waitForDnrPropagation so the debt is greppable (#824).
  await waitForDnrPropagation(page);
}

/**
 * Installs passive instrumentation on an already-loaded live page. Does NOT
 * redefine window.name via Object.defineProperty - the window-name-defuser
 * main-world script may have already installed its own accessor there by
 * the time this runs (after page load), and clobbering it with our own
 * descriptor would silently disable the very mechanism we are trying to
 * observe. Instead we take passive checkpoint reads of window.name and log
 * pushState/replaceState calls by wrapping whatever function is CURRENTLY
 * installed (MUGA's wrap or the native one) - our wrapper chains on top
 * without removing anything underneath.
 */
async function instrumentPage(page) {
  await page.evaluate(() => {
    window.__liveLog = [];

    const origPush = history.pushState.bind(history);
    const origReplace = history.replaceState.bind(history);
    history.pushState = function (...args) {
      window.__liveLog.push({ type: "pushState", args: args.map(String) });
      return origPush(...args);
    };
    history.replaceState = function (...args) {
      window.__liveLog.push({ type: "replaceState", args: args.map(String) });
      return origReplace(...args);
    };

    window.addEventListener("message", (e) => {
      window.__liveLog.push({ type: "message", origin: e.origin });
    });

    try {
      const mo = new MutationObserver((records) => {
        for (const r of records) {
          if (r.type === "attributes" && r.attributeName === "href") {
            let href = null;
            try {
              href = r.target.getAttribute("href");
            } catch {
              /* detached */
            }
            window.__liveLog.push({ type: "href-mutation", href });
          }
        }
      });
      mo.observe(document.documentElement, {
        subtree: true,
        attributes: true,
        attributeFilter: ["href"],
      });
      window.__liveMo = mo;
    } catch {
      /* MutationObserver unavailable - skip */
    }
  });
}

/**
 * Inspects the DOM for the likely comment trigger and any iframes that
 * might host a third-party comment widget (Disqus-shaped embeds are the
 * most common pattern on news sites). Returns a plain-object summary; does
 * not throw.
 */
async function inspectCommentMechanism(page) {
  return page.evaluate(() => {
    const iframes = Array.from(document.querySelectorAll("iframe")).map((f) => ({
      src: f.src || null,
      id: f.id || null,
    }));

    const candidates = Array.from(document.querySelectorAll("a, button, [role='button']")).filter((el) => {
      const text = (el.textContent || "").toLowerCase();
      const id = (el.id || "").toLowerCase();
      const cls = (el.className && el.className.toString ? el.className.toString() : "").toLowerCase();
      return (
        text.includes("comment") ||
        id.includes("comment") ||
        cls.includes("comment") ||
        id.includes("disqus") ||
        cls.includes("disqus")
      );
    });

    return {
      iframeCount: iframes.length,
      iframes: iframes.slice(0, 10),
      candidateCount: candidates.length,
      candidates: candidates.slice(0, 10).map((el) => ({
        tag: el.tagName,
        id: el.id || null,
        text: (el.textContent || "").trim().slice(0, 60),
        href: el.getAttribute ? el.getAttribute("href") : null,
      })),
    };
  });
}

test.describe("rt.com comment-load LIVE repro (#1006)", () => {
  test.skip(!process.env.MUGA_LIVE_TESTS, "live");

  test("real rt.com article: instrument and locate the comment mechanism, ACTIVE vs INERT", async ({
    context,
    extensionId,
  }) => {
    // ── ACTIVE pass ──────────────────────────────────────────────────────
    await setPrefs(context, extensionId);

    const activePage = await context.newPage();
    let navigated = true;
    try {
      await activePage.goto(RT_URL, { timeout: 45000, waitUntil: "domcontentloaded" });
    } catch (e) {
      navigated = false;
      console.log(`[LIVE] navigation to rt.com failed: ${e.message}. Network likely unreachable in this sandbox.`);
    }

    if (!navigated) {
      await activePage.close();
      test.skip(true, "rt.com unreachable from this sandbox - see [LIVE] log above");
      return;
    }

    await instrumentPage(activePage);
    const mechanism = await inspectCommentMechanism(activePage);
    console.log(`[LIVE] DOM inspection (ACTIVE): iframes=${mechanism.iframeCount} candidates=${mechanism.candidateCount}`);
    console.log(`[LIVE] iframes: ${JSON.stringify(mechanism.iframes)}`);
    console.log(`[LIVE] candidate trigger elements: ${JSON.stringify(mechanism.candidates)}`);

    let activeClicked = false;
    if (mechanism.candidateCount > 0) {
      const first = mechanism.candidates[0];
      try {
        if (first.id) {
          await activePage.locator(`#${first.id}`).first().click({ timeout: 5000 });
          activeClicked = true;
        }
      } catch (e) {
        console.log(`[LIVE] click on candidate trigger failed: ${e.message}`);
      }
    }

    // REASON: no "widget settled" signal exists for an unknown third-party
    // comment mechanism - give async handlers a window to fire (#1006 live probe).
    await activePage.waitForTimeout(2000);

    const activeLog = await activePage.evaluate(() => window.__liveLog);
    const activeNameAfter = await activePage.evaluate(() => window.name);
    console.log(`[LIVE] ACTIVE clicked=${activeClicked} log=${JSON.stringify(activeLog)}`);
    console.log(`[LIVE] ACTIVE window.name after interaction: ${JSON.stringify(activeNameAfter)}`);
    await activePage.close();

    // ── INERT pass (#1011 whitelist escape hatch) ───────────────────────
    await setPrefs(context, extensionId, { whitelist: [RT_HOST] });

    const inertPage = await context.newPage();
    try {
      await inertPage.goto(RT_URL, { timeout: 45000, waitUntil: "domcontentloaded" });
    } catch (e) {
      console.log(`[LIVE] second navigation to rt.com failed: ${e.message}.`);
      await inertPage.close();
      test.skip(true, "rt.com unreachable on second pass - see [LIVE] log above");
      return;
    }

    await instrumentPage(inertPage);
    const inertMechanism = await inspectCommentMechanism(inertPage);
    console.log(
      `[LIVE] DOM inspection (INERT): iframes=${inertMechanism.iframeCount} candidates=${inertMechanism.candidateCount}`
    );

    let inertClicked = false;
    if (inertMechanism.candidateCount > 0) {
      const first = inertMechanism.candidates[0];
      try {
        if (first.id) {
          await inertPage.locator(`#${first.id}`).first().click({ timeout: 5000 });
          inertClicked = true;
        }
      } catch (e) {
        console.log(`[LIVE] click on candidate trigger failed (INERT): ${e.message}`);
      }
    }

    // REASON: same rationale as the ACTIVE pass above - no deterministic
    // "widget settled" signal for an unknown third-party mechanism.
    await inertPage.waitForTimeout(2000);

    const inertLog = await inertPage.evaluate(() => window.__liveLog);
    const inertNameAfter = await inertPage.evaluate(() => window.name);
    console.log(`[LIVE] INERT clicked=${inertClicked} log=${JSON.stringify(inertLog)}`);
    console.log(`[LIVE] INERT window.name after interaction: ${JSON.stringify(inertNameAfter)}`);
    console.log(
      `[LIVE] DELTA: ACTIVE log entries=${activeLog.length} INERT log entries=${inertLog.length} - compare the two [LIVE] log lines above to see what MUGA changed on the real page.`
    );

    await inertPage.close();

    // This spec is diagnostic, not a pass/fail gate - it always "passes" if
    // it got this far (navigation succeeded); the value is in the [LIVE]
    // log lines above.
    expect(navigated).toBe(true);
  });
});
