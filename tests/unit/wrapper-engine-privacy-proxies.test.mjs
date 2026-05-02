/**
 * MUGA — Unit tests for B5 social/privacy-proxy wrappers (issue #441).
 *
 * Run with: npm test
 *
 * Networks covered (extending the WRAPPERS table):
 *   - out.reddit.com    /?url=                (Reddit outbound)
 *   - link.medium.com   path-based shortener  (best-effort, like t.co)
 *   - away.vk.com       /away.php?to=         (VK outbound)
 *   - exit.sc           /?url=                (Snap exit redirect)
 *   - href.li           path-embedded URL     (privacy proxy — URL after `?`)
 *   - anonym.to         path-embedded URL     (privacy proxy — URL after `?`)
 *
 * KEY new schema capability: path-embedded extraction. Privacy proxies put the
 * destination URL directly after `?` with NO key (e.g. `https://href.li/?https://x.com`).
 * In `new URL()` parsing, that destination ends up as the `search` portion
 * starting with `?http`. The new helper `extractFromUrlAfterQuery()` handles
 * that shape declaratively, so wrappers using it stay one-line entries in the
 * WRAPPERS table — same shape as `extractFromParam('u')`.
 *
 * Acceptance highlights (from #441):
 *   - Each wrapper detects without false positives on the parent domain
 *     (reddit.com, medium.com, vk.com).
 *   - Path-embedded extractor handles URL-encoded chars (%20, %2F).
 *   - Privacy proxies (href.li, anonym.to) MUST disappear from the final URL
 *     after processUrl — destination must contain neither host.
 *   - Non-HTTP schemes are rejected (javascript:, file:, ftp:).
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { unwrap, detectWrapper, WRAPPERS } from "../../src/lib/wrapper-engine.js";

// ---------------------------------------------------------------------------
// out.reddit.com — Reddit outbound link wrapper
// ---------------------------------------------------------------------------
describe("Wrapper Engine — out.reddit.com", () => {
  test("unwraps out.reddit.com with url= parameter", () => {
    const dest = "https://merchant.example.com/post/42";
    const input = "https://out.reddit.com/?url=" + encodeURIComponent(dest);
    const result = unwrap(input);
    assert.ok(result, "expected an unwrap result");
    assert.equal(result.unwrapped, dest);
    assert.equal(result.hops, 1);
    assert.deepEqual(result.networks, ["reddit-out"]);
  });

  test("returns null when out.reddit.com has no url= parameter", () => {
    assert.equal(unwrap("https://out.reddit.com/?token=abc"), null);
  });

  test("returns null when out.reddit.com url= is empty", () => {
    assert.equal(unwrap("https://out.reddit.com/?url="), null);
  });

  test("returns null when out.reddit.com url= is malformed", () => {
    assert.equal(unwrap("https://out.reddit.com/?url=not-a-url"), null);
  });

  test("returns null when out.reddit.com url= is non-HTTP(S)", () => {
    const input =
      "https://out.reddit.com/?url=" + encodeURIComponent("javascript:alert(1)");
    assert.equal(unwrap(input), null);
  });

  test("reddit.com (parent) does NOT match out.reddit.com wrapper", () => {
    assert.equal(detectWrapper("https://reddit.com/r/foo"), null);
    assert.equal(detectWrapper("https://www.reddit.com/r/foo"), null);
    assert.equal(detectWrapper("https://old.reddit.com/r/foo"), null);
  });
});

// ---------------------------------------------------------------------------
// link.medium.com — Medium short-URL host (best-effort, like t.co)
// ---------------------------------------------------------------------------
describe("Wrapper Engine — link.medium.com", () => {
  test("detectWrapper recognizes link.medium.com host (registered as wrapper)", () => {
    const w = detectWrapper("https://link.medium.com/abc123");
    assert.ok(w, "link.medium.com must be a recognized wrapper host");
    assert.equal(w.id, "medium-link");
  });

  test("returns null for path-based link.medium.com (no query fallback)", () => {
    // Real link.medium.com hides the destination behind an HTTP redirect we
    // cannot follow. With no query fallback, extraction returns null gracefully.
    assert.equal(unwrap("https://link.medium.com/abc123"), null);
  });

  test("extracts destination from ?url= query fallback when present", () => {
    const dest = "https://medium.com/@author/article-slug-abc";
    const input = "https://link.medium.com/abc123?url=" + encodeURIComponent(dest);
    const result = unwrap(input);
    assert.ok(result);
    assert.equal(result.unwrapped, dest);
    assert.deepEqual(result.networks, ["medium-link"]);
  });

  test("medium.com (parent) does NOT match link.medium.com wrapper", () => {
    assert.equal(detectWrapper("https://medium.com/@author/article"), null);
    assert.equal(detectWrapper("https://www.medium.com/@author/article"), null);
  });
});

// ---------------------------------------------------------------------------
// away.vk.com — VK outbound link wrapper
// ---------------------------------------------------------------------------
describe("Wrapper Engine — away.vk.com", () => {
  test("unwraps away.vk.com/away.php with to= parameter", () => {
    const dest = "https://merchant.example.com/p/vk";
    const input = "https://away.vk.com/away.php?to=" + encodeURIComponent(dest);
    const result = unwrap(input);
    assert.ok(result);
    assert.equal(result.unwrapped, dest);
    assert.equal(result.hops, 1);
    assert.deepEqual(result.networks, ["vk-away"]);
  });

  test("returns null when away.vk.com URL has no to= parameter", () => {
    assert.equal(unwrap("https://away.vk.com/away.php?cc_key="), null);
  });

  test("returns null when away.vk.com to= is malformed", () => {
    assert.equal(unwrap("https://away.vk.com/away.php?to=not-a-url"), null);
  });

  test("does not match away.vk.com paths other than /away.php", () => {
    const input =
      "https://away.vk.com/other?to=" + encodeURIComponent("https://merchant.com");
    assert.equal(unwrap(input), null);
  });

  test("vk.com (parent) does NOT match the VK away wrapper", () => {
    assert.equal(detectWrapper("https://vk.com/feed"), null);
    assert.equal(detectWrapper("https://www.vk.com/feed"), null);
  });
});

// ---------------------------------------------------------------------------
// exit.sc — Snap exit redirect
// ---------------------------------------------------------------------------
describe("Wrapper Engine — exit.sc", () => {
  test("unwraps exit.sc with url= parameter", () => {
    const dest = "https://merchant.example.com/snap/42";
    const input = "https://exit.sc/?url=" + encodeURIComponent(dest);
    const result = unwrap(input);
    assert.ok(result);
    assert.equal(result.unwrapped, dest);
    assert.equal(result.hops, 1);
    assert.deepEqual(result.networks, ["snap-exit"]);
  });

  test("returns null when exit.sc has no url= parameter", () => {
    assert.equal(unwrap("https://exit.sc/?ref=abc"), null);
  });

  test("returns null when exit.sc url= is empty", () => {
    assert.equal(unwrap("https://exit.sc/?url="), null);
  });

  test("returns null when exit.sc url= is non-HTTP(S)", () => {
    const input = "https://exit.sc/?url=" + encodeURIComponent("file:///etc/passwd");
    assert.equal(unwrap(input), null);
  });

  test("snapchat.com (parent) does NOT match exit.sc wrapper", () => {
    assert.equal(detectWrapper("https://snapchat.com/add/user"), null);
  });
});

// ---------------------------------------------------------------------------
// href.li — privacy proxy (URL embedded after `?` with no key)
// ---------------------------------------------------------------------------
describe("Wrapper Engine — href.li (path-embedded URL)", () => {
  test("unwraps href.li with URL after ? (no key)", () => {
    const dest = "https://merchant.example.com/article";
    const input = "https://href.li/?" + dest;
    const result = unwrap(input);
    assert.ok(result, "expected an unwrap result");
    assert.equal(result.unwrapped, dest);
    assert.equal(result.hops, 1);
    assert.deepEqual(result.networks, ["hrefli"]);
  });

  test("decodes URL-encoded characters in path-embedded destination (%20, %2F)", () => {
    // The proxy concatenates the raw URL after `?`; encoded chars in the
    // destination must round-trip cleanly through extraction.
    const dest = "https://merchant.example.com/path%20with%20space/seg%2Ffoo";
    const input = "https://href.li/?" + dest;
    const result = unwrap(input);
    assert.ok(result);
    assert.equal(result.unwrapped, dest);
  });

  test("returns null when href.li has no destination after ?", () => {
    assert.equal(unwrap("https://href.li/"), null);
    assert.equal(unwrap("https://href.li/?"), null);
  });

  test("returns null when href.li destination is non-HTTP(S)", () => {
    const input = "https://href.li/?javascript:alert(1)";
    assert.equal(unwrap(input), null);
  });

  test("returns null when href.li 'destination' is not a URL at all", () => {
    assert.equal(unwrap("https://href.li/?just-some-string"), null);
  });
});

// ---------------------------------------------------------------------------
// anonym.to — privacy proxy (same shape as href.li)
// ---------------------------------------------------------------------------
describe("Wrapper Engine — anonym.to (path-embedded URL)", () => {
  test("unwraps anonym.to with URL after ? (no key)", () => {
    const dest = "https://merchant.example.com/landing";
    const input = "https://anonym.to/?" + dest;
    const result = unwrap(input);
    assert.ok(result);
    assert.equal(result.unwrapped, dest);
    assert.deepEqual(result.networks, ["anonymto"]);
  });

  test("decodes URL-encoded characters in path-embedded destination (%20, %2F)", () => {
    const dest = "https://merchant.example.com/with%20space/and%2Fslash";
    const input = "https://anonym.to/?" + dest;
    const result = unwrap(input);
    assert.ok(result);
    assert.equal(result.unwrapped, dest);
  });

  test("returns null when anonym.to has no destination after ?", () => {
    assert.equal(unwrap("https://anonym.to/"), null);
  });

  test("returns null when anonym.to destination uses ftp scheme", () => {
    const input = "https://anonym.to/?ftp://merchant.example.com/x";
    assert.equal(unwrap(input), null);
  });
});

// ---------------------------------------------------------------------------
// Privacy-proxy host removal — integration through processUrl
// Acceptance: the final URL must NOT contain href.li / anonym.to as a host.
// ---------------------------------------------------------------------------
describe("Wrapper Engine — privacy-proxy host removal (processUrl)", () => {
  test("href.li disappears from final URL after processUrl", async () => {
    const { processUrl } = await import("../../src/lib/cleaner.js");
    const PREFS = {
      enabled: true,
      injectOwnAffiliate: false,
      notifyForeignAffiliate: false,
      blacklist: [],
      whitelist: [],
    };
    const dest = "https://merchant.example.com/article";
    const input = "https://href.li/?" + dest;
    const result = processUrl(input, PREFS);
    // Final URL must contain neither the proxy host name in any form.
    assert.ok(
      !result.cleanUrl.includes("href.li"),
      `final URL must not contain 'href.li': got ${result.cleanUrl}`
    );
    assert.equal(new URL(result.cleanUrl).hostname, "merchant.example.com");
  });

  test("anonym.to disappears from final URL after processUrl", async () => {
    const { processUrl } = await import("../../src/lib/cleaner.js");
    const PREFS = {
      enabled: true,
      injectOwnAffiliate: false,
      notifyForeignAffiliate: false,
      blacklist: [],
      whitelist: [],
    };
    const dest = "https://merchant.example.com/landing";
    const input = "https://anonym.to/?" + dest;
    const result = processUrl(input, PREFS);
    assert.ok(
      !result.cleanUrl.includes("anonym.to"),
      `final URL must not contain 'anonym.to': got ${result.cleanUrl}`
    );
    assert.equal(new URL(result.cleanUrl).hostname, "merchant.example.com");
  });
});

// ---------------------------------------------------------------------------
// Schema introspection — every new B5 entry is well-formed
// ---------------------------------------------------------------------------
describe("Wrapper Engine — B5 schema", () => {
  for (const id of [
    "reddit-out",
    "medium-link",
    "vk-away",
    "snap-exit",
    "hrefli",
    "anonymto",
  ]) {
    test(`WRAPPERS contains ${id} with required schema fields`, () => {
      const w = WRAPPERS.find((entry) => entry.id === id);
      assert.ok(w, `${id} entry must exist in WRAPPERS`);
      assert.ok(typeof w.name === "string" && w.name.length > 0);
      assert.ok(Array.isArray(w.hostPatterns) && w.hostPatterns.length > 0);
      assert.ok(typeof w.extract === "function");
    });
  }

  test("detectWrapper resolves each new B5 network correctly", () => {
    assert.equal(
      detectWrapper("https://out.reddit.com/?url=https%3A%2F%2Fx.com").id,
      "reddit-out"
    );
    assert.equal(
      detectWrapper("https://link.medium.com/abc123").id,
      "medium-link"
    );
    assert.equal(
      detectWrapper("https://away.vk.com/away.php?to=https%3A%2F%2Fx.com").id,
      "vk-away"
    );
    assert.equal(
      detectWrapper("https://exit.sc/?url=https%3A%2F%2Fx.com").id,
      "snap-exit"
    );
    assert.equal(
      detectWrapper("https://href.li/?https://x.com").id,
      "hrefli"
    );
    assert.equal(
      detectWrapper("https://anonym.to/?https://x.com").id,
      "anonymto"
    );
  });
});
