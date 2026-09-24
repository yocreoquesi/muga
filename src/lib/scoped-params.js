/**
 * MUGA: host lookup for the signed channel's host-scoped facts (#1409).
 *
 * `remoteRulesMeta.scopedFacts` is fact-major: `{ param, hosts[] }`. The DNR
 * sync turns it into requestDomains-scoped rules, which match a host and every
 * subdomain of it. processUrl needs the same answer per URL, so this inverts
 * the facts once into host -> params and walks the hostname's suffixes, which
 * keeps each lookup O(labels) instead of O(facts).
 *
 * Kept separate from remote-rules.js (the channel's fetch/verify/apply logic)
 * because the cleaner, which is bundled into content scripts, needs only this
 * pure lookup. The suffix semantics match scopedParamsForHost() there.
 */

/** Facts array -> Map<host, Set<lowercase param>>, built once per array. */
const _indexByFacts = new WeakMap();

/**
 * @param {Array<{param: string, hosts: string[]}>} facts
 * @returns {Map<string, Set<string>>}
 */
function indexFor(facts) {
  let index = _indexByFacts.get(facts);
  if (index) return index;
  index = new Map();
  for (const fact of facts) {
    if (!fact || typeof fact.param !== "string" || fact.param.length === 0 || !Array.isArray(fact.hosts)) continue;
    const param = fact.param.toLowerCase();
    for (const h of fact.hosts) {
      if (typeof h !== "string" || h.length === 0) continue;
      const host = h.toLowerCase();
      let set = index.get(host);
      if (!set) { set = new Set(); index.set(host, set); }
      set.add(param);
    }
  }
  _indexByFacts.set(facts, index);
  return index;
}

/**
 * The lowercase params the scoped facts strip on `hostname`: facts anchored to
 * the host itself or to any parent domain of it.
 *
 * @param {string} hostname
 * @param {Array<{param: string, hosts: string[]}>|null|undefined} facts
 * @returns {Set<string>}
 */
export function scopedParamsForHostname(hostname, facts) {
  const out = new Set();
  if (typeof hostname !== "string" || hostname.length === 0) return out;
  if (!Array.isArray(facts) || facts.length === 0) return out;

  const index = indexFor(facts);
  let host = hostname.toLowerCase();
  for (;;) {
    const params = index.get(host);
    if (params) for (const p of params) out.add(p);
    const dot = host.indexOf(".");
    if (dot === -1) break;
    host = host.slice(dot + 1);
  }
  return out;
}
