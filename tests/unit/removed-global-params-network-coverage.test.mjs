/**
 * MUGA — the 16 params #1228 removed from the global strip list stay stripped
 * at the network layer (commit 13f1250)
 *
 * #1228 removed 16 params from TRACKING_PARAMS because each one is already
 * covered per-host in domain-rules.json's `stripParams`. That premise only
 * became true for every host once 13f1250 deleted the `AMAZON_HOST_RE` gate
 * in tools/generate-rules.mjs — before that, a non-Amazon host's `stripParams`
 * entries never reached the generated DNR ruleset, so dropping the global
 * entry would have silently downgraded the param from pre-request DNR
 * stripping to post-load `history.replaceState` (see that gate-removal
 * comment for the full reasoning).
 *
 * This test pins the invariant the gate removal exists to guarantee: for
 * each of the 16 removed params —
 *   (1) it is absent from TRACKING_PARAMS (it must stay removed, not creep
 *       back in), and
 *   (2) for every host it is anchored to, that host's DNR profile rule (in
 *       the generated src/rules/tracking-params.json) both lists the param
 *       in removeParams AND does not exclude that host via
 *       excludedRequestDomains.
 *
 * If either check fails, the param would stop being stripped before the
 * request leaves the browser — reintroducing exactly the class of defect
 * #1228 fixed.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { TRACKING_PARAMS } from "../../src/lib/affiliates.js";
import {
  DNR_DOMAIN_PRESERVE_RULE_ID_BASE,
  DNR_DOMAIN_PRESERVE_MAX_RULES,
} from "../../src/lib/dnr-ids.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..", "..");
const RULES_PATH = join(ROOT, "src", "rules", "tracking-params.json");

const RULES = JSON.parse(readFileSync(RULES_PATH, "utf8"));
const PROFILE_RULES = RULES.filter(
  (r) =>
    r.id >= DNR_DOMAIN_PRESERVE_RULE_ID_BASE &&
    r.id < DNR_DOMAIN_PRESERVE_RULE_ID_BASE + DNR_DOMAIN_PRESERVE_MAX_RULES,
);
const trackingLc = new Set(TRACKING_PARAMS.map((p) => p.toLowerCase()));

const removeOf = (rule) =>
  rule.action?.redirect?.transform?.queryTransform?.removeParams ?? [];

// All 16 amazon.* marketplace hosts that share the extra-strips profile for
// the Amazon-anchored params below.
const AMAZON_HOSTS = [
  "amazon.ca", "amazon.co.jp", "amazon.co.uk", "amazon.com",
  "amazon.com.au", "amazon.com.br", "amazon.com.mx", "amazon.de",
  "amazon.es", "amazon.fr", "amazon.in", "amazon.it", "amazon.nl",
  "amazon.pl", "amazon.se", "amazon.sg",
];

/**
 * The 16 params #1228 removed from TRACKING_PARAMS, each mapped to every
 * host its coverage is anchored to. Sourced from src/rules/domain-rules.json
 * `stripParams` (the same source generate-rules.mjs reads).
 */
const PARAM_ANCHORED_HOSTS = {
  _r: ["tiktok.com"],
  _t: ["tiktok.com"],
  dchild: AMAZON_HOSTS,
  dib: AMAZON_HOSTS,
  dib_tag: AMAZON_HOSTS,
  igsh: ["instagram.com"],
  is_from_webapp: ["tiktok.com"],
  mibextid: ["facebook.com", "fb.com"],
  napm: ["11st.co.kr", "naver.com", "shopping.naver.com"],
  pd_rd_i: AMAZON_HOSTS,
  pd_rd_r: AMAZON_HOSTS,
  pd_rd_w: AMAZON_HOSTS,
  pd_rd_wg: AMAZON_HOSTS,
  qid: AMAZON_HOSTS,
  sender_device: ["tiktok.com"],
  smid: [...AMAZON_HOSTS, "nytimes.com"],
};

describe("#1228 — removed global params stay stripped at the network layer", () => {
  for (const [param, hosts] of Object.entries(PARAM_ANCHORED_HOSTS)) {
    describe(param, () => {
      test(`"${param}" is absent from TRACKING_PARAMS`, () => {
        assert.ok(
          !trackingLc.has(param.toLowerCase()),
          `"${param}" is back in TRACKING_PARAMS — it was removed by #1228 because its ` +
            "coverage is host-anchored; either it belongs in the global list again (revert " +
            "the removal) or it must come back out.",
        );
      });

      for (const host of hosts) {
        test(`"${param}" is stripped by a DNR profile rule scoped to "${host}"`, () => {
          const rule = PROFILE_RULES.find((r) =>
            (r.condition?.requestDomains ?? []).includes(host),
          );
          assert.ok(
            rule,
            `no DNR profile rule covers "${host}" — "${param}" would stop being stripped ` +
              "before the request leaves the browser. Run `npm run build:rules`.",
          );

          const excluded = new Set(rule.condition?.excludedRequestDomains ?? []);
          assert.ok(
            !excluded.has(host),
            `the DNR profile rule covering "${param}" on "${host}" (id ${rule.id}) excludes ` +
              `"${host}" from itself — "${param}" would stop being stripped before the ` +
              "request leaves the browser.",
          );

          const removeParamsLc = new Set(removeOf(rule).map((p) => p.toLowerCase()));
          assert.ok(
            removeParamsLc.has(param.toLowerCase()),
            `"${param}" is not in the removeParams of the DNR profile rule covering "${host}" ` +
              `(id ${rule.id}) — "${param}" would stop being stripped before the request ` +
              "leaves the browser. Run `npm run build:rules`.",
          );
        });
      }
    });
  }
});

/**
 * #1228 step 2 — `cid`, the highest-risk single name on the issue's list.
 *
 * `cid` (customer id / category id / chat id / Google Maps business id — a
 * textbook collision name) was in TRACKING_PARAMS, stripped on every site on
 * the web. Measured against both upstream sources, neither supports a global
 * claim for it: AdGuard Filter 17 anchors it to 23 specific hosts (zero
 * global lines), and ClearURLs strips it for only 3 providers, none in
 * `globalRules`. #1228 step 2 removes `cid` from TRACKING_PARAMS (430 -> 429)
 * and re-publishes it at its correct scope: host-anchored `stripParams` in
 * domain-rules.json for the 29 hosts the evidence actually supports.
 *
 * Same invariant as the describe block above, applied to `cid` on its own
 * list of hosts (kept separate from PARAM_ANCHORED_HOSTS because that map
 * documents #1228 step 1's original 16-param measurement).
 */
describe("#1228 step 2 — `cid` stays stripped at the network layer, host-anchored", () => {
  // apple.com and flipkart.com already had domain-rules.json entries (step 1's
  // scope); the rest are new entries added for cid alone.
  const CID_HOSTS = [
    "apple.com", "flipkart.com",
    // AdGuard `||host^$removeparam=cid` anchors (nhk.jp/nhk.or.jp via the
    // `domain=nhk.jp|nhk.or.jp` form).
    "adshares.net", "ana.co.jp", "asahi.com", "belta.co.jp", "candy.ai",
    "controld.com", "giphy.com", "lululemon.com.hk", "nhk.jp", "nhk.or.jp",
    "petbook.de", "porntube.com", "rac.co.uk", "realtor.com", "samsung.com",
    "sonybank.jp", "teknosa.com", "urban-vpn.com", "video.unext.jp",
    // ClearURLs `referralMarketing` anchors.
    "vitamix.com", "lazada.com", "lazada.co.th", "lazada.co.id",
    "lazada.com.my", "lazada.com.ph", "lazada.sg", "lazada.vn",
  ];

  test("29 hosts are covered (sanity on the fixture itself)", () => {
    assert.equal(CID_HOSTS.length, 29);
  });

  test('"cid" is absent from TRACKING_PARAMS', () => {
    assert.ok(
      !trackingLc.has("cid"),
      '"cid" is back in TRACKING_PARAMS — it was removed by #1228 step 2 because neither ' +
        "AdGuard nor ClearURLs supports a global claim for it; either that evidence changed " +
        "(revert the removal with a new measurement) or it must come back out.",
    );
  });

  for (const host of CID_HOSTS) {
    test(`"cid" is stripped by a DNR profile rule scoped to "${host}"`, () => {
      const rule = PROFILE_RULES.find((r) =>
        (r.condition?.requestDomains ?? []).includes(host),
      );
      assert.ok(
        rule,
        `no DNR profile rule covers "${host}" — "cid" would stop being stripped before the ` +
          "request leaves the browser. Run `npm run build:rules`.",
      );

      const excluded = new Set(rule.condition?.excludedRequestDomains ?? []);
      assert.ok(
        !excluded.has(host),
        `the DNR profile rule covering "cid" on "${host}" (id ${rule.id}) excludes "${host}" ` +
          "from itself — \"cid\" would stop being stripped before the request leaves the browser.",
      );

      const removeParamsLc = new Set(removeOf(rule).map((p) => p.toLowerCase()));
      assert.ok(
        removeParamsLc.has("cid"),
        `"cid" is not in the removeParams of the DNR profile rule covering "${host}" ` +
          `(id ${rule.id}) — "cid" would stop being stripped before the request leaves the ` +
          "browser. Run `npm run build:rules`.",
      );
    });
  }

  // Deliberately excluded (#1229 / ADR-0008 "import at the anchor, never
  // widen"): upstream anchors `cid` to a PATH on these hosts
  // (`||123chat.jp/promotion/`, `||shop.tsukumo.co.jp/goods/`,
  // `||ojrq.net/p/`), not to the whole host. domain-rules.json can only
  // express host scope, so adding them would claim more than upstream claims.
  // Pinned here so a future contributor does not "complete the set" by
  // widening the claim past its evidence.
  const PATH_ANCHORED_EXCLUDED_HOSTS = ["123chat.jp", "shop.tsukumo.co.jp", "ojrq.net"];

  for (const host of PATH_ANCHORED_EXCLUDED_HOSTS) {
    test(`"${host}" does NOT get a "cid" DNR strip (upstream anchors it to a path, not the host)`, () => {
      const rule = PROFILE_RULES.find((r) =>
        (r.condition?.requestDomains ?? []).includes(host),
      );
      if (!rule) return; // no profile rule at all — cid is not stripped here, as intended.

      const removeParamsLc = new Set(removeOf(rule).map((p) => p.toLowerCase()));
      assert.ok(
        !removeParamsLc.has("cid"),
        `"${host}" has a DNR profile rule (id ${rule.id}) that strips "cid" host-wide — ` +
          "upstream only anchors cid to a path on this host, so this host-wide claim widens " +
          "past the evidence (#1229 / ADR-0008). Remove it from domain-rules.json stripParams.",
      );
    });
  }
});

/**
 * #1228 step 3 — 28 params measured against AdGuard Filter 17 v2.0.14.20 and
 * ClearURLs `data.min.json` (2026-09-10): every one is in TRACKING_PARAMS
 * while neither upstream source ever anchors it globally, only to specific
 * hosts. Same failure class as #1212/#1217/step 1/step 2.
 *
 * The issue's list names 29 params. This step ships 28 of them: `ref_` is
 * withheld. Its only anchored host per this step's measurement is
 * imdb.com — but imdb.com's own domain-rules.json entry already carries
 * `preserveParams: ["ref_", "q"]`, a pre-existing, deliberate decision (IMDb
 * uses ref_ for internal navigation context; Amazon itself strips ref_, but
 * IMDb preserves it — see that entry's neighboring amazon.* entries for the
 * contrast). generate-rules.mjs's own `extraStrips` filter excludes any
 * param already in a host's OWN preserveParams (see its comment: "did NOT"
 * -> filtered before it ever reaches removeParams), so adding `ref_` to
 * imdb.com's stripParams would not have reached DNR at all — it would have
 * been silently inert, exactly the failure class this whole issue chain
 * exists to prevent. Overriding imdb.com's existing preserve is a product
 * judgment call outside this step's authority, so `ref_` stays in
 * TRACKING_PARAMS, untouched, reported rather than fixed.
 *
 * TRACKING_PARAMS: 429 -> 401 (28 removed, not 29).
 */
describe("#1228 step 3 — 28 params stay stripped at the network layer, host-anchored", () => {
  // Every host each param is anchored to, from src/rules/domain-rules.json
  // stripParams (the same source generate-rules.mjs reads). Includes both the
  // 9 pre-existing hosts this step appended to (trendyol.com, teknosa.com,
  // msn.com, instagram.com, bbc.co.uk, bbc.com, office.com, imdb.com,
  // vercel.com) and the 33 new host entries it added.
  const PARAM_ANCHORED_HOSTS_STEP3 = {
    ad_id: ["kitbash3d.com", "pcmax.jp", "shop.asus.com"],
    adjust_t: ["nesine.com", "trendyol.com"],
    af_sub1: ["onelink.me"],
    asc_campaign: ["aboutamazon.com", "amzn.to"],
    campaign: [
      "app.adjust.com", "gettranny.com", "moffme.com",
      "online.nojima.co.jp", "ubereats.com", "www.alternate.de",
    ],
    crid: ["teknosa.com"],
    ei: ["msn.com"],
    igshid: ["instagram.com", "threads.com", "threads.net"],
    n_cid: ["nikkei.com"],
    nclid: ["microsoft.com"],
    ocid: ["bbc.co.uk", "bbc.com", "microsoft.com", "msn.com", "office.com"],
    pf_rd_p: ["imdb.com"],
    pf_rd_r: ["imdb.com"],
    pf_rd_s: ["imdb.com"],
    pr_prod_strat: ["shop.hololivepro.com"],
    pr_rec_id: ["shop.hololivepro.com"],
    pr_rec_pid: ["shop.hololivepro.com"],
    pr_ref_pid: ["shop.hololivepro.com"],
    pr_seq: ["shop.hololivepro.com"],
    sc_customer: ["avansas.com"],
    sc_eh: ["puma.com"],
    sc_uid: ["avansas.com", "puma.com"],
    sfmc_activityid: ["vercel.com"],
    share_id: ["change.org", "smartnews.com", "sport.sky.it", "xiaohongshu.com"],
    tblci: ["wesleyfinancialgroup.typeform.com"],
    trk: [
      "aws.eu", "builder.aws.com", "pages.awscloud.com",
      "registration.awsevents.com", "wetransfer.com", "xkcd.com",
    ],
    tw_adid: ["code-wallets.com"],
    visitid: ["netmonet.co"],
  };

  test("28 params are covered (sanity on the fixture itself)", () => {
    assert.equal(Object.keys(PARAM_ANCHORED_HOSTS_STEP3).length, 28);
  });

  for (const [param, hosts] of Object.entries(PARAM_ANCHORED_HOSTS_STEP3)) {
    describe(param, () => {
      test(`"${param}" is absent from TRACKING_PARAMS`, () => {
        assert.ok(
          !trackingLc.has(param.toLowerCase()),
          `"${param}" is back in TRACKING_PARAMS — it was removed by #1228 step 3 because its ` +
            "coverage is host-anchored; either it belongs in the global list again (revert " +
            "the removal) or it must come back out.",
        );
      });

      for (const host of hosts) {
        test(`"${param}" is stripped by a DNR profile rule scoped to "${host}"`, () => {
          const rule = PROFILE_RULES.find((r) =>
            (r.condition?.requestDomains ?? []).includes(host),
          );
          assert.ok(
            rule,
            `no DNR profile rule covers "${host}" — "${param}" would stop being stripped ` +
              "before the request leaves the browser. Run `npm run build:rules`.",
          );

          const excluded = new Set(rule.condition?.excludedRequestDomains ?? []);
          assert.ok(
            !excluded.has(host),
            `the DNR profile rule covering "${param}" on "${host}" (id ${rule.id}) excludes ` +
              `"${host}" from itself — "${param}" would stop being stripped before the ` +
              "request leaves the browser.",
          );

          const removeParamsLc = new Set(removeOf(rule).map((p) => p.toLowerCase()));
          assert.ok(
            removeParamsLc.has(param.toLowerCase()),
            `"${param}" is not in the removeParams of the DNR profile rule covering "${host}" ` +
              `(id ${rule.id}) — "${param}" would stop being stripped before the request ` +
              "leaves the browser. Run `npm run build:rules`.",
          );
        });
      }
    });
  }

  // Recording the exclusions, so nobody "completes the set" by widening one
  // of these later without a fresh measurement.
  describe("deliberately excluded from step 3", () => {
    test('"click_id" remains in TRACKING_PARAMS (in AFFILIATE_PARAM_GUARD; host-anchoring would be inert)', () => {
      assert.ok(
        trackingLc.has("click_id"),
        '"click_id" left TRACKING_PARAMS — it must stay global: it is in AFFILIATE_PARAM_GUARD, ' +
          "so a per-host stripParams entry would be filtered by extraStrips and never reach DNR.",
      );
    });

    test('"linkid" remains in TRACKING_PARAMS (its remaining anchor, awin1.com, is a live affiliate redirect host)', () => {
      assert.ok(
        trackingLc.has("linkid"),
        '"linkid" left TRACKING_PARAMS — it must stay global: its anchored hosts include ' +
          "awin1.com, a REDIRECT_NETWORK_PATTERNS affiliate network host, held for its own review.",
      );
    });

    test('"ref_" remains in TRACKING_PARAMS (its only anchored host, imdb.com, already preserves it)', () => {
      assert.ok(
        trackingLc.has("ref_"),
        '"ref_" left TRACKING_PARAMS — it must stay global: imdb.com already carries ' +
          '`preserveParams: ["ref_", ...]`, so a stripParams entry there would be filtered by ' +
          "generate-rules.mjs's extraStrips and never reach DNR. Overriding that preserve is a " +
          "product decision outside this step's authority.",
      );

      // Guard the mechanism, not just the outcome: if ref_ were ever added to
      // imdb.com's stripParams without removing it from preserveParams, prove
      // it would still not reach imdb.com's DNR rule — inert, not merely absent.
      const domainRulesPath = join(ROOT, "src", "rules", "domain-rules.json");
      const domainRules = JSON.parse(readFileSync(domainRulesPath, "utf8"));
      const imdb = domainRules.find((e) => e.domain === "imdb.com");
      assert.ok(
        (imdb?.preserveParams ?? []).includes("ref_"),
        "imdb.com no longer preserves ref_ — the conflict this test documents may be resolved; " +
          "re-measure whether ref_ can now be host-anchored to imdb.com.",
      );
    });

    // Path-anchored upstream (a Chrome DNR domain-rules.json entry can only
    // express host scope, never a path) — #1229 / ADR-0008 "import at the
    // anchor, never widen". These stay global; host-scoping any of them would
    // claim less reach than the global entry already provides on the actual
    // anchor path, while adding a host-wide claim upstream never made.
    const PATH_ANCHORED_STAY_GLOBAL = [
      "ved", "sca_esv", "gs_lcp",
      "linkcode", "creativeasin", "lp_asin", "store_ref", "sprefix",
      "mkevt", "mkcid", "mkrid", "toolid", "customid", "ingress",
    ];

    for (const param of PATH_ANCHORED_STAY_GLOBAL) {
      test(`"${param}" remains in TRACKING_PARAMS (upstream anchors it to a path, not a host)`, () => {
        assert.ok(
          trackingLc.has(param.toLowerCase()),
          `"${param}" left TRACKING_PARAMS — it must stay global. Upstream anchors it to a ` +
            "path, and domain-rules.json can only express host scope, so host-anchoring it " +
            "would claim more than the evidence supports (#1229 / ADR-0008).",
        );
      });
    }
  });
});
