/**
 * MUGA — moat-expansion known-program lookup table (#793).
 *
 * Muga-authored static map from well-known ClearURLs provider keys to
 * canonical domain arrays and a program id. This is NOT derived from
 * or copied from upstream ClearURLs files — it is clean-room MUGA-authored
 * content mapping ClearURLs provider key identifiers to MUGA's own
 * AFFILIATE_PATTERNS program identifiers.
 *
 * Usage (named export only — no default):
 *   import { KNOWN_PROGRAMS } from "./lookup-table.mjs";
 *   const entry = KNOWN_PROGRAMS["amazon"];
 *   // → { programId: "amazon-associates", domains: [...], note: "..." }
 *
 * Schema: { [providerKey: string]: { programId: string, domains: string[], note: string } }
 *
 * programId maps to existing AFFILIATE_PATTERNS / REDIRECT_NETWORK_PATTERNS
 * ids so the differ can resolve what is "known" in the current affiliate moat.
 *
 * Refs #793. See PROVENANCE.md for ClearURLs license context.
 */

/**
 * Known-program lookup table — v1 seed set.
 *
 * For a provider whose key is present here, the differ uses this entry's
 * domains[] as the canonical domain set. For unknown providers (key absent),
 * the differ passes the raw urlPattern through without domain inference.
 *
 * @type {Record<string, { programId: string, domains: string[], note: string }>}
 */
export const KNOWN_PROGRAMS = {
  amazon: {
    programId: "amazon-associates",
    domains: [
      "amazon.com",
      "amazon.es",
      "amazon.de",
      "amazon.fr",
      "amazon.it",
      "amazon.co.uk",
      "amazon.ca",
      "amazon.com.br",
      "amazon.com.mx",
      "amazon.co.jp",
    ],
    note:
      "Amazon Associates program. ClearURLs provider key 'amazon'. " +
      "Referral tag param is 'tag'; ascsubtag covered by AFFILIATE_PARAM_GUARD.",
  },

  ebay: {
    programId: "ebay-partner-network",
    domains: [
      "ebay.com",
      "ebay.es",
      "ebay.de",
      "ebay.co.uk",
      "ebay.fr",
      "ebay.it",
      "ebay.com.au",
      "ebay.ca",
    ],
    note:
      "eBay Partner Network. ClearURLs provider key 'ebay'. " +
      "Primary referral param is 'campid'.",
  },

  aliexpress: {
    programId: "aliexpress-affiliate",
    domains: ["aliexpress.com", "s.click.aliexpress.com", "best.aliexpress.com"],
    note:
      "AliExpress affiliate program. ClearURLs provider key 'aliexpress'. " +
      "Traffic routed via s.click.aliexpress.com click-tracker.",
  },

  awin: {
    programId: "awin",
    domains: ["awin1.com", "www.awin1.com"],
    note:
      "AWIN affiliate network. ClearURLs provider key 'awin'. " +
      "Landing params (awc) also covered by REDIRECT_NETWORK_PATTERNS.",
  },

  impact: {
    programId: "impact-radius",
    domains: [
      "impact.com",
      "app.impact.com",
      "impactradius.com",
    ],
    note:
      "Impact (formerly Impact Radius) affiliate network. " +
      "ClearURLs provider key 'impact'. Multiple vanity domains in use.",
  },

  cj: {
    programId: "cj-affiliate",
    domains: [
      "anrdoezrs.net",
      "dpbolvw.net",
      "jdoqocy.com",
      "kqzyfj.com",
      "lduhtrp.net",
      "tkqlhce.com",
      "commission-junction.com",
    ],
    note:
      "CJ Affiliate (Commission Junction). ClearURLs provider key 'cj'. " +
      "Uses a fleet of vanity redirect domains for tracking links.",
  },
};
