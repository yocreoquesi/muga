/**
 * MUGA: store and social still templates, as a function of URL params -> { w, h, html }.
 * Ported from the MUGA brand kit (render sources); only the stills that ship
 * from docs/assets are kept here: store screenshots 1-5 (Chrome and Firefox
 * frames), the two promo tiles and the Open Graph card.
 */
import { markSVG, signalSVG, urlHTML, esc, URLS, browserFrame, articlePage, shopPage, popup, hoverTip, contextMenu, optionsPage, chatMock } from "./components.js";
import { COPY, TAGLINE } from "./copy.js";

const L = (p) => COPY[p.lang === "es" ? "es" : "en"];
const ticks = `<div class="frame-ticks"><i></i><i></i><i></i><i></i></div>`;
const LEN_BEFORE = URLS.shopDirty.length;
const LEN_AFTER = URLS.shopClean.length;
const bare = (u) => u.replace(/^https:\/\//, "");
/** Signature line with its final full stop as the purple "signal dot". */
const sigTag = (t = TAGLINE) => (t.endsWith(".") ? `${esc(t.slice(0, -1))}<span class="dot">.</span>` : esc(t));

/** Brand row: mark + name in mono, as on muga.app. */
const brandRow = (size = 18, text = "muga.app") =>
  `<div class="brand-row" style="font-size:${size * 0.72}px">${markSVG({ height: size, color: "var(--accent-ink)" })}<span>${esc(text)}</span></div>`;

/** Dashed ruler with ticks and mono labels (the Signal Path baseline). */
function ruler({ x, y, w, labels = [] }) {
  const step = labels.length > 1 ? w / (labels.length - 1) : 0;
  const t = labels.map((l, i) => {
    const tr = i === 0 ? "0" : i === labels.length - 1 ? "-100%" : "-50%";
    const lx = x + step * i;
    return `<i class="rl-tick" style="left:${lx}px;top:${y - 6}px"></i><span class="rl-lbl" style="left:${lx}px;top:${y + 12}px;transform:translateX(${tr})">${esc(l)}</span>`;
  }).join("");
  return `<div class="rl" style="left:${x}px;top:${y}px;width:${w}px"></div>${t}`;
}

/** Character counter: 193 -> 41 characters, in mono. */
const counter = (p, cls = "") =>
  `<div class="cnt ${cls}"><span class="cnt-a">${LEN_BEFORE}</span><span class="cnt-arrow">→</span><span class="cnt-b">${LEN_AFTER}</span><span class="cnt-l">${esc(L(p).chars)}</span></div>`;

// ── Chrome Web Store / AMO screenshots (1280x800) ────────
function storeShot(p, { n, eyebrow, title, lede, window: win, extra = "" }) {
  return {
    w: 1280, h: 800,
    html: `<div class="ss">
  <div class="ss-copy">
    ${brandRow(16, "MUGA")}
    <div class="eyebrow" style="margin-top:84px">${esc(eyebrow)}</div>
    <h1 class="h-display ss-h">${title}</h1>
    <p class="lede ss-lede">${esc(lede)}</p>
  </div>
  <div class="ss-win">${win}</div>
  ${extra}
  ${ruler({ x: 64, y: 748, w: 1152, labels: [`0${n} / 05`, "Open source · No telemetry"] })}
</div>`,
  };
}

const B = (p) => (p.browser === "firefox" ? "firefox" : "chrome");
const extUrl = (p) => (B(p) === "firefox" ? "moz-extension://muga/options/options.html" : "chrome-extension://pjdpeamhcjdhfijpmgamjdoplbnbajoh/options/options.html");
const popRight = (p) => (B(p) === "firefox" ? 58 : 76);

export const TEMPLATES = {
  // 1. Clean links: before / after, length, still works
  ss1: (p) => storeShot(p, {
    n: 1, eyebrow: "Clean links",
    title: `The same link, <span class="sig">without the clutter.</span>`,
    lede: "MUGA removes the extras it recognises from the links you open, copy and share. What the page needs stays, so the link still opens the same page.",
    window: browserFrame({ browser: B(p), url: URLS.shopClean, tab: "Linen shirt, relaxed fit", w: 700, h: 620, activeExt: true,
      content: shopPage({}),
      overlay: `<div class="ba">
        <div class="ba-row"><span class="ba-k">before</span><div class="url ba-u">${urlHTML(URLS.shopDirty, { strike: true })}</div></div>
        <div class="ba-mid">${signalSVG({ labels: null, junk: null, width: 64, showTicks: false })}${counter(p, "sm")}</div>
        <div class="ba-row"><span class="ba-k good">after</span><div class="url ba-u big">${urlHTML(URLS.shopClean)}</div></div>
        <div class="ba-ok"><span class="ok">✓</span>opens the same page</div>
      </div>` }),
  }),

  // 2. Copy and share
  ss2: (p) => storeShot(p, {
    n: 2, eyebrow: "Copy and share",
    title: `Share links <span class="sig">people can read.</span>`,
    lede: "Right-click any link and choose Copy clean link. Ctrl+C cleans the links in your selection too, so what you paste is short and clear.",
    window: browserFrame({ browser: B(p), url: URLS.newsClean, tab: "City adds 40 km of cycling lanes", w: 700, h: 620,
      content: articlePage({ linkFirst: true, hover: true }),
      overlay: `<div class="cm-anchor sm">${contextMenu({ browser: B(p) })}</div>` }),
    extra: `<div class="ss-chat">${chatMock({ url: URLS.newsDirty.replace("https://", ""), cleanUrl: bare(URLS.newsClean), w: 400, msg: "the cycling lanes piece" })}</div>`,
  }),

  // 3. Where a link really goes
  ss3: (p) => storeShot(p, {
    n: 3, eyebrow: "Redirects and short links",
    title: `See where a link <span class="sig">really goes.</span>`,
    lede: "Redirect wrappers open the page they point at. Short links are followed in your browser, so you land on a clean address.",
    window: browserFrame({ browser: B(p), url: URLS.newsClean, tab: "City adds 40 km of cycling lanes", w: 700, h: 620,
      content: articlePage({ link: true, hover: true }),
      overlay: `<div class="uw">
        <div class="uw-row"><span class="uw-k">redirect wrapper</span><div class="url uw-u">${urlHTML(URLS.wrapper, { strike: true })}</div>
          <div class="uw-arrow"></div><div class="url uw-u good">news.example/2026/09/city-cycling-lanes</div></div>
        <div class="uw-row"><span class="uw-k">short link</span><div class="url uw-u">go.example/x7Kp2</div>
          <div class="uw-arrow"></div><div class="url uw-u good">shop.example/p/linen-shirt</div></div>
      </div>
      <div class="hov-anchor">${hoverTip({ dest: "news.example/guides/cycling-lanes" })}</div>` }),
  }),

  // 4. Popup: what changed on this page
  ss4: (p) => storeShot(p, {
    n: 4, eyebrow: "This page",
    title: `See what changed <span class="sig">on this page.</span>`,
    lede: "Open the popup for the link before and after, what came off and how much shorter it got. Pause cleaning on any site with one click.",
    window: browserFrame({ browser: B(p), url: URLS.newsClean, tab: "City adds 40 km of cycling lanes", w: 700, h: 620, activeExt: true,
      content: articlePage({}),
      overlay: `<div class="pop-anchor" style="right:${popRight(p)}px">${popup({})}</div>` }),
  }),

  // 5. Settings that stay out of the way
  ss5: (p) => storeShot(p, {
    n: 5, eyebrow: "Yours to tune",
    title: `Settings that <span class="sig">stay out of the way.</span>`,
    lede: "Cleaning works from the moment you install. Tune the rest: right-click copy, short-link lookups, weekly rule updates, per-site pause.",
    window: browserFrame({ browser: B(p), url: extUrl(p), tab: "MUGA: Settings", w: 700, h: 620,
      content: `<div class="op-wrap">${optionsPage({})}</div>` }),
  }),

  // Small promo tile: no text, must read at half size
  "promo-small": () => ({
    w: 440, h: 280,
    html: `<div class="tile">${ticks}<div class="tile-sig">${signalSVG({ labels: null, junk: "dashes", width: 250 })}</div></div>`,
  }),

  marquee: (p) => {
    const c = L(p);
    return {
      w: 1400, h: 560,
      html: `<div class="mq">
  <div class="mq-copy">
    ${brandRow(20, "MUGA")}
    <div class="eyebrow" style="margin-top:56px">${esc(c.eyebrow)}</div>
    <h1 class="h-display mq-h">${sigTag()}</h1>
    <p class="mq-desc">${esc(c.heroFlat)}</p>
    ${counter(p, "mq-cnt")}
  </div>
  <div class="mq-sig">${signalSVG({ labels: c.sig, width: 470 })}</div>
  <div class="hair v" style="left:820px;top:64px;height:432px"></div>
</div>`,
    };
  },

  // ── Social ─────────────────────────────────────────
  og: (p) => {
    const c = L(p);
    return {
      w: 1200, h: 630,
      html: `<div class="og">${brandRow(22)}
  <h1 class="h-display og-h">${sigTag()}</h1>
  <p class="og-desc">${esc(c.heroFlat)}</p>
  ${counter(p, "og-cnt")}
  <div class="og-sig">${signalSVG({ labels: c.sig, width: 430 })}</div>
  ${ruler({ x: 72, y: 540, w: 1056, labels: [c.cta, "muga.app"] })}
</div>`,
    };
  },

};
