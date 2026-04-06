/**
 * MUGA: i18n helper
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
  history_label:        { en: "This session",                          es: "Esta sesión" },
  history_empty:        { en: "No URLs cleaned yet. Start browsing. MUGA works automatically.", es: "Aún no se han limpiado URLs. Navega normalmente. MUGA funciona automáticamente." },
  toggle_enabled:  { en: "Enable MUGA",                   es: "Activar MUGA" },
  toggle_title:    { en: "Enable / disable MUGA",        es: "Activar / desactivar MUGA" },
  link_advanced:    { en: "Settings →", es: "Ajustes →" },
  removed_params_label: { en: "Removed:", es: "Eliminados:" },
  tab_badge_label:      { en: "stripped in this tab", es: "eliminados en esta pestaña" },
  history_copy_hint:    { en: "Click to copy clean URL", es: "Clic para copiar URL limpia" },
  history_copied:       { en: "Copied!", es: "¡Copiado!" },
  history_copy_original: { en: "Copy with tracking", es: "Copiar con rastreo" },
  show_history:          { en: "Show history", es: "Mostrar historial" },
  share_copied:          { en: "Copied!", es: "¡Copiado!" },
  share_btn:             { en: "Share", es: "Compartir" },
  confirm_cancel:        { en: "Cancel", es: "Cancelar" },
  confirm_ok:            { en: "OK", es: "OK" },
  domain_stats_label:    { en: "Your top trackers", es: "Tus principales rastreadores" },
  domain_stats_empty:    { en: "No domain stats yet. Keep browsing!", es: "Aún no hay estadísticas. ¡Sigue navegando!" },
  domain_stats_params:   { en: "params stripped", es: "parámetros eliminados" },
  domain_stats_urls:     { en: "URLs cleaned", es: "URLs limpiadas" },

  // ── Popup: param breakdown (impact-dashboard) ─────────────────────────────
  param_breakdown_label:      { en: "What was removed",                  es: "Qué se eliminó" },
  param_category_analytics:   { en: "Analytics tracking",                es: "Rastreo analítico" },
  param_category_social:      { en: "Social media tracking",             es: "Rastreo de redes sociales" },
  param_category_advertising: { en: "Ad click tracking",                 es: "Rastreo de clics publicitarios" },
  param_category_email:       { en: "Email campaign tracking",           es: "Rastreo de campañas de email" },
  param_category_affiliate:   { en: "Affiliate network tracking",        es: "Rastreo de redes de afiliados" },
  param_category_marketplace: { en: "Marketplace tracking",              es: "Rastreo de marketplace" },
  param_category_ecommerce:   { en: "E-commerce tracking",               es: "Rastreo de e-commerce" },
  param_category_other:       { en: "Other tracking",                    es: "Otro rastreo" },

  // ── Popup milestones ────────────────────────────────────────────────────
  milestone_10000: { en: "MUGA: Legendary URL cleaner", es: "MUGA: Limpiador legendario de URLs" },
  milestone_5000:  { en: "MUGA: Master of Clean URLs", es: "MUGA: Maestro de URLs limpias" },
  milestone_1000:  { en: "MUGA: Tracking Terminator", es: "MUGA: Exterminador de rastreo" },
  milestone_500:   { en: "MUGA: Drain the Swamp Pro", es: "MUGA: Drenando el pantano Pro" },
  milestone_100:   { en: "MUGA: Making URLs Good Again", es: "MUGA: Haciendo las URLs geniales de nuevo" },
  milestone_10:    { en: "MUGA: First steps to clean URLs", es: "MUGA: Primeros pasos hacia URLs limpias" },

  // ── Share: seasonal easter eggs ─────────────────────────────────────────
  share_seasonal_0101: { en: "New year, new URLs. Still no tracking.", es: "Año nuevo, URLs nuevas. Sin rastreo." },
  share_seasonal_0214: { en: "Roses are red, trackers are dead. MUGA cleaned my URLs instead.", es: "Las rosas son rojas, los rastreadores están muertos. MUGA limpió mis URLs." },
  share_seasonal_0314: { en: "Happy Pi Day! 3.14159 reasons to clean your URLs.", es: "¡Feliz día de Pi! 3.14159 razones para limpiar tus URLs." },
  share_seasonal_0401: { en: "This is not a joke: your URLs had tracking params. Had.", es: "No es broma: tus URLs tenían parámetros de rastreo. Tenían." },
  share_seasonal_0504: { en: "May the clean URLs be with you.", es: "Que las URLs limpias te acompañen." },
  share_seasonal_1031: { en: "The scariest thing on the internet? Unclean URLs. Not anymore.", es: "¿Lo más aterrador de internet? URLs sucias. Ya no más." },
  share_seasonal_1225: { en: "All I want for Christmas is clean URLs. Done.", es: "Todo lo que quiero para Navidad son URLs limpias. Hecho." },
  share_seasonal_1231: { en: "My URLs are cleaner than my New Year's resolutions.", es: "Mis URLs están más limpias que mis propósitos de año nuevo." },

  // ── Share: fun phrases ──────────────────────────────────────────────────
  share_phrase_1: { en: "MUGA? Most URLs Get Abused. Mine don't anymore. %junk% trackers stripped so far.", es: "¿MUGA? La Mayoría de URLs son Abusadas. Las mías ya no. %junk% rastreadores eliminados." },
  share_phrase_2: { en: "MUGA. Mercilessly Undoing Garbage Attachments. %junk% params destroyed and counting.", es: "MUGA. Deshaciendo despiadadamente adjuntos basura. %junk% parámetros destruidos y contando." },
  share_phrase_3: { en: "MUGA! Making URLs Good Again. %cleaned% URLs cleaned, zero data collected.", es: "¡MUGA! Haciendo las URLs geniales de nuevo. %cleaned% URLs limpiadas, cero datos recolectados." },
  share_phrase_4: { en: "I've cleaned %cleaned% URLs and stripped %junk% trackers. My browser is basically a spa now.", es: "He limpiado %cleaned% URLs y eliminado %junk% rastreadores. Mi navegador es básicamente un spa." },
  share_phrase_5: { en: "%junk% tracking params eliminated. Nothing happened behind my back. Fair to every click.", es: "%junk% parámetros de rastreo eliminados. Nada pasó a mis espaldas. Justo con cada clic." },
  share_phrase_6: { en: "MUGA just cleaned %cleaned% URLs for me. The trackers never saw it coming.", es: "MUGA acaba de limpiar %cleaned% URLs. Los rastreadores no lo vieron venir." },
  share_phrase_7: { en: "My URLs used to be 400 characters of garbage. Now they're clean, honest, and short.", es: "Mis URLs solían tener 400 caracteres de basura. Ahora son limpias, honestas y cortas." },
  share_phrase_8: { en: "%junk% trackers stripped. No analytics. No telemetry. Just clean links. Fair to every click.", es: "%junk% rastreadores eliminados. Sin analytics. Sin telemetría. Solo enlaces limpios. Justo con cada clic." },
  share_phrase_9: { en: "Every link I click gets cleaned before it loads. %junk% trackers gone. Free and open source.", es: "Cada enlace que abro se limpia antes de cargar. %junk% rastreadores eliminados. Libre y open source." },

  // ── Share: button prefixes ──────────────────────────────────────────────
  share_copied_prefix: { en: "✓ ", es: "✓ " },
  share_copy_prefix:   { en: "📋 ", es: "📋 " },

  // ── Options ──────────────────────────────────────────────────────────────
  opts_title:      { en: "Settings", es: "Ajustes" },
  opts_subtitle:   { en: "Fair to every click.", es: "Fair to every click." },
  section_affiliate_settings: { en: "Affiliate settings", es: "Configuración de afiliados" },
  row_inject_label: { en: "Inject our affiliate tag when a link has none", es: "Inyectar nuestro afiliado cuando no hay ninguno" },
  row_inject_hint:  { en: "Off by default. You always pay the same price. This is how you support an independent developer at zero cost to you.", es: "Desactivado por defecto. Siempre pagas el mismo precio. Así apoyas a un desarrollador independiente sin coste para ti." },
  row_notify_label: { en: "Alert me when a link has someone else's affiliate tag", es: "Avisarme cuando un enlace tenga el tag de afiliado de otro" },
  row_notify_hint:  { en: "Shows a quick notification with options. Auto-dismisses in 15 seconds", es: "Muestra una notificación rápida con opciones. Desaparece en 15 segundos" },
  row_strip_affiliates_label: { en: "Remove all affiliate tags from other sources",          es: "Eliminar todos los tags de afiliado ajenos" },
  row_strip_affiliates_hint:  { en: "Removes affiliate tags placed by others from all links. Our tag is always preserved.", es: "Elimina los tags de afiliado de otros de todos los enlaces. Nuestro tag siempre se conserva." },
  section_stores:    { en: "Affiliate stores", es: "Tiendas afiliadas" },
  stores_hint:       { en: "Green dot = affiliate account active and configured. Grey = account pending registration.", es: "Punto verde = cuenta de afiliado activa. Gris = cuenta pendiente de registro." },
  no_active_stores:  { en: "No affiliate accounts configured yet.", es: "No hay cuentas de afiliado configuradas aún." },
  section_custom_params:    { en: "Custom tracking params: always strip", es: "Parámetros personalizados: eliminar siempre" },
  cp_placeholder:           { en: "ref_code  or  promo_id",                              es: "ref_codigo  o  promo_id" },
  cp_hint:                  { en: "One param name per entry (e.g. <code>mc_cid</code>, <code>oly_enc_id</code>). Stripped on every site, case-insensitive.", es: "Un nombre de parámetro por entrada (ej: <code>mc_cid</code>, <code>oly_enc_id</code>). Eliminado en todas las webs, sin distinción de mayúsculas." },
  section_blacklist: { en: "Blocked domains: always strip", es: "Dominios bloqueados: eliminar siempre" },
  section_whitelist: { en: "Protected tags & domains: never strip", es: "Tags y dominios protegidos: nunca eliminar" },
  privacy_link:    { en: "Privacy policy",                       es: "Política de privacidad" },
  report_issue:    { en: "Report a bug or suggest a feature",    es: "Reportar un error o sugerir mejora" },
  rate_muga_link:  { en: "Rate MUGA",                            es: "Valorar MUGA" },
  consent_gate_msg: { en: "Please accept the Terms of Use and Privacy Policy before using MUGA.", es: "Acepta los Términos de uso y la Política de privacidad antes de usar MUGA." },
  consent_gate_btn: { en: "Accept terms to continue",             es: "Aceptar condiciones para continuar" },
  rate_nudge_btn_short: { en: "Enjoying MUGA? Rate it",               es: "\u00bfTe gusta MUGA? Val\u00f3ralo" },
  bl_placeholder: { en: "mysite.com  or  amazon.es::tag::youtuber-21", es: "mysite.com  o  amazon.es::tag::youtuber-21" },
  wl_placeholder: { en: "mysite.com  or  amazon.es::tag::creator-21", es: "mysite.com  o  amazon.es::tag::creador-21" },
  bl_hint:  { en: "Domain only (e.g. <code>mysite.com</code>): strips all params on that site.<br>Domain::param::value (e.g. <code>amazon.es::tag::youtuber-21</code>): strips one specific affiliate tag.<br><code>amazon.es::disabled</code>: MUGA does nothing on that domain.", es: "Solo dominio (ej: <code>mysite.com</code>): elimina todos los parámetros en esa web.<br>Dominio::param::valor (ej: <code>amazon.es::tag::youtuber-21</code>): elimina un afiliado concreto.<br><code>amazon.es::disabled</code>: MUGA no toca nada en ese dominio." },
  wl_hint:  { en: "Accepts a domain (e.g. <code>mysite.com</code>): MUGA won't touch any affiliate on that site.<br>Or <code>domain::param::value</code> (e.g. <code>amazon.es::tag::creator-21</code>): protects one specific tag.", es: "Acepta un dominio (ej: <code>mysite.com</code>): MUGA no toca ningún afiliado en esa web.<br>O <code>dominio::parámetro::valor</code> (ej: <code>amazon.es::tag::creador-21</code>): protege un tag concreto." },
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
  row_dnr_hint:          { en: "Cleans URLs as you type in the address bar, from bookmarks, and links from other apps. Before the page loads.", es: "Limpia URLs mientras escribes en la barra de direcciones, desde marcadores y enlaces de otras apps. Antes de que cargue la página." },
  row_context_menu_label: { en: "Right-click → Copy clean link or selection", es: "Menú contextual → Copiar enlace o selección limpia" },
  row_context_menu_hint:  { en: "Works on a single link, a text selection with multiple URLs, or plain-text URLs. Alt+Shift+C copies the current tab's clean URL. Ctrl+C also auto-cleans URLs in your selection.", es: "Funciona con un enlace, una selección con varias URLs, o URLs en texto plano. Alt+Shift+C copia la URL limpia de la pestaña. Ctrl+C también limpia automáticamente las URLs en tu selección." },
  section_privacy:       { en: "Privacy",                            es: "Privacidad" },
  row_pings_label:       { en: "Block <a ping> tracking beacons",    es: "Bloquear balizas de rastreo <a ping>" },
  row_pings_hint:        { en: "Removes ping attributes from links so the browser doesn't send tracking beacons on click", es: "Elimina atributos ping para que el navegador no envíe balizas al hacer clic" },
  section_redirects:     { en: "Redirect handling",                  es: "Gestión de redirecciones" },
  row_amp_label:         { en: "Redirect AMP pages to canonical URL", es: "Redirigir páginas AMP a la URL canónica" },
  row_amp_hint:          { en: "Replaces AMP links with the original article URL", es: "Reemplaza los enlaces AMP con la URL original del artículo" },
  row_unwrap_label:      { en: "Unwrap redirect wrappers",            es: "Desenvolver redireccionadores" },
  row_unwrap_hint:       { en: "Extracts the real destination from redirect-wrapper URLs (e.g., ?redirect=https://example.com)", es: "Extrae el destino real de URLs de redirección (ej: ?redirect=https://example.com)" },
  row_toast_duration_label: { en: "Affiliate notification duration", es: "Duración de la notificación de afiliado" },
  row_toast_duration_hint:  { en: "How long the notification stays visible before auto-dismissing", es: "Cuánto tiempo permanece visible la notificación antes de desaparecer" },

  section_stats:         { en: "Statistics",                                                                        es: "Estadísticas" },
  stats_reset_label:     { en: "Lifetime stats",                                                                    es: "Estadísticas acumuladas" },
  stats_reset_hint:      { en: "Counters persist across sessions. Debug log resets when the browser restarts.", es: "Los contadores se conservan entre sesiones. El log de depuración se reinicia al cerrar el navegador." },
  stats_reset_btn:       { en: "Reset stats",                                                                       es: "Reiniciar estadísticas" },
  stats_reset_confirm:   { en: "Are you sure? This will clear all counters.",                                       es: "¿Seguro? Se borrarán todos los contadores." },
  stats_reset_done:      { en: "Stats cleared.",                                                                    es: "Estadísticas borradas." },
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
  dev_nudge_label:            { en: "Preview rating nudge",                                              es: "Previsualizar aviso de valoraci\u00f3n" },
  dev_nudge_hint:             { en: "Test the rating nudge. Dismiss increments the counter, Reset clears it.", es: "Prueba el aviso de valoraci\u00f3n. Descartar incrementa el contador, Reset lo limpia." },
  dev_nudge_btn:              { en: "Preview",                                                           es: "Previsualizar" },
  dev_url_tester_label:       { en: "URL tester",                                                       es: "Probador de URLs" },
  dev_url_tester_hint:        { en: "Paste any URL to see what MUGA will clean",                        es: "Pega cualquier URL para ver qué limpiará MUGA" },
  dev_url_tester_placeholder: { en: "https://example.com?utm_source=google&fbclid=...",                 es: "https://example.com?utm_source=google&fbclid=..." },
  dev_url_test_btn:           { en: "Test",                                                             es: "Probar" },
  dev_url_result_label:       { en: "Result",                                                           es: "Resultado" },
  dev_url_removed:            { en: "Removed: %s",                                                       es: "Eliminados: %s" },
  dev_url_clean:              { en: "No tracking params found. URL is already clean.",                   es: "Sin parámetros de rastreo. La URL ya está limpia." },
  dev_url_action:             { en: "Action: %s",                                                        es: "Acción: %s" },
  dev_url_report_btn:         { en: "Report a problem with this URL",                                    es: "Reportar un problema con esta URL" },
  report_broken_label:        { en: "Report a bug or suggest an improvement",                            es: "Reportar un error o sugerir una mejora" },
  report_dirty_url:           { en: "Report a problem with this URL",                                    es: "Reportar un problema con esta URL" },
  dev_report_broken_hint:     { en: "Opens a pre-filled GitHub issue with your browser and extension info", es: "Abre un issue de GitHub pre-rellenado con info de tu navegador y extensi\u00f3n" },
  dev_report_broken_btn:      { en: "Report",                                                            es: "Reportar" },

  // ── Context menu ─────────────────────────────────────────────────────────
  ctx_copy_clean_link:      { en: "Copy clean link",                       es: "Copiar enlace limpio" },
  ctx_copy_clean_selection: { en: "Copy clean links in selection",         es: "Copiar enlaces limpios de la selección" },

  // ── Content script toast ──────────────────────────────────────────────────
  toast_title:   { en: "MUGA found someone else's affiliate tag", es: "MUGA encontró el tag de afiliado de otro" },
  toast_tag_msg: { en: "has an affiliate tag that isn't ours:", es: "tiene un tag de afiliado que no es nuestro:" },
  toast_allow:   { en: "Keep it", es: "Mantenerlo" },
  toast_block:   { en: "Remove it", es: "Eliminarlo" },
  toast_dismiss: { en: "Dismiss", es: "Descartar" },

  // ── Onboarding ──────────────────────────────────────────────────────────
  ob_page_title:            { en: "Welcome to MUGA",                                                         es: "Bienvenido a MUGA" },
  ob_tagline:               { en: "Fair to every click.",                                                    es: "Fair to every click." },
  ob_tagline_sub:           { en: "Open source. Transparent. Built to protect your privacy.",                es: "Open source. Transparente. Hecho para proteger tu privacidad." },
  ob_tagline_values:        { en: "We may get things wrong, but we will always be honest about it and work to fix it. You stay in control.", es: "Puede que nos equivoquemos, pero siempre seremos honestos al respecto y trabajaremos para corregirlo. T\u00fa decides." },
  ob_step1_title:           { en: "What MUGA does, automatically",                                          es: "Lo que MUGA hace, autom\u00e1ticamente" },
  ob_feat1_title:           { en: "Strips 459+ tracking parameters from every URL",                         es: "Elimina 459+ par\u00e1metros de rastreo de cada URL" },
  ob_feat1_desc:            { en: "fbclid, gclid, UTMs, and hundreds more. Removed before the page loads. No data is collected or sent anywhere.", es: "fbclid, gclid, UTMs y cientos m\u00e1s. Eliminados antes de que cargue la p\u00e1gina. No se recoge ni env\u00eda ning\u00fan dato." },
  ob_feat2_title:           { en: "Blocks hidden tracking: AMP redirects, ping beacons, URL wrappers",      es: "Bloquea rastreo oculto: redirecciones AMP, balizas ping, wrappers de URL" },
  ob_feat2_desc:            { en: "Every trick advertisers use to follow your clicks is neutralized locally, inside your browser.", es: "Cada truco que los anunciantes usan para seguir tus clics se neutraliza en local, dentro de tu navegador." },
  ob_feat3_title:           { en: "Clean URLs are shorter, prettier, and safe to share",                     es: "Las URLs limpias son m\u00e1s cortas, m\u00e1s bonitas y seguras para compartir" },
  ob_feat3_desc:            { en: "Sometimes you can barely tell where a link goes with all the junk attached. Right-click any link to copy it clean -- no tracking, no noise.", es: "A veces es imposible saber a d\u00f3nde lleva un enlace con tanta basura pegada. Clic derecho en cualquier enlace para copiarlo limpio -- sin rastreo, sin ruido." },
  ob_step2_title:           { en: "Fair to every click",                                                    es: "Justa con cada clic" },
  ob_affiliate_desc:        { en: 'On selected stores, if a link has <strong>no affiliate tag at all</strong>, MUGA can add ours. <strong>Your price never changes.</strong> If a creator\'s tag is already there, we never touch it -- the code is open source, you can verify this.<br><br>We deliberately rejected 10+ stores whose tracking methods require routing your clicks through external servers. We would rather earn less than compromise how MUGA works.', es: 'En tiendas seleccionadas, si un enlace <strong>no tiene ning\u00fan tag de afiliado</strong>, MUGA puede a\u00f1adir el nuestro. <strong>Tu precio nunca cambia.</strong> Si el tag de un creador ya est\u00e1 ah\u00ed, nunca lo tocamos -- el c\u00f3digo es open source, puedes comprobarlo.<br><br>Hemos rechazado deliberadamente m\u00e1s de 10 tiendas cuyos m\u00e9todos de rastreo obligan a pasar tus clics por servidores externos. Preferimos ganar menos que comprometer c\u00f3mo funciona MUGA.' },
  ob_tos_label:             { en: 'I have read and accept the <a href="../privacy/tos.html" target="_blank" rel="noopener noreferrer">Terms of use</a> and <a href="../privacy/privacy.html" target="_blank" rel="noopener noreferrer">Privacy policy</a><small class="tos-required-hint">Required to continue</small>', es: 'He le\u00eddo y acepto los <a href="../privacy/tos.html" target="_blank" rel="noopener noreferrer">T\u00e9rminos de uso</a> y la <a href="../privacy/privacy.html" target="_blank" rel="noopener noreferrer">Pol\u00edtica de privacidad</a><small class="tos-required-hint">Obligatorio para continuar</small>' },
  ob_affiliate_check_label: { en: "Allow MUGA's affiliate tag on links that have none",                     es: "Permitir el tag de afiliado de MUGA en enlaces que no tengan ninguno" },
  ob_affiliate_check_hint:  { en: "Same price, always. If a link already has a tag, MUGA never touches it. Verify in our source code.", es: "Mismo precio, siempre. Si un enlace ya tiene un tag, MUGA nunca lo toca. Compru\u00e9balo en nuestro c\u00f3digo fuente." },
  ob_cta_btn:               { en: "Start browsing clean",                                                   es: "Empieza a navegar limpio" },
  ob_cta_note:              { en: "Open source, GPL v3. Change any setting anytime.",                        es: "C\u00f3digo abierto, GPL v3. Cambia cualquier ajuste en cualquier momento." },
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
const HTML_KEYS = new Set(["bl_hint", "wl_hint", "cp_hint", "ob_affiliate_desc", "ob_tos_label"]);

// Allowed tags and attributes for HTML_KEYS sanitization.
const ALLOWED_TAGS = new Set(["code", "br", "strong", "em", "a", "small"]);
const ALLOWED_ATTRS = new Set(["href", "target", "class", "rel"]);

/** Sanitize HTML by stripping all tags/attrs not in the allowlists. */
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
        walk(child);
      }
    }
  };
  walk(doc.body);
  return doc.body.innerHTML;
}

/**
 * Applies translations to all [data-i18n] elements in the current document.
 * Uses textContent for plain strings and sanitized innerHTML only for known HTML keys.
 * Also handles [data-i18n-placeholder] for input placeholders.
 * @param {string} lang - Language code ("en" | "es")
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
          resolve(r?.language ?? browserLang());
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
