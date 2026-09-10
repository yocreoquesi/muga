/**
 * MUGA — how short a name may be before "strip it everywhere" stops being safe (#1228)
 *
 * #1217 put a floor under the REMOTE param list: nothing shorter than
 * MIN_PARAM_LEN may be accepted, because "the list has no way to express a host
 * scope, so it would apply everywhere". The reasoning is about the SHAPE of a
 * global list, not about where the list came from — and the built-in list, the
 * one compiled into every install, had no such floor.
 *
 * It held five names below it: si, ie, ei, _r, _t.
 *
 * Two characters, stripped from every URL on every site. The codebase already
 * knew: `ie` needed preserveParams entries on baidu.com and naver.com, and `ei`
 * needed them on yahoo.com and yahoo.co.jp — per-host patches undoing a global
 * claim, one site at a time, which is what this defect looks like from the
 * inside. `ie` is gone; `_r` and `_t` left too, as part of the 17-param step 1
 * pass under this same issue — tiktok.com already carried both in its own
 * stripParams, so the DNR-generator blocker below did not apply to them; the
 * remaining two, `si` and `ei`, are pinned here with what each one still needs.
 *
 * ── Why the four are not simply deleted too ────────────────────────────────
 *
 * Because on the DNR path a per-host `stripParams` entry does NOT survive its
 * param leaving the global list. `generate-rules.mjs` builds a tailored rule as
 * "all TRACKING_PARAMS minus this host's preserves", and its `extraStrips`
 * escape hatch — params outside TRACKING_PARAMS that a host still strips — is
 * gated on `AMAZON_HOST_RE`. So `ie` could leave (Amazon picks it up as an
 * extra strip) while `si`, `ei`, `_r` and `_t` cannot: youtube.com, google.com
 * and tiktok.com would lose them outright in Chrome, however clearly
 * domain-rules.json lists them.
 *
 * The path out is the one ADR-0008 and #1221 already built: a host-anchored
 * fact travels as a DYNAMIC thin rule through the scoped channel, which is
 * exactly the shape a static per-host rule cannot have (measured in #1242: a
 * static thin rule is shadowed by the global rule and never fires). Land the
 * fact, then drop the global entry.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
import { TRACKING_PARAMS } from "../../src/lib/affiliates-data.js";
import { MIN_PARAM_LEN } from "../../src/lib/remote-rules.js";

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dir, "../..");
const domainRules = JSON.parse(readFileSync(join(ROOT, "src/rules/domain-rules.json"), "utf8"));

/**
 * Names below the floor that are still in the global list, each with the host
 * whose coverage has to exist before it can leave.
 *
 * Shrinking this list is the work. Growing it needs a better reason than
 * "upstream said so", which is how every one of these arrived.
 */
const KNOWN_SHORT = {
  si: "youtube.com, youtu.be",
  ei: "google.com",
};

describe("the built-in global strip list respects the same floor as the remote one (#1228)", () => {
  test("no NEW name below MIN_PARAM_LEN reaches the global list", () => {
    const short = TRACKING_PARAMS.filter((p) => p.length < MIN_PARAM_LEN);
    const unexpected = short.filter((p) => !(p in KNOWN_SHORT));

    assert.deepStrictEqual(
      unexpected,
      [],
      `${unexpected.join(", ")} would be stripped on every site on the web. A name this ` +
        "short cannot carry a scope, which is why #1217 put a floor under the remote list. " +
        "Land it as a host-scoped fact instead.",
    );
  });

  test("every name still below the floor is one this list names, and no more", () => {
    // Prevents the opposite drift: an entry lingering here after its param was
    // removed, quietly widening the exemption for the next one.
    const short = new Set(TRACKING_PARAMS.filter((p) => p.length < MIN_PARAM_LEN));
    const stale = Object.keys(KNOWN_SHORT).filter((p) => !short.has(p));

    assert.deepStrictEqual(stale, [], `${stale.join(", ")} is no longer in the global list`);
  });

  test("each one is already covered per-host, so only the delivery path is missing", () => {
    // The blocker is the DNR generator, not the knowledge: domain-rules.json
    // already says where each of these is a tracker. If one of these entries
    // ever disappears, dropping the global param stops being a scope fix and
    // starts being a coverage loss.
    for (const [param, expected] of Object.entries(KNOWN_SHORT)) {
      const hosts = domainRules
        .filter((e) => (e.stripParams ?? []).some((p) => p.toLowerCase() === param))
        .map((e) => e.domain);

      assert.ok(
        hosts.length > 0,
        `${param} is below the floor AND has no per-host coverage: nothing would replace it`,
      );
      for (const host of expected.split(", ")) {
        assert.ok(
          hosts.includes(host),
          `${param} should still be listed for ${host} (found: ${hosts.join(", ") || "none"})`,
        );
      }
    }
  });

  test("ie is gone, and the rules it forced are gone with it", () => {
    // The whole argument in one case. Removing one two-character name from the
    // global list also deleted the tailored DNR rule that existed only to undo
    // it on baidu and naver: 514 lines of generated ruleset.
    assert.ok(!TRACKING_PARAMS.includes("ie"), "ie must not return to the global list");

    const rules = JSON.parse(readFileSync(join(ROOT, "src/rules/tracking-params.json"), "utf8"));
    const global = rules.find((r) => r.id === 1);
    assert.ok(
      !global.action.redirect.transform.queryTransform.removeParams.includes("ie"),
      "the generated global rule must not strip ie either",
    );

    const amazon = rules.find(
      (r) => r.condition?.requestDomains?.includes("amazon.es"),
    );
    assert.ok(
      amazon?.action.redirect.transform.queryTransform.removeParams.includes("ie"),
      "Amazon must keep stripping ie from its own rule — that claim is true and scoped",
    );
  });
});
