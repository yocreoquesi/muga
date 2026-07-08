/**
 * MUGA — harvest-unwrap unit tests.
 *
 * Pins the pure logic of tools/rule-ingestion/harvest-unwrap.mjs: the
 * ClearURLs `redirections` → wrapper-recipe translation and every SAFETY GATE
 * that keeps an affiliate network, a test fixture, an unrepresentable shape,
 * or a review-only host out of the auto-harvested set. See the file header in
 * harvest-unwrap.mjs for the gate rationale.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const RULES_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "src", "rules");

import {
  mapRedirectionToExtractor,
  derivePathPrefix,
  parseRedirection,
  collidesWithAffiliateNetwork,
  parseClearUrlsRedirections,
  mergeIntoWrappers,
  hostToId,
  hostPatternsFor,
  serializeWrappersJson,
} from "../../tools/rule-ingestion/harvest-unwrap.mjs";

// ── mapRedirectionToExtractor ─────────────────────────────────────────────

describe("mapRedirectionToExtractor", () => {
  test("keyed `key=(…)` → fromParam", () => {
    assert.deepEqual(
      mapRedirectionToExtractor("\\/linkfilter\\/\\?url=([^&]*)"),
      { kind: "fromParam", paramName: "url" },
    );
  });

  test("takes the LAST key before the capture (ignores `.*?` prefix keys)", () => {
    // `.*?adurl=(…)` — the `.*?` may contain other `x=` fragments; the key
    // attached to the capture group is the last one.
    assert.deepEqual(
      mapRedirectionToExtractor("\\/aclk\\?sa=l&adurl=([^&]*)"),
      { kind: "fromParam", paramName: "adurl" },
    );
  });

  test("alternated `(?:a|b)=(…)` → fromAnyParam", () => {
    assert.deepEqual(
      mapRedirectionToExtractor("\\/url\\?.*?(?:url|q)=(https?[^&]+)"),
      { kind: "fromAnyParam", paramName: ["url", "q"] },
    );
  });

  test("alternation of one key collapses to fromParam", () => {
    assert.deepEqual(
      mapRedirectionToExtractor("(?:u)=([^&]*)"),
      { kind: "fromParam", paramName: "u" },
    );
  });

  test("naked tail `\\?(http…)` → fromUrlAfterQuery", () => {
    assert.deepEqual(
      mapRedirectionToExtractor("\\/\\?(http.+)"),
      { kind: "fromUrlAfterQuery" },
    );
  });

  test("preserves param-name case (query keys are case-sensitive)", () => {
    assert.deepEqual(
      mapRedirectionToExtractor("\\/go\\?remoteUrl=([^&]*)"),
      { kind: "fromParam", paramName: "remoteUrl" },
    );
  });

  test("a literal after the capture group → null (over-capture, unrepresentable)", () => {
    // disq.us: `url=([^&]*)%3A` trims a `:hash` suffix; fromParam would grab
    // the whole value including the suffix — no extractor kind can express it.
    assert.equal(mapRedirectionToExtractor("\\/.*?url=([^&]*)%3A"), null);
  });

  test("path-embedded capture (no key, no http) → null (unrepresentable)", () => {
    // deviantart `/outgoing?(.*)` — capture is not anchored to http, and has
    // no key. We cannot assert it is a URL.
    assert.equal(mapRedirectionToExtractor("\\/.*?\\/outgoing\\?(.*)"), null);
  });

  test("opaque path token `/(https?.*?)/` → null (not a query param or naked tail)", () => {
    assert.equal(mapRedirectionToExtractor("\\/.*\\/(https?.*?)\\/"), null);
  });

  test("non-string input → null", () => {
    assert.equal(mapRedirectionToExtractor(undefined), null);
  });
});

// ── derivePathPrefix ──────────────────────────────────────────────────────

describe("derivePathPrefix", () => {
  test("literal path before a metachar", () => {
    assert.equal(derivePathPrefix("\\/l\\.php\\?u=([^&]*)"), "/l.php");
  });

  test("stops at the first regex metachar (`?` quantifier)", () => {
    assert.equal(derivePathPrefix("\\/redirect?.*?q=([^&]*)"), "/redirect");
  });

  test("trailing-slash path is preserved", () => {
    assert.equal(derivePathPrefix("\\/linkfilter\\/\\?url=([^&]*)"), "/linkfilter/");
  });

  test("bare `/.*` yields null (host-only, `/` matches everything)", () => {
    assert.equal(derivePathPrefix("\\/.*?url=([^&]*)"), null);
  });

  test("tail that does not start with an escaped slash → null", () => {
    assert.equal(derivePathPrefix(".*?u=([^&]*)"), null);
  });
});

// ── collidesWithAffiliateNetwork ──────────────────────────────────────────

describe("collidesWithAffiliateNetwork", () => {
  test("exact affiliate host is rejected", () => {
    assert.equal(collidesWithAffiliateNetwork("shareasale.com"), true);
    assert.equal(collidesWithAffiliateNetwork("tc.tradetracker.net"), true);
  });

  test("wildcard affiliate (*.pxf.io) matches a subdomain", () => {
    assert.equal(collidesWithAffiliateNetwork("target.pxf.io"), true);
  });

  test("PARENT of an affiliate subdomain is rejected (ClearURLs anchors on the registrable domain)", () => {
    // linksynergy.com is the parent of click.linksynergy.com — must be caught.
    assert.equal(collidesWithAffiliateNetwork("linksynergy.com"), true);
    assert.equal(collidesWithAffiliateNetwork("viglink.com"), true);
    assert.equal(collidesWithAffiliateNetwork("skimresources.com"), true);
  });

  test("subdomain of an affiliate host is rejected", () => {
    assert.equal(collidesWithAffiliateNetwork("foo.shareasale.com"), true);
  });

  test("an unrelated host is allowed", () => {
    assert.equal(collidesWithAffiliateNetwork("steamcommunity.com"), false);
    assert.equal(collidesWithAffiliateNetwork("youtube.com"), false);
  });
});

// ── parseRedirection ──────────────────────────────────────────────────────

describe("parseRedirection", () => {
  test("concrete host + path + keyed extractor", () => {
    assert.deepEqual(
      parseRedirection("^https?:\\/\\/steamcommunity\\.com\\/linkfilter\\/\\?url=([^&]*)"),
      { host: "steamcommunity.com", pathPrefix: "/linkfilter/", extractor: { kind: "fromParam", paramName: "url" }, skip: null },
    );
  });

  test("subdomain host, no path, keyed extractor", () => {
    assert.deepEqual(
      parseRedirection("^https?:\\/\\/cc\\.loginfra\\.com\\/.*?u=([^&]+)"),
      { host: "cc.loginfra.com", pathPrefix: null, extractor: { kind: "fromParam", paramName: "u" }, skip: null },
    );
  });

  test("multi-TLD wildcard host → skip (no concrete host)", () => {
    const r = parseRedirection("^https?:\\/\\/(?:[a-z0-9-]+\\.)*?google(?:\\.[a-z]{2,}){1,}\\/url\\?q=([^&]*)");
    assert.ok(r.skip);
  });

  test("unrepresentable destination shape → skip", () => {
    const r = parseRedirection("^https?:\\/\\/(?:[a-z0-9-]+\\.)*?deviantart\\.com\\/.*?\\/outgoing\\?(.*)");
    assert.ok(r.skip);
  });
});

// ── hostToId / hostPatternsFor ────────────────────────────────────────────

describe("host helpers", () => {
  test("hostToId dots→hyphens", () => {
    assert.equal(hostToId("l.messenger.com"), "l-messenger-com");
  });

  test("apex host (2 labels) also emits the www variant", () => {
    assert.deepEqual(hostPatternsFor("gate.sc"), ["gate.sc", "www.gate.sc"]);
    assert.deepEqual(hostPatternsFor("youtube.com"), ["youtube.com", "www.youtube.com"]);
  });

  test("subdomain host (3+ labels) is emitted alone", () => {
    assert.deepEqual(hostPatternsFor("l.messenger.com"), ["l.messenger.com"]);
    assert.deepEqual(hostPatternsFor("cc.loginfra.com"), ["cc.loginfra.com"]);
  });
});

// ── parseClearUrlsRedirections (full pipeline over synthetic data) ────────

const FIXTURE = JSON.stringify({
  providers: {
    // KEEP: dedicated redirector subdomain, path-scoped, keyed
    messenger: {
      urlPattern: "^https?:\\/\\/l\\.messenger\\.com",
      redirections: ["^https?:\\/\\/l\\.messenger\\.com\\/l\\.php\\?u=([^&]*)"],
    },
    // KEEP: camelCase param name is preserved verbatim (query keys are
    // case-sensitive). Uses a made-up dedicated redirector host.
    examplecdn: {
      urlPattern: "^https?:\\/\\/go\\.example\\.test",
      redirections: ["^https?:\\/\\/go\\.example\\.test\\/out\\?remoteUrl=([^&]*)"],
    },
    // KEEP: naked tail
    hrefli: {
      urlPattern: "^https?:\\/\\/href\\.li",
      redirections: ["^https?:\\/\\/href\\.li\\/\\?(http.+)"],
    },
    // SKIP: globalRules catch-all
    globalRules: {
      urlPattern: ".*",
      redirections: ["^https?:\\/\\/.*url=([^&]*)"],
    },
    // SKIP: test-fixture provider
    ClearURLsTest: {
      urlPattern: "^https?:\\/\\/test\\.clearurls\\.xyz",
      redirections: ["^https?:\\/\\/test\\.clearurls\\.xyz\\/void\\?url=([^&]*)"],
    },
    // SKIP: affiliate network (parent of click.linksynergy.com)
    linksynergy: {
      urlPattern: "^https?:\\/\\/(?:[a-z0-9-]+\\.)*?linksynergy\\.com",
      redirections: ["^https?:\\/\\/(?:[a-z0-9-]+\\.)*?linksynergy\\.com\\/.*?murl=([^&]*)"],
    },
    // SKIP: host denylist (apex vk.com — sanctioned wrapper is away.vk.com)
    vkcom: {
      urlPattern: "^https?:\\/\\/vk\\.com",
      redirections: ["^https?:\\/\\/vk\\.com\\/away\\.php\\?to=([^&]*)"],
    },
    // SKIP: over-capture — a literal (`%3A`) follows the capture group
    disqus: {
      urlPattern: "^https?:\\/\\/disq\\.us",
      redirections: ["^https?:\\/\\/disq\\.us\\/.*?url=([^&]*)%3A"],
    },
    // SKIP: unrepresentable (path-embedded)
    deviantart: {
      urlPattern: "^https?:\\/\\/(?:[a-z0-9-]+\\.)*?deviantart\\.com",
      redirections: ["^https?:\\/\\/(?:[a-z0-9-]+\\.)*?deviantart\\.com\\/.*?\\/outgoing\\?(.*)"],
    },
    // REVIEW: suspicious ad-click key
    googleadservices: {
      urlPattern: "^https?:\\/\\/(?:[a-z0-9-]+\\.)*?googleadservices\\.com",
      redirections: ["^https?:\\/\\/(?:[a-z0-9-]+\\.)*?googleadservices\\.com\\/.*?adurl=([^&]*)"],
    },
    // REVIEW: correctness-review host (tokopedia /promo may be real content)
    tokopedia: {
      urlPattern: "^https?:\\/\\/(?:[a-z0-9-]+\\.)*?tokopedia\\.com",
      redirections: ["^https?:\\/\\/(?:[a-z0-9-]+\\.)*?tokopedia\\.com\\/promo.*r=([^&]*)"],
    },
  },
});

describe("parseClearUrlsRedirections", () => {
  const { entries, skipped, review } = parseClearUrlsRedirections(FIXTURE, "9.9.9");

  test("keeps only the safe representable dedicated-redirector candidates", () => {
    // ids derive from the HOST, not the provider name (href.li → href-li).
    const ids = entries.map((e) => e.id).sort();
    assert.deepEqual(ids, ["go-example-test", "href-li", "l-messenger-com"]);
  });

  test("harvested entry carries the passed version and a provenance note", () => {
    const m = entries.find((e) => e.id === "l-messenger-com");
    assert.equal(m.addedIn, "9.9.9");
    assert.match(m.notes, /ClearURLs/);
    assert.deepEqual(m.hostPatterns, ["l.messenger.com"]);
    assert.equal(m.pathPrefix, "/l.php");
    assert.deepEqual(m.extractor, { kind: "fromParam", paramName: "u" });
  });

  test("camelCase param name survives harvesting verbatim", () => {
    const e = entries.find((x) => x.id === "go-example-test");
    assert.deepEqual(e.extractor, { kind: "fromParam", paramName: "remoteUrl" });
  });

  test("naked-tail proxy has no pathPrefix and a fromUrlAfterQuery extractor", () => {
    const href = entries.find((e) => e.id === "href-li");
    assert.equal(href.pathPrefix, undefined);
    assert.deepEqual(href.extractor, { kind: "fromUrlAfterQuery" });
  });

  test("globalRules, test fixtures, affiliate networks, denylist, over-capture, and path-embedded are all skipped", () => {
    const reasons = skipped.map((s) => s.reason).join(" | ");
    assert.match(reasons, /globalRules/);
    assert.match(reasons, /test-fixture/);
    assert.match(reasons, /affiliate/);
    assert.match(reasons, /denylist/);
    assert.match(reasons, /not representable/);
    // disq.us (over-capture) and deviantart (path-embedded) both skip as
    // "not representable" — assert neither leaked into the harvested set.
    const ids = entries.map((e) => e.id);
    assert.ok(!ids.includes("disq-us"));
    assert.ok(!ids.includes("deviantart-com"));
  });

  test("suspicious keys and correctness-review hosts land in review, never harvested", () => {
    const reviewHosts = review.map((r) => r.host).sort();
    assert.deepEqual(reviewHosts, ["googleadservices.com", "tokopedia.com"]);
    const entryHosts = entries.flatMap((e) => e.hostPatterns);
    assert.ok(!entryHosts.includes("googleadservices.com"));
    assert.ok(!entryHosts.includes("tokopedia.com"));
  });
});

// ── mergeIntoWrappers ─────────────────────────────────────────────────────

const EXISTING = [
  { id: "anonymto", label: "anonym.to", hostPatterns: ["anonym.to"], extractor: { kind: "fromUrlAfterQuery" } },
  { id: "reddit-out", label: "Reddit Outbound", hostPatterns: ["out.reddit.com"], extractor: { kind: "fromParam", paramName: "url" } },
  { id: "vk-away", label: "VK Away", hostPatterns: ["away.vk.com"], pathPrefix: "/away.php", extractor: { kind: "fromParam", paramName: "to" } },
];

function harvested(id, host) {
  return { id, label: `${host}`, hostPatterns: [host], extractor: { kind: "fromParam", paramName: "url" } };
}

describe("mergeIntoWrappers", () => {
  test("adds new entries in codepoint-sorted id position", () => {
    const { wrappers, added } = mergeIntoWrappers(EXISTING, [
      harvested("disq-us", "disq.us"),
      harvested("youtube-com", "youtube.com"),
    ]);
    assert.deepEqual(added.sort(), ["disq-us", "youtube-com"]);
    assert.deepEqual(wrappers.map((w) => w.id), [
      "anonymto", "disq-us", "reddit-out", "vk-away", "youtube-com",
    ]);
  });

  test("skips an entry whose id already exists", () => {
    const { added, skippedDup } = mergeIntoWrappers(EXISTING, [harvested("vk-away", "somewhere.example")]);
    assert.deepEqual(added, []);
    assert.equal(skippedDup[0].reason, "id already present");
  });

  test("skips an entry whose host already exists (add-only)", () => {
    // out.reddit.com is already covered by reddit-out under a different id.
    const { added, skippedDup } = mergeIntoWrappers(EXISTING, [harvested("out-reddit-com", "out.reddit.com")]);
    assert.deepEqual(added, []);
    assert.match(skippedDup[0].reason, /host already present/);
  });

  test("never mutates the existing entries", () => {
    const snapshot = JSON.parse(JSON.stringify(EXISTING));
    mergeIntoWrappers(EXISTING, [harvested("disq-us", "disq.us")]);
    assert.deepEqual(EXISTING, snapshot);
  });

  test("idempotent: a second merge of the same input adds nothing", () => {
    const first = mergeIntoWrappers(EXISTING, [harvested("disq-us", "disq.us")]);
    const second = mergeIntoWrappers(first.wrappers, [harvested("disq-us", "disq.us")]);
    assert.deepEqual(second.added, []);
    assert.deepEqual(second.wrappers.map((w) => w.id), first.wrappers.map((w) => w.id));
  });
});

// ── serializeWrappersJson ─────────────────────────────────────────────────

describe("serializeWrappersJson", () => {
  const sample = [
    { id: "a", label: "A", hostPatterns: ["a.example", "www.a.example"], extractor: { kind: "fromParam", paramName: "u" } },
    { id: "b", label: "B", hostPatterns: ["b.example"], pathPrefix: "/go", extractor: { kind: "fromAnyParam", paramName: ["url", "u"] } },
  ];

  test("round-trips: JSON.parse(serialize(x)) deep-equals x", () => {
    assert.deepEqual(JSON.parse(serializeWrappersJson(sample)), sample);
  });

  test("renders hostPatterns and extractor INLINE (matches the hand-authored artifact)", () => {
    const out = serializeWrappersJson(sample);
    assert.match(out, /"hostPatterns": \["a\.example", "www\.a\.example"\]/);
    assert.match(out, /"extractor": \{ "kind": "fromParam", "paramName": "u" \}/);
    assert.match(out, /"paramName": \["url", "u"\]/);
    assert.ok(out.endsWith("\n"), "must end with a trailing newline");
  });

  test("re-serializing the shipped wrappers.json is byte-identical (no format drift)", () => {
    // Guards the invariant that a harvest only diffs the new entries, never
    // reformats the 17 existing signed recipes.
    const json = readFileSync(join(RULES_DIR, "wrappers.json"), "utf8");
    assert.equal(serializeWrappersJson(JSON.parse(json)), json);
  });
});
