/** MUGA: Opaque affiliate networks — wrappers that cannot be unwrapped client-side */
//
// Adding entries here is security-relevant. Goes through proposal review
// (caps-spec or muga RFC).
//
// These are redirect-network intermediaries whose destination URL is NOT
// embedded in the redirect URL (e.g. stored server-side behind a click ID).
// Client-side unwrapping is impossible; the Privacy Proxy tier handles them
// when the user has opted in (privacyProxyEnabled = true).
//
// Source references for each entry:
//   - s.click.aliexpress.com  — AliExpress affiliate click tracker
//   - anrdoezrs.net / dpbolvw.net / jdoqocy.com / kqzyfj.com /
//     tkqlhce.com / emjcd.com / qksrv.net / cj.dotomi.com
//       — CJ Affiliate (Commission Junction) redirect domains
//         (caps-spec manifest.json, program id: cj-affiliate)
//   - ad.admitad.com — Admitad CPA network

export const OPAQUE_NETWORKS = Object.freeze([
  // AliExpress affiliate click tracker
  "s.click.aliexpress.com",

  // CJ Affiliate (Commission Junction) — all redirect domains from caps-spec
  "anrdoezrs.net",
  "dpbolvw.net",
  "jdoqocy.com",
  "kqzyfj.com",
  "tkqlhce.com",
  "emjcd.com",
  "qksrv.net",
  "cj.dotomi.com",

  // Admitad CPA network
  "ad.admitad.com",
]);
