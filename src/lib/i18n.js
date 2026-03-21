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
  stat_urls:       { en: "URLs cleaned",      es: "URLs limpias" },
  stat_junk:       { en: "junk removed",      es: "basura eliminada" },
  stat_referrals:  { en: "referrals spotted", es: "referidos detectados" },
  nudge_text:      { en: "You've quietly cleaned {n} URLs. Enjoying MUGA?", es: "Has limpiado {n} URLs sin esfuerzo. ¿Te gusta MUGA?" },
  nudge_review:    { en: "⭐ Leave a review", es: "⭐ Deja una reseña" },
  nudge_kofi:      { en: "☕ Ko-fi",          es: "☕ Ko-fi" },
  nudge_dismiss:   { en: "✕",                 es: "✕" },
  preview_clean:   { en: "✓ This page is already clean",  es: "✓ Esta página ya está limpia" },
  preview_label:   { en: "This page",                     es: "Esta página" },
  history_label:   { en: "Recent",                        es: "Recientes" },
  toggle_enabled:  { en: "Enable MUGA",                   es: "Activar MUGA" },
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
  row_replace_label:          { en: "Allow replacing a third-party affiliate with ours",  es: "Permitir reemplazar afiliado ajeno por el nuestro" },
  row_replace_hint:           { en: "Only available when notification is on. You always decide, per link.", es: "Solo disponible si la notificación está activa. El usuario siempre decide." },
  row_strip_affiliates_label: { en: "Strip all affiliate parameters",                      es: "Eliminar todos los parámetros de afiliado" },
  section_stores:    { en: "Supported stores", es: "Tiendas soportadas" },
  stores_hint:       { en: "Green dot = affiliate account active and configured. Grey = account pending registration.", es: "Punto verde = cuenta de afiliado activa. Gris = cuenta pendiente de registro." },
  no_active_stores:  { en: "No affiliate accounts configured yet.", es: "No hay cuentas de afiliado configuradas aún." },
  section_custom_params:    { en: "Custom tracking params — always stripped everywhere", es: "Parámetros personalizados — siempre eliminados" },
  cp_placeholder:           { en: "ref_code  or  promo_id",                              es: "ref_codigo  o  promo_id" },
  cp_hint:                  { en: "One param name per entry. Stripped on every site, case-insensitive.", es: "Un nombre de parámetro por entrada. Eliminado en todas las webs, sin distinción de mayúsculas." },
  section_blacklist: { en: "Blacklist — these affiliates are always stripped", es: "Blacklist — estos afiliados se eliminan siempre" },
  section_whitelist: { en: "Whitelist — these affiliates are trusted and never touched", es: "Whitelist — estos afiliados son de confianza, no se tocan" },
  privacy_link:    { en: "Privacy policy",                       es: "Política de privacidad" },
  report_issue:    { en: "Report a bug or suggest a feature",    es: "Reportar un error o sugerir mejora" },
  bl_placeholder: { en: "amazon.es  or  amazon.es::tag::youtuber-21", es: "amazon.es  o  amazon.es::tag::youtuber-21" },
  wl_placeholder: { en: "amazon.es::tag::creator-i-support", es: "amazon.es::tag::creador-que-apoyo" },
  bl_hint:  { en: "Domain only (e.g. <code>amazon.es</code>) — strips all params on that site.<br>Domain::param::value (e.g. <code>amazon.es::tag::youtuber-21</code>) — strips one specific affiliate.<br><code>amazon.es::disabled</code> — MUGA does nothing on that domain.", es: "Solo dominio (ej: <code>amazon.es</code>) — elimina todos los parámetros en esa web.<br>Dominio::param::valor (ej: <code>amazon.es::tag::youtuber-21</code>) — elimina un afiliado concreto.<br><code>amazon.es::disabled</code> — MUGA no toca nada en ese dominio." },
  wl_hint:  { en: "Format: <code>domain::param::value</code>. That creator's affiliate tag is never modified.", es: "Formato: <code>dominio::parámetro::valor</code>. El afiliado de ese creador nunca se toca." },
  add_btn:  { en: "+ Add", es: "+ Añadir" },
  empty_list: { en: "No entries yet.", es: "Sin entradas todavía." },
  muga_disabled: { en: "MUGA is disabled", es: "MUGA está desactivado" },
  section_language: { en: "Language", es: "Idioma" },
  lang_label:  { en: "Display language", es: "Idioma de la interfaz" },
  lang_hint:   { en: "Affects the popup and settings page. Does not affect URL processing.", es: "Afecta al popup y a esta página. No afecta al procesamiento de URLs." },

  section_url_cleaning:  { en: "URL Cleaning",                       es: "Limpieza de URLs" },
  row_dnr_label:         { en: "Strip tracking parameters before navigation", es: "Eliminar parámetros de rastreo antes de navegar" },
  row_dnr_hint:          { en: "Uses browser-native rules to clean URLs from the address bar, bookmarks, and external apps", es: "Usa reglas nativas del navegador para limpiar URLs desde la barra de direcciones, marcadores y apps externas" },
  section_privacy:       { en: "Privacy",                            es: "Privacidad" },
  row_pings_label:       { en: "Block <a ping> tracking beacons",    es: "Bloquear balizas de rastreo <a ping>" },
  row_pings_hint:        { en: "Removes ping attributes from links so the browser doesn't send tracking beacons on click", es: "Elimina atributos ping para que el navegador no envíe balizas al hacer clic" },
  section_redirects:     { en: "Redirect handling",                  es: "Gestión de redirecciones" },
  row_amp_label:         { en: "Redirect AMP pages to canonical URL", es: "Redirigir páginas AMP a la URL canónica" },
  row_amp_hint:          { en: "Replaces Google AMP links with the original article URL", es: "Reemplaza los enlaces AMP de Google con la URL original del artículo" },
  row_unwrap_label:      { en: "Unwrap redirect-wrapper URLs",        es: "Desenvolver URLs de redirección" },
  row_unwrap_hint:       { en: "Extracts the real destination from Facebook, Reddit, Google, Steam and similar redirect wrappers", es: "Extrae el destino real de redireccionadores de Facebook, Reddit, Google, Steam y similares" },

  section_stats:         { en: "Statistics",                                                                        es: "Estadísticas" },
  stats_reset_btn:       { en: "Reset stats",                                                                       es: "Reiniciar stats" },
  stats_reset_confirm:   { en: "Are you sure? This will clear all counters.",                                       es: "¿Seguro? Se borrarán todos los contadores." },
  stats_reset_done:      { en: "Stats cleared.",                                                                    es: "Stats borrados." },
  stats_version:         { en: "Version",                                                                           es: "Versión" },
  section_data:          { en: "Import / Export",                                                                   es: "Importar / Exportar" },
  export_btn:            { en: "Export settings",                                                                   es: "Exportar ajustes" },
  import_btn:            { en: "Import settings",                                                                   es: "Importar ajustes" },
  import_success:        { en: "Settings imported successfully.",                                                   es: "Ajustes importados correctamente." },
  import_error:          { en: "Invalid file. Make sure it is a MUGA settings export.",                            es: "Archivo inválido. Asegúrate de que es una exportación de MUGA." },

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

// Keys whose values intentionally contain safe HTML (<code>, <br>).
// All other keys use textContent to prevent any XSS risk.
const HTML_KEYS = new Set(["bl_hint", "wl_hint"]);

/**
 * Applies translations to all [data-i18n] elements in the current document.
 * Uses textContent for plain strings and innerHTML only for known HTML keys.
 * Also handles [data-i18n-placeholder] for input placeholders.
 * @param {string} lang - Language code ("en" | "es")
 */
export function applyTranslations(lang) {
  document.querySelectorAll("[data-i18n]").forEach(el => {
    const key = el.getAttribute("data-i18n");
    const value = t(key, lang);
    if (HTML_KEYS.has(key)) {
      el.innerHTML = value;
    } else {
      el.textContent = value;
    }
  });
  document.querySelectorAll("[data-i18n-placeholder]").forEach(el => {
    const key = el.getAttribute("data-i18n-placeholder");
    el.placeholder = t(key, lang);
  });
}

/**
 * Reads the stored language preference.
 * On first run (no preference saved), falls back to the browser's UI language
 * via chrome.i18n.getUILanguage() — no extra permissions required.
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
    chrome.storage.sync.get({ language: null }, r => {
      resolve(r.language ?? browserLang());
    });
  });
}
