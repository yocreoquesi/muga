/**
 * MUGA — the preview surfaces answer the same question as the navigation (#1255)
 *
 * The popup preview and the Settings URL tester exist to show the user what
 * MUGA is about to do. Both called processUrl with a hand-assembled argument
 * list that left rules out: popup omitted the path rules, options omitted the
 * path rules AND the referrer. So each could display a result the extension
 * would not produce, which for a product whose stated identity is transparency
 * is the worst place for the divergence.
 *
 * Both carried a comment calling it deliberate -- "accepted regression per
 * declarative-path-rules design §7". That document is not in the repository,
 * and `git log -S` over the markdown history does not find it ever having
 * been: the only carriers of the phrase were the two comments themselves. A
 * trade-off nobody can read is not one anybody can check.
 *
 * The parity test below is the check that was missing. It is deliberately
 * built on a URL that needs BOTH a path rule and a domain rule, because those
 * are exactly the two the previews were dropping.
 *
 * Run with: npm test
 */

import { describe, test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import {
  loadCleaningContext,
  cleanForPreview,
  resetCleaningContextCache,
} from "../../src/lib/cleaning-context.js";
import { processUrl } from "../../src/lib/cleaner.js";
import { PREF_DEFAULTS } from "../../src/lib/prefs.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const readRule = (f) => readFileSync(join(ROOT, "src/rules", f), "utf8");

/** Serves the real shipped rule files, standing in for chrome.runtime.getURL. */
function realRuleLoader({ fail = [] } = {}) {
  const bodies = {
    "rules/domain-rules.json": readRule("domain-rules.json"),
    "rules/path-strip-rules.json": readRule("path-strip-rules.json"),
    "rules/path-affiliate-rules.json": readRule("path-affiliate-rules.json"),
  };
  globalThis.fetch = async (url) => {
    if (fail.includes(url)) throw new Error("simulated fetch failure");
    return { ok: true, json: async () => JSON.parse(bodies[url]) };
  };
  return (p) => p;
}

beforeEach(() => {
  resetCleaningContextCache();
});

// ── Loading ───────────────────────────────────────────────────────────────────

describe("loadCleaningContext", () => {
  test("loads all three rule sets, not just the domain rules", async () => {
    const resolveUrl = realRuleLoader();
    const ctx = await loadCleaningContext({ resolveUrl });

    assert.ok(ctx.domainRules.length > 0, "domain rules must load");
    assert.ok(ctx.pathStripRules.length > 0,
      "path-strip rules must load -- these are what the popup was dropping");
    assert.ok(Array.isArray(ctx.pathAffiliateRules), "path-affiliate rules must load");
  });

  test("caches for the life of the page", async () => {
    const resolveUrl = realRuleLoader();
    let calls = 0;
    const inner = globalThis.fetch;
    globalThis.fetch = (...args) => { calls++; return inner(...args); };

    await loadCleaningContext({ resolveUrl });
    const after = calls;
    await loadCleaningContext({ resolveUrl });

    assert.strictEqual(calls, after, "a second call must not refetch the packaged rule files");
  });

  test("one unreadable file costs only that file", async () => {
    const resolveUrl = realRuleLoader({ fail: ["rules/path-affiliate-rules.json"] });
    const ctx = await loadCleaningContext({ resolveUrl });

    assert.deepStrictEqual(ctx.pathAffiliateRules, []);
    assert.ok(ctx.domainRules.length > 0,
      "a preview missing one rule set is better than a preview missing all of them");
    assert.ok(ctx.pathStripRules.length > 0);
  });
});

// ── Parity with the navigation path ───────────────────────────────────────────

describe("cleanForPreview matches what the extension actually produces (#1255)", () => {
  // Needs BOTH: `/dp/<ASIN>` behind an SEO slug is a PATH rule, and `aref` is
  // in amazon.com's stripParams, a DOMAIN rule. The old popup call had the
  // domain rules and not the path rules; the old options call had neither.
  const DIRTY =
    "https://www.amazon.com/Some-Product-Name-Slug/dp/B0XYZ12345?aref=abc&utm_source=news";

  test("the preview result equals the full-context result, byte for byte", async () => {
    const resolveUrl = realRuleLoader();
    const ctx = await loadCleaningContext({ resolveUrl });
    const prefs = { ...PREF_DEFAULTS, onboardingDone: true };

    const preview = cleanForPreview(DIRTY, prefs, ctx, { referrer: "" });

    // The shape the service worker uses (service-worker.js handleProcessUrl).
    const navigation = processUrl(
      DIRTY,
      { ...prefs, notifyForeignAffiliate: false },
      ctx.domainRules,
      undefined,
      undefined,
      "",
      ctx.pathStripRules,
      ctx.pathAffiliateRules,
    );

    assert.strictEqual(
      preview.cleanUrl,
      navigation.cleanUrl,
      "a preview that disagrees with the navigation is worse than no preview"
    );
  });

  test("dropping the path rules really does change the answer", async () => {
    // Guards the test above from becoming vacuous. If the previews' omission
    // had made no difference, there would have been nothing to fix, and this
    // is the assertion that says otherwise in the code rather than in prose.
    const resolveUrl = realRuleLoader();
    const ctx = await loadCleaningContext({ resolveUrl });
    const prefs = { ...PREF_DEFAULTS, onboardingDone: true };

    const complete = cleanForPreview(DIRTY, prefs, ctx, { referrer: "" });
    const asPopupWas = cleanForPreview(
      DIRTY, prefs, { ...ctx, pathStripRules: [], pathAffiliateRules: [] }, { referrer: "" }
    );

    assert.notStrictEqual(
      complete.cleanUrl,
      asPopupWas.cleanUrl,
      "the SEO slug survives without the path rules, so the old preview showed a URL " +
        "the extension would never produce"
    );
    assert.ok(
      !complete.cleanUrl.includes("Some-Product-Name-Slug"),
      "with the path rules the slug is gone"
    );
    assert.ok(
      asPopupWas.cleanUrl.includes("Some-Product-Name-Slug"),
      "without them it is not"
    );
  });

  test("a domain-scoped strip param is removed either way", async () => {
    // The half the popup DID have. Pinned so a future refactor cannot trade
    // one omission for another.
    const resolveUrl = realRuleLoader();
    const ctx = await loadCleaningContext({ resolveUrl });
    const prefs = { ...PREF_DEFAULTS, onboardingDone: true };

    const result = cleanForPreview(DIRTY, prefs, ctx, { referrer: "" });
    assert.ok(!result.cleanUrl.includes("aref="), "aref is in amazon.com's stripParams");
    assert.ok(!result.cleanUrl.includes("utm_source="), "utm_source is a universal tracker");
  });

  test("the toast is suppressed for every preview, without the caller saying so", async () => {
    // Both call sites used to spread `notifyForeignAffiliate: false` in by
    // hand. That worked only while everyone remembered it; a preview firing
    // the foreign-affiliate toast would be MUGA reporting a navigation that
    // never happened.
    const resolveUrl = realRuleLoader();
    const ctx = await loadCleaningContext({ resolveUrl });

    const result = cleanForPreview(
      DIRTY,
      { ...PREF_DEFAULTS, onboardingDone: true, notifyForeignAffiliate: true },
      ctx,
      { referrer: "" }
    );
    assert.ok(result, "the call must still produce a result with the override forced off");
    assert.strictEqual(result.notifyForeignAffiliate, undefined,
      "processUrl must not report a foreign-affiliate notification for a preview");
  });
});
