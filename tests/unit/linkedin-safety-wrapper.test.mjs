/**
 * MUGA — LinkedIn outbound "safety redirect" wrapper.
 *
 * LinkedIn routes every external link through an interstitial safety redirect:
 *   https://www.linkedin.com/safety/go/?url=<encoded destination>&urlhash=..&mt=<tracking token>&isSdui=true
 *
 * This is a pure link-safety redirect, NOT an affiliate network (no merchant
 * attribution to preserve — unlike Awin/Impact, which #907 deliberately keeps
 * as pass-through). So it is safe to unwrap: reveal the real destination and
 * drop LinkedIn's own tracking cruft (mt / urlhash / isSdui).
 *
 * detectWrapper()/unwrap() only act on EXPLICIT, vetted per-host recipes (the
 * generic ?url= fallback was removed in #907), so this recipe is scoped to the
 * linkedin.com host AND the /safety/go path — a bare profile/feed URL that
 * happens to carry a `url` param must NOT be unwrapped.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { unwrap, detectWrapper } from "../../src/lib/wrapper-engine.js";
import { WRAPPERS_RAW } from "../../src/rules/wrappers.data.js";
import { processUrl } from "../../src/lib/cleaner.js";

const DEST =
  "https://www.latribunadeautomocion.es/2026/07/aesc-extremadura-fabricara-baterias-para-vehiculos-sobre-todo-industriales-y-estacionarias-y-acogera-a-proveedores-en-su-terreno/?swcfpc=1";
const LINK =
  "https://www.linkedin.com/safety/go/?url=" +
  "https%3A%2F%2Fwww%2Elatribunadeautomocion%2Ees%2F2026%2F07%2Faesc-extremadura-fabricara-baterias-para-vehiculos-sobre-todo-industriales-y-estacionarias-y-acogera-a-proveedores-en-su-terreno%2F%3Fswcfpc%3D1" +
  "&urlhash=NIDv&mt=po12JG4b8XEF_B2SH1aZPL8OzQgn_AY7Ahovc0c8qM-VdzXPhhKpweeGOVd&isSdui=true";

const PREFS = {
  enabled: true,
  injectOwnAffiliate: false,
  notifyForeignAffiliate: false,
  stripAllAffiliates: false,
  whitelist: [],
  blacklist: [],
};

describe("LinkedIn safety-redirect wrapper", () => {
  test("detectWrapper recognizes the safety/go recipe", () => {
    const w = detectWrapper(LINK);
    assert.equal(w?.id, "linkedin-safety");
  });

  test("unwrap reveals the real destination and drops LinkedIn's tracking cruft", () => {
    const r = unwrap(LINK);
    assert.ok(r, "the link must unwrap");
    assert.equal(r.unwrapped, DEST, "unwrapped URL must equal the decoded destination");
    // LinkedIn's own params must not survive.
    for (const noise of ["urlhash", "mt=", "isSdui", "linkedin.com"]) {
      assert.ok(!r.unwrapped.includes(noise), `unwrapped URL must not carry '${noise}'`);
    }
  });

  test("processUrl end-to-end resolves to the destination host", () => {
    const r = processUrl(LINK, PREFS, []);
    assert.equal(new URL(r.cleanUrl).host, "www.latribunadeautomocion.es");
  });

  test("SAFETY: a linkedin.com URL WITHOUT the /safety/go path is not unwrapped", () => {
    const notRedirect = "https://www.linkedin.com/feed/?url=https%3A%2F%2Fevil.example%2Fx";
    assert.equal(detectWrapper(notRedirect), null, "only the /safety/go path is a wrapper");
    assert.equal(unwrap(notRedirect), null);
  });

  test("SAFETY: a non-http(s) destination is rejected (no javascript: unwrap)", () => {
    const hostile = "https://www.linkedin.com/safety/go/?url=javascript%3Aalert(1)";
    assert.equal(unwrap(hostile), null, "extractFromParam must reject non-http(s) schemes");
  });

  test("wrappers.data.js carries the linkedin-safety recipe with the expected extractor", () => {
    const entry = WRAPPERS_RAW.find((w) => w.id === "linkedin-safety");
    assert.ok(entry, "linkedin-safety recipe must exist in wrappers.data.js");
    assert.deepEqual(entry.hostPatterns, ["linkedin.com", "www.linkedin.com"]);
    assert.equal(entry.pathPrefix, "/safety/go");
    assert.equal(entry.extractor.kind, "fromParam");
    assert.equal(entry.extractor.paramName, "url");
  });
});
