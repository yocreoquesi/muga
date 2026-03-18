/**
 * MUGA — Base de datos de patrones de afiliados y tracking
 *
 * Cada entrada define:
 *   - domains: dominios donde aplica el patrón
 *   - param: nombre del parámetro en la URL
 *   - type: 'affiliate' | 'tracking'
 *   - ourTag: nuestro valor de afiliado (solo si tenemos cuenta activa)
 *
 * Para añadir un nuevo programa:
 * 1. Añade la entrada al array AFFILIATE_PATTERNS
 * 2. Registra la cuenta en el programa correspondiente
 * 3. Rellena ourTag con tu ID de afiliado
 */

export const TRACKING_PARAMS = [
  // Google / Meta / Microsoft
  "utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term",
  "utm_id", "utm_source_platform", "utm_creative_format", "utm_marketing_tactic",
  "fbclid", "gclid", "gclsrc", "dclid", "gbraid", "wbraid",
  "msclkid", "tclid", "twclid",
  // Email marketing
  "mc_cid", "mc_eid", "MailingID", "HQEmail",
  // Social
  "igshid", "igsh", "s_cid",
  // Generic
  "ref", "source", "campaign", "cid", "clickid",
  "_hsenc", "_hsmi", "hsCtaTracking",
  "mkt_tok", "trk", "trkCampaign",
  // E-commerce internos (no funcionales para el usuario)
  "psc", "spLa", "pd_rd_r", "pd_rd_w", "pd_rd_wg",
  "pf_rd_p", "pf_rd_r",
];

export const AFFILIATE_PATTERNS = [
  {
    id: "amazon_es",
    name: "Amazon España",
    domains: ["amazon.es", "www.amazon.es"],
    param: "tag",
    type: "affiliate",
    ourTag: "",  // TODO: rellenar con tu Amazon Associates tag cuando lo tengas
  },
  {
    id: "amazon_de",
    name: "Amazon Alemania",
    domains: ["amazon.de", "www.amazon.de"],
    param: "tag",
    type: "affiliate",
    ourTag: "",
  },
  {
    id: "amazon_fr",
    name: "Amazon Francia",
    domains: ["amazon.fr", "www.amazon.fr"],
    param: "tag",
    type: "affiliate",
    ourTag: "",
  },
  {
    id: "amazon_it",
    name: "Amazon Italia",
    domains: ["amazon.it", "www.amazon.it"],
    param: "tag",
    type: "affiliate",
    ourTag: "",
  },
  {
    id: "amazon_co_uk",
    name: "Amazon UK",
    domains: ["amazon.co.uk", "www.amazon.co.uk"],
    param: "tag",
    type: "affiliate",
    ourTag: "",
  },
  {
    id: "amazon_com",
    name: "Amazon US",
    domains: ["amazon.com", "www.amazon.com"],
    param: "tag",
    type: "affiliate",
    ourTag: "",
  },
  {
    id: "booking",
    name: "Booking.com",
    domains: ["booking.com", "www.booking.com"],
    param: "aid",
    type: "affiliate",
    ourTag: "",  // TODO: rellenar con tu Booking Partner ID
  },
  {
    id: "aliexpress",
    name: "AliExpress",
    domains: ["aliexpress.com", "es.aliexpress.com", "www.aliexpress.com"],
    param: "aff_fcid",
    type: "affiliate",
    ourTag: "",
  },
  {
    id: "pccomponentes",
    name: "PcComponentes",
    domains: ["pccomponentes.com", "www.pccomponentes.com"],
    param: "ref",
    type: "affiliate",
    ourTag: "",
  },
  {
    id: "el_corte_ingles",
    name: "El Corte Inglés",
    domains: ["elcorteingles.es", "www.elcorteingles.es"],
    param: "affiliateId",
    type: "affiliate",
    ourTag: "",
  },
];

/**
 * Dado un hostname, devuelve todos los patrones de afiliado que aplican.
 * @param {string} hostname
 * @returns {Array}
 */
export function getPatternsForHost(hostname) {
  const host = hostname.replace(/^www\./, "");
  return AFFILIATE_PATTERNS.filter(p =>
    p.domains.some(d => d.replace(/^www\./, "") === host)
  );
}

/**
 * Devuelve true si el parámetro es de tracking puro (no afiliado).
 * @param {string} param
 * @returns {boolean}
 */
export function isTrackingParam(param) {
  return TRACKING_PARAMS.includes(param.toLowerCase());
}
