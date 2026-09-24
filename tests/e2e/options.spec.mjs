/**
 * E2E: Options page
 *
 * Tests settings toggles, blacklist/whitelist management,
 * language switcher, export/import, and dev tools.
 *
 * NOTE: All toggle checkboxes are visually hidden by custom CSS
 * (.toggle input is opacity:0, position:absolute). We use
 * page.evaluate() to toggle them and check their state, or click
 * the parent label.
 */

import { test, expect } from "./fixtures.mjs";
import { seedStorage } from "./helpers/storage.mjs";

/** Helper: toggle a checkbox by evaluating in page context. */
async function setCheckbox(page, id, checked) {
  await page.evaluate(
    ({ id, checked }) => {
      const el = document.getElementById(id);
      if (el.checked !== checked) {
        el.click();
      }
    },
    { id, checked }
  );
  // Wait for the checkbox state to reflect the requested value
  await expect(page.locator(`#${id}`)).toBeChecked({ checked });
}

test.describe("Options — toggles", () => {
  test("all main toggles render and respond to clicks", async ({ optionsPage: page }) => {
    const toggles = [
      { id: "notify", default: false },
      { id: "strip-affiliates", default: false },
      { id: "context-menu-toggle", default: true },
    ];

    for (const { id, default: def } of toggles) {
      const el = page.locator(`#${id}`);
      await expect(el).toBeAttached();

      if (def) {
        await expect(el).toBeChecked();
      } else {
        await expect(el).not.toBeChecked();
      }

      // Toggle it
      await setCheckbox(page, id, !def);
      if (def) {
        await expect(el).not.toBeChecked();
      } else {
        await expect(el).toBeChecked();
      }

      // Restore
      await setCheckbox(page, id, def);
    }
  });

  test("toggle changes persist to storage", async ({ optionsPage: page }) => {
    // Enable third-party affiliate stripping
    await setCheckbox(page, "strip-affiliates", true);

    const val = await page.evaluate(() => {
      return new Promise((resolve) => {
        chrome.storage.sync.get({ stripAllAffiliates: false }, (r) =>
          resolve(r.stripAllAffiliates)
        );
      });
    });
    expect(val).toBe(true);

    // Restore
    await setCheckbox(page, "strip-affiliates", false);
  });
});

test.describe("Options — blacklist", () => {
  test("add and remove a blacklist entry", async ({ optionsPage: page }) => {
    const input = page.locator("#bl-input");
    const addBtn = page.locator("#bl-add-btn");
    const list = page.locator("#blacklist-items");

    // Add
    await input.fill("example.com");
    await addBtn.click();

    // Entry appears in list (expect auto-waits for DOM update)
    await expect(list).toContainText("example.com");

    // Remove (click the × button)
    const removeBtn = list.locator("button").first();
    await removeBtn.click();

    // Entry is gone (expect auto-waits)
    await expect(list).not.toContainText("example.com");
  });

  test("rejects empty input", async ({ optionsPage: page }) => {
    const input = page.locator("#bl-input");
    const addBtn = page.locator("#bl-add-btn");

    await input.fill("");
    await addBtn.click();

    // No entry added
    const items = page.locator("#blacklist-items .list-item");
    const initialCount = await items.count();
    await addBtn.click();
    await expect(items).toHaveCount(initialCount);
  });
});

test.describe("Options — whitelist", () => {
  test("add and remove a whitelist entry", async ({ optionsPage: page }) => {
    const input = page.locator("#wl-input");
    const addBtn = page.locator("#wl-add-btn");
    const list = page.locator("#whitelist-items");

    await input.fill("mysite.org::tag::partner-01");
    await addBtn.click();

    // expect auto-waits for DOM update
    await expect(list).toContainText("mysite.org");

    const removeBtn = list.locator("button").first();
    await removeBtn.click();

    // expect auto-waits
    await expect(list).not.toContainText("mysite.org");
  });
});

test.describe("Options — language", () => {
  test("language selector covers every SUPPORTED_LANGS entry", async ({ optionsPage: page }) => {
    // #707: options are populated at init from SUPPORTED_LANGS (en/es/pt/de/fr/it/ja).
    // Test asserts the picker is fully data-driven — a new locale added to
    // i18n.js lights up here automatically.
    const options = page.locator("#lang-select option");
    await expect(options).toHaveCount(7);
    const codes = await options.evaluateAll((els) => els.map((e) => e.value));
    expect(codes).toEqual(["en", "es", "pt", "de", "fr", "it", "ja"]);
  });

  test("switching language updates UI text", async ({ optionsPage: page }) => {
    const select = page.locator("#lang-select");
    const title = page.locator("h1");

    // Switch to Spanish (toHaveText auto-waits for the text to change)
    await select.selectOption("es");
    await expect(title).toHaveText("Ajustes");

    // Switch to Portuguese
    await select.selectOption("pt");
    await expect(title).toHaveText("Configurações");

    // Switch to German
    await select.selectOption("de");
    await expect(title).toHaveText("Einstellungen");

    // Back to English
    await select.selectOption("en");
    await expect(title).toHaveText("Settings");
  });
});

test.describe("Options — advanced settings", () => {
  test("Advanced settings panel is hidden by default and shown when toggled", async ({ optionsPage: page }) => {
    const devToolsCard = page.locator("#dev-tools-card");
    await expect(devToolsCard).toBeHidden();

    // Enable advanced mode via evaluate (checkbox hidden by CSS)
    await setCheckbox(page, "dev-mode", true);
    await expect(devToolsCard).toBeVisible();

    // Disable again
    await setCheckbox(page, "dev-mode", false);
    await expect(devToolsCard).toBeHidden();
  });

  test("advanced toggles are visible when dev mode is on", async ({ optionsPage: page }) => {
    await setCheckbox(page, "dev-mode", true);

    const advancedToggles = ["block-pings", "amp-redirect", "unwrap-redirects"];
    for (const id of advancedToggles) {
      await expect(page.locator(`#${id}`)).toBeAttached();
      await expect(page.locator(`#${id}`)).toBeChecked();
    }

    await setCheckbox(page, "dev-mode", false);
  });

  // #1355: dnrEnabled's control was removed entirely (ADR-0011
  // internal-with-a-default) — no checkbox anywhere, not even gated behind
  // Advanced or Developer tools. The pref stays internal with a default.
  test("dnr-enabled has no control anywhere (#1355)", async ({ optionsPage: page }) => {
    await setCheckbox(page, "dev-mode", true);
    await expect(page.locator("#dnr-enabled")).toHaveCount(0);
    await setCheckbox(page, "dev-mode", false);
  });
});

test.describe("Options — developer tools (#1271 item 1)", () => {
  test("Developer tools panel is hidden by default and shown when toggled, independently of Advanced", async ({ optionsPage: page }) => {
    const devToolsCard = page.locator("#dev-tools-card");
    const devToolsPanel = page.locator("#dev-tools-panel");
    await expect(devToolsPanel).toBeHidden();

    // Turning Advanced on must not reveal the QA panel: the two gates are
    // separate, device-local flags now, not one toggle controlling both.
    await setCheckbox(page, "dev-mode", true);
    await expect(devToolsPanel).toBeHidden();
    await setCheckbox(page, "dev-mode", false);

    // Turning the QA gate on must not reveal Advanced.
    await setCheckbox(page, "dev-tools-mode", true);
    await expect(devToolsPanel).toBeVisible();
    await expect(devToolsCard).toBeHidden();

    await setCheckbox(page, "dev-tools-mode", false);
    await expect(devToolsPanel).toBeHidden();
  });

  // #1355: canonicalExtractorEnabled and experimentalParamClassesEnabled
  // moved from the dev-mode-gated Advanced card into this devToolsMode-gated
  // panel. Still real, exported prefs — only the location changed.
  //
  // NOTE: toggle <input>s are always opacity:0 by design (custom slider
  // CSS — see the file header), so toBeVisible() on the checkbox itself is
  // never true. Assert attachment/checked-ness on the input, and visibility
  // on the containing #dev-tools-panel, matching the pattern the rest of
  // this file already uses for gated toggles.
  test("canonical-extractor and experimental-param-classes live in Developer tools, not Advanced", async ({ optionsPage: page }) => {
    // #1355 R3-004: the moved inputs are always opacity:0 + width:0/height:0
    // (empty bounding box, see the file header note) — toBeHidden() on the
    // checkbox itself would be trivially true whether dev tools mode is on
    // or off, proving nothing. The real signal is the containing
    // #dev-tools-panel's own visibility, which the CSS class toggle
    // (dev-tools-hidden) actually gates.
    await expect(page.locator("#dev-tools-panel")).toBeHidden();

    await setCheckbox(page, "dev-mode", true);
    await expect(page.locator("#dev-tools-card #canonical-extractor")).toHaveCount(0);
    await expect(page.locator("#dev-tools-card #experimental-param-classes")).toHaveCount(0);
    await setCheckbox(page, "dev-mode", false);

    await setCheckbox(page, "dev-tools-mode", true);
    await expect(page.locator("#dev-tools-panel")).toBeVisible();
    await expect(page.locator("#canonical-extractor")).toBeAttached();
    await expect(page.locator("#canonical-extractor")).toBeChecked();
    await expect(page.locator("#experimental-param-classes")).toBeAttached();

    await setCheckbox(page, "dev-tools-mode", false);
    await expect(page.locator("#dev-tools-panel")).toBeHidden();
  });

  test("URL tester produces a clean result", async ({ optionsPage: page }) => {
    // The developer tools have their own gate now (#1271 item 1): reaching a
    // real Advanced setting no longer hands the user a panel that can replay
    // onboarding. This toggle is separate from dev-mode.
    await setCheckbox(page, "dev-tools-mode", true);

    const input = page.locator("#dev-url-input");
    const testBtn = page.locator("#dev-url-test-btn");
    const result = page.locator("#dev-url-result");
    const cleanUrl = page.locator("#dev-url-clean");

    await input.scrollIntoViewIfNeeded();
    await input.fill("https://example.com?utm_source=test&utm_medium=email&fbclid=abc123");
    await testBtn.click();

    // toBeVisible auto-waits for the result card to appear
    await expect(result).toBeVisible();
    const text = await cleanUrl.textContent();
    // URL constructor normalizes: example.com -> example.com/
    expect(text).toMatch(/^https:\/\/example\.com\/?$/);

    await setCheckbox(page, "dev-tools-mode", false);
  });
});

test.describe("Options — Aggressive privacy nudge (referer-beacon-privacy PR 4, D5, task 4.9)", () => {
  test("checking strip-affiliates reveals the nudge and does NOT flip suppressReferer/blockBeacons", async ({ optionsPage: page }) => {
    const nudge = page.locator("#strip-affiliates-nudge");
    await expect(nudge).toBeHidden();

    await setCheckbox(page, "strip-affiliates", true);
    await expect(nudge).toBeVisible();

    // D5: the nudge NEVER auto-enables the two new prefs — checkbox state
    // AND the persisted storage value must both remain false.
    await expect(page.locator("#suppress-referer")).not.toBeChecked();
    await expect(page.locator("#block-beacons")).not.toBeChecked();
    const stored = await page.evaluate(
      () =>
        new Promise((resolve) =>
          chrome.storage.sync.get({ suppressReferer: false, blockBeacons: false }, resolve)
        )
    );
    expect(stored.suppressReferer).toBe(false);
    expect(stored.blockBeacons).toBe(false);
  });

  test("unchecking strip-affiliates does not reveal the nudge (only the checked transition does)", async ({ optionsPage: page }) => {
    const nudge = page.locator("#strip-affiliates-nudge");
    await setCheckbox(page, "strip-affiliates", true);
    await expect(nudge).toBeVisible();

    await setCheckbox(page, "strip-affiliates", false);
    // The nudge stays as last revealed (no auto-hide on uncheck) — assert the
    // regression this guards against: unchecking must never THROW or flip
    // suppressReferer/blockBeacons either.
    await expect(page.locator("#suppress-referer")).not.toBeChecked();
    await expect(page.locator("#block-beacons")).not.toBeChecked();
  });

  test("dismissing the nudge persists the dismissal across a reload", async ({ optionsPage: page }) => {
    await setCheckbox(page, "strip-affiliates", true);
    const nudge = page.locator("#strip-affiliates-nudge");
    await expect(nudge).toBeVisible();

    await page.locator("#nudge-aggressive-privacy-dismiss").click();
    await expect(nudge).toBeHidden();

    await page.reload();
    await page.waitForFunction(() => document.body.dataset.mugaReady === "1");

    // Re-trigger the checked TRANSITION (off then on) after reload — the
    // persisted dismissal must suppress the nudge even for a fresh transition.
    await setCheckbox(page, "strip-affiliates", false);
    await setCheckbox(page, "strip-affiliates", true);
    await expect(page.locator("#strip-affiliates-nudge")).toBeHidden();
  });
});

test.describe("Options — blocklist migration notice (referer-beacon-privacy PR 4, D2/D6, task 4.10)", () => {
  test("does NOT appear for a user with an empty blocklist", async ({ optionsPage: page }) => {
    await expect(page.locator("#blocklist-migration-notice")).toBeHidden();
  });

  test("appears for a pre-existing non-empty blocklist, exactly once across reloads", async ({ optionsPage: page, context, extensionId }) => {
    await seedStorage(context, extensionId, { sync: { blacklist: ["example.com"] } });
    await page.reload();
    await page.waitForFunction(() => document.body.dataset.mugaReady === "1");

    const notice = page.locator("#blocklist-migration-notice");
    await expect(notice).toBeVisible();

    // Fires EXACTLY once: a second reload with the same non-empty blocklist
    // must NOT show it again (the stored flag was set the moment it was shown).
    await page.reload();
    await page.waitForFunction(() => document.body.dataset.mugaReady === "1");
    await expect(page.locator("#blocklist-migration-notice")).toBeHidden();
  });

  test("dismiss button hides the notice immediately", async ({ optionsPage: page, context, extensionId }) => {
    await seedStorage(context, extensionId, { sync: { blacklist: ["example.com"] } });
    await page.reload();
    await page.waitForFunction(() => document.body.dataset.mugaReady === "1");

    const notice = page.locator("#blocklist-migration-notice");
    await expect(notice).toBeVisible();
    await page.locator("#blocklist-migration-notice-dismiss").click();
    await expect(notice).toBeHidden();
  });
});

test.describe("Options — version", () => {
  test("version number is displayed at the bottom", async ({ optionsPage: page }) => {
    const version = page.locator("#version-number");
    await expect(version).toBeAttached();
    await expect(version).not.toHaveText("", { timeout: 5000 });
    const text = await version.textContent();
    expect(text).toMatch(/^\d+\.\d+\.\d+$/);
  });
});

test.describe("Options — browsewrap Phase 1: never redirects to onboarding", () => {
  test("Settings renders normally on a fresh install, without visiting onboarding first", async ({ context, extensionId }) => {
    // Fresh install: the service worker's implicit-accept-on-install already
    // wrote onboardingDone:true before this test runs. Options must render
    // its normal UI directly — no redirect to onboarding/onboarding.html.
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/options/options.html`);
    await page.waitForFunction(() => document.body.dataset.mugaReady === "1");

    expect(page.url()).toContain("/options/options.html");
    expect(page.url()).not.toContain("/onboarding/");
    await page.close();
  });
});

test.describe("Options — unified Activity ledger panel (#1352)", () => {
  test("the scope radio switches the visible sub-panel, including after a bfcache-style restore where the checked radio disagrees with in-memory state (R3-radio-state-desync)", async ({ optionsPage: page }) => {
    const sessionPanel = page.locator("#activity-session-panel");
    const recentPanel = page.locator("#activity-recent-panel");

    // Baseline: default scope is "session".
    await expect(sessionPanel).toBeVisible();
    await expect(recentPanel).toBeHidden();

    // An ordinary click flips the visible sub-panel via the change listener.
    await page.locator("#activity-scope-recent").check();
    await expect(recentPanel).toBeVisible();
    await expect(sessionPanel).toBeHidden();

    await page.locator("#activity-scope-session").check();
    await expect(sessionPanel).toBeVisible();
    await expect(recentPanel).toBeHidden();

    // R3-radio-state-desync: some browsers (Firefox bfcache/form-restore)
    // can flip a radio's `checked` DOM property WITHOUT firing a "change"
    // event — e.g. restoring form state on a back-forward navigation. Set
    // the "recent" radio checked directly (bypassing our change listener)
    // to simulate that, then dispatch a real pageshow(persisted:true),
    // which is the signal a bfcache restore fires. The fix must resync the
    // visible panel from whichever radio is ACTUALLY checked.
    await page.evaluate(() => {
      const recentRadio = document.getElementById("activity-scope-recent");
      recentRadio.checked = true; // no change event dispatched, deliberately
      // PageTransitionEvent isn't declared in this file's eslint globals
      // (it's Playwright-evaluated browser code, not Node) — a plain Event
      // with `persisted` set manually is observably identical to our
      // pageshow listener, which only reads `e.persisted`.
      const evt = new Event("pageshow");
      evt.persisted = true;
      window.dispatchEvent(evt);
    });
    await expect(recentPanel).toBeVisible();
    await expect(sessionPanel).toBeHidden();
  });

  test("keyboard Enter on an inner copy button activates the button, not the whole row (R3-keydown-hijacks-inner-controls)", async ({ optionsPage: page }) => {
    // Seed one well-formed "This session" history entry so the row exists.
    await page.evaluate(() => new Promise((resolve) => {
      chrome.storage.session.set({
        history: [{ original: "https://example.com/?utm_source=x", clean: "https://example.com/", ts: Date.now(), removedTracking: [] }],
      }, resolve);
    }));
    await page.reload();
    await page.waitForFunction(() => document.body.dataset.mugaReady === "1");

    const row = page.locator("#activity-session-list .history-entry").first();
    await expect(row).toBeVisible();
    const copyOrigBtn = row.locator(".history-copy-btn");
    const originalLabel = await copyOrigBtn.textContent();

    await copyOrigBtn.focus();
    await page.keyboard.press("Enter");

    // Fixed behavior: the button's OWN click handler ran (its label
    // changes to the translated "Copied!" state) and the ROW's own
    // reprocess-and-copy action did NOT also fire.
    await expect(copyOrigBtn).not.toHaveText(originalLabel);
    await expect(row).not.toHaveClass(/copied/);
  });

  test("corrupt Recent-activity ledger data does not abort Settings init — degrades to the empty state (R3-init-abort-on-render-throw)", async ({ optionsPage: page, context, extensionId }) => {
    // Legacy/corrupt shapes: a non-object event and a non-array events list
    // both previously reached ledger.events.map()/entryFor() unguarded and
    // threw, aborting the REST of options.js's init() (everything queued
    // after the awaited renderActivityLedgerPanel call never ran, so
    // document.body.dataset.mugaReady was never set).
    await seedStorage(context, extensionId, {
      local: { attributionLedger: { events: [null, { type: "clean" }, "garbage"], capacity: 10 } },
    });
    await page.reload();
    await page.waitForFunction(() => document.body.dataset.mugaReady === "1", null, { timeout: 5000 });

    // Init completed (the flag above proves it), and something wired up
    // AFTER the Activity panel in init() actually ran too.
    await expect(page.locator("#show-badge")).toBeAttached();

    await page.locator("#activity-scope-recent").check();
    await expect(page.locator("#activity-recent-empty")).toBeVisible();
    await expect(page.locator("#activity-recent-list")).toBeEmpty();
  });
});

test.describe("Options — attribution-ledger toggle race (audit b5-3, part 1)", () => {
  test("turning Recent activity off renders the disabled empty state immediately, without waiting for the pref write to land", async ({ optionsPage: page, context, extensionId }) => {
    // Seed one Recent-activity entry so the panel starts with real rows —
    // if the fix regresses, the list would still show these instead of the
    // disabled empty state.
    await seedStorage(context, extensionId, {
      local: { attributionLedger: { events: [{ type: "clean", url: "https://example.com/?utm_source=x" }], capacity: 50 } },
    });
    await page.reload();
    await page.waitForFunction(() => document.body.dataset.mugaReady === "1");

    await page.locator("#activity-scope-recent").check();
    await expect(page.locator("#activity-recent-list .recent-activity-row")).toHaveCount(1);

    // The bug: renderActivityLedgerPanel decided enabled/disabled by
    // re-reading getPrefs() from chrome.storage.sync, racing the toggle's
    // own bindToggle() write to that same storage. Delay the underlying
    // sync write so the read-back is provably still stale at the moment
    // the panel re-renders — the fix must use the in-memory toggle value
    // instead of depending on the write's timing.
    await page.evaluate(() => {
      const real = chrome.storage.sync.set.bind(chrome.storage.sync);
      chrome.storage.sync.set = (items, cb) => setTimeout(() => real(items, cb), 300);
    });

    await setCheckbox(page, "attribution-ledger", false);

    // Assert well before the delayed write (300ms) could possibly land.
    await expect(page.locator("#activity-recent-empty")).toBeVisible({ timeout: 150 });
    await expect(page.locator("#activity-recent-empty")).toHaveText(/turned off/i);
    await expect(page.locator("#activity-recent-list")).toBeEmpty();
  });
});