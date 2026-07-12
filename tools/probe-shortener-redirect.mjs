/**
 * MUGA: Maintainer redirect-behavior probe for shortener-resolver-expansion
 * (Slice 2, design D2).
 *
 * A standalone verification tool for classifying whether a candidate
 * shortener host actually gives a plain HTTP redirect (safe to add to
 * `GENERIC_SHORTENERS` in src/lib/opaque-networks.js) or hides its real
 * destination behind an ad-interstitial, bot check, or dead link.
 *
 * NOT shipped with the extension, NOT imported by any src/ module, and NOT
 * wired into CI — external-host network calls are inherently flaky and
 * outside the extension's static-curated-list contract (see design D2).
 * Run manually by a maintainer when evaluating whether a probable-tier
 * host should graduate to GENERIC_SHORTENERS.
 *
 * Verdicts:
 *   CLEAN         — direct 3xx with a `Location` header pointing off-site.
 *   INTERSTITIAL  — 3xx/200 that lands on a warning/confirmation page
 *                   before the real destination (no direct hop).
 *   AD-GATEWAY    — 200 HTML with a JS/timer redirect instead of a
 *                   `Location` header; matches the AD_GATEWAY_NETWORKS
 *                   pattern documented in opaque-networks.js.
 *   BOT-BLOCKED   — request is challenged (e.g. Cloudflare) before any
 *                   redirect can be observed.
 *   DEAD          — non-3xx, non-200 response, or the fetch fails outright.
 *   UNVERIFIED    — no sample link is configured for this host yet.
 *
 * Run with: node tools/probe-shortener-redirect.mjs
 * Dependency-free: Node built-ins only (global fetch, no third-party libs).
 */

/**
 * Reference dataset from the Slice 2 live probe run (2026-07). Each entry
 * documents the sample short link used, the expected verdict, and (for
 * CLEAN hosts) the real destination hostname the redirect landed on. Kept
 * here so re-running this tool reproduces and documents the verdicts that
 * justified graduating rb.gy, tiny.cc, dlvr.it, ift.tt, and qr.ae to
 * GENERIC_SHORTENERS, and why the rest stayed excluded.
 *
 * @type {Record<string, { sample: string, verdict: string, note: string }>}
 */
export const PROBE_DATASET = Object.freeze({
  "rb.gy": {
    sample: "https://rb.gy/fnvhyq",
    verdict: "CLEAN",
    note: "destination: etsy.com",
  },
  "tiny.cc": {
    sample: "https://tiny.cc/u69qrw",
    verdict: "CLEAN",
    note: "destination: example.com",
  },
  "dlvr.it": {
    sample: "https://dlvr.it/4fy7g9",
    verdict: "CLEAN",
    note: "destination: colorlines.com",
  },
  "ift.tt": {
    sample: "https://ift.tt/1YGmCC5",
    verdict: "CLEAN",
    note: "destination: campuse.ro",
  },
  "qr.ae": {
    sample: "https://qr.ae/7FQS9",
    verdict: "CLEAN",
    note: "destination: quora.com",
  },
  "clck.ru": {
    sample: "https://clck.ru/",
    verdict: "INTERSTITIAL",
    note: "lands on sba.yandex.ru confirmation page before the real destination",
  },
  "vk.cc": {
    sample: "https://vk.cc/",
    verdict: "INTERSTITIAL",
    note: "lands on vkontakte.ru/away.php confirmation page",
  },
  "spr.ly": {
    sample: "https://spr.ly/",
    verdict: "AD-GATEWAY",
    note: "destination is JS-built client-side, no Location header",
  },
  "bit.do": {
    sample: "https://bit.do/",
    verdict: "DEAD",
    note: "no functioning sample link found",
  },
  "t.ly": {
    sample: "https://t.ly/",
    verdict: "BOT-BLOCKED",
    note: "Cloudflare challenge intercepts the request before any redirect",
  },
  "bl.ink": {
    sample: "https://bl.ink/",
    verdict: "UNVERIFIED",
    note: "no off-site sample link available to probe",
  },
});

/**
 * Hosts that already passed a probe and belong to an existing MUGA bucket.
 * Following a redirect hop that lands on one of these MUST stop the chain
 * there (mirrors the resolver's real behavior; see ADR-0003) rather than
 * following further hops, so the probe output doesn't misclassify a
 * legitimate stop-at-affiliate-network hop as a dead end.
 */
const KNOWN_STOP_HOSTS = new Set([]);

/**
 * Classifies a single fetch response into one of the probe's verdicts.
 *
 * @param {Response} response The response of a `redirect: "manual"` fetch.
 * @returns {{ verdict: string, location: string|null }}
 */
export function classifyResponse(response) {
  const status = response.status;
  const location = response.headers.get("location");

  if (status >= 300 && status < 400) {
    if (location) {
      return { verdict: "CLEAN", location };
    }
    return { verdict: "AD-GATEWAY", location: null };
  }

  if (status === 403 || status === 429 || status === 503) {
    return { verdict: "BOT-BLOCKED", location: null };
  }

  if (status === 200) {
    // A 200 with no redirect header means the destination (if any) is
    // rendered client-side — either an interstitial or an ad-gateway.
    // This tool cannot distinguish those without inspecting page content,
    // so callers should treat 200 as INTERSTITIAL-or-worse and confirm
    // manually.
    return { verdict: "INTERSTITIAL", location: null };
  }

  return { verdict: "DEAD", location: null };
}

/**
 * Probes one host's sample short link with a manual-redirect fetch, only
 * following hops while the visited host is still an allowlisted shortener
 * candidate (the dataset key itself). Any hop landing off that host is
 * treated as the resolved destination.
 *
 * @param {string} host Shortener host being probed (dataset key).
 * @param {string} sampleUrl A real short link on that host.
 * @returns {Promise<{ host: string, verdict: string, destination: string|null, error: string|null }>}
 */
export async function probeHost(host, sampleUrl) {
  let currentUrl = sampleUrl;
  const visited = new Set();

  try {
    for (let hop = 0; hop < 5; hop++) {
      if (visited.has(currentUrl)) {
        return { host, verdict: "DEAD", destination: null, error: "redirect loop detected" };
      }
      visited.add(currentUrl);

      const response = await fetch(currentUrl, { redirect: "manual" });
      const { verdict, location } = classifyResponse(response);

      if (verdict !== "CLEAN") {
        return { host, verdict, destination: null, error: null };
      }

      const nextUrl = new URL(location, currentUrl).toString();
      const nextHost = new URL(nextUrl).hostname.replace(/^www\./, "");

      // Stop following hops once we land off the shortener's own host (or
      // on a known allowlisted stop-host) — that is the resolved destination.
      if (nextHost !== host && !KNOWN_STOP_HOSTS.has(nextHost)) {
        return { host, verdict: "CLEAN", destination: nextHost, error: null };
      }

      currentUrl = nextUrl;
    }
    return { host, verdict: "DEAD", destination: null, error: "too many hops without leaving shortener host" };
  } catch (err) {
    return { host, verdict: "DEAD", destination: null, error: err.message };
  }
}

/**
 * Runs the probe against every host in the given dataset (defaults to the
 * built-in reference dataset) and prints a verdict table.
 *
 * @param {Record<string, { sample: string, verdict: string, note: string }>} dataset
 * @returns {Promise<void>}
 */
async function main(dataset = PROBE_DATASET) {
  console.log("[muga] Shortener redirect probe — maintainer verification tool\n");
  console.log(`${"host".padEnd(14)} ${"expected".padEnd(14)} ${"actual".padEnd(14)} note`);
  console.log("-".repeat(70));

  for (const [host, entry] of Object.entries(dataset)) {
    if (entry.verdict === "UNVERIFIED") {
      console.log(`${host.padEnd(14)} ${entry.verdict.padEnd(14)} ${"(skipped)".padEnd(14)} ${entry.note}`);
      continue;
    }

    const result = await probeHost(host, entry.sample);
    const actual = result.destination ? `${result.verdict} (${result.destination})` : result.verdict;
    console.log(`${host.padEnd(14)} ${entry.verdict.padEnd(14)} ${actual.padEnd(14)} ${result.error ?? entry.note}`);
  }
}

if (process.argv[1]?.endsWith("probe-shortener-redirect.mjs")) {
  main();
}
