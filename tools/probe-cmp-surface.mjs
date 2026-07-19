/**
 * MUGA maintainer probe — CMP reject-API surface drift check (#1129 follow-up)
 *
 * The nightly canary (tests/canary/cmp-canary.spec.mjs) needs a real banner to
 * RENDER before it can prove MUGA dismisses it — and banners are geo-gated, so
 * from a non-EU vantage most land "inconclusive". This probe covers the OTHER,
 * higher-frequency drift risk that does NOT need the banner: a vendor renaming
 * or removing the reject method our adapter calls (e.g. Cookiebot dropping
 * `submitCustomConsent`). The vendor SDK loads and exposes its globals
 * regardless of the consent-banner geo gate, so this check yields a real
 * signal from ANY vantage.
 *
 * It is a MAINTAINER probe, NOT a CI gate (mirrors tools/probe-shortener-
 * redirect.mjs): real sites are flaky, add bot-protection, and change. Run it
 * on demand to confirm each adapter's reject-API surface still exists live:
 *
 *   node tools/probe-cmp-surface.mjs            # human-readable table
 *   node tools/probe-cmp-surface.mjs --json     # machine-readable JSON
 *
 * What it does NOT prove (still needs a real EU-vantage banner run — see
 * docs/qa/cookie-consent-release-smoke.md): that calling the method actually
 * DISMISSES the live banner. This only proves the method still EXISTS to call.
 * Requires `playwright` (a devDependency) with Chromium installed.
 *
 * The per-adapter (detection global, reject method) pairs below are the exact
 * surfaces src/lib/cmp-adapters.js keys on; the candidate sites are the real
 * customer deployments already curated in tests/canary/cmp-sites.json.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SITES = JSON.parse(readFileSync(join(__dirname, "../tests/canary/cmp-sites.json"), "utf8"));

// adapterId -> { global: detection global, method: dotted path of the reject
// call } exactly as verified in src/lib/cmp-adapters.js. Sourcepoint and
// consentmanager expose only the generic __tcfapi/__cmp function surface.
const SURFACE = {
  onetrust: { global: "OneTrust", method: "OneTrust.RejectAll" },
  cookiebot: { global: "Cookiebot", method: "Cookiebot.submitCustomConsent" },
  didomi: { global: "Didomi", method: "Didomi.setUserDisagreeToAll" },
  cookieyes: { global: "performBannerAction", method: "performBannerAction" },
  sourcepoint: { global: "__tcfapi", method: "__tcfapi" },
  usercentrics: { global: "UC_UI", method: "UC_UI.denyAllConsents" },
  cookieinformation: { global: "CookieInformation", method: "CookieInformation.declineAllCategories" },
  cookiescript: { global: "CookieScript", method: "CookieScript.instance.rejectAllAction" },
  tarteaucitron: { global: "tarteaucitron", method: "tarteaucitron.userInterface.respondAll" },
  consentmanager: { global: "__cmp", method: "__cmp" },
};

/**
 * Pure reducer: given raw per-site probe records, produce a per-adapter
 * verdict. An adapter is CONFIRMED if ANY of its sites exposed the reject
 * method as a function; GLOBAL_ONLY if a site had the detection global but not
 * the method (possible partial drift); UNCONFIRMED if no site loaded the SDK.
 * Exported for unit testing (tests/unit/probe-cmp-surface.test.mjs).
 *
 * @param {Array<{adapterId:string, methodType?:string, globalType?:string}>} records
 * @returns {Array<{adapterId:string, verdict:"CONFIRMED"|"GLOBAL_ONLY"|"UNCONFIRMED"}>}
 */
export function summarizeSurfaceResults(records) {
  const byAdapter = new Map();
  for (const r of Array.isArray(records) ? records : []) {
    if (!r || typeof r.adapterId !== "string") continue;
    const cur = byAdapter.get(r.adapterId) || { method: false, global: false };
    if (r.methodType === "function") cur.method = true;
    if (typeof r.globalType === "string" && r.globalType !== "undefined") cur.global = true;
    byAdapter.set(r.adapterId, cur);
  }
  const out = [];
  for (const [adapterId, s] of byAdapter) {
    out.push({
      adapterId,
      verdict: s.method ? "CONFIRMED" : s.global ? "GLOBAL_ONLY" : "UNCONFIRMED",
    });
  }
  return out;
}

async function main() {
  const asJson = process.argv.includes("--json");
  const { chromium } = await import("playwright");

  const sitesByAdapter = new Map();
  for (const s of SITES) {
    if (!SURFACE[s.cmp]) continue;
    if (!sitesByAdapter.has(s.cmp)) sitesByAdapter.set(s.cmp, []);
    sitesByAdapter.get(s.cmp).push(s.url);
  }

  const records = [];
  const browser = await chromium.launch({ headless: true });
  try {
    for (const [adapterId, urls] of sitesByAdapter) {
      const { global, method } = SURFACE[adapterId];
      for (const url of urls) {
        const context = await browser.newContext({ locale: "de-DE", timezoneId: "Europe/Berlin" });
        const page = await context.newPage();
        let rec = { adapterId, url, globalType: "undefined", methodType: "undefined", error: null };
        try {
          await page.goto(url, { waitUntil: "domcontentloaded", timeout: 25000 });
          await page.waitForTimeout(6000);
          const r = await page.evaluate(
            ({ g, m }) => {
              const gp = (p) => p.split(".").reduce((o, k) => (o == null ? o : o[k]), window);
              return { globalType: typeof gp(g), methodType: typeof gp(m) };
            },
            { g: global, m: method }
          );
          rec = { adapterId, url, ...r, error: null };
        } catch (e) {
          rec.error = String(e).split("\n")[0].slice(0, 100);
        }
        records.push(rec);
        if (!asJson) {
          const tag = rec.methodType === "function" ? "OK  method present" : rec.error ? "ERR " + rec.error : "--  method absent";
          console.log(`${adapterId.padEnd(17)} ${url.padEnd(30)} global=${String(rec.globalType).padEnd(9)} method=${String(rec.methodType).padEnd(9)} ${tag}`);
        }
        await context.close();
        // Stop at the first site that confirms the method — the rest are only
        // needed as fallbacks when a site is down / bot-blocked / not on the CMP.
        if (rec.methodType === "function") break;
      }
    }
  } finally {
    await browser.close();
  }

  const summary = summarizeSurfaceResults(records);
  if (asJson) {
    console.log(JSON.stringify({ records, summary }, null, 2));
  } else {
    console.log("\nPer-adapter reject-API surface verdict:");
    for (const s of summary) console.log(`  ${s.adapterId.padEnd(17)} ${s.verdict}`);
    const unconfirmed = summary.filter((s) => s.verdict !== "CONFIRMED").map((s) => s.adapterId);
    if (unconfirmed.length) {
      console.log(`\nNOT confirmed from this vantage: ${unconfirmed.join(", ")}`);
      console.log("(a site may be down, bot-protected, or not currently on that CMP — try another customer URL; this is a maintainer signal, not a gate.)");
    }
  }
}

// Only run the browser when invoked directly, so the pure reducer can be
// imported by unit tests without launching Chromium.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
