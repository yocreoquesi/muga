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
  confirm_cancel:        { en: "Cancel", es: "Cancelar", pt: "Cancelar", de: "Abbrechen" },
  confirm_ok:            { en: "OK", es: "OK", pt: "OK", de: "OK" },
  domain_stats_label:    { en: "Your top trackers", es: "Tus principales rastreadores", pt: "Seus principais rastreadores", de: "Deine häufigsten Tracker" },

  // ── Popup: Honor Creator Mode badge (#452, B14) ─────────────────────────
  // Surfaced when MUGA passes a redirect-network wrapper through unmodified
  // because the navigation referrer matched an allowlisted creator. {network}
  // is the wrapper id (e.g. "skimlinks"); {creator} is the matching entry
  // (e.g. "youtube.com/@LinusTechTips").
  popup_badge_honored_creator: {
    en: "Routed through {network} to honor {creator}",
    es: "Pasamos por {network} para honrar a {creator}",
    pt: "Passando por {network} para honrar {creator}" /* FIXME: needs native speaker review */,
    de: "Über {network} weitergeleitet, um {creator} zu ehren" /* FIXME: needs native speaker review */,
  },

  // ── Popup: Attribution Ledger / Recent activity section (#460, A2) ──────
  // Surfaces a rolling list of the last navigations with badge, optional
  // creator credit ("Supporting @creator"), optional network attribution
  // ("via {network}" — visible for Honor Creator Mode rows), and a copy
  // button per cleaned URL. Translation happens HERE (the popup glue),
  // not in the pure presenter — so the same ledger can be re-rendered
  // when the user switches language without rebuilding event history.
  ledger_section_title: {
    en: "Recent activity",
    es: "Actividad reciente",
    pt: "Atividade recente" /* FIXME: needs native speaker review */,
    de: "Letzte Aktivität" /* FIXME: needs native speaker review */,
  },
  ledger_empty: {
    en: "No recent navigations yet. Start browsing — MUGA will list cleaned URLs here.",
    es: "Aún no hay navegaciones recientes. Empezá a navegar — MUGA listará las URLs limpiadas acá.",
    pt: "Sem navegações recentes ainda. Comece a navegar — MUGA listará as URLs limpas aqui." /* FIXME: needs native speaker review */,
    de: "Noch keine letzten Navigationen. Fang an zu surfen — MUGA listet bereinigte URLs hier auf." /* FIXME: needs native speaker review */,
  },
  ledger_badge_cleaned: {
    en: "Cleaned",
    es: "Limpiada",
    pt: "Limpa" /* FIXME: needs native speaker review */,
    de: "Bereinigt" /* FIXME: needs native speaker review */,
  },
  ledger_badge_preserve_affiliate: {
    en: "Creator referral preserved",
    es: "Referido del creador preservado",
    pt: "Indicação do criador preservada" /* FIXME: needs native speaker review */,
    de: "Creator-Empfehlung beibehalten" /* FIXME: needs native speaker review */,
  },
  ledger_badge_inject_affiliate: {
    en: "Affiliate added",
    es: "Afiliado añadido",
    pt: "Afiliado adicionado" /* FIXME: needs native speaker review */,
    de: "Affiliate hinzugefügt" /* FIXME: needs native speaker review */,
  },
  ledger_badge_honor_creator: {
    en: "Honored creator routing",
    es: "Ruta de creador honrada",
    pt: "Rota de criador honrada" /* FIXME: needs native speaker review */,
    de: "Creator-Weiterleitung respektiert" /* FIXME: needs native speaker review */,
  },
  ledger_badge_blocked_opaque: {
    en: "Opaque wrapper blocked",
    es: "Envoltura opaca bloqueada",
    pt: "Wrapper opaco bloqueado" /* FIXME: needs native speaker review */,
    de: "Undurchsichtiger Wrapper blockiert" /* FIXME: needs native speaker review */,
  },
  ledger_creator_credit_template: {
    en: "Supporting {creator}",
    es: "Apoyando a {creator}",
    pt: "Apoiando {creator}" /* FIXME: needs native speaker review */,
    de: "Unterstützt {creator}" /* FIXME: needs native speaker review */,
  },
  ledger_network_template: {
    en: "via {network}",
    es: "vía {network}",
    pt: "via {network}" /* FIXME: needs native speaker review */,
    de: "über {network}" /* FIXME: needs native speaker review */,
  },
  ledger_copy_btn_label: {
    en: "Copy clean URL",
    es: "Copiar URL limpia",
    pt: "Copiar URL limpa" /* FIXME: needs native speaker review */,
    de: "Bereinigte URL kopieren" /* FIXME: needs native speaker review */,
  },
  ledger_copy_btn_copied: {
    en: "Copied!",
    es: "¡Copiado!",
    pt: "Copiado!" /* FIXME: needs native speaker review */,
    de: "Kopiert!" /* FIXME: needs native speaker review */,
  },

  // ── Popup: suspicious-params section (B15 entropy + B16 cross-site freq) ──
  suspicious_params_label:           { en: "Suspicious params",                                   es: "Parámetros sospechosos",                                  pt: "Parâmetros suspeitos",                                  de: "Verdächtige Parameter" },
  suspicious_params_entropy_group:   { en: "On this page (entropy)",                              es: "En esta página (entropía)",                               pt: "Nesta página (entropia)",                               de: "Auf dieser Seite (Entropie)" },
  suspicious_params_frequency_group: { en: "Across sites you've visited",                         es: "En varios sitios que has visitado",                       pt: "Em vários sites que você visitou",                      de: "Über besuchte Sites hinweg" },
  suspicious_params_freq_detail:     { en: "{domains} domains • {values} distinct values",        es: "{domains} dominios • {values} valores distintos",         pt: "{domains} domínios • {values} valores distintos",       de: "{domains} Domains • {values} verschiedene Werte" },

  // ── Popup: Strip locally per-row button (#536) ──────────────────────────
  // Promotes a flagged Suspicious-params row into prefs.userCustomRules so
  // the cleaner strips the param on every subsequent navigation. The "_done"
  // variant replaces the button text after a successful click; the active
  // count surfaces total active custom rules so the user has a reference
  // for what they have promoted.
  strip_locally_btn: {
    en: "Strip locally",
    es: "Eliminar localmente",
    pt: "Remover localmente" /* FIXME: needs native speaker review */,
    de: "Lokal entfernen" /* FIXME: needs native speaker review */,
  },
  strip_locally_btn_done: {
    en: "Stripped locally ✓",
    es: "Eliminado localmente ✓",
    pt: "Removido localmente ✓" /* FIXME: needs native speaker review */,
    de: "Lokal entfernt ✓" /* FIXME: needs native speaker review */,
  },
  strip_locally_active_count: {
    en: "{n} custom rules active",
    es: "{n} reglas personalizadas activas",
    pt: "{n} regras personalizadas ativas" /* FIXME: needs native speaker review */,
    de: "{n} benutzerdefinierte Regeln aktiv" /* FIXME: needs native speaker review */,
  },

  // ── Popup: Report upstream per-row button (#537) ────────────────────────
  // Opens a deep-linked GitHub issue pre-filled with ONLY the param name and
  // the count of distinct first-party domains the user has observed it on.
  // The issue title and body templates carry {paramName} and {count} place-
  // holders; the body MUST include a privacy disclaimer because the contract
  // for this slice is "MUGA never sees the value, hash, or domains".
  report_upstream_btn: {
    en: "Report upstream",
    es: "Reportar al repo",
    pt: "Reportar ao repo" /* FIXME: needs native speaker review */,
    de: "Upstream melden" /* FIXME: needs native speaker review */,
  },
  // #521: per-param dedup label shown in place of the Report-upstream
  // button after the user has reported that param from this install.
  // Cleared via the options page "Forget reported params" control.
  report_upstream_already_reported: {
    en: "Reported {date}",
    es: "Reportado el {date}",
    pt: "Reportado em {date}" /* FIXME: needs native speaker review */,
    de: "Gemeldet am {date}" /* FIXME: needs native speaker review */,
  },
  // #521: options-page button to clear the per-install dedup list
  // (chrome.storage.local.submittedParams). The user can resubmit a
  // previously-reported param after using this.
  forget_reported_params_btn: {
    en: "Forget reported params",
    es: "Olvidar parámetros reportados",
    pt: "Esquecer parâmetros reportados" /* FIXME: needs native speaker review */,
    de: "Gemeldete Parameter vergessen" /* FIXME: needs native speaker review */,
  },
  forget_reported_params_done: {
    en: "Reported list cleared",
    es: "Lista de reportes borrada",
    pt: "Lista de reportes limpa" /* FIXME: needs native speaker review */,
    de: "Liste der Meldungen gelöscht" /* FIXME: needs native speaker review */,
  },
  forget_reported_params_hint: {
    en: "Clears the local list of params you've already reported. The same param can then be reported again.",
    es: "Borra la lista local de parámetros que ya reportaste. El mismo parámetro se podrá volver a reportar.",
    pt: "Limpa a lista local de parâmetros já reportados. O mesmo parâmetro poderá ser reportado novamente." /* FIXME: needs native speaker review */,
    de: "Löscht die lokale Liste bereits gemeldeter Parameter. Derselbe Parameter kann danach erneut gemeldet werden." /* FIXME: needs native speaker review */,
  },

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

  // ── Share: fun phrases ──────────────────────────────────────────────────

  // ── Share: button prefixes ──────────────────────────────────────────────

  // ── Options ──────────────────────────────────────────────────────────────
  opts_title:      { en: "Settings", es: "Ajustes", pt: "Configurações", de: "Einstellungen" },
  opts_subtitle:   { en: "Fair to every click.", es: "Justa con cada clic.", pt: "Justa com cada clique.", de: "Fair bei jedem Klick." },
  section_affiliate_settings: { en: "Affiliate settings", es: "Configuración de afiliados", pt: "Configurações de afiliados", de: "Affiliate-Einstellungen" },
  row_inject_label: { en: "Inject our affiliate tag when a link has none", es: "Inyectar nuestro afiliado cuando no hay ninguno", pt: "Inserir nossa tag de afiliado quando o link não tem nenhuma", de: "Unser Affiliate-Tag einfügen, wenn ein Link keinen hat" },
  row_inject_hint:  { en: "Off by default. You always pay the same price. This is how you support an independent developer at zero cost to you.", es: "Desactivado por defecto. Siempre pagas el mismo precio. Así apoyas a un desarrollador independiente sin coste para ti.", pt: "Desativado por padrão. Você sempre paga o mesmo preço. É assim que você apoia um desenvolvedor independente sem nenhum custo.", de: "Standardmäßig deaktiviert. Du zahlst immer denselben Preis. So unterstützt du einen unabhängigen Entwickler ohne Mehrkosten." },
  row_notify_label: { en: "Alert me when a link has someone else's affiliate tag", es: "Avisarme cuando un enlace tenga el tag de afiliado de otro", pt: "Me avisar quando um link tiver a tag de afiliado de outra pessoa", de: "Mich benachrichtigen, wenn ein Link ein fremdes Affiliate-Tag hat" },
  row_notify_hint:  { en: "Shows a quick notification with options. Auto-dismisses in 15 seconds", es: "Muestra una notificación rápida con opciones. Desaparece en 15 segundos", pt: "Mostra uma notificação rápida com opções. Fecha automaticamente em 15 segundos", de: "Zeigt eine kurze Benachrichtigung mit Optionen. Wird nach 15 Sekunden automatisch geschlossen" },
  row_strip_affiliates_label: { en: "Remove all affiliate tags from other sources",          es: "Eliminar todos los tags de afiliado ajenos",          pt: "Remover todas as tags de afiliado de outras fontes",          de: "Alle fremden Affiliate-Tags entfernen" },
  row_strip_affiliates_hint:  { en: "Removes affiliate tags placed by others from all links. If MUGA's affiliate injection is enabled, our tag is preserved; otherwise it is removed too.", es: "Elimina los tags de afiliado de otros de todos los enlaces. Si la inyección de afiliado de MUGA está activada, nuestro tag se conserva; si no, también se elimina.", pt: "Remove tags de afiliado colocadas por outros de todos os links. Se a injeção de afiliado do MUGA estiver ativada, nossa tag é preservada; caso contrário, também é removida.", de: "Entfernt von anderen gesetzte Affiliate-Tags aus allen Links. Wenn MUGAs Affiliate-Injektion aktiviert ist, bleibt unser Tag erhalten; andernfalls wird er ebenfalls entfernt." },
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

  // ── Support MUGA section (#340) ──────────────────────────────────────────
  // Surfaces a donation path inside the extension. The strategic review
  // identified this as the natural revenue hedge for Amazon-affiliate
  // concentration; the popup link + options-page section together give
  // the user two entry points without crossing into intrusive territory.
  support_section_title: { en: "Support MUGA",                                                                                       es: "Apoyar MUGA",                                                                                            pt: "Apoiar o MUGA"                                                                                          /* FIXME: needs native speaker review */, de: "MUGA unterstützen"                                                                                       /* FIXME: needs native speaker review */ },
  support_label:         { en: "Open source. No ads. No telemetry.",                                                                 es: "Código abierto. Sin anuncios. Sin telemetría.",                                                          pt: "Código aberto. Sem anúncios. Sem telemetria."                                                           /* FIXME: needs native speaker review */, de: "Open source. Keine Werbung. Keine Telemetrie."                                                            /* FIXME: needs native speaker review */ },
  support_hint:          { en: "MUGA is free and ad-free. Affiliate revenue is small. If MUGA saves you time, consider supporting development. No tracking, no redirect — the link opens directly in a new tab.", es: "MUGA es gratis y sin publicidad. Los ingresos por afiliados son pequeños. Si MUGA te ahorra tiempo, considerá apoyar el desarrollo. Sin rastreo, sin redirecciones — el enlace abre directo en una pestaña nueva.", pt: "O MUGA é gratuito e sem anúncios. A receita de afiliados é pequena. Se o MUGA te poupa tempo, considere apoiar o desenvolvimento. Sem rastreamento, sem redirecionamento — o link abre direto em uma aba nova." /* FIXME: needs native speaker review */, de: "MUGA ist kostenlos und werbefrei. Affiliate-Einnahmen sind gering. Wenn MUGA dir Zeit spart, erwäge, die Entwicklung zu unterstützen. Kein Tracking, keine Weiterleitung — der Link öffnet direkt in einem neuen Tab." /* FIXME: needs native speaker review */ },
  support_github_sponsors: { en: "GitHub Sponsors (recurring)",                                                                      es: "GitHub Sponsors (mensual)",                                                                              pt: "GitHub Sponsors (recorrente)"                                                                            /* FIXME: needs native speaker review */, de: "GitHub Sponsors (wiederkehrend)"                                                                          /* FIXME: needs native speaker review */ },
  support_kofi:          { en: "Ko-fi (one-time)",                                                                                   es: "Ko-fi (una vez)",                                                                                        pt: "Ko-fi (única vez)"                                                                                       /* FIXME: needs native speaker review */, de: "Ko-fi (einmalig)"                                                                                         /* FIXME: needs native speaker review */ },
  support_link:          { en: "Support ♥",                                                                                          es: "Apoyar ♥",                                                                                                pt: "Apoiar ♥"                                                                                               /* FIXME: needs native speaker review */, de: "Unterstützen ♥"                                                                                          /* FIXME: needs native speaker review */ },
  consent_gate_msg: { en: "Please accept the Terms of Use and Privacy Policy before using MUGA.", es: "Acepta los Términos de uso y la Política de privacidad antes de usar MUGA.", pt: "Aceite os Termos de Uso e a Política de Privacidade antes de usar o MUGA.", de: "Bitte akzeptiere die Nutzungsbedingungen und Datenschutzrichtlinie, bevor du MUGA verwendest." },
  consent_gate_btn: { en: "Accept terms to continue",             es: "Aceptar condiciones para continuar",             pt: "Aceitar termos para continuar",             de: "Bedingungen akzeptieren und fortfahren" },
  rate_nudge_btn_short: { en: "Enjoying MUGA? Rate it",               es: "\u00bfTe gusta MUGA? Val\u00f3ralo",               pt: "Curtindo o MUGA? Avalie-o",               de: "Gefällt dir MUGA? Bewerte es" },
  bl_placeholder: { en: "mysite.com  or  amazon.es::tag::youtuber-21", es: "mysite.com  o  amazon.es::tag::youtuber-21", pt: "mysite.com  ou  amazon.com.br::tag::youtuber-21", de: "mysite.com  oder  amazon.de::tag::youtuber-21" },
  wl_placeholder: { en: "mysite.com  or  amazon.es::tag::creator-21", es: "mysite.com  o  amazon.es::tag::creador-21", pt: "mysite.com  ou  amazon.com.br::tag::criador-21", de: "mysite.com  oder  amazon.de::tag::creator-21" },
  bl_hint:  { en: "Domain only (e.g. <code>mysite.com</code>): strips all params on that site.<br>Domain::param::value (e.g. <code>amazon.es::tag::youtuber-21</code>): strips one specific affiliate tag.<br>Domain::param::* (e.g. <code>amazon.es::pid::*</code>): strips a param regardless of its value.<br><code>amazon.es::disabled</code>: MUGA does nothing on that domain.<br><br>Priority: a Whitelist match always wins over a Blacklist match for the same parameter.", es: "Solo dominio (ej: <code>mysite.com</code>): elimina todos los parámetros en esa web.<br>Dominio::param::valor (ej: <code>amazon.es::tag::youtuber-21</code>): elimina un afiliado concreto.<br>Dominio::param::* (ej: <code>amazon.es::pid::*</code>): elimina un parámetro sin importar su valor.<br><code>amazon.es::disabled</code>: MUGA no toca nada en ese dominio.<br><br>Prioridad: una coincidencia en la Whitelist siempre gana sobre la Blacklist para el mismo parámetro.", pt: "Apenas domínio (ex: <code>mysite.com</code>): remove todos os parâmetros nesse site.<br>Domínio::param::valor (ex: <code>amazon.com.br::tag::youtuber-21</code>): remove uma tag de afiliado específica.<br>Domínio::param::* (ex: <code>amazon.com.br::pid::*</code>): remove um parâmetro independentemente do valor.<br><code>amazon.com.br::disabled</code>: MUGA não toca nada nesse domínio.<br><br>Prioridade: uma correspondência na Whitelist sempre vence a Blacklist para o mesmo parâmetro.", de: "Nur Domain (z.B. <code>mysite.com</code>): entfernt alle Parameter auf dieser Website.<br>Domain::param::Wert (z.B. <code>amazon.de::tag::youtuber-21</code>): entfernt ein bestimmtes Affiliate-Tag.<br>Domain::param::* (z.B. <code>amazon.de::pid::*</code>): entfernt einen Parameter unabhängig vom Wert.<br><code>amazon.de::disabled</code>: MUGA macht nichts auf dieser Domain.<br><br>Priorität: ein Whitelist-Treffer gewinnt immer gegen die Blacklist für denselben Parameter." },
  wl_hint:  { en: "Accepts a domain (e.g. <code>mysite.com</code>): MUGA won't touch any affiliate on that site.<br>Or <code>domain::param::value</code> (e.g. <code>amazon.es::tag::creator-21</code>): protects one specific tag.<br>Or <code>domain::param::*</code> (e.g. <code>amazon.es::tag::*</code>): protects a param regardless of its value.<br><br>Priority: a Whitelist match always wins over a Blacklist match for the same parameter.", es: "Acepta un dominio (ej: <code>mysite.com</code>): MUGA no toca ningún afiliado en esa web.<br>O <code>dominio::parámetro::valor</code> (ej: <code>amazon.es::tag::creador-21</code>): protege un tag concreto.<br>O <code>dominio::parámetro::*</code> (ej: <code>amazon.es::tag::*</code>): protege un parámetro sin importar su valor.<br><br>Prioridad: una coincidencia en la Whitelist siempre gana sobre la Blacklist para el mismo parámetro.", pt: "Aceita um domínio (ex: <code>mysite.com</code>): MUGA não toca nenhum afiliado nesse site.<br>Ou <code>domínio::param::valor</code> (ex: <code>amazon.com.br::tag::criador-21</code>): protege uma tag específica.<br>Ou <code>domínio::param::*</code> (ex: <code>amazon.com.br::tag::*</code>): protege um parâmetro independentemente do valor.<br><br>Prioridade: uma correspondência na Whitelist sempre vence a Blacklist para o mesmo parâmetro.", de: "Akzeptiert eine Domain (z.B. <code>mysite.com</code>): MUGA berührt keine Affiliates auf dieser Website.<br>Oder <code>Domain::param::Wert</code> (z.B. <code>amazon.de::tag::creator-21</code>): schützt ein bestimmtes Tag.<br>Oder <code>Domain::param::*</code> (z.B. <code>amazon.de::tag::*</code>): schützt einen Parameter unabhängig vom Wert.<br><br>Priorität: ein Whitelist-Treffer gewinnt immer gegen die Blacklist für denselben Parameter." },
  add_btn:  { en: "+ Add", es: "+ Añadir", pt: "+ Adicionar", de: "+ Hinzufügen" },
  empty_list: { en: "No entries yet.", es: "Sin entradas todavía.", pt: "Nenhuma entrada ainda.", de: "Noch keine Einträge." },
  muga_disabled: { en: "MUGA is disabled", es: "MUGA está desactivado", pt: "MUGA está desativado", de: "MUGA ist deaktiviert" },
  section_tracking_categories: { en: "Tracking categories", es: "Categorías de rastreo", pt: "Categorias de rastreamento", de: "Tracking-Kategorien" },
  categories_hint: { en: "Enable or disable stripping for each param category. Disabling a category keeps those parameters in URLs.", es: "Activa o desactiva la eliminación por categoría. Desactivar una categoría conserva esos parámetros en las URLs.", pt: "Ative ou desative a remoção por categoria. Desativar uma categoria mantém esses parâmetros nas URLs.", de: "Aktiviere oder deaktiviere das Entfernen pro Parameter-Kategorie. Deaktivierte Kategorien behalten ihre Parameter in URLs." },

  section_features:  { en: "Features", es: "Funciones", pt: "Funcionalidades", de: "Funktionen" },
  section_language: { en: "Language", es: "Idioma", pt: "Idioma", de: "Sprache" },
  lang_label:  { en: "Display language", es: "Idioma de la interfaz", pt: "Idioma da interface", de: "Anzeigesprache" },
  lang_hint:   { en: "Affects the popup and settings page. Does not affect URL processing.", es: "Afecta al popup y a esta página. No afecta al procesamiento de URLs.", pt: "Afeta o popup e a página de configurações. Não afeta o processamento de URLs.", de: "Betrifft das Popup und die Einstellungsseite. Hat keinen Einfluss auf die URL-Verarbeitung." },
  // Community-maintained note (#360). Surfaces when PT or DE is selected so
  // users understand the support level they should expect for those locales.
  lang_community_note: { en: "Community-maintained — contributions welcome.", es: "Mantenido por la comunidad — se aceptan contribuciones.", pt: "Mantido pela comunidade — contribuições são bem-vindas.", de: "Von der Community gepflegt — Beiträge willkommen." },

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
  // Honor Creator Mode (#435, B12). Plumbing only — no behaviour wired yet.
  honor_creator_mode_label:   { en: "Honor Creator Mode",                                                es: "Modo Honrar al Creador",                                                pt: "Modo Honrar o Criador" /* FIXME: needs native speaker review */,                                                de: "Creator-Modus respektieren" /* FIXME: needs native speaker review */ },
  honor_creator_mode_hint:    { en: "Preserve creator referral chains on trusted redirect networks. Off by default; enable to support creators you follow.", es: "Conserva las cadenas de referidos de creadores en redes de redirección de confianza. Desactivado por defecto; activalo para apoyar a creadores que seguís.", pt: "Preserva cadeias de referência de criadores em redes de redirecionamento confiáveis. Desativado por padrão; ative para apoiar criadores que você segue." /* FIXME: needs native speaker review */, de: "Bewahrt Creator-Referral-Ketten auf vertrauenswürdigen Weiterleitungsnetzwerken. Standardmäßig deaktiviert; aktivieren, um Creator zu unterstützen, denen du folgst." /* FIXME: needs native speaker review */ },
  // Creator allowlist editor (#445, B13). Per-creator opt-in list for Honor Creator Mode.
  creator_allowlist_label:        { en: "Creators you support",                                                                                                                          es: "Creadores que apoyas",                                                                                                                                                pt: "Criadores que você apoia" /* FIXME: needs native speaker review */,                                                                                                          de: "Creator, die du unterstützt" /* FIXME: needs native speaker review */ },
  creator_allowlist_hint:         { en: "Add referrer domains where Honor Creator Mode should preserve creator referral chains (e.g. <code>youtube.com/@LinusTechTips</code>, <code>dot-css-news.com</code>). Up to 100 entries.", es: "Añade dominios de referencia donde el Modo Honrar al Creador debe conservar las cadenas de afiliados (ej: <code>youtube.com/@LinusTechTips</code>, <code>dot-css-news.com</code>). Hasta 100 entradas.", pt: "Adicione domínios de referência onde o Modo Honrar o Criador deve preservar as cadeias de referência (ex: <code>youtube.com/@LinusTechTips</code>, <code>dot-css-news.com</code>). Até 100 entradas." /* FIXME: needs native speaker review */, de: "Füge Referrer-Domains hinzu, auf denen der Creator-Modus Referral-Ketten bewahren soll (z.B. <code>youtube.com/@LinusTechTips</code>, <code>dot-css-news.com</code>). Bis zu 100 Einträge." /* FIXME: needs native speaker review */ },
  creator_allowlist_placeholder:  { en: "youtube.com/@creator  or  dot-css-news.com",                                                                                                    es: "youtube.com/@creador  o  dot-css-news.com",                                                                                                                            pt: "youtube.com/@criador  ou  dot-css-news.com" /* FIXME: needs native speaker review */,                                                                                          de: "youtube.com/@creator  oder  dot-css-news.com" /* FIXME: needs native speaker review */ },
  creator_allowlist_add_btn:      { en: "+ Add creator",                                                                                                                                 es: "+ Añadir creador",                                                                                                                                                    pt: "+ Adicionar criador" /* FIXME: needs native speaker review */,                                                                                                                de: "+ Creator hinzufügen" /* FIXME: needs native speaker review */ },
  creator_allowlist_remove_btn:   { en: "Remove",                                                                                                                                        es: "Eliminar",                                                                                                                                                            pt: "Remover" /* FIXME: needs native speaker review */,                                                                                                                            de: "Entfernen" /* FIXME: needs native speaker review */ },
  creator_allowlist_err_empty:    { en: "Enter a domain or creator handle (e.g. youtube.com/@creator).",                                                                                 es: "Introduce un dominio o handle de creador (ej: youtube.com/@creador).",                                                                                                pt: "Insira um domínio ou identificador de criador (ex: youtube.com/@criador)." /* FIXME: needs native speaker review */,                                                          de: "Gib eine Domain oder einen Creator-Handle ein (z.B. youtube.com/@creator)." /* FIXME: needs native speaker review */ },
  creator_allowlist_err_duplicate:{ en: "That creator is already on your allowlist.",                                                                                                    es: "Ese creador ya está en tu lista.",                                                                                                                                    pt: "Esse criador já está na sua lista." /* FIXME: needs native speaker review */,                                                                                                de: "Dieser Creator steht bereits auf deiner Liste." /* FIXME: needs native speaker review */ },
  // Experimental shape-based param heuristic (#544). Default OFF; toggle
  // sits in the Advanced card next to Honor Creator Mode. Warning copy is a
  // SEPARATE key so the UI can render it with a distinct visual treatment
  // (warning hint) without translators needing to embed inline HTML.
  exp_param_classes_label: {
    en: "Experimental: shape-based param stripping",
    es: "Experimental: limpieza de parámetros por forma",
    pt: "Experimental: remoção de parâmetros por forma" /* FIXME: needs native speaker review */,
    de: "Experimentell: Parameter nach Form entfernen" /* FIXME: needs native speaker review */,
  },
  exp_param_classes_hint: {
    en: "Strips params whose value shape matches a tracker pattern (long, high-entropy, base64/hex/uuid). Ships behind this flag because false positives can break some sites.",
    es: "Elimina parámetros cuyo valor tiene forma de identificador de tracker (largos, alta entropía, base64/hex/uuid). Va detrás de este flag porque los falsos positivos pueden romper algunos sitios.",
    pt: "Remove parâmetros cujo valor tem forma de identificador de tracker (longos, alta entropia, base64/hex/uuid). Atrás deste flag porque falsos positivos podem quebrar alguns sites." /* FIXME: needs native speaker review */,
    de: "Entfernt Parameter, deren Wertform einem Tracker-Muster entspricht (lang, hohe Entropie, base64/hex/uuid). Hinter diesem Flag, weil False Positives einige Seiten beschädigen können." /* FIXME: needs native speaker review */,
  },
  exp_param_classes_warn: {
    en: "May break some sites. Disable if you see issues.",
    es: "Puede romper algunos sitios. Desactivalo si ves problemas.",
    pt: "Pode quebrar alguns sites. Desative se vir problemas." /* FIXME: needs native speaker review */,
    de: "Kann einige Seiten beschädigen. Deaktiviere es bei Problemen." /* FIXME: needs native speaker review */,
  },
  creator_allowlist_err_max:      { en: "You've reached the 100-creator limit. Remove an entry to add a new one.",                                                                       es: "Has alcanzado el límite de 100 creadores. Elimina una entrada para añadir otra.",                                                                                     pt: "Você atingiu o limite de 100 criadores. Remova uma entrada para adicionar outra." /* FIXME: needs native speaker review */,                                                   de: "Du hast das Limit von 100 Creatorn erreicht. Entferne einen Eintrag, um einen neuen hinzuzufügen." /* FIXME: needs native speaker review */ },
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
  preview_count_one:              { en: "MUGA removed 1 tracker from this URL",                            es: "MUGA eliminó 1 rastreador de esta URL",                              pt: "O MUGA removeu 1 rastreador desta URL",                              de: "MUGA hat 1 Tracker aus dieser URL entfernt" },
  preview_count_other:            { en: "MUGA removed {n} trackers from this URL",                         es: "MUGA eliminó {n} rastreadores de esta URL",                          pt: "O MUGA removeu {n} rastreadores desta URL",                          de: "MUGA hat {n} Tracker aus dieser URL entfernt" },
  preview_count_clean:            { en: "URL was already clean",                                           es: "La URL ya estaba limpia",                                            pt: "A URL já estava limpa",                                              de: "URL war bereits sauber" },
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

  // ── Toolbar tooltips (#358) ──────────────────────────────────────────────
  tooltip_default:                { en: "MUGA",                                                  es: "MUGA",                                                  pt: "MUGA",                                                  de: "MUGA" },
  tooltip_cleaned:                { en: "MUGA — tracking removed",                               es: "MUGA — rastreo eliminado",                              pt: "MUGA — rastreamento removido",                          de: "MUGA — Tracking entfernt" },
  tooltip_preserved:              { en: "MUGA — creator referral preserved",                     es: "MUGA — referido del creador preservado",                pt: "MUGA — indicação do criador preservada",                de: "MUGA — Creator-Empfehlung erhalten" },
  tooltip_cleaned_and_preserved:  { en: "MUGA — tracking removed, creator referral preserved",   es: "MUGA — rastreo eliminado, referido del creador preservado", pt: "MUGA — rastreamento removido, indicação do criador preservada", de: "MUGA — Tracking entfernt, Creator-Empfehlung erhalten" },

  // ── Content script toast ──────────────────────────────────────────────────
  toast_title:   { en: "MUGA found someone else's affiliate tag", es: "MUGA encontró el tag de afiliado de otro", pt: "MUGA encontrou a tag de afiliado de outra pessoa", de: "MUGA hat ein fremdes Affiliate-Tag gefunden" },
  toast_tag_msg: { en: "has an affiliate tag that isn't ours:", es: "tiene un tag de afiliado que no es nuestro:", pt: "tem uma tag de afiliado que não é nossa:", de: "hat ein Affiliate-Tag, das nicht unseres ist:" },
  toast_allow:   { en: "Keep it", es: "Mantenerlo", pt: "Manter", de: "Behalten" },
  toast_block:   { en: "Remove it", es: "Eliminarlo", pt: "Remover", de: "Entfernen" },
  toast_dismiss: { en: "Dismiss", es: "Descartar", pt: "Ignorar", de: "Schließen" },

  // ── Onboarding ──────────────────────────────────────────────────────────
  ob_page_title:            { en: "Welcome to MUGA",                                                         es: "Bienvenido a MUGA",                                                         pt: "Bem-vindo ao MUGA",                                                         de: "Willkommen bei MUGA" },
  ob_tagline:               { en: "Fair to every click.",                                                    es: "Justa con cada clic.",                                                    pt: "Justa com cada clique.",                                                    de: "Fair bei jedem Klick." },  ob_tagline_sub:           { en: "No servers. No telemetry. URLs never leave your browser.",                es: "Sin servidores. Sin telemetría. Las URLs nunca salen de tu navegador.",         pt: "Sem servidores. Sem telemetria. As URLs nunca saem do seu navegador.",          de: "Keine Server. Keine Telemetrie. URLs verlassen nie deinen Browser." },
  ob_step1_title:           { en: "What MUGA does, automatically",                                          es: "Lo que MUGA hace, autom\u00e1ticamente",                                          pt: "O que MUGA faz, automaticamente",                                          de: "Was MUGA automatisch macht" },
  ob_feat1_title:           { en: "Strips 450+ tracking parameters from every URL",                         es: "Elimina 450+ par\u00e1metros de rastreo de cada URL",                         pt: "Remove 450+ parâmetros de rastreamento de cada URL",                         de: "Entfernt 450+ Tracking-Parameter aus jeder URL" },
  ob_feat1_desc:            { en: "fbclid, gclid, UTMs, and hundreds more. Removed before the page loads. No data is collected or sent anywhere.", es: "fbclid, gclid, UTMs y cientos m\u00e1s. Eliminados antes de que cargue la p\u00e1gina. No se recoge ni env\u00eda ning\u00fan dato.", pt: "fbclid, gclid, UTMs e centenas mais. Removidos antes de a página carregar. Nenhum dado é coletado ou enviado.", de: "fbclid, gclid, UTMs und Hunderte mehr. Vor dem Laden der Seite entfernt. Es werden keine Daten gesammelt oder gesendet." },
  ob_feat2_title:           { en: "Blocks hidden tracking: AMP redirects, ping beacons, URL wrappers",      es: "Bloquea rastreo oculto: redirecciones AMP, balizas ping, wrappers de URL",      pt: "Bloqueia rastreamento oculto: redirecionamentos AMP, balizas ping, wrappers de URL",      de: "Blockiert verstecktes Tracking: AMP-Weiterleitungen, Ping-Beacons, URL-Wrapper" },
  ob_feat2_desc:            { en: "Every trick advertisers use to follow your clicks is neutralized locally, inside your browser.", es: "Cada truco que los anunciantes usan para seguir tus clics se neutraliza en local, dentro de tu navegador.", pt: "Cada truque que os anunciantes usam para rastrear seus cliques é neutralizado localmente, dentro do seu navegador.", de: "Jeder Trick, den Werbetreibende nutzen, um deine Klicks zu verfolgen, wird lokal in deinem Browser neutralisiert." },
  ob_feat3_title:           { en: "Clean URLs are shorter, prettier, and safe to share",                     es: "Las URLs limpias son m\u00e1s cortas, m\u00e1s bonitas y seguras para compartir",                     pt: "URLs limpas são mais curtas, mais bonitas e seguras para compartilhar",                     de: "Saubere URLs sind kürzer, schöner und sicher zum Teilen" },
  ob_feat3_desc:            { en: "Sometimes you can barely tell where a link goes with all the junk attached. Right-click any link to copy it clean -- no tracking, no noise.", es: "A veces es imposible saber a d\u00f3nde lleva un enlace con tanta basura pegada. Clic derecho en cualquier enlace para copiarlo limpio -- sin rastreo, sin ruido.", pt: "Às vezes é difícil saber para onde um link leva com toda aquela sujeira. Clique com o botão direito em qualquer link para copiá-lo limpo -- sem rastreamento, sem ruído.", de: "Manchmal kann man kaum erkennen, wohin ein Link führt, mit all dem Datenmüll dran. Klicke mit rechts auf jeden Link, um ihn sauber zu kopieren -- kein Tracking, kein Lärm." },  ob_step2_title:           { en: "How MUGA stays free",                                                    es: "Cómo MUGA se mantiene gratis",                                            pt: "Como o MUGA se mantém gratuito",                                          de: "Wie MUGA kostenlos bleibt" },
  ob_affiliate_desc:        { en: 'On selected stores, if a link has <strong>no affiliate tag at all</strong>, MUGA can add ours. <strong>Your price never changes.</strong> If a creator\'s tag is already there, we never touch it -- the code is open source, you can verify this.<br><br>We deliberately rejected 10+ stores whose tracking methods require routing your clicks through external servers. We would rather earn less than compromise how MUGA works.', es: 'En tiendas seleccionadas, si un enlace <strong>no tiene ning\u00fan tag de afiliado</strong>, MUGA puede a\u00f1adir el nuestro. <strong>Tu precio nunca cambia.</strong> Si el tag de un creador ya est\u00e1 ah\u00ed, nunca lo tocamos -- el c\u00f3digo es open source, puedes comprobarlo.<br><br>Hemos rechazado deliberadamente m\u00e1s de 10 tiendas cuyos m\u00e9todos de rastreo obligan a pasar tus clics por servidores externos. Preferimos ganar menos que comprometer c\u00f3mo funciona MUGA.', pt: 'Em lojas selecionadas, se um link <strong>não tiver nenhuma tag de afiliado</strong>, MUGA pode adicionar a nossa. <strong>Seu preço nunca muda.</strong> Se a tag de um criador já estiver lá, nunca a tocamos -- o código é open source, você pode verificar isso.<br><br>Rejeitamos deliberadamente mais de 10 lojas cujos métodos de rastreamento exigem passar seus cliques por servidores externos. Preferimos ganhar menos a comprometer como o MUGA funciona.', de: 'In ausgewählten Shops kann MUGA unser Affiliate-Tag hinzufügen, wenn ein Link <strong>überhaupt kein Affiliate-Tag hat</strong>. <strong>Dein Preis ändert sich nie.</strong> Wenn das Tag eines Creators bereits vorhanden ist, berühren wir es nie -- der Code ist open source, du kannst das überprüfen.<br><br>Wir haben bewusst 10+ Shops abgelehnt, deren Tracking-Methoden erfordern, dass deine Klicks über externe Server geleitet werden. Wir verdienen lieber weniger, als wie MUGA funktioniert zu gefährden.' },
  ob_tos_label:             { en: 'I have read and accept the <a href="../privacy/tos.html" target="_blank" rel="noopener noreferrer">Terms of use</a> and <a href="../privacy/privacy.html" target="_blank" rel="noopener noreferrer">Privacy policy</a><small class="tos-required-hint">Required to continue</small>', es: 'He le\u00eddo y acepto los <a href="../privacy/tos.html" target="_blank" rel="noopener noreferrer">T\u00e9rminos de uso</a> y la <a href="../privacy/privacy.html" target="_blank" rel="noopener noreferrer">Pol\u00edtica de privacidad</a><small class="tos-required-hint">Obligatorio para continuar</small>', pt: 'Li e aceito os <a href="../privacy/tos.html" target="_blank" rel="noopener noreferrer">Termos de uso</a> e a <a href="../privacy/privacy.html" target="_blank" rel="noopener noreferrer">Política de privacidade</a><small class="tos-required-hint">Obrigatório para continuar</small>', de: 'Ich habe die <a href="../privacy/tos.html" target="_blank" rel="noopener noreferrer">Nutzungsbedingungen</a> und die <a href="../privacy/privacy.html" target="_blank" rel="noopener noreferrer">Datenschutzrichtlinie</a> gelesen und akzeptiert<small class="tos-required-hint">Erforderlich zum Fortfahren</small>' },
  ob_affiliate_check_label: { en: "Allow MUGA's affiliate tag on links that have none",                     es: "Permitir el tag de afiliado de MUGA en enlaces que no tengan ninguno",                     pt: "Permitir a tag de afiliado do MUGA em links que não têm nenhuma",                     de: "MUGAs Affiliate-Tag bei Links ohne Tag erlauben" },
  ob_affiliate_check_hint:  { en: "Same price, always. If a link already has a tag, MUGA never touches it. Verify in our source code.", es: "Mismo precio, siempre. Si un enlace ya tiene un tag, MUGA nunca lo toca. Compru\u00e9balo en nuestro c\u00f3digo fuente.", pt: "Mesmo preço, sempre. Se um link já tem uma tag, MUGA nunca a toca. Verifique no nosso código-fonte.", de: "Immer derselbe Preis. Wenn ein Link bereits ein Tag hat, berührt MUGA es nie. Im Quellcode überprüfbar." },
  ob_cta_btn:               { en: "Start browsing clean",                                                   es: "Empieza a navegar limpio",                                                   pt: "Comece a navegar limpo",                                                   de: "Sauber surfen starten" },
  ob_cta_gated_msg:         { en: "Accept the Terms of use and Privacy policy below to continue.",          es: "Acepta los Términos de uso y la Política de privacidad para continuar.",     pt: "Aceite os Termos de uso e a Política de privacidade para continuar.",       de: "Akzeptiere unten die Nutzungsbedingungen und die Datenschutzrichtlinie, um fortzufahren." },

  // ── Per-device confirmation prompts (#364) ───────────────────────────────
  ob_synced_from_other_device: { en: "This setting was enabled on another device. Confirm it for this device, or uncheck to keep it off here.", es: "Este ajuste fue activado en otro dispositivo. Confírmalo para este dispositivo o desmarca la casilla para mantenerlo desactivado aquí.", pt: "Esta configuração foi ativada em outro dispositivo. Confirme-a para este dispositivo ou desmarque para mantê-la desativada aqui.", de: "Diese Einstellung wurde auf einem anderen Gerät aktiviert. Bestätige sie für dieses Gerät oder hebe die Auswahl auf, um sie hier deaktiviert zu lassen." },
  ob_remote_rules_title:    { en: "Remote rule updates",                                                     es: "Actualizaciones remotas de reglas",                                                     pt: "Atualizações remotas de regras",                                                     de: "Remote-Regelaktualisierungen" },
  ob_remote_rules_desc:     { en: "Your other device has remote rule updates enabled. With this on, MUGA performs a weekly fetch of a signed tracking-param list from a public GitHub Pages endpoint to keep your protection fresh. No user data is sent.", es: "Tu otro dispositivo tiene activadas las actualizaciones remotas de reglas. Con esto activo, MUGA hace una descarga semanal de una lista firmada de parámetros de rastreo desde un endpoint público de GitHub Pages para mantener tu protección al día. No se envían datos del usuario.", pt: "Seu outro dispositivo tem as atualizações remotas de regras ativadas. Com isto ligado, MUGA faz um download semanal de uma lista assinada de parâmetros de rastreamento de um endpoint público do GitHub Pages para manter sua proteção atualizada. Nenhum dado do usuário é enviado.", de: "Dein anderes Gerät hat Remote-Regelaktualisierungen aktiviert. Wenn aktiviert, lädt MUGA einmal pro Woche eine signierte Tracking-Parameter-Liste von einem öffentlichen GitHub-Pages-Endpunkt, um deinen Schutz aktuell zu halten. Es werden keine Nutzerdaten gesendet." },
  ob_remote_rules_check_label: { en: "Enable remote rule updates on this device",                            es: "Activar actualizaciones remotas de reglas en este dispositivo",                            pt: "Ativar atualizações remotas de regras neste dispositivo",                            de: "Remote-Regelaktualisierungen auf diesem Gerät aktivieren" },

  // ── Re-onboard banners (#370) — first-draft copy, review before merge ────
  ob_reonboard_delta_title: { en: "A few terms have been added since you last accepted",                       es: "Se han añadido algunas cláusulas desde la última vez que aceptaste",                       pt: "Algumas cláusulas foram adicionadas desde sua última aceitação",                       de: "Seit deiner letzten Zustimmung wurden einige Klauseln ergänzt" },
  ob_reonboard_delta_desc:  { en: "Your existing acceptance still applies. Review the new clauses below; accepting unlocks the new behaviours, declining keeps MUGA running under your previously accepted terms.", es: "Tu aceptación previa sigue siendo válida. Revisá las cláusulas nuevas abajo; aceptar habilita los nuevos comportamientos, rechazar mantiene MUGA funcionando bajo los términos que ya habías aceptado.", pt: "Sua aceitação anterior continua válida. Revise as novas cláusulas abaixo; aceitar habilita os novos comportamentos, recusar mantém o MUGA funcionando sob os termos previamente aceitos.", de: "Deine bisherige Zustimmung gilt weiterhin. Überprüfe die neuen Klauseln unten; akzeptieren schaltet die neuen Verhaltensweisen frei, ablehnen lässt MUGA unter den zuvor akzeptierten Bedingungen weiterlaufen." },
  ob_reonboard_material_title: { en: "Important: terms have changed materially",                              es: "Importante: los términos cambiaron sustancialmente",                              pt: "Importante: os termos mudaram de forma substancial",                              de: "Wichtig: die Nutzungsbedingungen haben sich wesentlich geändert" },
  ob_reonboard_material_desc:  { en: "MUGA's terms have been updated in a way that affects what you previously agreed to. Continued use of the extension requires accepting the new terms. Please review the linked Terms of Use and Privacy Policy below.", es: "Los términos de MUGA se actualizaron de una manera que afecta lo que aceptaste antes. El uso continuado de la extensión requiere aceptar los nuevos términos. Revisá los Términos de uso y la Política de privacidad enlazados abajo.", pt: "Os termos do MUGA foram atualizados de forma que afeta o que você aceitou anteriormente. O uso contínuo da extensão exige aceitar os novos termos. Revise os Termos de uso e a Política de privacidade vinculados abaixo.", de: "MUGAs Nutzungsbedingungen wurden in einer Weise aktualisiert, die deine bisherige Zustimmung berührt. Die weitere Nutzung der Erweiterung erfordert die Annahme der neuen Bedingungen. Bitte überprüfe die unten verlinkten Nutzungsbedingungen und Datenschutzrichtlinien." },

  // ── Migration banner (#369) — first-draft button copy, review before merge
  migration_accept:   { en: "Enable",                                                                          es: "Activar",                                                                          pt: "Ativar",                                                                          de: "Aktivieren" },
  migration_decline:  { en: "No thanks",                                                                       es: "No, gracias",                                                                       pt: "Não, obrigado",                                                                     de: "Nein, danke" },
  migration_counter:  { en: "{n} of {total}",                                                                  es: "{n} de {total}",                                                                  pt: "{n} de {total}",                                                                    de: "{n} von {total}" },  ob_cta_note:              { en: "Change any setting anytime.",                                            es: "Cambia cualquier ajuste cuando quieras.",                                  pt: "Altere qualquer configuração quando quiser.",                              de: "Jede Einstellung jederzeit änderbar." },
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
