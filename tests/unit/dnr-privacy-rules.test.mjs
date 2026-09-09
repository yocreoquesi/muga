/**
 * MUGA — Unit tests for the referer/beacon DNR rule builders (#1268)
 *
 * Run with: npm test
 *
 * None of these could be written before the extraction. The rule shapes, the
 * id assignment and the blocklist cap lived inside `service-worker.js`, which
 * Node cannot import, so the only reachable assertions were source-string
 * scans of the file's text or a hand-written mirror of its logic. Both of
 * those go green while the shipped behaviour changes.
 *
 * The invariants below are the ones a mirror would not have thought to check:
 * that a resync clears the FULL id range rather than only the ids it is about
 * to add, that the cap drops from the tail and reports what it dropped, and
 * that the four id families cannot collide.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  buildSuppressRefererRules,
  buildBlockBeaconsRules,
  buildBlocklistRefererRules,
  buildBlocklistBeaconsRules,
  BLOCKLIST_REFERER_RULE_ID_RANGE,
  BLOCKLIST_BEACON_RULE_ID_RANGE,
} from "../../src/background/dnr-privacy-rules.js";
import {
  DNR_SUPPRESS_REFERER_RULE_ID,
  DNR_BLOCK_BEACONS_RULE_ID,
  DNR_BLOCKLIST_REFERER_RULE_ID_BASE,
  DNR_BLOCKLIST_BEACON_RULE_ID_BASE,
  DNR_BLOCKLIST_MAX_RULES,
  ALLOWLIST_RESOURCE_TYPES,
} from "../../src/lib/dnr-ids.js";

const domains = (n, prefix = "d") =>
  Array.from({ length: n }, (_, i) => `${prefix}${i}.example`);

describe("#1268 — global referer-suppression rule", () => {

  test("pref off clears rule 2500 and adds nothing", () => {
    for (const prefs of [{ suppressReferer: false }, {}, undefined]) {
      const out = buildSuppressRefererRules(prefs);
      assert.deepEqual(out.removeRuleIds, [DNR_SUPPRESS_REFERER_RULE_ID]);
      assert.deepEqual(out.addRules, [], "nothing is registered while the pref is off");
    }
  });

  test("pref on registers one modifyHeaders rule that strips referer everywhere", () => {
    const out = buildSuppressRefererRules({ suppressReferer: true });
    assert.deepEqual(out.removeRuleIds, [DNR_SUPPRESS_REFERER_RULE_ID],
      "the previous rule is always cleared first, so an update never doubles it");
    assert.equal(out.addRules.length, 1);

    const [rule] = out.addRules;
    assert.equal(rule.id, DNR_SUPPRESS_REFERER_RULE_ID);
    assert.equal(rule.priority, 1,
      "priority 1 so the allowlist's priority-1000 allow rule deterministically shadows it");
    assert.equal(rule.action.type, "modifyHeaders");
    assert.deepEqual(rule.action.requestHeaders, [{ header: "referer", operation: "remove" }]);
    assert.equal(rule.condition.urlFilter, "*");
    assert.deepEqual(rule.condition.resourceTypes, ALLOWLIST_RESOURCE_TYPES,
      "must be the SAME list the allowlist rule uses, or the shadowing is not total");
  });
});

describe("#1268 — global beacon-block rule", () => {

  test("pref off clears rule 2600 and adds nothing", () => {
    for (const prefs of [{ blockBeacons: false }, {}, undefined]) {
      const out = buildBlockBeaconsRules(prefs);
      assert.deepEqual(out.removeRuleIds, [DNR_BLOCK_BEACONS_RULE_ID]);
      assert.deepEqual(out.addRules, []);
    }
  });

  test("pref on blocks the ping resourceType", () => {
    const out = buildBlockBeaconsRules({ blockBeacons: true });
    assert.equal(out.addRules.length, 1);
    const [rule] = out.addRules;
    assert.equal(rule.id, DNR_BLOCK_BEACONS_RULE_ID);
    assert.equal(rule.priority, 1);
    assert.equal(rule.action.type, "block");
    assert.deepEqual(rule.condition.resourceTypes, ["ping"],
      "ping covers both <a ping> auditing and sendBeacon()");
  });
});

describe("#1268 — blocklist force rules", () => {

  const families = [
    {
      name: "referer",
      build: buildBlocklistRefererRules,
      base: DNR_BLOCKLIST_REFERER_RULE_ID_BASE,
      range: BLOCKLIST_REFERER_RULE_ID_RANGE,
      assertAction: (rule) => {
        assert.equal(rule.action.type, "modifyHeaders");
        assert.deepEqual(rule.action.requestHeaders, [{ header: "referer", operation: "remove" }]);
        assert.deepEqual(rule.condition.resourceTypes, ALLOWLIST_RESOURCE_TYPES);
      },
    },
    {
      name: "beacons",
      build: buildBlocklistBeaconsRules,
      base: DNR_BLOCKLIST_BEACON_RULE_ID_BASE,
      range: BLOCKLIST_BEACON_RULE_ID_RANGE,
      assertAction: (rule) => {
        assert.equal(rule.action.type, "block");
        assert.deepEqual(rule.condition.resourceTypes, ["ping"]);
      },
    },
  ];

  for (const family of families) {
    describe(family.name, () => {

      test("an empty blacklist clears the whole range", () => {
        const out = family.build([]);
        assert.deepEqual(out.addRules, []);
        assert.deepEqual(out.removeRuleIds, [...family.range]);
        assert.deepEqual(out.dropped, []);
      });

      test("no argument at all behaves like an empty blacklist", () => {
        const out = family.build();
        assert.deepEqual(out.addRules, []);
        assert.deepEqual(out.removeRuleIds, [...family.range]);
      });

      test("a resync clears the FULL range, not just the ids it re-adds", () => {
        // The invariant that stops a stale force rule surviving a domain being
        // removed from the blacklist. Clearing only the ids about to be added
        // would leave rule BASE+2 live after the list shrinks from 3 to 2, and
        // that domain would keep being enforced forever.
        const out = family.build(domains(2));
        assert.equal(out.addRules.length, 2);
        assert.equal(out.removeRuleIds.length, DNR_BLOCKLIST_MAX_RULES,
          "removeRuleIds must span the entire range regardless of how many rules are added");
        assert.ok(out.removeRuleIds.includes(family.base + 2),
          "including ids no longer in use");
      });

      test("ids are assigned sequentially from the base, in domain order", () => {
        const list = domains(5);
        const out = family.build(list);
        out.addRules.forEach((rule, i) => {
          assert.equal(rule.id, family.base + i);
          assert.equal(rule.priority, 2);
          assert.deepEqual(rule.condition.requestDomains, [list[i]]);
          family.assertAction(rule);
        });
      });

      test("exactly at the cap drops nothing", () => {
        const out = family.build(domains(DNR_BLOCKLIST_MAX_RULES));
        assert.equal(out.addRules.length, DNR_BLOCKLIST_MAX_RULES);
        assert.deepEqual(out.dropped, [], "the boundary belongs to the accepted side");
      });

      test("over the cap drops from the TAIL and reports exactly what it dropped", () => {
        // Silent truncation would mean a domain the user explicitly blacklisted
        // quietly stops being enforced, with nothing in the log to say so.
        const list = domains(DNR_BLOCKLIST_MAX_RULES + 3);
        const out = family.build(list);
        assert.equal(out.addRules.length, DNR_BLOCKLIST_MAX_RULES, "capped");
        assert.deepEqual(out.dropped, list.slice(DNR_BLOCKLIST_MAX_RULES),
          "the dropped domains are the tail, and are reported so the caller can log them");
        assert.equal(out.dropped.length, 3);
      });

      test("no generated id ever escapes the declared range", () => {
        const out = family.build(domains(DNR_BLOCKLIST_MAX_RULES + 10));
        for (const rule of out.addRules) {
          assert.ok(family.range.includes(rule.id),
            `id ${rule.id} is outside the declared range for ${family.name}`);
        }
      });

      test("the exported range is frozen, and building does not mutate it", () => {
        const before = [...family.range];
        family.build(domains(3)).removeRuleIds.push(999999);
        assert.deepEqual([...family.range], before,
          "removeRuleIds must be a copy — a caller mutating it must not corrupt the shared range");
      });
    });
  }
});

describe("#1268 — the four id families cannot collide", () => {

  test("the two blocklist ranges are disjoint", () => {
    // They are deliberately non-adjacent: referer removal and beacon blocking
    // are distinct DNR action types, so a blacklisted domain needs a rule from
    // BOTH families at once. An overlap would silently drop one of them.
    const overlap = BLOCKLIST_REFERER_RULE_ID_RANGE
      .filter((id) => BLOCKLIST_BEACON_RULE_ID_RANGE.includes(id));
    assert.deepEqual(overlap, []);
  });

  test("neither global rule id falls inside a blocklist range", () => {
    for (const id of [DNR_SUPPRESS_REFERER_RULE_ID, DNR_BLOCK_BEACONS_RULE_ID]) {
      assert.ok(!BLOCKLIST_REFERER_RULE_ID_RANGE.includes(id), `${id} collides with the referer range`);
      assert.ok(!BLOCKLIST_BEACON_RULE_ID_RANGE.includes(id), `${id} collides with the beacon range`);
    }
  });

  test("the two global rule ids differ", () => {
    assert.notEqual(DNR_SUPPRESS_REFERER_RULE_ID, DNR_BLOCK_BEACONS_RULE_ID);
  });
});
