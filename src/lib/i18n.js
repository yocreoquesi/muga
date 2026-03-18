/**
 * MUGA — i18n helper
 *
 * Provides translations for EN and ES. Each key maps to an object with
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
 */

export const SUPPORTED_LANGS = [
  { code: "en", label: "English" },
  { code: "es", label: "Español" },
];

export const TRANSLATIONS = {
  // ── Popup ────────────────────────────────────────────────────────────────
  stat_tracking:   { en: "tracking removed",   es: "tracking eliminado" },
  stat_injected:   { en: "affiliate links",     es: "afiliados activos" },
  stat_foreign:    { en: "referrals detected",  es: "referidos detectados" },
  toggle_enabled:  { en: "Enable MUGA",         es: "Activar MUGA" },
  opt_inject_label: { en: "Inject our affiliate when none is present", es: "Inyectar nuestro afiliado si no hay ninguno" },
  opt_inject_hint:  { en: "Only on stores where we have an active account", es: "Solo en tiendas donde tenemos cuenta activa" },
  opt_notify_label: { en: "Notify me when a third-party affiliate is detected", es: "Notificarme si hay un referido ajeno" },
  opt_notify_hint:  { en: "Shows a non-intrusive toast for 5 seconds", es: "Muestra un aviso no intrusivo durante 5 segundos" },
  link_advanced:    { en: "Advanced settings →", es: "Preferencias avanzadas →" },
  link_donate:      { en: "Support the project", es: "Apoyar el proyecto" },

  // ── Options ──────────────────────────────────────────────────────────────
  opts_title:      { en: "Advanced settings", es: "Preferencias avanzadas" },
  opts_subtitle:   { en: "Make URLs Great Again", es: "Make URLs Great Again" },
  section_behaviour: { en: "Behaviour", es: "Comportamiento" },
  row_inject_label: { en: "Inject our affiliate when none is present", es: "Inyectar nuestro afiliado cuando no hay ninguno" },
  row_inject_hint:  { en: "Only on stores where we have an active affiliate account", es: "Solo en tiendas donde tenemos cuenta de afiliado activa" },
  row_notify_label: { en: "Notify me when a third-party affiliate is detected", es: "Notificarme si hay un referido ajeno" },
  row_notify_hint:  { en: "Shows a non-intrusive toast with options — auto-dismisses in 5 seconds", es: "Muestra un aviso no intrusivo con opciones — desaparece en 5 segundos" },
  row_replace_label: { en: "Allow replacing a third-party affiliate with ours", es: "Permitir reemplazar afiliado ajeno por el nuestro" },
  row_replace_hint:  { en: "Only available when notification is on. You always decide, per link.", es: "Solo disponible si la notificación está activa. El usuario siempre decide." },
  section_stores:    { en: "Supported stores", es: "Tiendas soportadas" },
  stores_hint:       { en: "Green dot = affiliate account active and configured. Grey = account pending registration.", es: "Punto verde = cuenta de afiliado activa. Gris = cuenta pendiente de registro." },
  section_blacklist: { en: "Blacklist — these affiliates are always stripped", es: "Blacklist — estos afiliados se eliminan siempre" },
  section_whitelist: { en: "Whitelist — these affiliates are trusted and never touched", es: "Whitelist — estos afiliados son de confianza, no se tocan" },
  bl_placeholder: { en: "amazon.es  or  amazon.es::tag::youtuber-21", es: "amazon.es  o  amazon.es::tag::youtuber-21" },
  wl_placeholder: { en: "amazon.es::tag::creator-i-support", es: "amazon.es::tag::creador-que-apoyo" },
  bl_hint:  { en: "Domain only (e.g. <code>amazon.es</code>) — blocks all affiliate activity on that site.<br>Domain::param::value (e.g. <code>amazon.es::tag::youtuber-21</code>) — blocks one specific affiliate.", es: "Solo dominio (ej: <code>amazon.es</code>) para bloquear toda actividad en esa web.<br>Dominio::param::valor (ej: <code>amazon.es::tag::youtuber-21</code>) para bloquear un afiliado concreto." },
  wl_hint:  { en: "Format: <code>domain::param::value</code>. That creator's affiliate tag is never modified.", es: "Formato: <code>dominio::parámetro::valor</code>. El afiliado de ese creador nunca se toca." },
  add_btn:  { en: "+ Add", es: "+ Añadir" },
  empty_list: { en: "No entries yet.", es: "Sin entradas todavía." },
  privacy_link: { en: "Privacy policy", es: "Política de privacidad" },
  section_language: { en: "Language", es: "Idioma" },
  lang_label:  { en: "Display language", es: "Idioma de la interfaz" },
  lang_hint:   { en: "Affects the popup and settings page. Does not affect URL processing.", es: "Afecta al popup y a esta página. No afecta al procesamiento de URLs." },

  // ── Content script toast ──────────────────────────────────────────────────
  toast_title:   { en: "MUGA detected an affiliate", es: "MUGA detectó un referido" },
  toast_tag_msg: { en: "carries the tag", es: "lleva el tag" },
  toast_keep:    { en: "Keep", es: "Mantener" },
  toast_remove:  { en: "Remove", es: "Quitar" },
  toast_ours:    { en: "Use ours", es: "Usar el nuestro" },
  toast_dismiss: { en: "Dismiss", es: "Descartar" },
};

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

/**
 * Applies translations to all [data-i18n] elements in the current document.
 * Also handles [data-i18n-placeholder] for input placeholders.
 * @param {string} lang - Language code ("en" | "es")
 */
export function applyTranslations(lang) {
  document.querySelectorAll("[data-i18n]").forEach(el => {
    const key = el.getAttribute("data-i18n");
    el.innerHTML = t(key, lang);
  });
  document.querySelectorAll("[data-i18n-placeholder]").forEach(el => {
    const key = el.getAttribute("data-i18n-placeholder");
    el.placeholder = t(key, lang);
  });
}

/**
 * Reads the stored language preference, defaulting to "en".
 * @returns {Promise<string>}
 */
export async function getStoredLang() {
  return new Promise(resolve => {
    chrome.storage.sync.get({ language: "en" }, r => resolve(r.language));
  });
}
