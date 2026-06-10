/**
 * MUGA: i18n helper
 *
 * Provides translations for EN, ES, PT, DE, FR, IT, and JA. Each key maps to an object with
 * one entry per supported language code.
 *
 * Usage:
 *   import { applyTranslations } from "../lib/i18n.js";
 *   const lang = await getStoredLang();
 *   applyTranslations(lang);  // updates all [data-i18n] elements in the DOM
 *
 * HTML elements declare their key with a data-i18n attribute:
 *   <span data-i18n="stat_tracking"></span>
 *   <input placeholder="" data-i18n-placeholder="bl_placeholder">
 *
 * Translation data lives in per-locale modules under src/lib/locales/.
 * To add or edit a translation, edit the matching src/lib/locales/<code>.mjs file.
 */

import en from "./locales/en.mjs";
import es from "./locales/es.mjs";
import pt from "./locales/pt.mjs";
import de from "./locales/de.mjs";
import fr from "./locales/fr.mjs";
import it from "./locales/it.mjs";
import ja from "./locales/ja.mjs";

export const SUPPORTED_LANGS = [
  { code: "en", label: "English" },
  { code: "es", label: "Español" },
  { code: "pt", label: "Português" },
  { code: "de", label: "Deutsch" },
  { code: "fr", label: "Français" },
  { code: "it", label: "Italiano" },
  { code: "ja", label: "日本語" },
];

/** @type {Record<string, Record<string, string>>} */
const _localeMap = { en, es, pt, de, fr, it, ja };

/**
 * TRANSLATIONS: the canonical cross-locale map used by `t()`, tests, and tools.
 * Shape: { [key: string]: { en: string, es: string, pt: string|null, ... } }
 *
 * Assembled at module load from the per-locale data files in src/lib/locales/.
 * All consumers that previously imported TRANSLATIONS directly continue to work
 * without changes — the shape is identical to the old inline object.
 */
export const TRANSLATIONS = Object.freeze(
  Object.fromEntries(
    Object.keys(en).map((key) => [
      key,
      Object.freeze(
        Object.fromEntries(
          Object.entries(_localeMap).map(([code, data]) => [code, data[key] ?? null])
        )
      ),
    ])
  )
);

/**
 * Returns the translation string for a key in the given language.
 * Falls back to English if the key or language is missing.
 * @param {string} key
 * @param {string} lang
 * @returns {string}
 */
export function t(key, lang) {
  const entry = TRANSLATIONS[key];
  if (!entry) return key;
  return entry[lang] ?? entry["en"] ?? key;
}

// Keys whose values intentionally contain safe HTML (<code>, <br>).
// All other keys use textContent to prevent any XSS risk.
const HTML_KEYS = new Set(["bl_hint", "wl_hint", "cp_hint", "ob_affiliate_desc", "ob_tos_label", "creator_allowlist_hint"]);

// Allowed tags and attributes for HTML_KEYS sanitization.
const ALLOWED_TAGS = new Set(["code", "br", "strong", "em", "a", "small"]);
const ALLOWED_ATTRS = new Set(["href", "target", "class", "rel"]);

/**
 * Sanitize HTML from translation strings. Defense-in-depth approach:
 *
 * Layer 1: Tag allowlist — only <code>, <br>, <strong>, <em>, <a>, <small> pass.
 *          All others (including <img>, <svg>, <script>, <object>, <embed>) are
 *          stripped, with their text content preserved.
 *
 * Layer 2: Attribute allowlist — only href, target, class, rel survive.
 *          All event handlers (onclick, onerror, onload, etc.) are removed.
 *
 * Layer 3: href scheme allowlist — only https:, http:, relative (../), and
 *          fragment (#) URLs are permitted. javascript:, data:, vbscript:
 *          and all other schemes are stripped.
 *
 * Safe to use with innerHTML because all three layers are applied before
 * returning the sanitized markup.
 *
 * @param {string} html — raw HTML from translation strings
 * @returns {string} — sanitized HTML safe for innerHTML
 */
function sanitizeHTML(html) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const walk = (node) => {
    for (const child of [...node.childNodes]) {
      if (child.nodeType === 1) { // Element
        if (!ALLOWED_TAGS.has(child.tagName.toLowerCase())) {
          child.replaceWith(...child.childNodes);
          continue;
        }
        for (const attr of [...child.attributes]) {
          if (!ALLOWED_ATTRS.has(attr.name.toLowerCase())) child.removeAttribute(attr.name);
        }
        // Enforce safe href: no javascript: or data: URLs
        if (child.hasAttribute("href")) {
          const href = child.getAttribute("href");
          if (!/^(https?:|\.\.\/|#)/.test(href)) child.removeAttribute("href");
        }
        // Force rel="noopener noreferrer" on any <a target="_blank"> to prevent
        // reverse tabnapping. target="_blank" without rel="noopener" gives the
        // opened page access to window.opener.
        if (child.tagName.toLowerCase() === "a" && child.getAttribute("target") === "_blank") {
          child.setAttribute("rel", "noopener noreferrer");
        }
        walk(child);
      }
    }
  };
  walk(doc.body);
  return doc.body.innerHTML;
}

/**
 * Dev-mode assertion: warn loudly when a data-i18n-html element references a
 * key not in HTML_KEYS. This turns a silent textContent fallback into an
 * audible error so missing HTML_KEYS registrations are caught early.
 *
 * Only logs console.error (does not throw) to avoid breaking the page in prod.
 * In tests, assertHtmlKeyCoverage() can be called explicitly to throw.
 *
 * @param {string} key
 */
export function assertHtmlKeyCoverage(key) {
  if (!HTML_KEYS.has(key)) {
    const msg = `[MUGA i18n] data-i18n-html key "${key}" is not in HTML_KEYS — add it or use data-i18n instead.`;
    // In test environments (Node), throw so CI catches missing registrations.
    if (typeof process !== "undefined" && process.env && process.env.NODE_ENV === "test") {
      throw new Error(msg);
    }
    console.error(msg);
  }
}

/**
 * Applies translations to all [data-i18n] elements in the current document.
 * Uses textContent for plain strings and sanitized innerHTML only for known HTML keys.
 * Also handles [data-i18n-placeholder] for input placeholders.
 * @param {string} lang - Language code ("en" | "es" | "pt" | "de")
 */
export function applyTranslations(lang) {
  document.querySelectorAll("[data-i18n]").forEach(el => {
    const key = el.getAttribute("data-i18n");
    const value = t(key, lang);
    if (HTML_KEYS.has(key)) {
      el.innerHTML = sanitizeHTML(value);
    } else {
      el.textContent = value;
    }
  });
  // [data-i18n-html]: sanitized innerHTML for known HTML keys
  document.querySelectorAll("[data-i18n-html]").forEach(el => {
    const key = el.getAttribute("data-i18n-html");
    const value = t(key, lang);
    if (HTML_KEYS.has(key)) {
      el.innerHTML = sanitizeHTML(value);
    } else {
      // Silent fallback: the key is not registered in HTML_KEYS.
      // Warn loudly so developers notice the missing registration.
      assertHtmlKeyCoverage(key);
      el.textContent = value;
    }
  });
  document.querySelectorAll("[data-i18n-placeholder]").forEach(el => {
    const key = el.getAttribute("data-i18n-placeholder");
    /** @type {HTMLInputElement|HTMLTextAreaElement} */ (el).placeholder = t(key, lang);
  });
  document.querySelectorAll("[data-i18n-title]").forEach(el => {
    const key = el.getAttribute("data-i18n-title");
    /** @type {HTMLElement} */ (el).title = t(key, lang);
  });
  // #707: data-i18n-aria-label handles screen-reader labels. Without this,
  // every aria-label in markup is locked in source-language English and
  // ES/PT/DE/FR/IT/JA users hear untranslated text. Always plain-string
  // (aria-label is a text attribute, never HTML).
  document.querySelectorAll("[data-i18n-aria-label]").forEach(el => {
    const key = el.getAttribute("data-i18n-aria-label");
    el.setAttribute("aria-label", t(key, lang));
  });
}

/**
 * Reads the stored language preference.
 * On first run (no preference saved), falls back to the browser's UI language
 * via chrome.i18n.getUILanguage(). No extra permissions required.
 * Unsupported languages fall back to "en".
 * @returns {Promise<string>}
 */
export async function getStoredLang() {
  const supported = new Set(SUPPORTED_LANGS.map(l => l.code));

  // Resolve the browser language once, clamped to supported list
  function browserLang() {
    const raw = (typeof chrome !== "undefined" && chrome.i18n?.getUILanguage?.())
      || navigator.language
      || "en";
    const code = raw.split("-")[0].toLowerCase();
    return supported.has(code) ? code : "en";
  }

  return new Promise(resolve => {
    try {
      chrome.storage.sync.get({ language: null }, r => {
        void chrome.runtime.lastError;
        try {
          const stored = r?.language;
          resolve(stored && supported.has(stored) ? stored : browserLang());
        } catch (err) {
          console.error("[MUGA] getStoredLang:", err);
          resolve(browserLang());
        }
      });
    } catch (err) {
      console.error("[MUGA] getStoredLang:", err);
      resolve(browserLang());
    }
  });
}
