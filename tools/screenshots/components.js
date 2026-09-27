/** MUGA brand kit: DOM/SVG builders shared by every still template. */

// ── The mark ─────────────────────────────────────────────
// Path data is byte-identical to muga/src/icons/muga-mark.svg (viewBox 0 0 104 68).
export const MARK_STROKE = "M 12 56 C 12 8, 46 8, 52 46 L 62 22 L 72 50 L 84 50";
export const MARK_HEAD = "M 80 37 L 98 50 L 80 63 Z";

/** Canonical mark in its own 104x68 box. */
export function markSVG({ color = "currentColor", height = 20, cls = "" } = {}) {
  const w = (height * 104) / 68;
  return `<svg class="${cls}" viewBox="0 0 104 68" width="${w.toFixed(2)}" height="${height}" fill="none" aria-label="MUGA">
  <path d="${MARK_STROKE}" stroke="${color}" stroke-width="10" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
  <path d="${MARK_HEAD}" fill="${color}" stroke="${color}" stroke-width="2" stroke-linejoin="round"/></svg>`;
}

/**
 * The Signal Path diagram: the mark annotated in its own coordinate space
 * (same composition as the muga.app hero). `junk` may be a string, or
 * "dashes" for a text-free rendition (small promo tile).
 */
export function signalSVG({
  labels = ["noisy in", "tracking cut", "clean out"],
  junk = "?utm_source=newsletter&fbclid=IwAR2x",
  strike = false,
  stroke = "var(--accent-ink)",
  width = "100%",
  showBase = true,
  showTicks = true,
} = {}) {
  let junkEl = "";
  if (junk === "dashes") {
    // Text-free stand-in for tracking params: short red segments peeling up-left.
    junkEl = [[-3, -13, 13], [13, -13, 9], [25, -13, 15], [43, -13, 7], [53, -13, 12]]
      .map(([x, y, l], i) => `<line x1="${x}" y1="${y + i * 0.0}" x2="${x + l}" y2="${y}" stroke="var(--bad)" stroke-width="2.2" stroke-linecap="round" opacity="${0.95 - i * 0.12}"/>`)
      .join("") +
      `<line x1="-3" y1="-5" x2="36" y2="-5" stroke="var(--rule-2)" stroke-width="0.6"/>`;
  } else if (junk) {
    junkEl = `<text class="sig-junk" x="-4" y="-12" ${strike ? 'fill="var(--bad)" text-decoration="line-through"' : ""}>${esc(junk)}</text>`;
    if (strike) junkEl += `<line x1="-4" y1="-13.2" x2="${-4 + junk.length * 2.05}" y2="-13.2" stroke="var(--bad)" stroke-width="0.5"/>`;
  }
  const ticks = showTicks
    ? [24, 59, 95].map((x) => `<line x1="${x}" y1="70" x2="${x}" y2="64" stroke="var(--rule-2)" stroke-width="0.6"/>`).join("")
    : "";
  const lbl = labels
    ? labels.map((t, i) => `<text class="sig-lbl" x="${[24, 59, 95][i]}" y="79" text-anchor="middle">${esc(t)}</text>`).join("")
    : "";
  return `<svg class="signal" viewBox="-6 -22 122 112" width="${width}" fill="none" role="img" aria-label="MUGA signal path">
  ${showBase ? `<line x1="-4" y1="50" x2="114" y2="50" stroke="var(--rule)" stroke-width="0.6" stroke-dasharray="2 3"/>` : ""}
  ${junkEl}
  <path d="${MARK_STROKE}" stroke="${stroke}" stroke-width="10" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="${MARK_HEAD}" fill="${stroke}" stroke="${stroke}" stroke-width="2" stroke-linejoin="round"/>
  ${ticks}${lbl}</svg>`;
}

export function esc(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// ── Example URLs (neutral domains only) ─────────────────
export const URLS = {
  shopDirty: "https://shop.example/p/linen-shirt?utm_source=newsletter&utm_medium=email&utm_campaign=autumn_drop&size=m&utm_content=hero_button&fbclid=IwAR2xK9pQ7vLmZ3sT8&gclid=Cj0KCQjw8rTBhD&mc_eid=8f2a91c7",
  shopClean: "https://shop.example/p/linen-shirt?size=m",
  newsDirty: "https://news.example/2026/09/city-cycling-lanes?utm_source=social&utm_medium=share&utm_campaign=sept&fbclid=IwAR0pZ7yQ3&mc_eid=8f2a91",
  newsClean: "https://news.example/2026/09/city-cycling-lanes",
  wrapper: "https://l.social.example/l.php?u=https%3A%2F%2Fnews.example%2F2026%2F09%2Fcity-cycling-lanes&h=AT0x9Kq2",
  short: "https://go.example/x7Kp2",
};
export const TRACKERS = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "fbclid", "gclid", "mc_eid", "h"];
/** Params the page actually uses: shown in green, they survive cleaning. */
export const NEEDED = ["size"];

/**
 * Colour a URL: clutter params red (optionally struck), params the page needs green,
 * the rest in the current ink. Returns HTML.
 */
export function urlHTML(url, { strike = false, dimBase = false, markNeeded = true } = {}) {
  const q = url.indexOf("?");
  if (q < 0) return `<span class="u-base">${esc(url)}</span>`;
  const base = url.slice(0, q);
  const parts = url.slice(q + 1).split("&");
  const out = [`<span class="u-base${dimBase ? " dim" : ""}">${esc(base)}</span><span class="u-sep">?</span>`];
  parts.forEach((p, i) => {
    const k = p.split("=")[0];
    const cls = TRACKERS.includes(k) ? `u-bad${strike ? " strike" : ""}` : NEEDED.includes(k) && markNeeded ? "u-good" : "u-keep";
    if (i) out.push(`<span class="u-sep">&amp;</span>`);
    out.push(`<span class="${cls}">${esc(p)}</span>`);
  });
  return out.join("");
}

export function pctShorter(a, b) {
  return Math.round((1 - b.length / a.length) * 100);
}

// ── Icons (simple strokes) ──────────────────────────────
const I = {
  back: '<path d="M15 6l-6 6 6 6"/>',
  fwd: '<path d="M9 6l6 6-6 6"/>',
  reload: '<path d="M19 12a7 7 0 1 1-2.05-4.95"/><path d="M19 5v4h-4"/>',
  lock: '<rect x="6" y="11" width="12" height="9" rx="2"/><path d="M8.5 11V8a3.5 3.5 0 0 1 7 0v3"/>',
  tune: '<path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/>',
  star: '<path d="M12 4l2.4 5 5.3.6-4 3.6 1.1 5.3L12 16l-4.8 2.5 1.1-5.3-4-3.6 5.3-.6z"/>',
  puzzle: '<path d="M10 4h4v3a1.5 1.5 0 0 0 3 0V4h3v6h-3a1.5 1.5 0 0 0 0 3h3v7h-6v-3a1.5 1.5 0 0 0-3 0v3H4v-7h3a1.5 1.5 0 0 0 0-3H4V4z"/>',
  menu: '<circle cx="12" cy="6" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="12" cy="18" r="1.3"/>',
  burger: '<path d="M5 7h14M5 12h14M5 17h14"/>',
  shield: '<path d="M12 4l7 3v5c0 4-3 7-7 8-4-1-7-4-7-8V7z"/>',
  close: '<path d="M7 7l10 10M17 7L7 17"/>',
  min: '<path d="M6 12h12"/>',
  max: '<rect x="7" y="7" width="10" height="10"/>',
  plus: '<path d="M12 6v12M6 12h12"/>',
  ext: '<path d="M14 5h5v5M19 5l-8 8M18 14v4a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h4"/>',
  newtab: '<rect x="4" y="6" width="16" height="12" rx="2"/><path d="M12 9v6M9 12h6"/>',
  copy: '<rect x="8" y="8" width="11" height="11" rx="2"/><path d="M16 8V6a1 1 0 0 0-1-1H6a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1h2"/>',
  save: '<path d="M12 5v10M8 11l4 4 4-4M6 19h12"/>',
  window: '<rect x="4" y="5" width="16" height="14" rx="2"/><path d="M4 9h16"/>',
  incog: '<circle cx="8" cy="15" r="2.5"/><circle cx="16" cy="15" r="2.5"/><path d="M4 11h16M7 11l1.5-5h7L17 11"/>',
  inspect: '<path d="M5 5h14v10H5zM9 19h6"/>',
};
export function icon(name, { size = 16, sw = 1.7, color = "currentColor" } = {}) {
  return `<svg class="ico" viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="${color}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round">${I[name]}</svg>`;
}

// ── Browser frames ──────────────────────────────────────
/**
 * Browser window replica. browser: "chrome" | "firefox"; theme: "light" | "dark".
 * `url` is shown in the address bar (host bold, rest muted); `content` fills the page.
 */
export function browserFrame({ browser = "chrome", theme = "light", url = URLS.newsClean, tab = "City cycling lanes", content = "", w = 1000, h = 640, activeExt = false, overlay = "" }) {
  const u = url.replace(/^https?:\/\//, "");
  const host = u.split("/")[0];
  const rest = u.slice(host.length);
  const tabIcon = `<span class="bf-fav"></span>`;
  const extBtn = `<span class="bf-ext${activeExt ? " on" : ""}">${markSVG({ height: 11, color: "var(--mark)" })}</span>`;
  if (browser === "firefox") {
    return `<div class="bf ff ${theme}" style="width:${w}px;height:${h}px">
  <div class="bf-strip">
    <span class="ff-tabs-btn">${icon("burger", { size: 14 })}</span>
    <div class="bf-tab active">${tabIcon}<span class="bf-tt">${esc(tab)}</span>${icon("close", { size: 12 })}</div>
    <div class="bf-tab">${tabIcon.replace("bf-fav", "bf-fav alt")}<span class="bf-tt">New Tab</span></div>
    <span class="bf-newtab">${icon("plus", { size: 14 })}</span>
    <span class="bf-grow"></span>
    <span class="bf-win">${icon("min", { size: 14 })}${icon("max", { size: 12 })}${icon("close", { size: 14 })}</span>
  </div>
  <div class="bf-bar">
    ${icon("back")}${icon("fwd")}${icon("reload")}
    <div class="bf-omni">${icon("shield", { size: 14 })}${icon("lock", { size: 13 })}<span class="bf-url"><b>${esc(host)}</b>${esc(rest)}</span>${icon("star", { size: 15 })}</div>
    ${extBtn}${icon("puzzle", { size: 16 })}${icon("burger", { size: 16 })}
  </div>
  <div class="bf-page">${content}${overlay}</div></div>`;
  }
  return `<div class="bf cr ${theme}" style="width:${w}px;height:${h}px">
  <div class="bf-strip">
    <div class="bf-tab active">${tabIcon}<span class="bf-tt">${esc(tab)}</span>${icon("close", { size: 12 })}</div>
    <div class="bf-tab">${tabIcon.replace("bf-fav", "bf-fav alt")}<span class="bf-tt">New Tab</span></div>
    <span class="bf-newtab">${icon("plus", { size: 14 })}</span>
    <span class="bf-grow"></span>
    <span class="bf-win">${icon("min", { size: 14 })}${icon("max", { size: 12 })}${icon("close", { size: 14 })}</span>
  </div>
  <div class="bf-bar">
    ${icon("back")}${icon("fwd")}${icon("reload")}
    <div class="bf-omni">${icon("tune", { size: 14 })}<span class="bf-url"><b>${esc(host)}</b>${esc(rest)}</span>${icon("star", { size: 15 })}</div>
    ${extBtn}${icon("puzzle", { size: 16 })}<span class="bf-avatar"></span>${icon("menu", { size: 16 })}
  </div>
  <div class="bf-page">${content}${overlay}</div></div>`;
}

/** A neutral article page (wireframe-ish, so the MUGA UI stays the subject). */
export function articlePage({ theme = "light", title = "City adds 40 km of protected cycling lanes", kicker = "news.example · City", link = false, linkFirst = false, hover = false } = {}) {
  const lp = `<p class="pg-p">The full route map is in <a class="pg-a${hover ? " hover" : ""}" id="pg-link">our cycling lanes guide</a>, updated weekly.</p>`;
  return `<div class="pg ${theme}">
  <div class="pg-nav"><span class="pg-logo">news.example</span><span class="pg-links"><i></i><i></i><i></i><i></i></span></div>
  <div class="pg-body">
    <div class="pg-kicker">${esc(kicker)}</div>
    <h1 class="pg-h1">${esc(title)}</h1>
    <div class="pg-meta"><i></i><i style="width:90px"></i></div>
    ${linkFirst ? lp : ""}
    <div class="pg-hero"></div>
    ${link && !linkFirst ? lp : `<p class="pg-p"><i></i></p>`}
    <div class="pg-lines"><i></i><i></i><i style="width:78%"></i><i></i><i style="width:64%"></i></div>
  </div></div>`;
}

export function shopPage({ theme = "light" } = {}) {
  return `<div class="pg ${theme}">
  <div class="pg-nav"><span class="pg-logo">shop.example</span><span class="pg-links"><i></i><i></i><i></i></span></div>
  <div class="pg-shop">
    <div class="pg-img"></div>
    <div class="pg-info">
      <div class="pg-kicker">Shirts · Linen</div>
      <h1 class="pg-h1 sm">Linen shirt, relaxed fit</h1>
      <div class="pg-price">€49</div>
      <div class="pg-lines"><i></i><i style="width:82%"></i><i style="width:60%"></i></div>
      <div class="pg-btn"></div>
    </div>
  </div></div>`;
}

// ── Popup replica (src/popup/popup.html + popup.css) ────
export function popup({ theme = "light", lang = "en", before = URLS.newsDirty, after = URLS.newsClean, removed = ["utm_source", "utm_medium", "utm_campaign", "fbclid", "mc_eid"], stats = [37, 112], unwrap = null } = {}) {
  const S = lang === "es"
    ? { page: "Esta página", badge: "eliminados en esta pestaña", pause: "Pausar la limpieza en este sitio", count: `MUGA eliminó ${removed.length} bits de ruido de esta URL`, shorter: (n) => `Este enlace es un ${n}% más corto`, removed: "Eliminados:", s1: "URLs limpias", s2: "bits de ruido eliminados", settings: "Ajustes →", rate: "Valorar MUGA", support: "Apoyar ♥", terms: "Términos de uso", privacy: "Política de privacidad", unwrap: (h) => `Destino real revelado: ${h}` }
    : { page: "This page", badge: "stripped in this tab", pause: "Pause cleaning on this site", count: `MUGA removed ${removed.length} bits of noise from this URL`, shorter: (n) => `This link is ${n}% shorter`, removed: "Removed:", s1: "URLs cleaned", s2: "bits of noise removed", settings: "Settings →", rate: "Rate MUGA", support: "Support ♥", terms: "Terms of use", privacy: "Privacy policy", unwrap: (h) => `Real destination revealed: ${h}` };
  const pct = pctShorter(before, after);
  const kept = 100 - pct;
  return `<div class="pp ${theme}">
  <header><div class="pp-brand">${markSVG({ height: 16, color: "var(--pp-accent)" })}<span class="pp-logo">MUGA</span></div><span class="pp-toggle on"><i></i></span></header>
  <section class="pp-preview">
    <div class="pp-ph"><span class="pp-plabel">${S.page}</span><span class="pp-badge">${removed.length} ${S.badge}</span></div>
    <button class="pp-pause">${S.pause}</button>
    <div class="pp-url before">${esc(before.replace(/^https:\/\//, ""))}</div>
    <div class="pp-url after">${esc(after.replace(/^https:\/\//, ""))}</div>
    <div class="pp-count">${S.count}</div>
    <p class="pp-shorter">${S.shorter(pct)}</p>
    <div class="pp-bar"><i style="width:${kept}%"></i><b style="width:${pct}%"></b></div>
    ${unwrap ? `<p class="pp-unwrap">${esc(S.unwrap(unwrap))}</p>` : ""}
    <div class="pp-removed">${S.removed} ${esc(removed.join(", "))}</div>
  </section>
  <section class="pp-stats"><div><span class="v">${stats[0]}</span><span class="l">${S.s1}</span></div><div><span class="v">${stats[1]}</span><span class="l">${S.s2}</span></div></section>
  <footer><span>${S.settings}</span><span>${S.rate}</span><span>${S.support}</span></footer>
  <div class="pp-legal"><span>${S.terms}</span><em>·</em><span>${S.privacy}</span></div></div>`;
}

// ── Affiliate toast replica (src/content/cleaner.js showAffiliateNotice) ──
export function toast({ lang = "en", host = "shop.example", tag = "aff=deals_hub" } = {}) {
  const S = lang === "es"
    ? { t: "MUGA encontró el tag de afiliado de otro", m: "lleva un tag de afiliado de terceros:", a: "Mantenerlo", b: "Eliminarlo", d: "Descartar" }
    : { t: "MUGA found someone else's affiliate tag", m: "carries a third-party affiliate tag:", a: "Keep it", b: "Remove it", d: "Dismiss" };
  return `<div class="tst" role="alert"><div class="tst-t">${S.t}</div><div class="tst-m">${esc(host)} ${S.m} <code>${esc(tag)}</code></div><div class="tst-b"><span>${S.a}</span><span>${S.b}</span></div><div class="tst-d">${S.d}</div></div>`;
}

/** Hover-preview tooltip replica (src/content/hover-preview.js "Goes to:"). */
export function hoverTip({ lang = "en", dest = "shop.example/p/linen-shirt" } = {}) {
  return `<div class="hov"><span class="hov-l">${lang === "es" ? "Va a:" : "Goes to:"}</span> <span class="hov-u">${esc(dest)}</span></div>`;
}

/** Chrome-style link context menu with MUGA's "Copy clean link" item. */
export function contextMenu({ theme = "light", lang = "en", browser = "chrome" } = {}) {
  const L = lang === "es"
    ? ["Abrir enlace en una pestaña nueva", "Abrir enlace en una ventana nueva", "Abrir enlace en una ventana de incógnito", "Guardar enlace como...", "Copiar dirección del enlace", "Copiar enlace limpio", "Inspeccionar"]
    : browser === "firefox"
      ? ["Open Link in New Tab", "Open Link in New Window", "Open Link in New Private Window", "Save Link As...", "Copy Link", "Copy clean link", "Inspect"]
      : ["Open link in new tab", "Open link in new window", "Open link in incognito window", "Save link as...", "Copy link address", "Copy clean link", "Inspect"];
  const row = (ic, t, cls = "") => `<div class="cm-i ${cls}">${ic}<span>${esc(t)}</span></div>`;
  return `<div class="cm ${theme} ${browser}">
  ${row(icon("newtab", { size: 15 }), L[0])}${row(icon("window", { size: 15 }), L[1])}${row(icon("incog", { size: 15 }), L[2])}
  <div class="cm-sep"></div>${row(icon("save", { size: 15 }), L[3])}${row(icon("copy", { size: 15 }), L[4])}
  <div class="cm-sep"></div>${row(`<span class="cm-mark">${markSVG({ height: 10, color: "var(--mark)" })}</span>`, L[5], "hl")}
  <div class="cm-sep"></div>${row(icon("inspect", { size: 15 }), L[6])}</div>`;
}

/** Settings page replica (src/options/options.html), real rows and strings. */
export function optionsPage({ theme = "light", lang = "en" } = {}) {
  const es = lang === "es";
  const row = (t, s, on) => `<div class="op-row"><div class="op-l"><strong>${esc(t)}</strong>${s ? `<small>${esc(s)}</small>` : ""}</div><span class="pp-toggle${on ? " on" : ""}"><i></i></span></div>`;
  return `<div class="op ${theme}">
  <h1>${es ? "Ajustes" : "Settings"}</h1><p class="op-sub">${es ? "Limpia las URLs que visitas y compartes." : "Clean the URLs you visit and share."}</p>
  <h2>General</h2>
  <div class="op-card">
    ${row(es ? "Menú contextual → Copiar enlace o selección limpia" : "Right-click → Copy clean link or selection", es ? "Funciona con un enlace, una selección con varias URLs, o URLs en texto plano. Ctrl+C también limpia automáticamente las URLs de tu selección." : "Works on a single link, a text selection with multiple URLs, or plain-text URLs. Ctrl+C also auto-cleans URLs in your selection.", true)}
  </div>
  <h2>${es ? "Seguir redirecciones de acortadores" : "Follow shortener redirects"}</h2>
  <div class="op-card">
    ${row(es ? "Resolver enlaces cortos al abrirlos" : "Resolve short links when you open them", "", true)}
    ${row(es ? "Resolver también al pasar el ratón por encima" : "Also resolve short links on hover", es ? "Contacta con el acortador y con el sitio de destino antes de que hagas clic" : "Contacts the shortener and the destination site before you click", false)}
  </div>
  <h2>${es ? "Actualización remota de reglas" : "Remote rule updates"}</h2>
  <div class="op-card">
    ${row(es ? "Activar actualizaciones semanales" : "Enable weekly updates", es ? "Descarga actualizaciones semanales firmadas de la lista de parámetros de rastreo." : "Download weekly signed updates to the list of tracking parameters. On by default; disable it here at any time.", true)}
  </div>
  <h2>${es ? "Afiliados y creadores" : "Affiliate &amp; creators"}</h2>
  <div class="op-card">
    ${row(es ? "Avisarme cuando un enlace tenga la etiqueta de afiliado de otro" : "Alert me when a link has someone else's affiliate tag", "", true)}
  </div></div>`;
}

/** Chat thread mock: the same link pasted messy vs clean. */
export function chatMock({ lang = "en", messy = true, clean = true, w = 420, url, cleanUrl, msg } = {}) {
  const es = lang === "es";
  return `<div class="chat" style="width:${w}px">
  <div class="chat-h"><span class="chat-av">S</span><span>Sam</span></div>
  ${messy ? `<div class="chat-b them"><div class="chat-u">${esc(url)}</div></div>` : ""}
  ${clean ? `<div class="chat-b me"><div class="chat-u">${esc(cleanUrl)}</div><div class="chat-t">${esc(msg || (es ? "la camisa que te dije" : "the shirt I told you about"))}</div></div>` : ""}
</div>`;
}
