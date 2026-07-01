/**
 * MUGA — Unit tests for honor-creator (#452, B14)
 *
 * The pure module that decides whether to "honor" a creator's referral chain:
 * when the user enabled `honorCreatorMode`, AND the navigation referrer
 * matches one of the user's `creatorAllowlist` entries, AND the URL is a
 * recognized redirect-network wrapper, MUGA passes the wrapper URL through
 * unmodified so the creator gets credit. Otherwise: default behaviour.
 *
 * Coverage:
 *   - shouldHonor — full decision matrix (mode off / mode on + non-wrapper /
 *     wrapper + empty allowlist / wrapper + matching referrer / wrapper +
 *     non-matching referrer / null referrer)
 *   - matchesAllowlist — normalization (case, scheme, trailing slash),
 *     www. strip, prefix semantics, empty inputs
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { shouldHonor, matchesAllowlist } from "../../src/lib/honor-creator.js";

// A real wrapper URL the engine recognizes. Prior to #907 this fixture used
// Skimlinks (go.redirectingat.com) — Skimlinks was reclassified pass-through
// in #907 (joining Awin/Impact/Rakuten/TradeTracker), so detectWrapper()
// now returns null for it unconditionally and it can no longer exercise
// honor-creator mode (shouldHonor requires detectWrapper(url) to be
// non-null; see condition 2 in the module docstring above). Facebook's
// l.facebook.com wrapper is still a live WRAPPERS entry — honor-creator
// mode still gates whether that wrapper URL is preserved unmodified, so it
// replaces Skimlinks here.
const WRAPPER_URL =
  "https://l.facebook.com/l.php?u=https%3A%2F%2Famazon.com%2Fdp%2FB000&h=AT0abc";
const NON_WRAPPER_URL = "https://example.com/article?utm_source=foo";

describe("matchesAllowlist", () => {
  test("empty allowlist never matches", () => {
    const m = matchesAllowlist("https://www.youtube.com/@foo/community", []);
    assert.equal(m, null);
  });

  test("missing/null/empty referrer never matches", () => {
    const list = ["youtube.com/@foo"];
    assert.equal(matchesAllowlist("", list), null);
    assert.equal(matchesAllowlist(null, list), null);
    assert.equal(matchesAllowlist(undefined, list), null);
  });

  test("invalid referrer string never matches", () => {
    assert.equal(matchesAllowlist("not a url", ["example.com"]), null);
  });

  test("entry matches when host+path starts with normalized entry", () => {
    const m = matchesAllowlist(
      "https://www.youtube.com/@LinusTechTips/community",
      ["youtube.com/@LinusTechTips"],
    );
    assert.equal(m, "youtube.com/@linustechtips");
  });

  test("strips leading www. from referrer host (common alias)", () => {
    const m = matchesAllowlist(
      "https://www.example.com/article",
      ["example.com"],
    );
    assert.equal(m, "example.com");
  });

  test("normalizes the entry: scheme + uppercase + trailing slash", () => {
    const m = matchesAllowlist(
      "http://example.com/@foo/bar",
      ["https://Example.com/@Foo/"],
    );
    assert.equal(m, "example.com/@foo");
  });

  test("does not match when the referrer is a different path", () => {
    const m = matchesAllowlist(
      "https://www.youtube.com/@OtherChannel/community",
      ["youtube.com/@LinusTechTips"],
    );
    assert.equal(m, null);
  });

  test("returns the first matching entry when several entries are present", () => {
    const list = ["dot-css-news.com", "youtube.com/@foo"];
    const m = matchesAllowlist("https://www.dot-css-news.com/post/1", list);
    assert.equal(m, "dot-css-news.com");
  });

  test("entry without path matches any path on that host", () => {
    const list = ["dot-css-news.com"];
    assert.equal(matchesAllowlist("https://dot-css-news.com/", list), "dot-css-news.com");
    assert.equal(matchesAllowlist("https://dot-css-news.com/x/y", list), "dot-css-news.com");
  });

  test("entry must be a true prefix — partial host overlap does not match", () => {
    // "example.com" must NOT match "evilexample.com" — host comparison must be
    // anchored at the start AND followed by a path boundary or end-of-string.
    const m = matchesAllowlist("https://evilexample.com/", ["example.com"]);
    assert.equal(m, null);
  });
});

describe("shouldHonor", () => {
  const allowlist = ["youtube.com/@linustechtips"];
  const referrer = "https://www.youtube.com/@LinusTechTips/community";

  test("mode off → never honor (even with matching referrer + wrapper URL)", () => {
    const r = shouldHonor({
      url: WRAPPER_URL,
      referrer,
      prefs: { honorCreatorMode: false, creatorAllowlist: allowlist },
    });
    assert.equal(r.honor, false);
  });

  test("mode missing → never honor (defensive)", () => {
    const r = shouldHonor({
      url: WRAPPER_URL,
      referrer,
      prefs: { creatorAllowlist: allowlist },
    });
    assert.equal(r.honor, false);
  });

  test("mode on + non-wrapper URL → not honored", () => {
    const r = shouldHonor({
      url: NON_WRAPPER_URL,
      referrer,
      prefs: { honorCreatorMode: true, creatorAllowlist: allowlist },
    });
    assert.equal(r.honor, false);
  });

  test("mode on + wrapper URL + empty allowlist → not honored", () => {
    const r = shouldHonor({
      url: WRAPPER_URL,
      referrer,
      prefs: { honorCreatorMode: true, creatorAllowlist: [] },
    });
    assert.equal(r.honor, false);
  });

  test("mode on + wrapper URL + null/empty referrer → not honored", () => {
    const r1 = shouldHonor({
      url: WRAPPER_URL,
      referrer: "",
      prefs: { honorCreatorMode: true, creatorAllowlist: allowlist },
    });
    assert.equal(r1.honor, false);
    const r2 = shouldHonor({
      url: WRAPPER_URL,
      referrer: null,
      prefs: { honorCreatorMode: true, creatorAllowlist: allowlist },
    });
    assert.equal(r2.honor, false);
  });

  test("mode on + wrapper URL + non-matching referrer → not honored", () => {
    const r = shouldHonor({
      url: WRAPPER_URL,
      referrer: "https://www.youtube.com/@OtherChannel/",
      prefs: { honorCreatorMode: true, creatorAllowlist: allowlist },
    });
    assert.equal(r.honor, false);
  });

  test("mode on + wrapper URL + matching referrer → honored, network + creator returned", () => {
    const r = shouldHonor({
      url: WRAPPER_URL,
      referrer,
      prefs: { honorCreatorMode: true, creatorAllowlist: allowlist },
    });
    assert.equal(r.honor, true);
    assert.equal(r.network, "facebook-l");
    assert.equal(r.creator, "youtube.com/@linustechtips");
  });

  test("non-string url → not honored (safe default)", () => {
    const r = shouldHonor({
      url: null,
      referrer,
      prefs: { honorCreatorMode: true, creatorAllowlist: allowlist },
    });
    assert.equal(r.honor, false);
  });
});
