/**
 * MUGA brand kit: every line of marketing copy, EN + ES (peninsular Spanish).
 *
 * Positioning: MUGA is the URL cleaner. It cleans links and leaves them
 * WORKING, easier to read and to share, with only what the user needs.
 * Lead with clean / readable / shareable / still works. Privacy is a side
 * effect: "tracking" appears only as a descriptive label, never as the message.
 * Rules: no em-dashes, no retailer or brand names, no fear framing.
 */

// ── The signature: ONE swappable token ───────────────────
// Final: "Just the link." (brand line, stays English in every locale).
// Change it here and in brand/tokens.json ("tagline"); render scripts read
// tokens.json and pass it as ?tagline=, which wins over this default.
export const TAGLINE_DEFAULT = "Just the link.";
export const TAGLINE_ALTERNATIVES = ["Links, without the clutter.", "The link, and nothing else.", "Clean links that still work.", "Share what matters."];
const _q = typeof location !== "undefined" ? new URLSearchParams(location.search).get("tagline") : null;
export const TAGLINE = _q || TAGLINE_DEFAULT;

// ── Backronyms: MUGA stands for... ───────────────────────
// One word per letter, M U G A. Canonical is for bios and the guideline hero;
// the series rotates one per social post. Only these lines are approved.
export const BACKRONYM_CANONICAL = ["Minus", "Useless", "Garbage", "Appended."];
export const BACKRONYMS = {
  en: [["My", "URLs,", "Gloriously", "Abridged."], ["Mostly", "Unneeded,", "Gone", "Automatically."], ["Meaningful", "URLs,", "Gunk", "Averted."]],
  es: [["Menos", "Utm,", "Gracias,", "Adiós."], ["Muy", "Útil,", "Gratis y", "Abierto."]],
};

export const COPY = {
  en: {
    eyebrow: "URL cleaner · Chrome · Firefox",
    hero: ["Links, without", "the clutter."],
    heroFlat: "Links, without the clutter.",
    stands: "MUGA stands for",
    lede: "MUGA cleans the links you open, copy and share, so they stay short, readable and still open the same page.",
    cta: "Free for Chrome and Firefox",
    facts: "Open source · No telemetry",
    factsLong: "Free · Open source · No telemetry",
    sig: ["messy in", "clutter off", "clean out"],
    chars: "characters",
    before: "before", after: "after",
    // Instagram carousel: anatomy of a messy link
    c1: { k: "Link anatomy", t: "Why are links so long?", b: "Most of a shared link is extras stuck on after the question mark. The page never needed them." },
    c2: { k: "What the page needs", t: "Read a link in three parts.", rows: [["shop.example", "The site", "need"], ["/p/linen-shirt", "The page", "need"], ["size=m", "A setting the page uses", "need"], ["utm_source=newsletter", "A campaign tag", "extra"], ["fbclid=IwAR2xK9pQ7", "A click ID", "extra"]] },
    c3: { k: "When you share", t: "Extras make links hard to read and easy to break.", b: "They get cut off in chats, wrap across three lines and hide where the link goes." },
    c4: { k: "What MUGA does", t: "MUGA keeps what the page needs.", b: "Search terms, filters and settings stay, so the link still opens the same page." },
    c5: { k: "MUGA", b: "A URL cleaner for Chrome and Firefox." },
    // Motion captions (20 s master; the 15 s cut reuses a subset)
    v: {
      hook: "Would you click this?",
      clutter: "Most of it is clutter.",
      strip: "MUGA cleans it up.",
      works: "Still works.",
      worksSub: "Same page, shorter link.",
      unwrap: "See where it really goes.",
      share: "Easy to read. Easy to share.",
      lbl: { campaign: "campaign tag", click: "click ID", ad: "ad click ID", mail: "mailing ID", keep: "the page needs this", chars: "characters", redirect: "redirect wrapper", short: "short link", goes: "goes to", opens: "opens the same page" },
      chatName: "Sam", chatMsg: "the shirt I told you about",
    },
  },
  es: {
    eyebrow: "Limpiador de URLs · Chrome · Firefox",
    hero: ["Enlaces, sin", "lo que sobra."],
    heroFlat: "Enlaces, sin lo que sobra.",
    stands: "MUGA significa",
    lede: "MUGA limpia los enlaces que abres, copias y compartes, para que sean cortos, legibles y sigan abriendo la misma página.",
    cta: "Gratis para Chrome y Firefox",
    facts: "Código abierto · Sin telemetría",
    factsLong: "Gratis · Código abierto · Sin telemetría",
    sig: ["entra liado", "sin extras", "sale limpio"],
    chars: "caracteres",
    before: "antes", after: "después",
    c1: { k: "Anatomía de un enlace", t: "¿Por qué los enlaces son tan largos?", b: "Casi todo lo que lleva un enlace compartido son añadidos pegados tras el signo de interrogación. La página nunca los necesitó." },
    c2: { k: "Lo que necesita la página", t: "Un enlace se lee en tres partes.", rows: [["shop.example", "El sitio", "need"], ["/p/linen-shirt", "La página", "need"], ["size=m", "Un ajuste que usa la página", "need"], ["utm_source=newsletter", "Una etiqueta de campaña", "extra"], ["fbclid=IwAR2xK9pQ7", "Un ID de clic", "extra"]] },
    c3: { k: "Al compartir", t: "Los añadidos hacen los enlaces difíciles de leer y fáciles de romper.", b: "Se cortan en los chats, ocupan tres líneas y esconden adónde lleva el enlace." },
    c4: { k: "Qué hace MUGA", t: "MUGA deja lo que la página necesita.", b: "Las búsquedas, los filtros y los ajustes se quedan, así que el enlace sigue abriendo la misma página." },
    c5: { k: "MUGA", b: "Un limpiador de URLs para Chrome y Firefox." },
    v: {
      hook: "¿Harías clic en esto?",
      clutter: "Casi todo sobra.",
      strip: "MUGA lo limpia.",
      works: "Sigue funcionando.",
      worksSub: "La misma página, un enlace más corto.",
      unwrap: "Mira adónde lleva de verdad.",
      share: "Fácil de leer. Fácil de compartir.",
      lbl: { campaign: "etiqueta de campaña", click: "ID de clic", ad: "ID de clic de anuncio", mail: "ID de envío", keep: "la página lo necesita", chars: "caracteres", redirect: "redirección", short: "enlace corto", goes: "va a", opens: "abre la misma página" },
      chatName: "Sam", chatMsg: "la camisa que te dije",
    },
  },
};
