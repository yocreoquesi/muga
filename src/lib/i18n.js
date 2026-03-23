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
  stat_junk:       { en: "tracking params removed", es: "parámetros eliminados" },
  stat_referrals:  { en: "affiliate tags detected", es: "tags de afiliado detectados" },
  preview_label:   { en: "This page",                     es: "Esta página" },
  history_label:        { en: "Recent",                               es: "Recientes" },
  history_empty:        { en: "No URLs cleaned yet. Start browsing — MUGA works automatically.", es: "Aún no se han limpiado URLs. Navega normalmente — MUGA funciona automáticamente." },
  toggle_enabled:  { en: "Enable MUGA",                   es: "Activar MUGA" },
  toggle_title:    { en: "Enable / disable MUGA",        es: "Activar / desactivar MUGA" },
  link_advanced:    { en: "Settings →", es: "Ajustes →" },
  removed_params_label: { en: "Removed:", es: "Eliminado:" },
  tab_badge_label:      { en: "stripped this tab", es: "eliminados en esta pestaña" },
  history_copy_hint:    { en: "Click to copy clean URL", es: "Clic para copiar URL limpia" },
  history_copied:       { en: "Copied!", es: "¡Copiado!" },
  history_copy_original: { en: "Copy with tracking", es: "Copiar con rastreo" },
  show_history:          { en: "Show history", es: "Mostrar historial" },

  // ── Options ──────────────────────────────────────────────────────────────
  opts_title:      { en: "Settings", es: "Ajustes" },
  opts_subtitle:   { en: "Make URLs Great Again", es: "Haz que las URLs vuelvan a ser geniales." },
  section_affiliate_settings: { en: "Affiliate settings", es: "Configuración de afiliados" },
  row_inject_label: { en: "Inject our affiliate tag when a link has none", es: "Inyectar nuestro afiliado cuando no hay ninguno" },
  row_inject_hint:  { en: "Off by default. Enable here or during first setup. You always pay the same price.", es: "Desactivado por defecto. Actívalo aquí o durante la configuración inicial." },
  row_notify_label: { en: "Alert me when a link has someone else's affiliate tag", es: "Avisarme cuando un enlace tenga el tag de afiliado de otro" },
  row_notify_hint:  { en: "Shows a quick notification with options — auto-dismisses in 15 seconds", es: "Muestra una notificación rápida con opciones — desaparece en 15 segundos" },
  row_replace_label:          { en: "Allow replacing someone else's affiliate tag with ours",  es: "Permitir reemplazar el tag de afiliado de otro por el nuestro" },
  row_replace_hint:           { en: "When someone else's affiliate tag is found and the notification is shown, you can swap it for MUGA's. Requires affiliate injection to be enabled.", es: "Cuando se encuentra el tag de afiliado de otro y aparece la notificación, puedes cambiarlo por el de MUGA. Requiere que la inyección de afiliados esté activada." },
  row_strip_affiliates_label: { en: "Remove all affiliate tags from other sources",          es: "Eliminar todos los tags de afiliado ajenos" },
  row_strip_affiliates_hint:  { en: "Removes affiliate tags placed by others from all links. Our tag is preserved when injection is active.", es: "Elimina los tags de afiliado de otros de todos los enlaces. Nuestro tag se conserva cuando la inyección está activa." },
  section_stores:    { en: "Affiliate stores", es: "Tiendas afiliadas" },
  stores_hint:       { en: "Green dot = affiliate account active and configured. Grey = account pending registration.", es: "Punto verde = cuenta de afiliado activa. Gris = cuenta pendiente de registro." },
  no_active_stores:  { en: "No affiliate accounts configured yet.", es: "No hay cuentas de afiliado configuradas aún." },
  section_custom_params:    { en: "Custom tracking params — always stripped everywhere", es: "Parámetros personalizados — siempre eliminados" },
  cp_placeholder:           { en: "ref_code  or  promo_id",                              es: "ref_codigo  o  promo_id" },
  cp_hint:                  { en: "One param name per entry. Stripped on every site, case-insensitive.", es: "Un nombre de parámetro por entrada. Eliminado en todas las webs, sin distinción de mayúsculas." },
  section_blacklist: { en: "Always strip on these domains", es: "Eliminar siempre en estos dominios" },
  section_whitelist: { en: "Protected tags & domains — never touched", es: "Tags y dominios protegidos — nunca se tocan" },
  privacy_link:    { en: "Privacy policy",                       es: "Política de privacidad" },
  report_issue:    { en: "Report a bug or suggest a feature",    es: "Reportar un error o sugerir mejora" },
  bl_placeholder: { en: "mysite.com  or  amazon.es::tag::youtuber-21", es: "mysite.com  o  amazon.es::tag::youtuber-21" },
  wl_placeholder: { en: "mysite.com  or  amazon.es::tag::creator-21", es: "mysite.com  o  amazon.es::tag::creador-21" },
  bl_hint:  { en: "Domain only (e.g. <code>mysite.com</code>) — strips all params on that site.<br>Domain::param::value (e.g. <code>amazon.es::tag::youtuber-21</code>) — strips one specific affiliate tag.<br><code>amazon.es::disabled</code> — MUGA does nothing on that domain.", es: "Solo dominio (ej: <code>mysite.com</code>) — elimina todos los parámetros en esa web.<br>Dominio::param::valor (ej: <code>amazon.es::tag::youtuber-21</code>) — elimina un afiliado concreto.<br><code>amazon.es::disabled</code> — MUGA no toca nada en ese dominio." },
  wl_hint:  { en: "Accepts a domain (e.g. <code>mysite.com</code>) — MUGA won't touch any affiliate on that site.<br>Or <code>domain::param::value</code> (e.g. <code>amazon.es::tag::creator-21</code>) — protects one specific tag.", es: "Acepta un dominio (ej: <code>mysite.com</code>) — MUGA no toca ningún afiliado en esa web.<br>O <code>dominio::parámetro::valor</code> (ej: <code>amazon.es::tag::creador-21</code>) — protege un tag concreto." },
  add_btn:  { en: "+ Add", es: "+ Añadir" },
  empty_list: { en: "No entries yet.", es: "Sin entradas todavía." },
  muga_disabled: { en: "MUGA is disabled", es: "MUGA está desactivado" },
  section_tracking_categories: { en: "Tracking categories", es: "Categorías de rastreo" },
  categories_hint: { en: "Enable or disable stripping for each param category. Disabling a category keeps those parameters in URLs.", es: "Activa o desactiva la eliminación por categoría. Desactivar una categoría conserva esos parámetros en las URLs." },

  section_features:  { en: "Features", es: "Funciones" },
  section_language: { en: "Language", es: "Idioma" },
  lang_label:  { en: "Display language", es: "Idioma de la interfaz" },
  lang_hint:   { en: "Affects the popup and settings page. Does not affect URL processing.", es: "Afecta al popup y a esta página. No afecta al procesamiento de URLs." },

  section_url_cleaning:  { en: "URL Cleaning",                       es: "Limpieza de URLs" },
  row_dnr_label:         { en: "Strip tracking parameters before navigation", es: "Eliminar parámetros de rastreo antes de navegar" },
  row_dnr_hint:          { en: "Cleans URLs as you type in the address bar, from bookmarks, and links from other apps — before the page loads", es: "Limpia URLs mientras escribes en la barra de direcciones, desde marcadores y enlaces de otras apps — antes de que cargue la página" },
  row_context_menu_label: { en: "Right-click → Copy clean link", es: "Menú contextual → Copiar enlace limpio" },
  row_context_menu_hint:  { en: "Alt+Shift+C also copies the clean URL of the current tab", es: "Alt+Shift+C también copia la URL limpia de la pestaña activa" },
  section_privacy:       { en: "Privacy",                            es: "Privacidad" },
  row_pings_label:       { en: "Block <a ping> tracking beacons",    es: "Bloquear balizas de rastreo <a ping>" },
  row_pings_hint:        { en: "Removes ping attributes from links so the browser doesn't send tracking beacons on click", es: "Elimina atributos ping para que el navegador no envíe balizas al hacer clic" },
  section_redirects:     { en: "Redirect handling",                  es: "Gestión de redirecciones" },
  row_amp_label:         { en: "Redirect AMP pages to canonical URL", es: "Redirigir páginas AMP a la URL canónica" },
  row_amp_hint:          { en: "Replaces Google AMP links with the original article URL", es: "Reemplaza los enlaces AMP de Google con la URL original del artículo" },
  row_unwrap_label:      { en: "Unwrap redirect wrappers",            es: "Desenvolver redireccionadores" },
  row_unwrap_hint:       { en: "Extracts the real destination from redirect-wrapper URLs (e.g., ?redirect=https://example.com)", es: "Extrae el destino real de URLs de redirección (ej: ?redirect=https://example.com)" },

  section_stats:         { en: "Statistics",                                                                        es: "Estadísticas" },
  stats_reset_label:     { en: "Lifetime stats",                                                                    es: "Estadísticas acumuladas" },
  stats_reset_hint:      { en: "URLs cleaned, params removed, affiliates spotted",                                  es: "URLs limpias, parámetros eliminados, afiliados detectados" },
  stats_reset_btn:       { en: "Reset stats",                                                                       es: "Reiniciar stats" },
  stats_reset_confirm:   { en: "Are you sure? This will clear all counters.",                                       es: "¿Seguro? Se borrarán todos los contadores." },
  stats_reset_done:      { en: "Stats cleared.",                                                                    es: "Stats borrados." },
  section_data:          { en: "Import / Export",                                                                   es: "Importar / Exportar" },
  export_btn:            { en: "Export settings",                                                                   es: "Exportar ajustes" },
  import_btn:            { en: "Import settings",                                                                   es: "Importar ajustes" },
  export_label:          { en: "Export settings",                                                                   es: "Exportar ajustes" },
  import_label:          { en: "Import settings",                                                                   es: "Importar ajustes" },
  import_success:        { en: "Settings imported successfully.",                                                   es: "Ajustes importados correctamente." },
  import_error:          { en: "That doesn't look like a MUGA settings file. Make sure you're importing a .json file exported from MUGA.",  es: "Eso no parece un archivo de ajustes de MUGA. Asegúrate de que sea un .json exportado desde MUGA." },

  // ── Advanced / Developer options ──────────────────────────────────────────
  section_advanced:           { en: "Advanced",                                                          es: "Avanzado" },
  advanced_mode_label:        { en: "Show advanced settings",                                            es: "Mostrar ajustes avanzados" },
  advanced_mode_hint:         { en: "Fine-grained control over URL cleaning, privacy, and developer tools", es: "Control detallado de limpieza de URLs, privacidad y herramientas de desarrollo" },
  section_dev_tools:          { en: "Developer tools",                                                   es: "Herramientas de desarrollo" },
  dev_preview_notify_label:   { en: "Preview affiliate notification",                                   es: "Previsualizar notificación de afiliado" },
  dev_preview_notify_hint:    { en: "See how the toast looks when a third-party affiliate is detected", es: "Ve cómo aparece el aviso cuando se detecta un afiliado ajeno" },
  dev_preview_notify_btn:     { en: "Preview",                                                          es: "Vista previa" },
  dev_onboarding_label:       { en: "Show welcome screen",                                              es: "Mostrar pantalla de bienvenida" },
  dev_onboarding_hint:        { en: "Re-open the first-run onboarding page",                            es: "Vuelve a abrir el onboarding inicial" },
  dev_onboarding_btn:         { en: "Open",                                                             es: "Abrir" },
  dev_log_label:              { en: "Debug log",                                                        es: "Log de depuración" },
  dev_log_hint:               { en: "Download a log of errors and warnings from the current session",   es: "Descarga un log de errores y avisos de la sesión actual" },
  dev_log_btn:                { en: "Export log",                                                       es: "Exportar log" },
  dev_url_tester_label:       { en: "URL tester",                                                       es: "Probador de URLs" },
  dev_url_tester_hint:        { en: "Paste any URL to see what MUGA will clean",                        es: "Pega cualquier URL para ver qué limpiará MUGA" },
  dev_url_tester_placeholder: { en: "https://example.com?utm_source=google&fbclid=...",                 es: "https://example.com?utm_source=google&fbclid=..." },
  dev_url_test_btn:           { en: "Test",                                                             es: "Probar" },
  dev_url_result_label:       { en: "Result",                                                           es: "Resultado" },
  dev_url_removed:            { en: "Removed: %s",                                                       es: "Eliminados: %s" },
  dev_url_clean:              { en: "No tracking params found — URL is already clean.",                   es: "Sin parámetros de rastreo — la URL ya está limpia." },
  dev_url_action:             { en: "Action: %s",                                                        es: "Acción: %s" },

  // ── Context menu ─────────────────────────────────────────────────────────
  ctx_copy_clean_link:      { en: "Copy clean link",                       es: "Copiar enlace limpio" },
  ctx_copy_clean_selection: { en: "Copy clean links in selection",         es: "Copiar enlaces limpios de la selección" },

  // ── Content script toast ──────────────────────────────────────────────────
  toast_title:   { en: "MUGA found someone else's affiliate tag", es: "MUGA encontró el tag de afiliado de otro" },
  toast_tag_msg: { en: "has an affiliate tag that isn't ours:", es: "tiene un tag de afiliado que no es nuestro:" },
  toast_allow:   { en: "Keep it", es: "Mantenerlo" },
  toast_block:   { en: "Remove it", es: "Eliminarlo" },
  toast_ours:    { en: "Use ours", es: "Usar el nuestro" },
  toast_dismiss: { en: "Dismiss", es: "Descartar" },

  // ── Onboarding ──────────────────────────────────────────────────────────
  ob_page_title:            { en: "Welcome to MUGA",                                                         es: "Bienvenido a MUGA" },
  ob_tagline:               { en: "Make URLs Great Again.",                                                   es: "Haz que las URLs vuelvan a ser geniales." },
  ob_tagline_sub:           { en: "Here's exactly what this extension does — and what it never will.",        es: "Esto es exactamente lo que hace esta extensión — y lo que nunca hará." },
  ob_tagline_local:         { en: "Everything runs locally in your browser. No data is sent to any server.",  es: "Todo se ejecuta en tu navegador. No se envía ningún dato a ningún servidor." },
  ob_step1_title:           { en: "Always on — no configuration needed",                                      es: "Siempre activo — sin configuración" },
  ob_feat1_title:           { en: "Strips 130+ tracking parameters automatically",                            es: "Elimina más de 130 parámetros de rastreo automáticamente" },
  ob_feat1_desc:            { en: "UTMs, fbclid, gclid, msclkid, mc_cid, si (YouTube), eBay tracking tags, and more — removed before the page loads.", es: "UTMs, fbclid, gclid, msclkid, mc_cid, si (YouTube), tags de rastreo de eBay y más — eliminados antes de que cargue la página." },
  ob_feat2_title:           { en: "Redirects Google AMP pages to the real article",                            es: "Redirige páginas AMP de Google al artículo real" },
  ob_feat2_desc:            { en: "AMP URLs are silently redirected to the canonical article so you always land on the actual site.", es: "Las URLs AMP se redirigen silenciosamente al artículo original para que siempre llegues al sitio real." },
  ob_feat3_title:           { en: "Blocks <a ping> tracking beacons",                                         es: "Bloquea balizas de rastreo <a ping>" },
  ob_feat3_desc:            { en: "Prevents the hidden ping requests advertisers use to log every link you click.", es: "Impide las peticiones ocultas que los anunciantes usan para registrar cada enlace que pulsas." },
  ob_feat4_title:           { en: "Unwraps redirect-wrapper URLs",                                            es: "Desenvuelve URLs con redireccionadores" },
  ob_feat4_desc:            { en: "Extracts the real destination from tracking wrappers so you go straight to the target page.", es: "Extrae el destino real de los redireccionadores para que vayas directamente a la página de destino." },
  ob_feat5_title:           { en: "Right-click → Copy clean link",                                            es: "Clic derecho → Copiar enlace limpio" },
  ob_feat5_desc:            { en: "Copies the cleaned URL to your clipboard without navigating anywhere.",     es: "Copia la URL limpia al portapapeles sin navegar a ningún sitio." },
  ob_step2_title:           { en: "How MUGA stays free — your choice",                                        es: "Cómo MUGA se mantiene gratis — tú decides" },
  ob_affiliate_desc:        { en: 'When you visit a supported store (Amazon, Booking.com, AliExpress\u2026) and the link has <strong>no affiliate tag at all</strong>, MUGA can silently add ours. <strong>The price you pay is always identical</strong> \u2014 affiliate tags don\u2019t affect what you pay, they tell the store who referred you. We earn a small commission.<br><br>This is how we keep MUGA free and actively maintained.', es: 'Cuando visitas una tienda compatible (Amazon, Booking.com, AliExpress\u2026) y el enlace <strong>no tiene ning\u00fan tag de afiliado</strong>, MUGA puede a\u00f1adir el nuestro silenciosamente. <strong>El precio que pagas es siempre el mismo</strong> \u2014 los tags de afiliado no afectan lo que pagas, solo indican a la tienda qui\u00e9n te refiri\u00f3. Nosotros ganamos una peque\u00f1a comisi\u00f3n.<br><br>As\u00ed es como mantenemos MUGA gratis y en desarrollo activo.' },
  ob_disclaimer:            { en: '<strong>What MUGA never does:</strong> replace or overwrite a tag that is already in a link. If a creator\u2019s or another affiliate\u2019s tag is there, MUGA leaves it alone. This is the exact opposite of what <a href="https://en.wikipedia.org/wiki/Honey_(browser_extension)" target="_blank">Honey did</a>. MUGA only acts on links that have <em>no tag at all</em>. The source code is public \u2014 you can verify this yourself.', es: '<strong>Lo que MUGA nunca hace:</strong> reemplazar o sobreescribir un tag que ya existe en un enlace. Si el tag de un creador u otro afiliado ya est\u00e1 ah\u00ed, MUGA lo deja intacto. Esto es exactamente lo opuesto a lo que <a href="https://en.wikipedia.org/wiki/Honey_(browser_extension)" target="_blank">hizo Honey</a>. MUGA solo act\u00faa en enlaces que <em>no tienen ning\u00fan tag</em>. El c\u00f3digo fuente es p\u00fablico \u2014 puedes comprobarlo t\u00fa mismo.' },
  ob_tos_label:             { en: 'I have read and accept the <a href="../privacy/tos.html" target="_blank">Terms of use</a> and <a href="../privacy/privacy.html" target="_blank">Privacy policy</a><small style="display:block;color:var(--text2);margin-top:3px">Required to continue</small>', es: 'He le\u00eddo y acepto los <a href="../privacy/tos.html" target="_blank">T\u00e9rminos de uso</a> y la <a href="../privacy/privacy.html" target="_blank">Pol\u00edtica de privacidad</a><small style="display:block;color:var(--text2);margin-top:3px">Obligatorio para continuar</small>' },
  ob_affiliate_check_label: { en: "Yes, support MUGA for free — allow our affiliate tag on links that have none", es: "Sí, apoya a MUGA gratis — permitir nuestro tag de afiliado en enlaces sin ninguno" },
  ob_affiliate_check_hint:  { en: "You always pay the same price. You can disable this in Settings at any time.", es: "Siempre pagas el mismo precio. Puedes desactivarlo en Ajustes en cualquier momento." },
  ob_cta_btn:               { en: "Get started →",                                                            es: "Empezar →" },
  ob_cta_note:              { en: "You can change all of this later in Settings at any time.",                 es: "Puedes cambiar todo esto más tarde en Ajustes en cualquier momento." },
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
const HTML_KEYS = new Set(["bl_hint", "wl_hint", "ob_affiliate_desc", "ob_disclaimer", "ob_tos_label"]);

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
  // [data-i18n-html] — always uses innerHTML (for keys with trusted HTML content)
  document.querySelectorAll("[data-i18n-html]").forEach(el => {
    const key = el.getAttribute("data-i18n-html");
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
  document.querySelectorAll("[data-i18n-title]").forEach(el => {
    const key = el.getAttribute("data-i18n-title");
    el.title = t(key, lang);
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
