/**
 * MUGA — the two preserved-creator programs outside the guard (#1252)
 *
 * Run with: npm test
 *
 * `AFFILIATE_PARAM_GUARD` covers the affiliate param of six of MUGA's eight
 * `direct-injection` programs. Two were missing: Vercel Referrals (`ref`) and
 * Apple Performance Partners (`at`).
 *
 * ── Why they are NOT in the guard ──────────────────────────────────────────
 *
 * The guard is ABSOLUTE: a name guarded anywhere is stripped nowhere, at any
 * scope, forever. That is deliberate (#1212 was an affiliate id applied to the
 * wrong host), but it is the wrong instrument for these two.
 *
 * `ref` is a genuine tracker on sites that have nothing to do with Vercel.
 * Upstream anchors it to shein.com and a set of Japanese blog domains today,
 * and `src/lib/affiliates-data.js` records that `ref` was removed from MUGA's
 * global strip list precisely because it is ambiguous: PcComponentes and
 * MediaMarkt use it as an affiliate param, GitHub uses `?ref=` for branch refs.
 * Guarding the name would block every one of those strips permanently, to
 * protect one program on one host.
 *
 * So both are protected the precise way instead: a per-host preserve entry.
 * That is strictly stronger AND narrower than the guard, because
 * `preserve-params.data.js` is generated from the same domain rules and feeds
 * `_hostPreserves`, so one entry covers the runtime cleaner AND the remote
 * scoped channel, while leaving the name strippable everywhere else.
 *
 * The reachability that made this worth fixing: `validateScopedFacts`
 * deliberately does NOT apply `MIN_PARAM_LEN`, so a two-character name like
 * `at` can land as a host-scoped fact even though the global path's 3-char
 * floor would reject it. And `at` appears verbatim in the 1441 AdGuard Filter
 * 17 candidates sitting in PR #1232, so it is one careless triage from being
 * imported.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { getPreservedParams } from "../../src/lib/cleaner.js";
import { validateScopedFacts, AFFILIATE_PARAM_GUARD } from "../../src/lib/remote-rules.js";

const require = createRequire(import.meta.url);
const domainRules = require("../../src/rules/domain-rules.json");
const programs = require("../../src/rules/manifest.json");

/** The two programs this issue is about, and the hosts they actually run on. */
const CASES = [
  { program: "apple-phg", param: "at", hosts: ["music.apple.com", "tv.apple.com", "apps.apple.com", "itunes.apple.com"] },
  { program: "vercel", param: "ref", hosts: ["vercel.com"] },
];

describe("#1252 — apple-phg (at) and vercel (ref) are preserved per host", () => {

  for (const { program, param, hosts } of CASES) {
    test(`${program}: "${param}" is preserved at runtime on every host it runs on`, () => {
      for (const host of hosts) {
        assert.ok(
          getPreservedParams(host, domainRules).has(param),
          `${host} must preserve "${param}" or ${program}'s attribution is stripped there`,
        );
      }
    });

    test(`${program}: a scoped fact naming "${param}" on its own host is rejected`, () => {
      // The remote channel half. _hostPreserves reads the generated
      // preserve-params.data.js, so the same domain entry closes both doors.
      for (const host of hosts) {
        const { accepted, rejected } = validateScopedFacts([{ param, hosts: [host] }]);
        assert.deepEqual(accepted, [], `a fact stripping "${param}" on ${host} must not land`);
        assert.equal(rejected, 1);
      }
    });
  }

  test('"ref" is still strippable on hosts that have nothing to do with Vercel', () => {
    // The whole reason for not using the absolute guard. Upstream anchors `ref`
    // to shein.com today; the guard would have blocked that forever. If this
    // ever starts failing, someone has reached for the blunt instrument.
    const { accepted, rejected } = validateScopedFacts([{ param: "ref", hosts: ["shein.com"] }]);
    assert.equal(rejected, 0);
    assert.deepEqual(accepted, [{ param: "ref", hosts: ["shein.com"] }]);
  });

  test("neither name was added to the absolute guard", () => {
    // Pins the decision itself, not just its effect. Adding either here would
    // silently undo the test above.
    for (const { param } of CASES) {
      assert.ok(
        !AFFILIATE_PARAM_GUARD.has(param),
        `"${param}" must stay OUT of AFFILIATE_PARAM_GUARD — it is protected per host, ` +
        `and guarding it blocks legitimate strips on unrelated sites forever`,
      );
    }
  });

  test("every direct-injection program's param is protected one way or the other", () => {
    // The check that found this gap. Each program is either in the absolute
    // guard, or preserved on each of its own hosts.
    const list = Array.isArray(programs) ? programs : (programs.programs ?? Object.values(programs).find(Array.isArray) ?? []);
    const direct = list.filter((p) => p.programType === "direct-injection");

    // Six, not the eight #1252's table lists. Booking (aid) and Humble Bundle
    // (partner) have since moved to programType "deprecated"; both are in the
    // absolute guard anyway, so nothing regressed, the issue's table is just
    // older than the manifest. The floor guards against this list silently
    // emptying and turning the check below into a no-op.
    assert.ok(direct.length >= 6, `expected the direct-injection programs, found ${direct.length}`);

    const unprotected = [];
    for (const p of direct) {
      if (AFFILIATE_PARAM_GUARD.has(String(p.param).toLowerCase())) continue;
      const gaps = (p.domains ?? []).filter((h) => !getPreservedParams(h, domainRules).has(p.param));
      if (gaps.length > 0) unprotected.push(`${p.id} (${p.param}) unprotected on: ${gaps.join(", ")}`);
    }
    assert.deepEqual(unprotected, [],
      "a preserved-creator program's param must be guarded globally or preserved on its own hosts");
  });
});
