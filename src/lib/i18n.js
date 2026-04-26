/**
 * MUGA: i18n helper
 *
 * Provides translations for EN, ES, PT, and DE. Each key maps to an object with
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
  { code: "pt", label: "Português" },
  { code: "de", label: "Deutsch" },
];

export const TRANSLATIONS = {
  // ── Popup ────────────────────────────────────────────────────────────────
  stat_urls:       { en: "URLs cleaned",      es: "URLs limpias",           pt: "URLs limpas",          de: "URLs bereinigt" },
  stat_junk:       { en: "tracking params removed", es: "parámetros eliminados", pt: "parâmetros removidos", de: "Tracking-Parameter entfernt" },
  stat_referrals:  { en: "affiliate tags detected", es: "tags de afiliado detectados", pt: "tags de afiliado detectados", de: "Affiliate-Tags erkannt" },
  preview_label:   { en: "This page",                     es: "Esta página",                  pt: "Esta página",                  de: "Diese Seite" },
  history_label:        { en: "This session",                          es: "Esta sesión",                       pt: "Esta sessão",                       de: "Diese Sitzung" },
  history_empty:        { en: "No URLs cleaned yet. Start browsing. MUGA works automatically.", es: "Aún no se han limpiado URLs. Navega normalmente. MUGA funciona automáticamente.", pt: "Nenhuma URL limpa ainda. Comece a navegar. MUGA funciona automaticamente.", de: "Noch keine URLs bereinigt. Fang an zu surfen. MUGA arbeitet automatisch." },
  toggle_enabled:  { en: "Enable MUGA",                   es: "Activar MUGA",                 pt: "Ativar MUGA",                  de: "MUGA aktivieren" },
  toggle_title:    { en: "Enable / disable MUGA",        es: "Activar / desactivar MUGA",    pt: "Ativar / desativar MUGA",      de: "MUGA aktivieren / deaktivieren" },
  link_advanced:    { en: "Settings →", es: "Ajustes →", pt: "Configurações →", de: "Einstellungen →" },
  removed_params_label: { en: "Removed:", es: "Eliminados:", pt: "Removidos:", de: "Entfernt:" },
  tab_badge_label:      { en: "stripped in this tab", es: "eliminados en esta pestaña", pt: "removidos nesta aba", de: "in diesem Tab entfernt" },
  history_copy_hint:    { en: "Click to copy clean URL", es: "Clic para copiar URL limpia", pt: "Clique para copiar URL limpa", de: "Klicken zum Kopieren der bereinigten URL" },
  history_copied:       { en: "Copied!", es: "¡Copiado!", pt: "Copiado!", de: "Kopiert!" },
  history_copy_original: { en: "Copy with tracking", es: "Copiar con rastreo", pt: "Copiar com rastreamento", de: "Mit Tracking kopieren" },
  show_history:          { en: "Show history", es: "Mostrar historial", pt: "Mostrar histórico", de: "Verlauf anzeigen" },
  share_copied:          { en: "Copied!", es: "¡Copiado!", pt: "Copiado!", de: "Kopiert!" },
  share_btn:             { en: "Share", es: "Compartir", pt: "Compartilhar", de: "Teilen" },
  confirm_cancel:        { en: "Cancel", es: "Cancelar", pt: "Cancelar", de: "Abbrechen" },
  confirm_ok:            { en: "OK", es: "OK", pt: "OK", de: "OK" },
  domain_stats_label:    { en: "Your top trackers", es: "Tus principales rastreadores", pt: "Seus principais rastreadores", de: "Deine häufigsten Tracker" },
  domain_stats_empty:    { en: "No domain stats yet. Keep browsing!", es: "Aún no hay estadísticas. ¡Sigue navegando!", pt: "Sem estatísticas ainda. Continue navegando!", de: "Noch keine Domain-Statistiken. Weiter surfen!" },
  domain_stats_params:   { en: "params stripped", es: "parámetros eliminados", pt: "parâmetros removidos", de: "Parameter entfernt" },
  domain_stats_urls:     { en: "URLs cleaned", es: "URLs limpiadas", pt: "URLs limpas", de: "URLs bereinigt" },

  // ── Popup: param breakdown (impact-dashboard) ─────────────────────────────
  // NOTE: The breakdown in popup.js reads locale labels directly from
  // TRACKING_PARAM_CATEGORIES (labelEs/labelPt/labelDe) for performance.
  // The keys below are kept in sync so contributors can update all labels in
  // one place and as a reference for future locale additions.
  param_breakdown_label:      { en: "What was removed",                  es: "Qué se eliminó",                      pt: "O que foi removido",                   de: "Was wurde entfernt" },
  param_category_analytics:   { en: "Analytics tracking",                es: "Rastreo analítico",                   pt: "Rastreamento analítico",               de: "Analytics-Tracking" },
  param_category_social:      { en: "Social media tracking",             es: "Rastreo de redes sociales",           pt: "Rastreamento de redes sociais",        de: "Social-Media-Tracking" },
  param_category_advertising: { en: "Ad click tracking",                 es: "Rastreo de clics publicitarios",      pt: "Rastreamento de cliques em anúncios",  de: "Werbe-Click-Tracking" },
  param_category_email:       { en: "Email campaign tracking",           es: "Rastreo de campañas de email",        pt: "Rastreamento de campanhas de email",   de: "E-Mail-Kampagnen-Tracking" },
  param_category_affiliate:   { en: "Affiliate network tracking",        es: "Rastreo de redes de afiliados",       pt: "Rastreamento de redes de afiliados",   de: "Affiliate-Netzwerk-Tracking" },
  param_category_marketplace: { en: "Marketplace tracking",              es: "Rastreo de marketplace",              pt: "Rastreamento de marketplace",          de: "Marktplatz-Tracking" },
  param_category_ecommerce:   { en: "E-commerce tracking",               es: "Rastreo de e-commerce",               pt: "Rastreamento de e-commerce",           de: "E-Commerce-Tracking" },
  param_category_other:       { en: "Other tracking",                    es: "Otro rastreo",                        pt: "Outro rastreamento",                   de: "Sonstiges Tracking" },

  // ── Popup milestones ────────────────────────────────────────────────────
  milestone_10000: { en: "MUGA: Legendary URL cleaner", es: "MUGA: Limpiador legendario de URLs", pt: "MUGA: Limpador lendário de URLs", de: "MUGA: Legendärer URL-Reiniger" },
  milestone_5000:  { en: "MUGA: Master of Clean URLs", es: "MUGA: Maestro de URLs limpias", pt: "MUGA: Mestre das URLs limpas", de: "MUGA: Meister der sauberen URLs" },
  milestone_1000:  { en: "MUGA: Tracking Terminator", es: "MUGA: Exterminador de rastreo", pt: "MUGA: Exterminador de rastreamento", de: "MUGA: Tracking-Terminator" },
  milestone_500:   { en: "MUGA: Drain the Swamp Pro", es: "MUGA: Drenando el pantano Pro", pt: "MUGA: Drenando o pântano Pro", de: "MUGA: Drain the Swamp Pro" },
  milestone_100:   { en: "MUGA: Making URLs Good Again", es: "MUGA: Haciendo las URLs geniales de nuevo", pt: "MUGA: Making URLs Good Again", de: "MUGA: Making URLs Good Again" },
  milestone_10:    { en: "MUGA: First steps to clean URLs", es: "MUGA: Primeros pasos hacia URLs limpias", pt: "MUGA: Primeiros passos para URLs limpas", de: "MUGA: Erste Schritte zu sauberen URLs" },

  // ── Share: seasonal easter eggs ─────────────────────────────────────────
  share_seasonal_0101: { en: "New year, new URLs. Still no tracking.", es: "Año nuevo, URLs nuevas. Sin rastreo.", pt: "Ano novo, URLs novas. Sem rastreamento.", de: "Neues Jahr, neue URLs. Immer noch kein Tracking." },
  share_seasonal_0214: { en: "Roses are red, trackers are dead. MUGA cleaned my URLs instead.", es: "Las rosas son rojas, los rastreadores están muertos. MUGA limpió mis URLs.", pt: "Rosas são vermelhas, trackers estão mortos. MUGA limpou minhas URLs.", de: "Rosen sind rot, Tracker sind tot. MUGA hat meine URLs bereinigt." },
  share_seasonal_0314: { en: "Happy Pi Day! 3.14159 reasons to clean your URLs.", es: "¡Feliz día de Pi! 3.14159 razones para limpiar tus URLs.", pt: "Feliz Dia do Pi! 3.14159 razões para limpar suas URLs.", de: "Fröhlicher Pi-Tag! 3.14159 Gründe, deine URLs zu bereinigen." },
  share_seasonal_0401: { en: "This is not a joke: your URLs had tracking params. Had.", es: "No es broma: tus URLs tenían parámetros de rastreo. Tenían.", pt: "Não é brincadeira: suas URLs tinham parâmetros de rastreamento. Tinham.", de: "Das ist kein Scherz: Deine URLs hatten Tracking-Parameter. Hatten." },
  share_seasonal_0504: { en: "May the clean URLs be with you.", es: "Que las URLs limpias te acompañen.", pt: "Que as URLs limpas estejam com você.", de: "Mögen die sauberen URLs mit dir sein." },
  share_seasonal_1031: { en: "The scariest thing on the internet? Unclean URLs. Not anymore.", es: "¿Lo más aterrador de internet? URLs sucias. Ya no más.", pt: "A coisa mais assustadora da internet? URLs sujas. Não mais.", de: "Das Gruseligste im Internet? Unsaubere URLs. Nicht mehr." },
  share_seasonal_1225: { en: "All I want for Christmas is clean URLs. Done.", es: "Todo lo que quiero para Navidad son URLs limpias. Hecho.", pt: "Tudo o que quero para o Natal são URLs limpas. Feito.", de: "Alles, was ich zu Weihnachten möchte, sind saubere URLs. Erledigt." },
  share_seasonal_1231: { en: "My URLs are cleaner than my New Year's resolutions.", es: "Mis URLs están más limpias que mis propósitos de año nuevo.", pt: "Minhas URLs estão mais limpas do que minhas resoluções de Ano Novo.", de: "Meine URLs sind sauberer als meine Neujahrsvorsätze." },

  // ── Share: fun phrases ──────────────────────────────────────────────────
  share_phrase_1: { en: "MUGA? Most URLs Get Abused. Mine don't anymore. %junk% trackers stripped so far.", es: "¿MUGA? La Mayoría de URLs son Abusadas. Las mías ya no. %junk% rastreadores eliminados.", pt: "MUGA? Most URLs Get Abused. As minhas não. %junk% trackers removidos até agora.", de: "MUGA? Most URLs Get Abused. Meine nicht mehr. %junk% Tracker bisher entfernt." },
  share_phrase_2: { en: "MUGA. Mercilessly Undoing Garbage Attachments. %junk% params destroyed and counting.", es: "MUGA. Deshaciendo despiadadamente adjuntos basura. %junk% parámetros destruidos y contando.", pt: "MUGA. Mercilessly Undoing Garbage Attachments. %junk% params destruídos e contando.", de: "MUGA. Mercilessly Undoing Garbage Attachments. %junk% Parameter vernichtet und zählend." },
  share_phrase_3: { en: "MUGA! Making URLs Good Again. %cleaned% URLs cleaned, zero data collected.", es: "¡MUGA! Haciendo las URLs geniales de nuevo. %cleaned% URLs limpiadas, cero datos recolectados.", pt: "MUGA! Making URLs Good Again. %cleaned% URLs limpas, zero dados coletados.", de: "MUGA! Making URLs Good Again. %cleaned% URLs bereinigt, null Daten gesammelt." },
  share_phrase_4: { en: "I've cleaned %cleaned% URLs and stripped %junk% trackers. My browser is basically a spa now.", es: "He limpiado %cleaned% URLs y eliminado %junk% rastreadores. Mi navegador es básicamente un spa.", pt: "Limpei %cleaned% URLs e removi %junk% trackers. Meu navegador virou um spa.", de: "Ich habe %cleaned% URLs bereinigt und %junk% Tracker entfernt. Mein Browser ist jetzt quasi ein Spa." },
  share_phrase_5: { en: "%junk% tracking params eliminated. Nothing happened behind my back. Fair to every click.", es: "%junk% parámetros de rastreo eliminados. Nada pasó a mis espaldas. Justo con cada clic.", pt: "%junk% parâmetros de rastreamento eliminados. Nada aconteceu por trás das cortinas. Fair to every click.", de: "%junk% Tracking-Parameter eliminiert. Nichts passierte hinter meinem Rücken. Fair to every click." },
  share_phrase_6: { en: "MUGA just cleaned %cleaned% URLs for me. The trackers never saw it coming.", es: "MUGA acaba de limpiar %cleaned% URLs. Los rastreadores no lo vieron venir.", pt: "MUGA acabou de limpar %cleaned% URLs para mim. Os trackers não viram isso chegando.", de: "MUGA hat gerade %cleaned% URLs für mich bereinigt. Die Tracker haben es nicht kommen sehen." },
  share_phrase_7: { en: "My URLs used to be 400 characters of garbage. Now they're clean, honest, and short.", es: "Mis URLs solían tener 400 caracteres de basura. Ahora son limpias, honestas y cortas.", pt: "Minhas URLs costumavam ter 400 caracteres de lixo. Agora são limpas, honestas e curtas.", de: "Meine URLs waren früher 400 Zeichen Datenmüll. Jetzt sind sie sauber, ehrlich und kurz." },
  share_phrase_8: { en: "%junk% trackers stripped. No analytics. No telemetry. Just clean links. Fair to every click.", es: "%junk% rastreadores eliminados. Sin analytics. Sin telemetría. Solo enlaces limpios. Justo con cada clic.", pt: "%junk% trackers removidos. Sem analytics. Sem telemetria. Só links limpos. Fair to every click.", de: "%junk% Tracker entfernt. Kein Analytics. Kein Telemetrie. Nur saubere Links. Fair to every click." },
  share_phrase_9: { en: "Every link I click gets cleaned before it loads. %junk% trackers gone. Free and open source.", es: "Cada enlace que abro se limpia antes de cargar. %junk% rastreadores eliminados. Libre y open source.", pt: "Cada link que clico é limpo antes de carregar. %junk% trackers eliminados. Gratuito e open source.", de: "Jeder Link, den ich anklicke, wird vor dem Laden bereinigt. %junk% Tracker weg. Kostenlos und open source." },

  // ── Share: button prefixes ──────────────────────────────────────────────
  share_copied_prefix: { en: "✓ ", es: "✓ ", pt: "✓ ", de: "✓ " },
  share_copy_prefix:   { en: "📋 ", es: "📋 ", pt: "📋 ", de: "📋 " },

  // ── Options ──────────────────────────────────────────────────────────────
  opts_title:      { en: "Settings", es: "Ajustes", pt: "Configurações", de: "Einstellungen" },
  opts_subtitle:   { en: "Fair to every click.", es: "Justa con cada clic.", pt: "Justa com cada clique.", de: "Fair bei jedem Klick." },
  section_affiliate_settings: { en: "Affiliate settings", es: "Configuración de afiliados", pt: "Configurações de afiliados", de: "Affiliate-Einstellungen" },
  row_inject_label: { en: "Inject our affiliate tag when a link has none", es: "Inyectar nuestro afiliado cuando no hay ninguno", pt: "Inserir nossa tag de afiliado quando o link não tem nenhuma", de: "Unser Affiliate-Tag einfügen, wenn ein Link keinen hat" },
  row_inject_hint:  { en: "Off by default. You always pay the same price. This is how you support an independent developer at zero cost to you.", es: "Desactivado por defecto. Siempre pagas el mismo precio. Así apoyas a un desarrollador independiente sin coste para ti.", pt: "Desativado por padrão. Você sempre paga o mesmo preço. É assim que você apoia um desenvolvedor independente sem nenhum custo.", de: "Standardmäßig deaktiviert. Du zahlst immer denselben Preis. So unterstützt du einen unabhängigen Entwickler ohne Mehrkosten." },
  row_notify_label: { en: "Alert me when a link has someone else's affiliate tag", es: "Avisarme cuando un enlace tenga el tag de afiliado de otro", pt: "Me avisar quando um link tiver a tag de afiliado de outra pessoa", de: "Mich benachrichtigen, wenn ein Link ein fremdes Affiliate-Tag hat" },
  row_notify_hint:  { en: "Shows a quick notification with options. Auto-dismisses in 15 seconds", es: "Muestra una notificación rápida con opciones. Desaparece en 15 segundos", pt: "Mostra uma notificação rápida com opções. Fecha automaticamente em 15 segundos", de: "Zeigt eine kurze Benachrichtigung mit Optionen. Wird nach 15 Sekunden automatisch geschlossen" },
  row_strip_affiliates_label: { en: "Remove all affiliate tags from other sources",          es: "Eliminar todos los tags de afiliado ajenos",          pt: "Remover todas as tags de afiliado de outras fontes",          de: "Alle fremden Affiliate-Tags entfernen" },
  row_strip_affiliates_hint:  { en: "Removes affiliate tags placed by others from all links. Our tag is always preserved.", es: "Elimina los tags de afiliado de otros de todos los enlaces. Nuestro tag siempre se conserva.", pt: "Remove tags de afiliado colocadas por outros de todos os links. Nossa tag é sempre preservada.", de: "Entfernt von anderen gesetzte Affiliate-Tags aus allen Links. Unser Tag bleibt immer erhalten." },
  section_stores:    { en: "Affiliate stores", es: "Tiendas afiliadas", pt: "Lojas afiliadas", de: "Affiliate-Shops" },
  stores_hint:       { en: "Green dot = affiliate account active and configured. Grey = account pending registration.", es: "Punto verde = cuenta de afiliado activa. Gris = cuenta pendiente de registro.", pt: "Ponto verde = conta de afiliado ativa e configurada. Cinza = conta pendente de registro.", de: "Grüner Punkt = Affiliate-Konto aktiv und konfiguriert. Grau = Konto ausstehend." },
  no_active_stores:  { en: "No affiliate accounts configured yet.", es: "No hay cuentas de afiliado configuradas aún.", pt: "Nenhuma conta de afiliado configurada ainda.", de: "Noch keine Affiliate-Konten konfiguriert." },
  section_custom_params:    { en: "Custom tracking params: always strip", es: "Parámetros personalizados: eliminar siempre", pt: "Parâmetros personalizados: remover sempre", de: "Benutzerdefinierte Tracking-Parameter: immer entfernen" },
  cp_placeholder:           { en: "ref_code  or  promo_id",                              es: "ref_codigo  o  promo_id",                              pt: "ref_code  ou  promo_id",                              de: "ref_code  oder  promo_id" },
  cp_hint:                  { en: "One param name per entry (e.g. <code>mc_cid</code>, <code>oly_enc_id</code>). Stripped on every site, case-insensitive.", es: "Un nombre de parámetro por entrada (ej: <code>mc_cid</code>, <code>oly_enc_id</code>). Eliminado en todas las webs, sin distinción de mayúsculas.", pt: "Um nome de parâmetro por entrada (ex: <code>mc_cid</code>, <code>oly_enc_id</code>). Removido em todos os sites, sem distinção de maiúsculas.", de: "Ein Parametername pro Eintrag (z.B. <code>mc_cid</code>, <code>oly_enc_id</code>). Auf jeder Website entfernt, Groß-/Kleinschreibung egal." },
  section_blacklist: { en: "Blocked domains: always strip", es: "Dominios bloqueados: eliminar siempre", pt: "Domínios bloqueados: remover sempre", de: "Gesperrte Domains: immer bereinigen" },
  section_whitelist: { en: "Protected tags & domains: never strip", es: "Tags y dominios protegidos: nunca eliminar", pt: "Tags e domínios protegidos: nunca remover", de: "Geschützte Tags & Domains: nie entfernen" },
  privacy_link:    { en: "Privacy policy",                       es: "Política de privacidad",                       pt: "Política de privacidade",                       de: "Datenschutzrichtlinie" },
  report_issue:    { en: "Report a bug or suggest a feature",    es: "Reportar un error o sugerir mejora",    pt: "Reportar um bug ou sugerir uma melhoria",    de: "Fehler melden oder Feature vorschlagen" },
  rate_muga_link:  { en: "Rate MUGA",                            es: "Valorar MUGA",                            pt: "Avaliar MUGA",                            de: "MUGA bewerten" },
  consent_gate_msg: { en: "Please accept the Terms of Use and Privacy Policy before using MUGA.", es: "Acepta los Términos de uso y la Política de privacidad antes de usar MUGA.", pt: "Aceite os Termos de Uso e a Política de Privacidade antes de usar o MUGA.", de: "Bitte akzeptiere die Nutzungsbedingungen und Datenschutzrichtlinie, bevor du MUGA verwendest." },
  consent_gate_btn: { en: "Accept terms to continue",             es: "Aceptar condiciones para continuar",             pt: "Aceitar termos para continuar",             de: "Bedingungen akzeptieren und fortfahren" },
  rate_nudge_btn_short: { en: "Enjoying MUGA? Rate it",               es: "\u00bfTe gusta MUGA? Val\u00f3ralo",               pt: "Curtindo o MUGA? Avalie-o",               de: "Gefällt dir MUGA? Bewerte es" },
  bl_placeholder: { en: "mysite.com  or  amazon.es::tag::youtuber-21", es: "mysite.com  o  amazon.es::tag::youtuber-21", pt: "mysite.com  ou  amazon.com.br::tag::youtuber-21", de: "mysite.com  oder  amazon.de::tag::youtuber-21" },
  wl_placeholder: { en: "mysite.com  or  amazon.es::tag::creator-21", es: "mysite.com  o  amazon.es::tag::creador-21", pt: "mysite.com  ou  amazon.com.br::tag::criador-21", de: "mysite.com  oder  amazon.de::tag::creator-21" },
  bl_hint:  { en: "Domain only (e.g. <code>mysite.com</code>): strips all params on that site.<br>Domain::param::value (e.g. <code>amazon.es::tag::youtuber-21</code>): strips one specific affiliate tag.<br><code>amazon.es::disabled</code>: MUGA does nothing on that domain.", es: "Solo dominio (ej: <code>mysite.com</code>): elimina todos los parámetros en esa web.<br>Dominio::param::valor (ej: <code>amazon.es::tag::youtuber-21</code>): elimina un afiliado concreto.<br><code>amazon.es::disabled</code>: MUGA no toca nada en ese dominio.", pt: "Apenas domínio (ex: <code>mysite.com</code>): remove todos os parâmetros nesse site.<br>Domínio::param::valor (ex: <code>amazon.com.br::tag::youtuber-21</code>): remove uma tag de afiliado específica.<br><code>amazon.com.br::disabled</code>: MUGA não toca nada nesse domínio.", de: "Nur Domain (z.B. <code>mysite.com</code>): entfernt alle Parameter auf dieser Website.<br>Domain::param::Wert (z.B. <code>amazon.de::tag::youtuber-21</code>): entfernt ein bestimmtes Affiliate-Tag.<br><code>amazon.de::disabled</code>: MUGA macht nichts auf dieser Domain." },
  wl_hint:  { en: "Accepts a domain (e.g. <code>mysite.com</code>): MUGA won't touch any affiliate on that site.<br>Or <code>domain::param::value</code> (e.g. <code>amazon.es::tag::creator-21</code>): protects one specific tag.", es: "Acepta un dominio (ej: <code>mysite.com</code>): MUGA no toca ningún afiliado en esa web.<br>O <code>dominio::parámetro::valor</code> (ej: <code>amazon.es::tag::creador-21</code>): protege un tag concreto.", pt: "Aceita um domínio (ex: <code>mysite.com</code>): MUGA não toca nenhum afiliado nesse site.<br>Ou <code>domínio::param::valor</code> (ex: <code>amazon.com.br::tag::criador-21</code>): protege uma tag específica.", de: "Akzeptiert eine Domain (z.B. <code>mysite.com</code>): MUGA berührt keine Affiliates auf dieser Website.<br>Oder <code>Domain::param::Wert</code> (z.B. <code>amazon.de::tag::creator-21</code>): schützt ein bestimmtes Tag." },
  add_btn:  { en: "+ Add", es: "+ Añadir", pt: "+ Adicionar", de: "+ Hinzufügen" },
  empty_list: { en: "No entries yet.", es: "Sin entradas todavía.", pt: "Nenhuma entrada ainda.", de: "Noch keine Einträge." },
  muga_disabled: { en: "MUGA is disabled", es: "MUGA está desactivado", pt: "MUGA está desativado", de: "MUGA ist deaktiviert" },
  section_tracking_categories: { en: "Tracking categories", es: "Categorías de rastreo", pt: "Categorias de rastreamento", de: "Tracking-Kategorien" },
  categories_hint: { en: "Enable or disable stripping for each param category. Disabling a category keeps those parameters in URLs.", es: "Activa o desactiva la eliminación por categoría. Desactivar una categoría conserva esos parámetros en las URLs.", pt: "Ative ou desative a remoção por categoria. Desativar uma categoria mantém esses parâmetros nas URLs.", de: "Aktiviere oder deaktiviere das Entfernen pro Parameter-Kategorie. Deaktivierte Kategorien behalten ihre Parameter in URLs." },

  section_features:  { en: "Features", es: "Funciones", pt: "Funcionalidades", de: "Funktionen" },
  section_language: { en: "Language", es: "Idioma", pt: "Idioma", de: "Sprache" },
  lang_label:  { en: "Display language", es: "Idioma de la interfaz", pt: "Idioma da interface", de: "Anzeigesprache" },
  lang_hint:   { en: "Affects the popup and settings page. Does not affect URL processing.", es: "Afecta al popup y a esta página. No afecta al procesamiento de URLs.", pt: "Afeta o popup e a página de configurações. Não afeta o processamento de URLs.", de: "Betrifft das Popup und die Einstellungsseite. Hat keinen Einfluss auf die URL-Verarbeitung." },

  row_dnr_label:         { en: "Strip tracking parameters before navigation", es: "Eliminar parámetros de rastreo antes de navegar", pt: "Remover parâmetros de rastreamento antes de navegar", de: "Tracking-Parameter vor der Navigation entfernen" },
  row_dnr_hint:          { en: "Cleans URLs as you type in the address bar, from bookmarks, and links from other apps. Before the page loads.", es: "Limpia URLs mientras escribes en la barra de direcciones, desde marcadores y enlaces de otras apps. Antes de que cargue la página.", pt: "Limpa URLs enquanto você digita na barra de endereços, de favoritos e links de outros apps. Antes de a página carregar.", de: "Bereinigt URLs während du in der Adressleiste tippst, aus Lesezeichen und Links aus anderen Apps. Vor dem Laden der Seite." },
  row_context_menu_label: { en: "Right-click → Copy clean link or selection", es: "Menú contextual → Copiar enlace o selección limpia", pt: "Botão direito → Copiar link limpo ou seleção", de: "Rechtsklick → Bereinigten Link oder Auswahl kopieren" },
  row_context_menu_hint:  { en: "Works on a single link, a text selection with multiple URLs, or plain-text URLs. Alt+Shift+C copies the current tab's clean URL. Ctrl+C also auto-cleans URLs in your selection.", es: "Funciona con un enlace, una selección con varias URLs, o URLs en texto plano. Alt+Shift+C copia la URL limpia de la pestaña. Ctrl+C también limpia automáticamente las URLs en tu selección.", pt: "Funciona em um único link, uma seleção de texto com várias URLs, ou URLs em texto puro. Alt+Shift+C copia a URL limpa da aba atual. Ctrl+C também limpa automaticamente URLs na sua seleção.", de: "Funktioniert bei einem einzelnen Link, einer Textauswahl mit mehreren URLs oder reinen Text-URLs. Alt+Shift+C kopiert die bereinigte URL des aktuellen Tabs. Strg+C bereinigt auch URLs in deiner Auswahl automatisch." },
  row_pings_label:       { en: "Block <a ping> tracking beacons",    es: "Bloquear balizas de rastreo <a ping>",    pt: "Bloquear balizas de rastreamento <a ping>",    de: "<a ping>-Tracking-Beacons blockieren" },
  row_pings_hint:        { en: "Removes ping attributes from links so the browser doesn't send tracking beacons on click", es: "Elimina atributos ping para que el navegador no envíe balizas al hacer clic", pt: "Remove atributos ping dos links para que o navegador não envie balizas de rastreamento ao clicar", de: "Entfernt ping-Attribute von Links, damit der Browser beim Klicken keine Tracking-Beacons sendet" },
  row_amp_label:         { en: "Redirect AMP pages to canonical URL", es: "Redirigir páginas AMP a la URL canónica", pt: "Redirecionar páginas AMP para a URL canônica", de: "AMP-Seiten zur kanonischen URL weiterleiten" },
  row_amp_hint:          { en: "Replaces AMP links with the original article URL", es: "Reemplaza los enlaces AMP con la URL original del artículo", pt: "Substitui links AMP pela URL original do artigo", de: "Ersetzt AMP-Links durch die Original-Artikel-URL" },
  row_unwrap_label:      { en: "Unwrap redirect wrappers",            es: "Desenvolver redireccionadores",            pt: "Desempacotar redirecionadores",            de: "Weiterleitungs-Wrapper entpacken" },
  row_unwrap_hint:       { en: "Extracts the real destination from redirect-wrapper URLs (e.g., ?redirect=https://example.com)", es: "Extrae el destino real de URLs de redirección (ej: ?redirect=https://example.com)", pt: "Extrai o destino real de URLs com redirecionadores (ex: ?redirect=https://example.com)", de: "Extrahiert das echte Ziel aus Weiterleitungs-URLs (z.B. ?redirect=https://example.com)" },
  row_toast_duration_label: { en: "Affiliate notification duration", es: "Duración de la notificación de afiliado", pt: "Duração da notificação de afiliado", de: "Anzeigedauer der Affiliate-Benachrichtigung" },
  row_toast_duration_hint:  { en: "How long the notification stays visible before auto-dismissing", es: "Cuánto tiempo permanece visible la notificación antes de desaparecer", pt: "Quanto tempo a notificação fica visível antes de fechar automaticamente", de: "Wie lange die Benachrichtigung sichtbar bleibt, bevor sie automatisch geschlossen wird" },

  section_stats:         { en: "Statistics",                                                                        es: "Estadísticas",                                                                        pt: "Estatísticas",                                                                        de: "Statistiken" },
  stats_reset_label:     { en: "Lifetime stats",                                                                    es: "Estadísticas acumuladas",                                                                    pt: "Estatísticas acumuladas",                                                                    de: "Gesamtstatistiken" },
  stats_reset_hint:      { en: "Counters persist across sessions. Debug log resets when the browser restarts.", es: "Los contadores se conservan entre sesiones. El log de depuración se reinicia al cerrar el navegador.", pt: "Os contadores persistem entre sessões. O log de depuração é zerado quando o navegador reinicia.", de: "Zähler bleiben sitzungsübergreifend erhalten. Das Debug-Log wird beim Neustart des Browsers zurückgesetzt." },
  stats_reset_btn:       { en: "Reset stats",                                                                       es: "Reiniciar estadísticas",                                                                       pt: "Zerar estatísticas",                                                                       de: "Statistiken zurücksetzen" },
  stats_reset_confirm:   { en: "Are you sure? This will clear all counters.",                                       es: "¿Seguro? Se borrarán todos los contadores.",                                       pt: "Tem certeza? Isso vai zerar todos os contadores.",                                       de: "Bist du sicher? Das löscht alle Zähler." },
  stats_reset_done:      { en: "Stats cleared.",                                                                    es: "Estadísticas borradas.",                                                                    pt: "Estatísticas zeradas.",                                                                    de: "Statistiken gelöscht." },
  section_data:          { en: "Import / Export",                                                                   es: "Importar / Exportar",                                                                   pt: "Importar / Exportar",                                                                   de: "Importieren / Exportieren" },
  export_btn:            { en: "Export settings",                                                                   es: "Exportar ajustes",                                                                   pt: "Exportar configurações",                                                                   de: "Einstellungen exportieren" },
  import_btn:            { en: "Import settings",                                                                   es: "Importar ajustes",                                                                   pt: "Importar configurações",                                                                   de: "Einstellungen importieren" },
  export_label:          { en: "Export settings",                                                                   es: "Exportar ajustes",                                                                   pt: "Exportar configurações",                                                                   de: "Einstellungen exportieren" },
  import_label:          { en: "Import settings",                                                                   es: "Importar ajustes",                                                                   pt: "Importar configurações",                                                                   de: "Einstellungen importieren" },
  import_success:        { en: "Settings imported successfully.",                                                   es: "Ajustes importados correctamente.",                                                                   pt: "Configurações importadas com sucesso.",                                                                   de: "Einstellungen erfolgreich importiert." },
  import_error:          { en: "That doesn't look like a MUGA settings file. Make sure you're importing a .json file exported from MUGA.",  es: "Eso no parece un archivo de ajustes de MUGA. Asegúrate de que sea un .json exportado desde MUGA.",  pt: "Isso não parece um arquivo de configurações do MUGA. Certifique-se de importar um .json exportado pelo MUGA.",  de: "Das sieht nicht wie eine MUGA-Einstellungsdatei aus. Stelle sicher, dass du eine .json-Datei importierst, die von MUGA exportiert wurde." },

  // ── Remote rule updates (Options section) ────────────────────────────────────
  // REQ-I18N-1: all four locales required. EN/ES native; PT/DE mechanical.
  // FIXME (PT/DE): needs native-speaker review before ship.
  optionsRemoteRulesTitle:        { en: "Remote rule updates",                                                                                                es: "Actualización remota de reglas",                           pt: "Atualizações remotas de regras" /* FIXME: needs native speaker review */,              de: "Remote-Regelaktualisierungen" /* FIXME: needs native speaker review */ },
  optionsRemoteRulesDesc:         { en: "Optional. Download weekly updates to the list of tracking parameters. Off by default.",                             es: "Opcional. Descarga actualizaciones semanales de la lista de parámetros de rastreo. Desactivado por defecto.",  pt: "Opcional. Baixa atualizações semanais da lista de parâmetros de rastreamento. Desativado por padrão." /* FIXME: needs native speaker review */,  de: "Optional. Lädt wöchentliche Aktualisierungen der Tracking-Parameter-Liste herunter. Standardmäßig deaktiviert." /* FIXME: needs native speaker review */ },
  optionsRemoteRulesToggle:       { en: "Enable weekly updates",                                                                                             es: "Activar actualizaciones semanales",                         pt: "Ativar atualizações semanais" /* FIXME: needs native speaker review */,                de: "Wöchentliche Aktualisierungen aktivieren" /* FIXME: needs native speaker review */ },
  optionsRemoteRulesLastFetch:    { en: "Last checked:",                                                                                                     es: "Última comprobación:",                                      pt: "Última verificação:" /* FIXME: needs native speaker review */,                        de: "Zuletzt geprüft:" /* FIXME: needs native speaker review */ },
  optionsRemoteRulesParamCount:   { en: "Active remote params:",                                                                                             es: "Parámetros remotos activos:",                               pt: "Parâmetros remotos ativos:" /* FIXME: needs native speaker review */,                 de: "Aktive Remote-Parameter:" /* FIXME: needs native speaker review */ },
  optionsRemoteRulesSource:       { en: "Source",                                                                                                            es: "Fuente",                                                    pt: "Fonte" /* FIXME: needs native speaker review */,                                      de: "Quelle" /* FIXME: needs native speaker review */ },
  optionsRemoteRulesError:        { en: "Update failed. Check the console for details.",                                                                     es: "La actualización falló. Consulta la consola para más detalles.", pt: "Atualização falhou. Verifique o console para detalhes." /* FIXME: needs native speaker review */, de: "Aktualisierung fehlgeschlagen. Details in der Konsole." /* FIXME: needs native speaker review */ },
  optionsRemoteRulesNeverFetched: { en: "Never checked.",                                                                                                    es: "Nunca comprobado.",                                         pt: "Nunca verificado." /* FIXME: needs native speaker review */,                          de: "Nie geprüft." /* FIXME: needs native speaker review */ },
  optionsRemoteRulesPermDenied:   { en: "Permission was not granted. Updates remain off.",                                                                   es: "Permiso no concedido. Las actualizaciones siguen desactivadas.", pt: "Permissão não concedida. Atualizações permanecem desativadas." /* FIXME: needs native speaker review */, de: "Berechtigung nicht erteilt. Aktualisierungen bleiben deaktiviert." /* FIXME: needs native speaker review */ },
  optionsRemoteRulesErrNetwork:   { en: "Could not reach the update server. Previous list still in use.",                                                    es: "No se pudo contactar con el servidor. Se sigue usando la lista anterior.", pt: "Não foi possível contactar o servidor de atualização. A lista anterior ainda está em uso." /* FIXME: needs native speaker review */, de: "Update-Server nicht erreichbar. Vorherige Liste wird weiterhin verwendet." /* FIXME: needs native speaker review */ },
  optionsRemoteRulesErrSchema:    { en: "Update file was malformed.",                                                                                        es: "El archivo de actualización estaba mal formado.",           pt: "Arquivo de atualização malformado." /* FIXME: needs native speaker review */,            de: "Aktualisierungsdatei war fehlerhaft." /* FIXME: needs native speaker review */ },
  optionsRemoteRulesErrSignature: { en: "Update signature did not match. Update ignored.",                                                                   es: "La firma de la actualización no coincide. Actualización ignorada.", pt: "Assinatura de atualização não correspondeu. Atualização ignorada." /* FIXME: needs native speaker review */, de: "Aktualisierungssignatur stimmte nicht überein. Aktualisierung ignoriert." /* FIXME: needs native speaker review */ },
  optionsRemoteRulesErrFormat:    { en: "Update contained an invalid parameter. Ignored.",                                                                   es: "La actualización contenía un parámetro inválido. Ignorada.", pt: "Atualização continha um parâmetro inválido. Ignorada." /* FIXME: needs native speaker review */, de: "Aktualisierung enthielt einen ungültigen Parameter. Ignoriert." /* FIXME: needs native speaker review */ },
  optionsRemoteRulesErrDenylist:  { en: "Update contained a reserved parameter. Ignored.",                                                                   es: "La actualización contenía un parámetro reservado. Ignorada.", pt: "Atualização continha um parâmetro reservado. Ignorada." /* FIXME: needs native speaker review */, de: "Aktualisierung enthielt einen reservierten Parameter. Ignoriert." /* FIXME: needs native speaker review */ },
  optionsRemoteRulesErrOverCap:   { en: "Update was too large. Ignored.",                                                                                    es: "La actualización era demasiado grande. Ignorada.",           pt: "Atualização era grande demais. Ignorada." /* FIXME: needs native speaker review */,      de: "Aktualisierung war zu groß. Ignoriert." /* FIXME: needs native speaker review */ },
  optionsRemoteRulesErrVersion:   { en: "Update was older than current. Ignored.",                                                                           es: "La actualización era más antigua que la actual. Ignorada.", pt: "Atualização era mais antiga que a atual. Ignorada." /* FIXME: needs native speaker review */, de: "Aktualisierung war älter als die aktuelle. Ignoriert." /* FIXME: needs native speaker review */ },
  optionsRemoteRulesErrStale:     { en: "Update file was too old. Ignored.",                                                                                 es: "El archivo de actualización era demasiado antiguo. Ignorado.", pt: "Arquivo de atualização era muito antigo. Ignorado." /* FIXME: needs native speaker review */, de: "Aktualisierungsdatei war zu alt. Ignoriert." /* FIXME: needs native speaker review */ },
  optionsRemoteRulesErrUnknown:   { en: "Update failed. Check the console for details.",                                                                     es: "La actualización falló. Consulta la consola para más detalles.", pt: "Atualização falhou. Verifique o console para detalhes." /* FIXME: needs native speaker review */, de: "Aktualisierung fehlgeschlagen. Details in der Konsole." /* FIXME: needs native speaker review */ },
  whatsNewRemoteRules:            { en: "New: you can enable optional updates to the tracking-parameter list in Settings. Off by default.",                                     es: "Novedad: podés activar actualizaciones opcionales de la lista de parámetros en Ajustes. Desactivado por defecto.", pt: "Novo: você pode ativar atualizações opcionais da lista de parâmetros em Configurações. Desativado por padrão." /* FIXME: needs native speaker review */, de: "Neu: Optionale Aktualisierungen der Tracking-Parameter-Liste können in den Einstellungen aktiviert werden. Standardmäßig deaktiviert." /* FIXME: needs native speaker review */ },
  muga_disabled_for_domain:       { en: "MUGA is disabled on this site",                                                                                     es: "MUGA está desactivado en este sitio",                       pt: "MUGA está desativado neste site" /* FIXME: needs native speaker review */,             de: "MUGA ist auf dieser Seite deaktiviert" /* FIXME: needs native speaker review */ },

  // ── Advanced / Developer options ──────────────────────────────────────────
  section_advanced:           { en: "Advanced",                                                          es: "Avanzado",                                                          pt: "Avançado",                                                          de: "Erweitert" },
  advanced_mode_label:        { en: "Show advanced settings",                                            es: "Mostrar ajustes avanzados",                                            pt: "Mostrar configurações avançadas",                                            de: "Erweiterte Einstellungen anzeigen" },
  advanced_mode_hint:         { en: "Fine-grained control over URL cleaning, privacy, and developer tools", es: "Control detallado de limpieza de URLs, privacidad y herramientas de desarrollo", pt: "Controle detalhado sobre limpeza de URLs, privacidade e ferramentas para desenvolvedores", de: "Detaillierte Kontrolle über URL-Bereinigung, Datenschutz und Entwicklertools" },
  section_dev_tools:          { en: "Developer tools",                                                   es: "Herramientas de desarrollo",                                                   pt: "Ferramentas de desenvolvedor",                                                   de: "Entwicklertools" },
  dev_preview_notify_label:   { en: "Preview affiliate notification",                                   es: "Previsualizar notificación de afiliado",                                   pt: "Pré-visualizar notificação de afiliado",                                   de: "Affiliate-Benachrichtigung vorschauen" },
  dev_preview_notify_hint:    { en: "See how the toast looks when a third-party affiliate is detected", es: "Ve cómo aparece el aviso cuando se detecta un afiliado ajeno", pt: "Veja como o aviso aparece quando um afiliado de terceiro é detectado", de: "Sieh, wie die Benachrichtigung aussieht, wenn ein Drittanbieter-Affiliate erkannt wird" },
  dev_preview_notify_btn:     { en: "Preview",                                                          es: "Vista previa",                                                          pt: "Pré-visualizar",                                                          de: "Vorschau" },
  dev_onboarding_label:       { en: "Show welcome screen",                                              es: "Mostrar pantalla de bienvenida",                                              pt: "Mostrar tela de boas-vindas",                                              de: "Willkommensbildschirm anzeigen" },
  dev_onboarding_hint:        { en: "Re-open the first-run onboarding page",                            es: "Vuelve a abrir el onboarding inicial",                            pt: "Reabrir a página de introdução inicial",                            de: "Die Einführungsseite erneut öffnen" },
  dev_onboarding_btn:         { en: "Open",                                                             es: "Abrir",                                                             pt: "Abrir",                                                             de: "Öffnen" },
  dev_log_label:              { en: "Debug log",                                                        es: "Log de depuración",                                                        pt: "Log de depuração",                                                        de: "Debug-Log" },
  dev_log_hint:               { en: "Download a log of errors and warnings from the current session",   es: "Descarga un log de errores y avisos de la sesión actual",   pt: "Baixar um log de erros e avisos da sessão atual",   de: "Ein Log mit Fehlern und Warnungen der aktuellen Sitzung herunterladen" },
  dev_log_btn:                { en: "Export log",                                                       es: "Exportar log",                                                       pt: "Exportar log",                                                       de: "Log exportieren" },
  dev_nudge_label:            { en: "Preview rating nudge",                                              es: "Previsualizar aviso de valoraci\u00f3n",                                              pt: "Pré-visualizar aviso de avaliação",                                              de: "Bewertungshinweis vorschauen" },
  dev_nudge_hint:             { en: "Test the rating nudge. Dismiss increments the counter, Reset clears it.", es: "Prueba el aviso de valoraci\u00f3n. Descartar incrementa el contador, Reset lo limpia.", pt: "Teste o aviso de avaliação. Dispensar incrementa o contador, Zerar o limpa.", de: "Den Bewertungshinweis testen. Schließen erhöht den Zähler, Zurücksetzen löscht ihn." },
  dev_nudge_btn:              { en: "Preview",                                                           es: "Previsualizar",                                                           pt: "Pré-visualizar",                                                           de: "Vorschau" },
  dev_url_tester_label:       { en: "URL tester",                                                       es: "Probador de URLs",                                                       pt: "Testador de URLs",                                                       de: "URL-Tester" },
  dev_url_tester_hint:        { en: "Paste any URL to see what MUGA will clean",                        es: "Pega cualquier URL para ver qué limpiará MUGA",                        pt: "Cole qualquer URL para ver o que MUGA vai limpar",                        de: "Füge eine beliebige URL ein, um zu sehen, was MUGA bereinigt" },
  dev_url_tester_placeholder: { en: "https://example.com?utm_source=google&fbclid=...",                 es: "https://example.com?utm_source=google&fbclid=...",                 pt: "https://example.com?utm_source=google&fbclid=...",                 de: "https://example.com?utm_source=google&fbclid=..." },
  dev_url_test_btn:           { en: "Test",                                                             es: "Probar",                                                             pt: "Testar",                                                             de: "Testen" },
  dev_url_result_label:       { en: "Result",                                                           es: "Resultado",                                                           pt: "Resultado",                                                           de: "Ergebnis" },
  dev_url_removed:            { en: "Removed: %s",                                                       es: "Eliminados: %s",                                                       pt: "Removidos: %s",                                                       de: "Entfernt: %s" },
  dev_url_clean:              { en: "No tracking params found. URL is already clean.",                   es: "Sin parámetros de rastreo. La URL ya está limpia.",                   pt: "Nenhum parâmetro de rastreamento encontrado. A URL já está limpa.",                   de: "Keine Tracking-Parameter gefunden. URL ist bereits sauber." },
  dev_url_action:             { en: "Action: %s",                                                        es: "Acción: %s",                                                        pt: "Ação: %s",                                                        de: "Aktion: %s" },
  dev_url_report_btn:         { en: "Report a problem with this URL",                                    es: "Reportar un problema con esta URL",                                    pt: "Reportar um problema com esta URL",                                    de: "Ein Problem mit dieser URL melden" },
  report_broken_label:        { en: "Report a bug or suggest an improvement",                            es: "Reportar un error o sugerir una mejora",                            pt: "Reportar um bug ou sugerir uma melhoria",                            de: "Fehler melden oder Verbesserung vorschlagen" },
  report_dirty_url:           { en: "Report a problem with this URL",                                    es: "Reportar un problema con esta URL",                                    pt: "Reportar um problema com esta URL",                                    de: "Ein Problem mit dieser URL melden" },
  report_unclean_url:         { en: "Still see tracking? Help us improve",                              es: "¿Sigue habiendo rastreo? Ayudanos a mejorar",                              pt: "Ainda vê rastreamento? Ajude-nos a melhorar",                              de: "Noch Tracking sichtbar? Hilf uns, MUGA zu verbessern" },
  preview_preserved_creator:      { en: "Creator referral preserved",                                       es: "Referido del creador preservado",                                       pt: "Indicação do criador preservada",                                       de: "Empfehlung des Creators erhalten" },
  preview_preserved_creator_hint: { en: "MUGA never touches an affiliate tag that isn't ours, so the creator who recommended this still gets credit.", es: "MUGA nunca toca un tag de afiliado que no sea nuestro, así que quien te recomendó esto sigue recibiendo el crédito.", pt: "O MUGA nunca toca em uma tag de afiliado que não seja nossa, então quem recomendou isso continua recebendo o crédito.", de: "MUGA berührt niemals ein Affiliate-Tag, das uns nicht gehört — die Person, die dir das empfohlen hat, bekommt weiterhin die Anrechnung." },
  dev_report_broken_hint:     { en: "Opens a pre-filled GitHub issue with your browser and extension info", es: "Abre un issue de GitHub pre-rellenado con info de tu navegador y extensi\u00f3n", pt: "Abre uma issue do GitHub pré-preenchida com informações do seu navegador e extensão", de: "Öffnet ein vorab ausgefülltes GitHub-Issue mit deinen Browser- und Erweiterungsinfos" },
  dev_report_broken_btn:      { en: "Report",                                                            es: "Reportar",                                                            pt: "Reportar",                                                            de: "Melden" },

  // ── Rate button short label (used by growth bar) ──────────────────────────
  rate_muga_short: { en: "Rate MUGA", es: "Valorar MUGA", pt: "Avaliar MUGA", de: "MUGA bewerten" },

  // ── Error messages ───────────────────────────────────────────────────────
  ob_save_error:   { en: "Error — please try again", es: "Error — por favor intentalo de nuevo", pt: "Erro — por favor tente novamente", de: "Fehler — bitte versuche es erneut" },
  dev_url_error:   { en: "Error:", es: "Error:", pt: "Erro:", de: "Fehler:" },

  // ── Dev-mode nudge panel (developer-facing, intentionally minimal) ────────
  dev_nudge_dismiss_btn: { en: "Dismiss", es: "Descartar", pt: "Dispensar", de: "Schließen" },
  dev_nudge_reset_btn:   { en: "Reset counters", es: "Reiniciar contadores", pt: "Zerar contadores", de: "Zähler zurücksetzen" },
  dev_nudge_status:      { en: "Status: dismissed=%s1, shown=%s2/3, lastShown=%s3", es: "Estado: descartado=%s1, mostrado=%s2/3, lastShown=%s3", pt: "Status: descartado=%s1, mostrado=%s2/3, lastShown=%s3", de: "Status: verworfen=%s1, gezeigt=%s2/3, zuletzt=%s3" },
  dev_nudge_reset_done:  { en: "All nudge counters reset. Ready for testing.", es: "Todos los contadores reiniciados. Listo para probar.", pt: "Todos os contadores zerados. Pronto para testar.", de: "Alle Zähler zurückgesetzt. Bereit zum Testen." },
  dev_nudge_reset_fresh: { en: "Counters reset to 0. Ready for fresh testing.", es: "Contadores a 0. Listo para una prueba nueva.", pt: "Contadores a 0. Pronto para um novo teste.", de: "Zähler auf 0. Bereit für neue Tests." },

  // ── Context menu ─────────────────────────────────────────────────────────
  ctx_copy_clean_link:      { en: "Copy clean link",                       es: "Copiar enlace limpio",                       pt: "Copiar link limpo",                       de: "Bereinigten Link kopieren" },
  ctx_copy_clean_selection: { en: "Copy clean links in selection",         es: "Copiar enlaces limpios de la selección",         pt: "Copiar links limpos da seleção",         de: "Bereinigte Links in Auswahl kopieren" },

  // ── Content script toast ──────────────────────────────────────────────────
  toast_title:   { en: "MUGA found someone else's affiliate tag", es: "MUGA encontró el tag de afiliado de otro", pt: "MUGA encontrou a tag de afiliado de outra pessoa", de: "MUGA hat ein fremdes Affiliate-Tag gefunden" },
  toast_tag_msg: { en: "has an affiliate tag that isn't ours:", es: "tiene un tag de afiliado que no es nuestro:", pt: "tem uma tag de afiliado que não é nossa:", de: "hat ein Affiliate-Tag, das nicht unseres ist:" },
  toast_allow:   { en: "Keep it", es: "Mantenerlo", pt: "Manter", de: "Behalten" },
  toast_block:   { en: "Remove it", es: "Eliminarlo", pt: "Remover", de: "Entfernen" },
  toast_dismiss: { en: "Dismiss", es: "Descartar", pt: "Ignorar", de: "Schließen" },

  // ── Onboarding ──────────────────────────────────────────────────────────
  ob_page_title:            { en: "Welcome to MUGA",                                                         es: "Bienvenido a MUGA",                                                         pt: "Bem-vindo ao MUGA",                                                         de: "Willkommen bei MUGA" },
  ob_tagline:               { en: "Fair to every click.",                                                    es: "Justa con cada clic.",                                                    pt: "Justa com cada clique.",                                                    de: "Fair bei jedem Klick." },
  ob_tagline_sub:           { en: "Open source. Transparent. Built to protect your privacy.",                es: "Open source. Transparente. Hecho para proteger tu privacidad.",                pt: "Open source. Transparente. Feito para proteger sua privacidade.",                de: "Open source. Transparent. Entwickelt zum Schutz deiner Privatsphäre." },
  ob_tagline_values:        { en: "We may get things wrong, but we will always be honest about it and work to fix it. You stay in control.", es: "Puede que nos equivoquemos, pero siempre seremos honestos al respecto y trabajaremos para corregirlo. T\u00fa decides.", pt: "Podemos errar, mas sempre seremos honestos sobre isso e trabalharemos para corrigir. Você permanece no controle.", de: "Wir können Fehler machen, aber wir werden immer ehrlich darüber sein und daran arbeiten, sie zu beheben. Du behältst die Kontrolle." },
  ob_step1_title:           { en: "What MUGA does, automatically",                                          es: "Lo que MUGA hace, autom\u00e1ticamente",                                          pt: "O que MUGA faz, automaticamente",                                          de: "Was MUGA automatisch macht" },
  ob_feat1_title:           { en: "Strips 450+ tracking parameters from every URL",                         es: "Elimina 450+ par\u00e1metros de rastreo de cada URL",                         pt: "Remove 450+ parâmetros de rastreamento de cada URL",                         de: "Entfernt 450+ Tracking-Parameter aus jeder URL" },
  ob_feat1_desc:            { en: "fbclid, gclid, UTMs, and hundreds more. Removed before the page loads. No data is collected or sent anywhere.", es: "fbclid, gclid, UTMs y cientos m\u00e1s. Eliminados antes de que cargue la p\u00e1gina. No se recoge ni env\u00eda ning\u00fan dato.", pt: "fbclid, gclid, UTMs e centenas mais. Removidos antes de a página carregar. Nenhum dado é coletado ou enviado.", de: "fbclid, gclid, UTMs und Hunderte mehr. Vor dem Laden der Seite entfernt. Es werden keine Daten gesammelt oder gesendet." },
  ob_feat2_title:           { en: "Blocks hidden tracking: AMP redirects, ping beacons, URL wrappers",      es: "Bloquea rastreo oculto: redirecciones AMP, balizas ping, wrappers de URL",      pt: "Bloqueia rastreamento oculto: redirecionamentos AMP, balizas ping, wrappers de URL",      de: "Blockiert verstecktes Tracking: AMP-Weiterleitungen, Ping-Beacons, URL-Wrapper" },
  ob_feat2_desc:            { en: "Every trick advertisers use to follow your clicks is neutralized locally, inside your browser.", es: "Cada truco que los anunciantes usan para seguir tus clics se neutraliza en local, dentro de tu navegador.", pt: "Cada truque que os anunciantes usam para rastrear seus cliques é neutralizado localmente, dentro do seu navegador.", de: "Jeder Trick, den Werbetreibende nutzen, um deine Klicks zu verfolgen, wird lokal in deinem Browser neutralisiert." },
  ob_feat3_title:           { en: "Clean URLs are shorter, prettier, and safe to share",                     es: "Las URLs limpias son m\u00e1s cortas, m\u00e1s bonitas y seguras para compartir",                     pt: "URLs limpas são mais curtas, mais bonitas e seguras para compartilhar",                     de: "Saubere URLs sind kürzer, schöner und sicher zum Teilen" },
  ob_feat3_desc:            { en: "Sometimes you can barely tell where a link goes with all the junk attached. Right-click any link to copy it clean -- no tracking, no noise.", es: "A veces es imposible saber a d\u00f3nde lleva un enlace con tanta basura pegada. Clic derecho en cualquier enlace para copiarlo limpio -- sin rastreo, sin ruido.", pt: "Às vezes é difícil saber para onde um link leva com toda aquela sujeira. Clique com o botão direito em qualquer link para copiá-lo limpo -- sem rastreamento, sem ruído.", de: "Manchmal kann man kaum erkennen, wohin ein Link führt, mit all dem Datenmüll dran. Klicke mit rechts auf jeden Link, um ihn sauber zu kopieren -- kein Tracking, kein Lärm." },
  ob_step2_title:           { en: "Fair to every click",                                                    es: "Justa con cada clic",                                                    pt: "Justo com cada clique",                                                    de: "Fair bei jedem Klick" },
  ob_affiliate_desc:        { en: 'On selected stores, if a link has <strong>no affiliate tag at all</strong>, MUGA can add ours. <strong>Your price never changes.</strong> If a creator\'s tag is already there, we never touch it -- the code is open source, you can verify this.<br><br>We deliberately rejected 10+ stores whose tracking methods require routing your clicks through external servers. We would rather earn less than compromise how MUGA works.', es: 'En tiendas seleccionadas, si un enlace <strong>no tiene ning\u00fan tag de afiliado</strong>, MUGA puede a\u00f1adir el nuestro. <strong>Tu precio nunca cambia.</strong> Si el tag de un creador ya est\u00e1 ah\u00ed, nunca lo tocamos -- el c\u00f3digo es open source, puedes comprobarlo.<br><br>Hemos rechazado deliberadamente m\u00e1s de 10 tiendas cuyos m\u00e9todos de rastreo obligan a pasar tus clics por servidores externos. Preferimos ganar menos que comprometer c\u00f3mo funciona MUGA.', pt: 'Em lojas selecionadas, se um link <strong>não tiver nenhuma tag de afiliado</strong>, MUGA pode adicionar a nossa. <strong>Seu preço nunca muda.</strong> Se a tag de um criador já estiver lá, nunca a tocamos -- o código é open source, você pode verificar isso.<br><br>Rejeitamos deliberadamente mais de 10 lojas cujos métodos de rastreamento exigem passar seus cliques por servidores externos. Preferimos ganhar menos a comprometer como o MUGA funciona.', de: 'In ausgewählten Shops kann MUGA unser Affiliate-Tag hinzufügen, wenn ein Link <strong>überhaupt kein Affiliate-Tag hat</strong>. <strong>Dein Preis ändert sich nie.</strong> Wenn das Tag eines Creators bereits vorhanden ist, berühren wir es nie -- der Code ist open source, du kannst das überprüfen.<br><br>Wir haben bewusst 10+ Shops abgelehnt, deren Tracking-Methoden erfordern, dass deine Klicks über externe Server geleitet werden. Wir verdienen lieber weniger, als wie MUGA funktioniert zu gefährden.' },
  ob_tos_label:             { en: 'I have read and accept the <a href="../privacy/tos.html" target="_blank" rel="noopener noreferrer">Terms of use</a> and <a href="../privacy/privacy.html" target="_blank" rel="noopener noreferrer">Privacy policy</a><small class="tos-required-hint">Required to continue</small>', es: 'He le\u00eddo y acepto los <a href="../privacy/tos.html" target="_blank" rel="noopener noreferrer">T\u00e9rminos de uso</a> y la <a href="../privacy/privacy.html" target="_blank" rel="noopener noreferrer">Pol\u00edtica de privacidad</a><small class="tos-required-hint">Obligatorio para continuar</small>', pt: 'Li e aceito os <a href="../privacy/tos.html" target="_blank" rel="noopener noreferrer">Termos de uso</a> e a <a href="../privacy/privacy.html" target="_blank" rel="noopener noreferrer">Política de privacidade</a><small class="tos-required-hint">Obrigatório para continuar</small>', de: 'Ich habe die <a href="../privacy/tos.html" target="_blank" rel="noopener noreferrer">Nutzungsbedingungen</a> und die <a href="../privacy/privacy.html" target="_blank" rel="noopener noreferrer">Datenschutzrichtlinie</a> gelesen und akzeptiert<small class="tos-required-hint">Erforderlich zum Fortfahren</small>' },
  ob_affiliate_check_label: { en: "Allow MUGA's affiliate tag on links that have none",                     es: "Permitir el tag de afiliado de MUGA en enlaces que no tengan ninguno",                     pt: "Permitir a tag de afiliado do MUGA em links que não têm nenhuma",                     de: "MUGAs Affiliate-Tag bei Links ohne Tag erlauben" },
  ob_affiliate_check_hint:  { en: "Same price, always. If a link already has a tag, MUGA never touches it. Verify in our source code.", es: "Mismo precio, siempre. Si un enlace ya tiene un tag, MUGA nunca lo toca. Compru\u00e9balo en nuestro c\u00f3digo fuente.", pt: "Mesmo preço, sempre. Se um link já tem uma tag, MUGA nunca a toca. Verifique no nosso código-fonte.", de: "Immer derselbe Preis. Wenn ein Link bereits ein Tag hat, berührt MUGA es nie. Im Quellcode überprüfbar." },
  ob_cta_btn:               { en: "Start browsing clean",                                                   es: "Empieza a navegar limpio",                                                   pt: "Comece a navegar limpo",                                                   de: "Sauber surfen starten" },
  ob_cta_note:              { en: "Open source, GPL v3. Change any setting anytime.",                        es: "C\u00f3digo abierto, GPL v3. Cambia cualquier ajuste en cualquier momento.",                        pt: "Open source, GPL v3. Altere qualquer configuração a qualquer momento.",                        de: "Open source, GPL v3. Jede Einstellung jederzeit änderbar." },
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
