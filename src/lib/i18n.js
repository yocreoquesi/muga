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
 */

export const SUPPORTED_LANGS = [
  { code: "en", label: "English" },
  { code: "es", label: "Español" },
  { code: "pt", label: "Português" },
  { code: "de", label: "Deutsch" },
  { code: "fr", label: "Français" },
  { code: "it", label: "Italiano" },
  { code: "ja", label: "日本語" },
];

export const TRANSLATIONS = {
  // ── Popup ────────────────────────────────────────────────────────────────
  stat_urls:       { en: "URLs cleaned",      es: "URLs limpias",           pt: "URLs limpas",          de: "URLs bereinigt", fr: "URL nettoyées", it: "URL ripulite", ja: "クリーンアップしたURL" },
  stat_junk:       { en: "bits of noise removed", es: "bits de ruido eliminados", pt: "bits de ruído removidos", de: "Rauschen-Bits entfernt", fr: "bits de bruit supprimés", it: "bit di rumore rimossi", ja: "削除したノイズ" },
  stat_referrals:  { en: "affiliate tags detected", es: "tags de afiliado detectados", pt: "tags de afiliado detectados", de: "Affiliate-Tags erkannt", fr: "tags d'affiliation détectés", it: "tag di affiliazione rilevati", ja: "検出したアフィリエイトタグ" },
  preview_label:   { en: "This page",                     es: "Esta página",                  pt: "Esta página",                  de: "Diese Seite", fr: "Cette page", it: "Questa pagina", ja: "このページ" },
  history_label:        { en: "This session",                          es: "Esta sesión",                       pt: "Esta sessão",                       de: "Diese Sitzung", fr: "Cette session", it: "Questa sessione", ja: "このセッション" },
  history_empty:        { en: "No URLs cleaned yet. Start browsing. MUGA works automatically.", es: "Aún no se han limpiado URLs. Navega normalmente. MUGA funciona automáticamente.", pt: "Nenhuma URL limpa ainda. Comece a navegar. MUGA funciona automaticamente.", de: "Noch keine URLs bereinigt. Fang an zu surfen. MUGA arbeitet automatisch.", fr: "Aucune URL nettoyée pour l'instant. Naviguez normalement. MUGA fonctionne automatiquement.", it: "Nessuna URL ripulita ancora. Inizia a navigare. MUGA funziona automaticamente.", ja: "まだクリーンアップされたURLはありません。普通にブラウジングしてください。MUGAは自動的に動作します。" },
  toggle_enabled:  { en: "Enable MUGA",                   es: "Activar MUGA",                 pt: "Ativar MUGA",                  de: "MUGA aktivieren", fr: "Activer MUGA", it: "Attiva MUGA", ja: "MUGAを有効にする" },
  toggle_title:    { en: "Enable / disable MUGA",        es: "Activar / desactivar MUGA",    pt: "Ativar / desativar MUGA",      de: "MUGA aktivieren / deaktivieren", fr: "Activer / désactiver MUGA", it: "Attiva / disattiva MUGA", ja: "MUGAを有効/無効にする" },
  link_advanced:    { en: "Settings →", es: "Ajustes →", pt: "Configurações →", de: "Einstellungen →", fr: "Paramètres →", it: "Impostazioni →", ja: "設定 →" },
  removed_params_label: { en: "Removed:", es: "Eliminados:", pt: "Removidos:", de: "Entfernt:", fr: "Supprimés :", it: "Rimossi:", ja: "削除済み:" },
  tab_badge_label:      { en: "stripped in this tab", es: "eliminados en esta pestaña", pt: "removidos nesta aba", de: "in diesem Tab entfernt", fr: "supprimés dans cet onglet", it: "rimossi in questa scheda", ja: "このタブで削除済み" },
  history_copy_hint:    { en: "Click to copy clean URL", es: "Clic para copiar URL limpia", pt: "Clique para copiar URL limpa", de: "Klicken zum Kopieren der bereinigten URL", fr: "Cliquez pour copier l'URL nettoyée", it: "Clicca per copiare l'URL ripulita", ja: "クリックでクリーンURLをコピー" },
  history_copied:       { en: "Copied!", es: "¡Copiado!", pt: "Copiado!", de: "Kopiert!", fr: "Copié !", it: "Copiato!", ja: "コピーしました!" },
  history_copy_original: { en: "Copy with noise", es: "Copiar con ruido", pt: "Copiar com ruído", de: "Mit Rauschen kopieren", fr: "Copier avec le bruit", it: "Copia con rumore", ja: "ノイズ付きでコピー" },
  show_history:          { en: "Show history", es: "Mostrar historial", pt: "Mostrar histórico", de: "Verlauf anzeigen", fr: "Afficher l'historique", it: "Mostra cronologia", ja: "履歴を表示" },
  confirm_cancel:        { en: "Cancel", es: "Cancelar", pt: "Cancelar", de: "Abbrechen", fr: "Annuler", it: "Annulla", ja: "キャンセル" },
  confirm_ok:            { en: "OK", es: "OK", pt: "OK", de: "OK", fr: "OK", it: "OK", ja: "OK" },
  domain_stats_label:    { en: "Where the most noise comes from", es: "De dónde viene más ruido", pt: "De onde vem mais ruído", de: "Woher das meiste Rauschen kommt", fr: "D'où vient le plus de bruit", it: "Da dove viene più rumore", ja: "最もノイズが多い発生源" },

  // ── Popup: Honor Creator Mode badge (#452, B14) ─────────────────────────
  // Surfaced when MUGA passes a redirect-network wrapper through unmodified
  // because the navigation referrer matched an allowlisted creator. {network}
  // is the wrapper id (e.g. "skimlinks"); {creator} is the matching entry
  // (e.g. "youtube.com/@LinusTechTips").
  popup_badge_honored_creator: {
    en: "Routed through {network} to honor {creator}",
    es: "Pasamos por {network} para honrar a {creator}",
    pt: "Roteado por {network} para honrar {creator}",
    de: "Über {network} weitergeleitet, um {creator} zu ehren",
    fr: "Acheminé via {network} pour honorer {creator}",
    it: "Instradato tramite {network} per onorare {creator}",
    ja: "{creator}を支援するため{network}経由でルーティング",
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
    pt: "Atividade recente",
    de: "Letzte Aktivität",
    fr: "Activité récente",
    it: "Attività recente",
    ja: "最近のアクティビティ",
  },
  ledger_empty: {
    en: "No recent navigations yet. Start browsing — MUGA will list cleaned URLs here.",
    es: "Aún no hay navegaciones recientes. Empezá a navegar — MUGA listará las URLs limpiadas acá.",
    pt: "Sem navegações recentes ainda. Comece a navegar — MUGA listará as URLs limpas aqui.",
    de: "Noch keine letzten Navigationen. Fang an zu surfen — MUGA listet bereinigte URLs hier auf.",
    fr: "Aucune navigation récente. Commencez à naviguer — MUGA listera ici les URL nettoyées.",
    it: "Nessuna navigazione recente. Inizia a navigare — MUGA elencherà qui le URL ripulite.",
    ja: "最近のナビゲーションはまだありません。ブラウジングを始めてください — MUGAがクリーンアップしたURLをここに表示します。",
  },
  ledger_badge_cleaned: {
    en: "Cleaned",
    es: "Limpiada",
    pt: "Limpa",
    de: "Bereinigt",
    fr: "Nettoyée",
    it: "Ripulita",
    ja: "クリーンアップ済み",
  },
  ledger_badge_preserve_affiliate: {
    en: "Creator referral preserved",
    es: "Referido del creador preservado",
    pt: "Indicação do criador preservada",
    de: "Creator-Empfehlung beibehalten",
    fr: "Affiliation du créateur préservée",
    it: "Affiliazione del creatore preservata",
    ja: "クリエイターのリファラルを保持",
  },
  ledger_badge_inject_affiliate: {
    en: "Affiliate added",
    es: "Afiliado añadido",
    pt: "Afiliado adicionado",
    de: "Affiliate hinzugefügt",
    fr: "Affiliation ajoutée",
    it: "Affiliazione aggiunta",
    ja: "アフィリエイトを追加",
  },
  ledger_badge_honor_creator: {
    en: "Honored creator routing",
    es: "Ruta de creador honrada",
    pt: "Rota de criador honrada",
    de: "Creator-Weiterleitung respektiert",
    fr: "Routage du créateur respecté",
    it: "Routing del creatore rispettato",
    ja: "クリエイタールーティングを尊重",
  },
  ledger_badge_blocked_opaque: {
    en: "Opaque wrapper blocked",
    es: "Envoltura opaca bloqueada",
    pt: "Wrapper opaco bloqueado",
    de: "Undurchsichtiger Wrapper blockiert",
    fr: "Wrapper opaque bloqué",
    it: "Wrapper opaco bloccato",
    ja: "不透明なラッパーをブロック",
  },
  ledger_creator_credit_template: {
    en: "Supporting {creator}",
    es: "Apoyando a {creator}",
    pt: "Apoiando {creator}",
    de: "Unterstützt {creator}",
    fr: "Soutien à {creator}",
    it: "Sostegno a {creator}",
    ja: "{creator}を支援中",
  },
  ledger_network_template: {
    en: "via {network}",
    es: "vía {network}",
    pt: "via {network}",
    de: "über {network}",
    fr: "via {network}",
    it: "tramite {network}",
    ja: "{network}経由",
  },
  ledger_copy_btn_label: {
    en: "Copy clean URL",
    es: "Copiar URL limpia",
    pt: "Copiar URL limpa",
    de: "Bereinigte URL kopieren",
    fr: "Copier l'URL nettoyée",
    it: "Copia URL ripulita",
    ja: "クリーンURLをコピー",
  },
  ledger_copy_btn_copied: {
    en: "Copied!",
    es: "¡Copiado!",
    pt: "Copiado!",
    de: "Kopiert!",
    fr: "Copié !",
    it: "Copiato!",
    ja: "コピーしました!",
  },

  // ── Popup: suspicious-params section (B15 entropy + B16 cross-site freq) ──
  suspicious_params_label:           { en: "Suspicious params",                                   es: "Parámetros sospechosos",                                  pt: "Parâmetros suspeitos",                                  de: "Verdächtige Parameter", fr: "Paramètres suspects", it: "Parametri sospetti", ja: "疑わしいパラメータ" },
  suspicious_params_entropy_group:   { en: "On this page (entropy)",                              es: "En esta página (entropía)",                               pt: "Nesta página (entropia)",                               de: "Auf dieser Seite (Entropie)", fr: "Sur cette page (entropie)", it: "Su questa pagina (entropia)", ja: "このページ (エントロピー)" },
  suspicious_params_frequency_group: { en: "Across sites you've visited",                         es: "En varios sitios que has visitado",                       pt: "Em vários sites que você visitou",                      de: "Über besuchte Sites hinweg", fr: "Sur les sites que vous avez visités", it: "Sui siti che hai visitato", ja: "訪問したサイト全体" },
  suspicious_params_freq_detail:     { en: "{domains} domains • {values} distinct values",        es: "{domains} dominios • {values} valores distintos",         pt: "{domains} domínios • {values} valores distintos",       de: "{domains} Domains • {values} verschiedene Werte", fr: "{domains} domaines • {values} valeurs distinctes", it: "{domains} domini • {values} valori distinti", ja: "{domains}個のドメイン • {values}個の異なる値" },

  // ── Popup: Strip locally per-row button (#536) ──────────────────────────
  // Promotes a flagged Suspicious-params row into prefs.userCustomRules so
  // the cleaner strips the param on every subsequent navigation. The "_done"
  // variant replaces the button text after a successful click; the active
  // count surfaces total active custom rules so the user has a reference
  // for what they have promoted.
  strip_locally_btn: {
    en: "Strip locally",
    es: "Eliminar localmente",
    pt: "Remover localmente",
    de: "Lokal entfernen",
    fr: "Supprimer localement",
    it: "Rimuovi localmente",
    ja: "ローカルで削除",
  },
  strip_locally_btn_done: {
    en: "Stripped locally ✓",
    es: "Eliminado localmente ✓",
    pt: "Removido localmente ✓",
    de: "Lokal entfernt ✓",
    fr: "Supprimé localement ✓",
    it: "Rimosso localmente ✓",
    ja: "ローカルで削除済み ✓",
  },
  strip_locally_active_count: {
    en: "{n} custom rules active",
    es: "{n} reglas personalizadas activas",
    pt: "{n} regras personalizadas ativas",
    de: "{n} benutzerdefinierte Regeln aktiv",
    fr: "{n} règles personnalisées actives",
    it: "{n} regole personalizzate attive",
    ja: "{n}個のカスタムルールが有効",
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
    pt: "Reportar ao repo",
    de: "Upstream melden",
    fr: "Signaler en amont",
    it: "Segnala al repo",
    ja: "アップストリームに報告",
  },
  // #521: per-param dedup label shown in place of the Report-upstream
  // button after the user has reported that param from this install.
  // Cleared via the options page "Forget reported params" control.
  report_upstream_already_reported: {
    en: "Reported {date}",
    es: "Reportado el {date}",
    pt: "Reportado em {date}",
    de: "Gemeldet am {date}",
    fr: "Signalé le {date}",
    it: "Segnalato il {date}",
    ja: "{date}に報告済み",
  },
  // #521: options-page button to clear the per-install dedup list
  // (chrome.storage.local.submittedParams). The user can resubmit a
  // previously-reported param after using this.
  forget_reported_params_btn: {
    en: "Forget reported params",
    es: "Olvidar parámetros reportados",
    pt: "Esquecer parâmetros reportados",
    de: "Gemeldete Parameter vergessen",
    fr: "Oublier les paramètres signalés",
    it: "Dimentica i parametri segnalati",
    ja: "報告済みパラメータをリセット",
  },
  forget_reported_params_done: {
    en: "Reported list cleared",
    es: "Lista de reportes borrada",
    pt: "Lista de reportes limpa",
    de: "Liste der Meldungen gelöscht",
    fr: "Liste des signalements effacée",
    it: "Elenco delle segnalazioni cancellato",
    ja: "報告リストをクリアしました",
  },
  forget_reported_params_hint: {
    en: "Clears the local list of params you've already reported. The same param can then be reported again.",
    es: "Borra la lista local de parámetros que ya reportaste. El mismo parámetro se podrá volver a reportar.",
    pt: "Limpa a lista local de parâmetros já reportados. O mesmo parâmetro poderá ser reportado novamente.",
    de: "Löscht die lokale Liste bereits gemeldeter Parameter. Derselbe Parameter kann danach erneut gemeldet werden.",
    fr: "Efface la liste locale des paramètres que vous avez déjà signalés. Le même paramètre pourra alors être signalé à nouveau.",
    it: "Cancella l'elenco locale dei parametri che hai già segnalato. Lo stesso parametro potrà essere segnalato di nuovo.",
    ja: "すでに報告したパラメータのローカルリストをクリアします。同じパラメータを再度報告できるようになります。",
  },

  domain_stats_empty:    { en: "No domain stats yet. Keep browsing!", es: "Aún no hay estadísticas. ¡Sigue navegando!", pt: "Sem estatísticas ainda. Continue navegando!", de: "Noch keine Domain-Statistiken. Weiter surfen!", fr: "Pas encore de statistiques par domaine. Continuez à naviguer !", it: "Ancora nessuna statistica per dominio. Continua a navigare!", ja: "ドメイン統計はまだありません。ブラウジングを続けてください!" },
  domain_stats_params:   { en: "params stripped", es: "parámetros eliminados", pt: "parâmetros removidos", de: "Parameter entfernt", fr: "paramètres supprimés", it: "parametri rimossi", ja: "削除したパラメータ" },
  domain_stats_urls:     { en: "URLs cleaned", es: "URLs limpiadas", pt: "URLs limpas", de: "URLs bereinigt", fr: "URL nettoyées", it: "URL ripulite", ja: "クリーンアップしたURL" },

  // ── Popup: param breakdown (impact-dashboard) ─────────────────────────────
  // NOTE: The breakdown in popup.js reads locale labels directly from
  // TRACKING_PARAM_CATEGORIES (labelEs/labelPt/labelDe) for performance.
  // The keys below are kept in sync so contributors can update all labels in
  // one place and as a reference for future locale additions.
  param_breakdown_label:      { en: "What was removed",                  es: "Qué se eliminó",                      pt: "O que foi removido",                   de: "Was wurde entfernt", fr: "Ce qui a été supprimé", it: "Cosa è stato rimosso", ja: "削除された内容" },
  param_category_analytics:   { en: "Analytics tracking",                es: "Rastreo analítico",                   pt: "Rastreamento analítico",               de: "Analytics-Tracking", fr: "Pistage analytique", it: "Tracciamento analitico", ja: "アナリティクストラッキング" },
  param_category_social:      { en: "Social media tracking",             es: "Rastreo de redes sociales",           pt: "Rastreamento de redes sociais",        de: "Social-Media-Tracking", fr: "Pistage des réseaux sociaux", it: "Tracciamento social media", ja: "ソーシャルメディアトラッキング" },
  param_category_advertising: { en: "Ad click tracking",                 es: "Rastreo de clics publicitarios",      pt: "Rastreamento de cliques em anúncios",  de: "Werbe-Click-Tracking", fr: "Pistage des clics publicitaires", it: "Tracciamento dei clic pubblicitari", ja: "広告クリックトラッキング" },
  param_category_email:       { en: "Email campaign tracking",           es: "Rastreo de campañas de email",        pt: "Rastreamento de campanhas de email",   de: "E-Mail-Kampagnen-Tracking", fr: "Pistage des campagnes e-mail", it: "Tracciamento campagne email", ja: "メールキャンペーントラッキング" },
  param_category_affiliate:   { en: "Affiliate network tracking",        es: "Rastreo de redes de afiliados",       pt: "Rastreamento de redes de afiliados",   de: "Affiliate-Netzwerk-Tracking", fr: "Pistage des réseaux d'affiliation", it: "Tracciamento reti di affiliazione", ja: "アフィリエイトネットワークトラッキング" },
  param_category_marketplace: { en: "Marketplace tracking",              es: "Rastreo de marketplace",              pt: "Rastreamento de marketplace",          de: "Marktplatz-Tracking", fr: "Pistage des places de marché", it: "Tracciamento marketplace", ja: "マーケットプレイストラッキング" },
  param_category_ecommerce:   { en: "E-commerce tracking",               es: "Rastreo de e-commerce",               pt: "Rastreamento de e-commerce",           de: "E-Commerce-Tracking", fr: "Pistage e-commerce", it: "Tracciamento e-commerce", ja: "Eコマーストラッキング" },
  param_category_other:       { en: "Other tracking",                    es: "Otro rastreo",                        pt: "Outro rastreamento",                   de: "Sonstiges Tracking", fr: "Autre pistage", it: "Altro tracciamento", ja: "その他のトラッキング" },

  // ── Popup milestones ────────────────────────────────────────────────────
  milestone_10000: { en: "MUGA: Legendary URL cleaner", es: "MUGA: Limpiador legendario de URLs", pt: "MUGA: Limpador lendário de URLs", de: "MUGA: Legendärer URL-Reiniger", fr: "MUGA : Nettoyeur d'URL légendaire", it: "MUGA: Leggendario pulitore di URL", ja: "MUGA: 伝説のURLクリーナー" },
  milestone_5000:  { en: "MUGA: Master of Clean URLs", es: "MUGA: Maestro de URLs limpias", pt: "MUGA: Mestre das URLs limpas", de: "MUGA: Meister der sauberen URLs", fr: "MUGA : Maître des URL propres", it: "MUGA: Maestro delle URL pulite", ja: "MUGA: クリーンURLの達人" },
  milestone_1000:  { en: "MUGA: Noise Terminator", es: "MUGA: Exterminador de ruido", pt: "MUGA: Exterminador de ruído", de: "MUGA: Rauschen-Terminator", fr: "MUGA : Exterminateur de bruit", it: "MUGA: Sterminatore di rumore", ja: "MUGA: ノイズターミネーター" },
  milestone_500:   { en: "MUGA: Drain the Swamp Pro", es: "MUGA: Drenando el pantano Pro", pt: "MUGA: Drenando o pântano Pro", de: "MUGA: Drain the Swamp Pro", fr: "MUGA : Assainissement Pro", it: "MUGA: Bonifica Pro", ja: "MUGA: トラッカー一掃プロ" },
  milestone_100:   { en: "MUGA: Noise level: low", es: "MUGA: Nivel de ruido: bajo", pt: "MUGA: Nível de ruído: baixo", de: "MUGA: Rauschpegel: niedrig", fr: "MUGA : Niveau de bruit : faible", it: "MUGA: Livello di rumore: basso", ja: "MUGA: ノイズレベル: 低" },
  milestone_10:    { en: "MUGA: First steps to clean URLs", es: "MUGA: Primeros pasos hacia URLs limpias", pt: "MUGA: Primeiros passos para URLs limpas", de: "MUGA: Erste Schritte zu sauberen URLs", fr: "MUGA : Premiers pas vers des URL propres", it: "MUGA: Primi passi verso URL pulite", ja: "MUGA: クリーンURLへの第一歩" },

  // ── Share: seasonal easter eggs ─────────────────────────────────────────

  // ── Share: fun phrases ──────────────────────────────────────────────────

  // ── Share: button prefixes ──────────────────────────────────────────────

  // ── Options ──────────────────────────────────────────────────────────────
  opts_title:      { en: "Settings", es: "Ajustes", pt: "Configurações", de: "Einstellungen", fr: "Paramètres", it: "Impostazioni", ja: "設定" },
  opts_subtitle:   { en: "The denoise extension for the web.", es: "La extensión de reducción de ruido para la web.", pt: "A extensão que tira o ruído da web.", de: "Die Entrauschen-Erweiterung für das Web.", fr: "L'extension de réduction de bruit pour le web.", it: "L'estensione per togliere il rumore dal web.", ja: "ウェブのノイズを除去する拡張機能。" },
  section_affiliate_settings: { en: "Affiliate settings", es: "Configuración de afiliados", pt: "Configurações de afiliados", de: "Affiliate-Einstellungen", fr: "Paramètres d'affiliation", it: "Impostazioni di affiliazione", ja: "アフィリエイト設定" },
  row_inject_label: { en: "Inject our affiliate tag when a link has none", es: "Inyectar nuestro afiliado cuando no hay ninguno", pt: "Inserir nossa tag de afiliado quando o link não tem nenhuma", de: "Unser Affiliate-Tag einfügen, wenn ein Link keinen hat", fr: "Injecter notre tag d'affiliation lorsqu'un lien n'en a aucun", it: "Inserisci il nostro tag di affiliazione quando un link non ne ha nessuno", ja: "リンクにアフィリエイトタグがない場合は当方のタグを挿入" },
  row_inject_hint:  { en: "Off by default. You always pay the same price. This is how you support an independent developer at zero cost to you.", es: "Desactivado por defecto. Siempre pagas el mismo precio. Así apoyas a un desarrollador independiente sin coste para ti.", pt: "Desativado por padrão. Você sempre paga o mesmo preço. É assim que você apoia um desenvolvedor independente sem nenhum custo.", de: "Standardmäßig deaktiviert. Du zahlst immer denselben Preis. So unterstützt du einen unabhängigen Entwickler ohne Mehrkosten.", fr: "Désactivé par défaut. Vous payez toujours le même prix. C'est ainsi que vous soutenez un développeur indépendant sans aucun coût pour vous.", it: "Disattivato per impostazione predefinita. Paghi sempre lo stesso prezzo. È così che sostieni uno sviluppatore indipendente a costo zero per te.", ja: "デフォルトでオフ。価格は常に同じです。これにより、追加費用なしで独立開発者を支援できます。" },
  row_notify_label: { en: "Alert me when a link has someone else's affiliate tag", es: "Avisarme cuando un enlace tenga el tag de afiliado de otro", pt: "Me avisar quando um link tiver a tag de afiliado de outra pessoa", de: "Mich benachrichtigen, wenn ein Link ein fremdes Affiliate-Tag hat", fr: "M'avertir lorsqu'un lien contient le tag d'affiliation de quelqu'un d'autre", it: "Avvisami quando un link contiene il tag di affiliazione di qualcun altro", ja: "リンクに他者のアフィリエイトタグがある場合に通知" },
  row_notify_hint:  { en: "Shows a quick notification with options. Auto-dismisses in 15 seconds", es: "Muestra una notificación rápida con opciones. Desaparece en 15 segundos", pt: "Mostra uma notificação rápida com opções. Fecha automaticamente em 15 segundos", de: "Zeigt eine kurze Benachrichtigung mit Optionen. Wird nach 15 Sekunden automatisch geschlossen", fr: "Affiche une notification rapide avec des options. Disparaît automatiquement après 15 secondes", it: "Mostra una notifica rapida con opzioni. Si chiude automaticamente dopo 15 secondi", ja: "オプション付きの通知を表示。15秒後に自動的に閉じます" },
  row_strip_affiliates_label: { en: "Remove all affiliate tags from other sources",          es: "Eliminar todos los tags de afiliado ajenos",          pt: "Remover todas as tags de afiliado de outras fontes",          de: "Alle fremden Affiliate-Tags entfernen", fr: "Supprimer tous les tags d'affiliation d'autres sources", it: "Rimuovi tutti i tag di affiliazione di altre fonti", ja: "他のソースからのアフィリエイトタグをすべて削除" },
  row_strip_affiliates_hint:  { en: "Removes affiliate tags placed by others from all links. If MUGA's affiliate injection is enabled, our tag is preserved; otherwise it is removed too.", es: "Elimina los tags de afiliado de otros de todos los enlaces. Si la inyección de afiliado de MUGA está activada, nuestro tag se conserva; si no, también se elimina.", pt: "Remove tags de afiliado colocadas por outros de todos os links. Se a injeção de afiliado do MUGA estiver ativada, nossa tag é preservada; caso contrário, também é removida.", de: "Entfernt von anderen gesetzte Affiliate-Tags aus allen Links. Wenn MUGAs Affiliate-Injektion aktiviert ist, bleibt unser Tag erhalten; andernfalls wird er ebenfalls entfernt.", fr: "Supprime de tous les liens les tags d'affiliation placés par d'autres. Si l'injection d'affiliation de MUGA est activée, notre tag est préservé ; sinon, il est aussi supprimé.", it: "Rimuove da tutti i link i tag di affiliazione inseriti da altri. Se l'iniezione di affiliazione di MUGA è attiva, il nostro tag viene preservato; altrimenti viene rimosso anch'esso.", ja: "他者が設定したアフィリエイトタグをすべてのリンクから削除します。MUGAのアフィリエイト挿入が有効な場合、当方のタグは保持されます。それ以外の場合は当方のタグも削除されます。" },
  section_stores:    { en: "Affiliate stores", es: "Tiendas afiliadas", pt: "Lojas afiliadas", de: "Affiliate-Shops", fr: "Boutiques affiliées", it: "Negozi affiliati", ja: "アフィリエイトストア" },
  stores_hint:       { en: "Green dot = affiliate account active and configured. Grey = account pending registration.", es: "Punto verde = cuenta de afiliado activa. Gris = cuenta pendiente de registro.", pt: "Ponto verde = conta de afiliado ativa e configurada. Cinza = conta pendente de registro.", de: "Grüner Punkt = Affiliate-Konto aktiv und konfiguriert. Grau = Konto ausstehend.", fr: "Point vert = compte d'affiliation actif et configuré. Gris = compte en attente d'enregistrement.", it: "Punto verde = account di affiliazione attivo e configurato. Grigio = account in attesa di registrazione.", ja: "緑のドット = アフィリエイトアカウントが有効で設定済み。グレー = アカウント登録待ち。" },
  no_active_stores:  { en: "No affiliate accounts configured yet.", es: "No hay cuentas de afiliado configuradas aún.", pt: "Nenhuma conta de afiliado configurada ainda.", de: "Noch keine Affiliate-Konten konfiguriert.", fr: "Aucun compte d'affiliation configuré pour l'instant.", it: "Nessun account di affiliazione ancora configurato.", ja: "アフィリエイトアカウントはまだ設定されていません。" },
  section_custom_params:    { en: "Custom tracking params: always strip", es: "Parámetros personalizados: eliminar siempre", pt: "Parâmetros personalizados: remover sempre", de: "Benutzerdefinierte Tracking-Parameter: immer entfernen", fr: "Paramètres de pistage personnalisés : toujours supprimer", it: "Parametri di tracciamento personalizzati: rimuovi sempre", ja: "カスタムトラッキングパラメータ: 常に削除" },
  cp_placeholder:           { en: "ref_code  or  promo_id",                              es: "ref_codigo  o  promo_id",                              pt: "ref_code  ou  promo_id",                              de: "ref_code  oder  promo_id", fr: "ref_code  ou  promo_id", it: "ref_code  o  promo_id", ja: "ref_code  または  promo_id" },
  cp_hint:                  { en: "One param name per entry (e.g. <code>mc_cid</code>, <code>oly_enc_id</code>). Stripped on every site, case-insensitive.", es: "Un nombre de parámetro por entrada (ej: <code>mc_cid</code>, <code>oly_enc_id</code>). Eliminado en todas las webs, sin distinción de mayúsculas.", pt: "Um nome de parâmetro por entrada (ex: <code>mc_cid</code>, <code>oly_enc_id</code>). Removido em todos os sites, sem distinção de maiúsculas.", de: "Ein Parametername pro Eintrag (z.B. <code>mc_cid</code>, <code>oly_enc_id</code>). Auf jeder Website entfernt, Groß-/Kleinschreibung egal.", fr: "Un nom de paramètre par entrée (ex. <code>mc_cid</code>, <code>oly_enc_id</code>). Supprimé sur tous les sites, sans distinction de casse.", it: "Un nome di parametro per voce (es. <code>mc_cid</code>, <code>oly_enc_id</code>). Rimosso su ogni sito, senza distinzione tra maiuscole e minuscole.", ja: "1エントリにつき1つのパラメータ名 (例: <code>mc_cid</code>, <code>oly_enc_id</code>)。すべてのサイトで大文字小文字を区別せず削除されます。" },
  section_blacklist: { en: "Blocked domains: always strip", es: "Dominios bloqueados: eliminar siempre", pt: "Domínios bloqueados: remover sempre", de: "Gesperrte Domains: immer bereinigen", fr: "Domaines bloqués : toujours nettoyer", it: "Domini bloccati: rimuovi sempre", ja: "ブロック対象ドメイン: 常に削除" },
  section_whitelist: { en: "Protected tags & domains: never strip", es: "Tags y dominios protegidos: nunca eliminar", pt: "Tags e domínios protegidos: nunca remover", de: "Geschützte Tags & Domains: nie entfernen", fr: "Tags et domaines protégés : ne jamais supprimer", it: "Tag e domini protetti: non rimuovere mai", ja: "保護対象のタグとドメイン: 削除しない" },
  privacy_link:    { en: "Privacy policy",                       es: "Política de privacidad",                       pt: "Política de privacidade",                       de: "Datenschutzrichtlinie", fr: "Politique de confidentialité", it: "Informativa sulla privacy", ja: "プライバシーポリシー" },
  report_issue:    { en: "Report a bug or suggest a feature",    es: "Reportar un error o sugerir mejora",    pt: "Reportar um bug ou sugerir uma melhoria",    de: "Fehler melden oder Feature vorschlagen", fr: "Signaler un bug ou suggérer une fonctionnalité", it: "Segnala un bug o suggerisci una funzione", ja: "バグを報告または機能を提案" },
  rate_muga_link:  { en: "Rate MUGA",                            es: "Valorar MUGA",                            pt: "Avaliar MUGA",                            de: "MUGA bewerten", fr: "Évaluer MUGA", it: "Valuta MUGA", ja: "MUGAを評価する" },

  // ── Support MUGA section (#340) ──────────────────────────────────────────
  // Surfaces a donation path inside the extension. The strategic review
  // identified this as the natural revenue hedge for Amazon-affiliate
  // concentration; the popup link + options-page section together give
  // the user two entry points without crossing into intrusive territory.
  support_section_title: { en: "Support MUGA",                                                                                       es: "Apoyar MUGA",                                                                                            pt: "Apoiar o MUGA"                                                                                         , de: "MUGA unterstützen", fr: "Soutenir MUGA", it: "Sostieni MUGA", ja: "MUGAを支援" },
  support_label:         { en: "Open source. No ads. No telemetry.",                                                                 es: "Código abierto. Sin anuncios. Sin telemetría.",                                                          pt: "Código aberto. Sem anúncios. Sem telemetria."                                                          , de: "Open source. Keine Werbung. Keine Telemetrie.", fr: "Open source. Sans publicité. Sans télémétrie.", it: "Open source. Senza pubblicità. Senza telemetria.", ja: "オープンソース。広告なし。テレメトリなし。" },
  support_hint:          { en: "MUGA is free and ad-free. Affiliate revenue is small. If MUGA saves you time, consider supporting development. No tracking, no redirect — the link opens directly in a new tab.", es: "MUGA es gratis y sin publicidad. Los ingresos por afiliados son pequeños. Si MUGA te ahorra tiempo, considerá apoyar el desarrollo. Sin rastreo, sin redirecciones — el enlace abre directo en una pestaña nueva.", pt: "O MUGA é gratuito e sem anúncios. A receita de afiliados é pequena. Se o MUGA te poupa tempo, considere apoiar o desenvolvimento. Sem rastreamento, sem redirecionamento — o link abre direto em uma aba nova.", de: "MUGA ist kostenlos und werbefrei. Affiliate-Einnahmen sind gering. Wenn MUGA dir Zeit spart, erwäge, die Entwicklung zu unterstützen. Kein Tracking, keine Weiterleitung — der Link öffnet direkt in einem neuen Tab.", fr: "MUGA est gratuit et sans publicité. Les revenus d'affiliation sont modestes. Si MUGA vous fait gagner du temps, envisagez de soutenir son développement. Pas de pistage, pas de redirection — le lien s'ouvre directement dans un nouvel onglet.", it: "MUGA è gratuito e senza pubblicità. I ricavi da affiliazione sono limitati. Se MUGA ti fa risparmiare tempo, considera di sostenere lo sviluppo. Nessun tracciamento, nessun reindirizzamento — il link si apre direttamente in una nuova scheda.", ja: "MUGAは無料で広告がありません。アフィリエイト収益はわずかです。MUGAが時間の節約になっているなら、開発の支援をご検討ください。トラッキングなし、リダイレクトなし — リンクは新しいタブで直接開きます。" },
  support_github_sponsors: { en: "GitHub Sponsors (recurring)",                                                                      es: "GitHub Sponsors (mensual)",                                                                              pt: "GitHub Sponsors (recorrente)"                                                                           , de: "GitHub Sponsors (wiederkehrend)", fr: "GitHub Sponsors (récurrent)", it: "GitHub Sponsors (ricorrente)", ja: "GitHub Sponsors (定期)" },
  support_kofi:          { en: "Ko-fi (one-time)",                                                                                   es: "Ko-fi (una vez)",                                                                                        pt: "Ko-fi (pagamento único)", de: "Ko-fi (einmalig)", fr: "Ko-fi (unique)", it: "Ko-fi (una tantum)", ja: "Ko-fi (一回)" },
  support_link:          { en: "Support ♥",                                                                                          es: "Apoyar ♥",                                                                                                pt: "Apoiar ♥"                                                                                              , de: "Unterstützen ♥", fr: "Soutenir ♥", it: "Sostieni ♥", ja: "支援する ♥" },
  consent_gate_msg: { en: "Please accept the Terms of Use and Privacy Policy before using MUGA.", es: "Acepta los Términos de uso y la Política de privacidad antes de usar MUGA.", pt: "Aceite os Termos de Uso e a Política de Privacidade antes de usar o MUGA.", de: "Bitte akzeptiere die Nutzungsbedingungen und Datenschutzrichtlinie, bevor du MUGA verwendest.", fr: "Veuillez accepter les Conditions d'utilisation et la Politique de confidentialité avant d'utiliser MUGA.", it: "Accetta i Termini di utilizzo e l'Informativa sulla privacy prima di usare MUGA.", ja: "MUGAを使用する前に利用規約とプライバシーポリシーに同意してください。" },
  consent_gate_btn: { en: "Accept terms to continue",             es: "Aceptar condiciones para continuar",             pt: "Aceitar termos para continuar",             de: "Bedingungen akzeptieren und fortfahren", fr: "Accepter les conditions pour continuer", it: "Accetta i termini per continuare", ja: "規約に同意して続行" },
  rate_nudge_btn_short: { en: "Enjoying MUGA? Rate it",               es: "\u00bfTe gusta MUGA? Val\u00f3ralo",               pt: "Curtindo o MUGA? Avalie-o",               de: "Gefällt dir MUGA? Bewerte es", fr: "MUGA vous plaît ? Évaluez-le", it: "Ti piace MUGA? Valutalo", ja: "MUGAがお気に入りですか? 評価してください" },
  bl_placeholder: { en: "mysite.com  or  amazon.es::tag::youtuber-21", es: "mysite.com  o  amazon.es::tag::youtuber-21", pt: "mysite.com  ou  amazon.com.br::tag::youtuber-21", de: "mysite.com  oder  amazon.de::tag::youtuber-21", fr: "mysite.com  ou  amazon.fr::tag::youtuber-21", it: "mysite.com  o  amazon.it::tag::youtuber-21", ja: "mysite.com  または  amazon.co.jp::tag::youtuber-21" },
  wl_placeholder: { en: "mysite.com  or  amazon.es::tag::creator-21", es: "mysite.com  o  amazon.es::tag::creador-21", pt: "mysite.com  ou  amazon.com.br::tag::criador-21", de: "mysite.com  oder  amazon.de::tag::creator-21", fr: "mysite.com  ou  amazon.fr::tag::createur-21", it: "mysite.com  o  amazon.it::tag::creator-21", ja: "mysite.com  または  amazon.co.jp::tag::creator-21" },
  bl_hint:  { en: "Domain only (e.g. <code>mysite.com</code>): strips all params on that site.<br>Domain::param::value (e.g. <code>amazon.es::tag::youtuber-21</code>): strips one specific affiliate tag.<br>Domain::param::* (e.g. <code>amazon.es::pid::*</code>): strips a param regardless of its value.<br><code>amazon.es::disabled</code>: MUGA does nothing on that domain.<br><br>Priority: a Whitelist match always wins over a Blacklist match for the same parameter.", es: "Solo dominio (ej: <code>mysite.com</code>): elimina todos los parámetros en esa web.<br>Dominio::param::valor (ej: <code>amazon.es::tag::youtuber-21</code>): elimina un afiliado concreto.<br>Dominio::param::* (ej: <code>amazon.es::pid::*</code>): elimina un parámetro sin importar su valor.<br><code>amazon.es::disabled</code>: MUGA no toca nada en ese dominio.<br><br>Prioridad: una coincidencia en la Whitelist siempre gana sobre la Blacklist para el mismo parámetro.", pt: "Apenas domínio (ex: <code>mysite.com</code>): remove todos os parâmetros nesse site.<br>Domínio::param::valor (ex: <code>amazon.com.br::tag::youtuber-21</code>): remove uma tag de afiliado específica.<br>Domínio::param::* (ex: <code>amazon.com.br::pid::*</code>): remove um parâmetro independentemente do valor.<br><code>amazon.com.br::disabled</code>: MUGA não toca nada nesse domínio.<br><br>Prioridade: uma correspondência na Whitelist sempre vence a Blacklist para o mesmo parâmetro.", de: "Nur Domain (z.B. <code>mysite.com</code>): entfernt alle Parameter auf dieser Website.<br>Domain::param::Wert (z.B. <code>amazon.de::tag::youtuber-21</code>): entfernt ein bestimmtes Affiliate-Tag.<br>Domain::param::* (z.B. <code>amazon.de::pid::*</code>): entfernt einen Parameter unabhängig vom Wert.<br><code>amazon.de::disabled</code>: MUGA macht nichts auf dieser Domain.<br><br>Priorität: ein Whitelist-Treffer gewinnt immer gegen die Blacklist für denselben Parameter.", fr: "Domaine seul (ex. <code>mysite.com</code>) : supprime tous les paramètres sur ce site.<br>Domaine::param::valeur (ex. <code>amazon.fr::tag::youtuber-21</code>) : supprime un tag d'affiliation précis.<br>Domaine::param::* (ex. <code>amazon.fr::pid::*</code>) : supprime un paramètre quelle que soit sa valeur.<br><code>amazon.fr::disabled</code> : MUGA ne fait rien sur ce domaine.<br><br>Priorité : une correspondance dans la Whitelist l'emporte toujours sur la Blacklist pour le même paramètre.", it: "Solo dominio (es. <code>mysite.com</code>): rimuove tutti i parametri su quel sito.<br>Dominio::param::valore (es. <code>amazon.it::tag::youtuber-21</code>): rimuove un tag di affiliazione specifico.<br>Dominio::param::* (es. <code>amazon.it::pid::*</code>): rimuove un parametro indipendentemente dal valore.<br><code>amazon.it::disabled</code>: MUGA non tocca nulla su quel dominio.<br><br>Priorità: una corrispondenza nella Whitelist vince sempre sulla Blacklist per lo stesso parametro.", ja: "ドメインのみ (例: <code>mysite.com</code>): そのサイトのすべてのパラメータを削除します。<br>ドメイン::param::値 (例: <code>amazon.co.jp::tag::youtuber-21</code>): 特定のアフィリエイトタグを削除します。<br>ドメイン::param::* (例: <code>amazon.co.jp::pid::*</code>): 値に関係なくパラメータを削除します。<br><code>amazon.co.jp::disabled</code>: MUGAはそのドメインで何もしません。<br><br>優先順位: 同じパラメータについてはWhitelistの一致が常にBlacklistより優先されます。" },
  wl_hint:  { en: "Accepts a domain (e.g. <code>mysite.com</code>): MUGA won't touch any affiliate on that site.<br>Or <code>domain::param::value</code> (e.g. <code>amazon.es::tag::creator-21</code>): protects one specific tag.<br>Or <code>domain::param::*</code> (e.g. <code>amazon.es::tag::*</code>): protects a param regardless of its value.<br><br>Priority: a Whitelist match always wins over a Blacklist match for the same parameter.", es: "Acepta un dominio (ej: <code>mysite.com</code>): MUGA no toca ningún afiliado en esa web.<br>O <code>dominio::parámetro::valor</code> (ej: <code>amazon.es::tag::creador-21</code>): protege un tag concreto.<br>O <code>dominio::parámetro::*</code> (ej: <code>amazon.es::tag::*</code>): protege un parámetro sin importar su valor.<br><br>Prioridad: una coincidencia en la Whitelist siempre gana sobre la Blacklist para el mismo parámetro.", pt: "Aceita um domínio (ex: <code>mysite.com</code>): MUGA não toca nenhum afiliado nesse site.<br>Ou <code>domínio::param::valor</code> (ex: <code>amazon.com.br::tag::criador-21</code>): protege uma tag específica.<br>Ou <code>domínio::param::*</code> (ex: <code>amazon.com.br::tag::*</code>): protege um parâmetro independentemente do valor.<br><br>Prioridade: uma correspondência na Whitelist sempre vence a Blacklist para o mesmo parâmetro.", de: "Akzeptiert eine Domain (z.B. <code>mysite.com</code>): MUGA berührt keine Affiliates auf dieser Website.<br>Oder <code>Domain::param::Wert</code> (z.B. <code>amazon.de::tag::creator-21</code>): schützt ein bestimmtes Tag.<br>Oder <code>Domain::param::*</code> (z.B. <code>amazon.de::tag::*</code>): schützt einen Parameter unabhängig vom Wert.<br><br>Priorität: ein Whitelist-Treffer gewinnt immer gegen die Blacklist für denselben Parameter.", fr: "Accepte un domaine (ex. <code>mysite.com</code>) : MUGA ne touchera à aucune affiliation sur ce site.<br>Ou <code>domaine::param::valeur</code> (ex. <code>amazon.fr::tag::createur-21</code>) : protège un tag précis.<br>Ou <code>domaine::param::*</code> (ex. <code>amazon.fr::tag::*</code>) : protège un paramètre quelle que soit sa valeur.<br><br>Priorité : une correspondance dans la Whitelist l'emporte toujours sur la Blacklist pour le même paramètre.", it: "Accetta un dominio (es. <code>mysite.com</code>): MUGA non toccherà alcuna affiliazione su quel sito.<br>Oppure <code>dominio::param::valore</code> (es. <code>amazon.it::tag::creator-21</code>): protegge un tag specifico.<br>Oppure <code>dominio::param::*</code> (es. <code>amazon.it::tag::*</code>): protegge un parametro indipendentemente dal valore.<br><br>Priorità: una corrispondenza nella Whitelist vince sempre sulla Blacklist per lo stesso parametro.", ja: "ドメインを受け付けます (例: <code>mysite.com</code>): MUGAはそのサイトのアフィリエイトに一切触れません。<br>または <code>ドメイン::param::値</code> (例: <code>amazon.co.jp::tag::creator-21</code>): 特定のタグを保護します。<br>または <code>ドメイン::param::*</code> (例: <code>amazon.co.jp::tag::*</code>): 値に関係なくパラメータを保護します。<br><br>優先順位: 同じパラメータについてはWhitelistの一致が常にBlacklistより優先されます。" },
  add_btn:  { en: "+ Add", es: "+ Añadir", pt: "+ Adicionar", de: "+ Hinzufügen", fr: "+ Ajouter", it: "+ Aggiungi", ja: "+ 追加" },
  empty_list: { en: "No entries yet.", es: "Sin entradas todavía.", pt: "Nenhuma entrada ainda.", de: "Noch keine Einträge.", fr: "Aucune entrée pour l'instant.", it: "Nessuna voce ancora.", ja: "エントリはまだありません。" },
  muga_disabled: { en: "MUGA is disabled", es: "MUGA está desactivado", pt: "MUGA está desativado", de: "MUGA ist deaktiviert", fr: "MUGA est désactivé", it: "MUGA è disattivato", ja: "MUGAは無効です" },
  section_tracking_categories: { en: "Tracking categories", es: "Categorías de rastreo", pt: "Categorias de rastreamento", de: "Tracking-Kategorien", fr: "Catégories de pistage", it: "Categorie di tracciamento", ja: "トラッキングカテゴリ" },
  categories_hint: { en: "Enable or disable stripping for each param category. Disabling a category keeps those parameters in URLs.", es: "Activa o desactiva la eliminación por categoría. Desactivar una categoría conserva esos parámetros en las URLs.", pt: "Ative ou desative a remoção por categoria. Desativar uma categoria mantém esses parâmetros nas URLs.", de: "Aktiviere oder deaktiviere das Entfernen pro Parameter-Kategorie. Deaktivierte Kategorien behalten ihre Parameter in URLs.", fr: "Activez ou désactivez la suppression par catégorie de paramètres. Désactiver une catégorie conserve ces paramètres dans les URL.", it: "Attiva o disattiva la rimozione per ogni categoria di parametri. Disattivare una categoria mantiene quei parametri negli URL.", ja: "各パラメータカテゴリの削除を有効/無効にします。カテゴリを無効にすると、そのパラメータはURLに残ります。" },

  section_features:  { en: "Features", es: "Funciones", pt: "Funcionalidades", de: "Funktionen", fr: "Fonctionnalités", it: "Funzionalità", ja: "機能" },
  section_language: { en: "Language", es: "Idioma", pt: "Idioma", de: "Sprache", fr: "Langue", it: "Lingua", ja: "言語" },
  lang_label:  { en: "Display language", es: "Idioma de la interfaz", pt: "Idioma da interface", de: "Anzeigesprache", fr: "Langue d'affichage", it: "Lingua dell'interfaccia", ja: "表示言語" },
  lang_hint:   { en: "Affects the popup and settings page. Does not affect URL processing.", es: "Afecta al popup y a esta página. No afecta al procesamiento de URLs.", pt: "Afeta o popup e a página de configurações. Não afeta o processamento de URLs.", de: "Betrifft das Popup und die Einstellungsseite. Hat keinen Einfluss auf die URL-Verarbeitung.", fr: "Affecte le popup et la page de paramètres. N'affecte pas le traitement des URL.", it: "Influisce sul popup e sulla pagina delle impostazioni. Non influisce sull'elaborazione degli URL.", ja: "ポップアップと設定ページに影響します。URLの処理には影響しません。" },
  // Community-maintained note (#360). Surfaces when PT or DE is selected so
  // users understand the support level they should expect for those locales.
  lang_community_note: { en: "Community-maintained — contributions welcome.", es: "Mantenido por la comunidad — se aceptan contribuciones.", pt: "Mantido pela comunidade — contribuições são bem-vindas.", de: "Von der Community gepflegt — Beiträge willkommen.", fr: "Assisté par IA — contributions bienvenues.", it: "Assistito da IA — contributi benvenuti.", ja: "AI支援による翻訳 — 貢献を歓迎します。" },

  row_dnr_label:         { en: "Denoise links before navigation", es: "Reducir el ruido de los enlaces antes de navegar", pt: "Tirar o ruído dos links antes de navegar", de: "Links vor der Navigation entrauschen", fr: "Réduire le bruit des liens avant la navigation", it: "Togliere il rumore dai link prima della navigazione", ja: "ナビゲーション前にリンクのノイズを除去" },
  row_dnr_hint:          { en: "Cleans URLs as you type in the address bar, from bookmarks, and links from other apps. Before the page loads.", es: "Limpia URLs mientras escribes en la barra de direcciones, desde marcadores y enlaces de otras apps. Antes de que cargue la página.", pt: "Limpa URLs enquanto você digita na barra de endereços, de favoritos e links de outros apps. Antes de a página carregar.", de: "Bereinigt URLs während du in der Adressleiste tippst, aus Lesezeichen und Links aus anderen Apps. Vor dem Laden der Seite.", fr: "Nettoie les URL pendant que vous tapez dans la barre d'adresse, depuis les favoris et les liens d'autres applications. Avant le chargement de la page.", it: "Ripulisce gli URL mentre digiti nella barra degli indirizzi, dai segnalibri e dai link di altre app. Prima del caricamento della pagina.", ja: "アドレスバーへの入力、ブックマーク、他のアプリからのリンクのURLをクリーンアップします。ページが読み込まれる前に。" },
  row_context_menu_label: { en: "Right-click → Copy clean link or selection", es: "Menú contextual → Copiar enlace o selección limpia", pt: "Botão direito → Copiar link limpo ou seleção", de: "Rechtsklick → Bereinigten Link oder Auswahl kopieren", fr: "Clic droit → Copier le lien ou la sélection nettoyée", it: "Clic destro → Copia link o selezione ripulita", ja: "右クリック → クリーンなリンクまたは選択範囲をコピー" },
  row_context_menu_hint:  { en: "Works on a single link, a text selection with multiple URLs, or plain-text URLs. Alt+Shift+C copies the current tab's clean URL. Ctrl+C also auto-cleans URLs in your selection.", es: "Funciona con un enlace, una selección con varias URLs, o URLs en texto plano. Alt+Shift+C copia la URL limpia de la pestaña. Ctrl+C también limpia automáticamente las URLs en tu selección.", pt: "Funciona em um único link, uma seleção de texto com várias URLs, ou URLs em texto puro. Alt+Shift+C copia a URL limpa da aba atual. Ctrl+C também limpa automaticamente URLs na sua seleção.", de: "Funktioniert bei einem einzelnen Link, einer Textauswahl mit mehreren URLs oder reinen Text-URLs. Alt+Shift+C kopiert die bereinigte URL des aktuellen Tabs. Strg+C bereinigt auch URLs in deiner Auswahl automatisch.", fr: "Fonctionne sur un lien unique, une sélection de texte avec plusieurs URL ou des URL en texte brut. Alt+Maj+C copie l'URL nettoyée de l'onglet actuel. Ctrl+C nettoie aussi automatiquement les URL de votre sélection.", it: "Funziona su un singolo link, una selezione di testo con più URL o URL in testo semplice. Alt+Maiusc+C copia l'URL ripulita della scheda corrente. Ctrl+C ripulisce anche automaticamente gli URL nella selezione.", ja: "1つのリンク、複数のURLを含むテキスト選択、またはプレーンテキストのURLで動作します。Alt+Shift+Cで現在のタブのクリーンURLをコピーします。Ctrl+Cでも選択範囲のURLが自動的にクリーンアップされます。" },
  row_pings_label:       { en: "Block <a ping> beacons",    es: "Bloquear balizas <a ping>",    pt: "Bloquear balizas <a ping>",    de: "<a ping>-Beacons blockieren", fr: "Bloquer les balises <a ping>", it: "Blocca i beacon <a ping>", ja: "<a ping>ビーコンをブロック" },
  row_pings_hint:        { en: "Removes ping attributes from links so the browser doesn't send tracking beacons on click", es: "Elimina atributos ping para que el navegador no envíe balizas al hacer clic", pt: "Remove atributos ping dos links para que o navegador não envie balizas de rastreamento ao clicar", de: "Entfernt ping-Attribute von Links, damit der Browser beim Klicken keine Tracking-Beacons sendet", fr: "Supprime les attributs ping des liens pour que le navigateur n'envoie pas de balises de pistage au clic", it: "Rimuove gli attributi ping dai link in modo che il browser non invii beacon di tracciamento al clic", ja: "リンクからping属性を削除し、ブラウザがクリック時にトラッキングビーコンを送信しないようにします" },
  row_amp_label:         { en: "Skip AMP detours", es: "Saltar los desvíos AMP", pt: "Ignorar os desvios AMP", de: "AMP-Umwege überspringen", fr: "Ignorer les détours AMP", it: "Salta le deviazioni AMP", ja: "AMP寄り道をスキップ" },
  row_amp_hint:          { en: "Replaces AMP links with the original article URL", es: "Reemplaza los enlaces AMP con la URL original del artículo", pt: "Substitui links AMP pela URL original do artigo", de: "Ersetzt AMP-Links durch die Original-Artikel-URL", fr: "Remplace les liens AMP par l'URL d'origine de l'article", it: "Sostituisce i link AMP con l'URL originale dell'articolo", ja: "AMPリンクを元の記事URLに置き換えます" },
  row_unwrap_label:      { en: "Unwrap redirect wrappers",            es: "Desenvolver redireccionadores",            pt: "Desempacotar redirecionadores",            de: "Weiterleitungs-Wrapper entpacken", fr: "Déballer les wrappers de redirection", it: "Sballa i wrapper di reindirizzamento", ja: "リダイレクトラッパーを展開" },
  row_unwrap_hint:       { en: "Extracts the real destination from redirect-wrapper URLs (e.g., ?redirect=https://example.com)", es: "Extrae el destino real de URLs de redirección (ej: ?redirect=https://example.com)", pt: "Extrai o destino real de URLs com redirecionadores (ex: ?redirect=https://example.com)", de: "Extrahiert das echte Ziel aus Weiterleitungs-URLs (z.B. ?redirect=https://example.com)", fr: "Extrait la destination réelle des URL avec wrapper de redirection (ex. ?redirect=https://example.com)", it: "Estrae la destinazione reale dagli URL con wrapper di reindirizzamento (es. ?redirect=https://example.com)", ja: "リダイレクトラッパーURLから実際の宛先を抽出します (例: ?redirect=https://example.com)" },
  row_toast_duration_label: { en: "Toast duration when a creator tag is detected", es: "Duración del aviso cuando se detecta un tag de creador", pt: "Duração do aviso quando um tag de criador é detectado", de: "Toast-Dauer wenn ein Creator-Tag erkannt wird", fr: "Durée de la notification quand un tag de créateur est détecté", it: "Durata della notifica quando viene rilevato un tag creator", ja: "クリエイタータグ検出時のトースト表示時間" },
  row_toast_duration_hint:  { en: "How long the notification stays visible before auto-dismissing", es: "Cuánto tiempo permanece visible la notificación antes de desaparecer", pt: "Quanto tempo a notificação fica visível antes de fechar automaticamente", de: "Wie lange die Benachrichtigung sichtbar bleibt, bevor sie automatisch geschlossen wird", fr: "Durée pendant laquelle la notification reste visible avant de disparaître automatiquement", it: "Per quanto tempo la notifica resta visibile prima della chiusura automatica", ja: "通知が自動的に閉じるまでの表示時間" },

  section_stats:         { en: "Statistics",                                                                        es: "Estadísticas",                                                                        pt: "Estatísticas",                                                                        de: "Statistiken", fr: "Statistiques", it: "Statistiche", ja: "統計" },
  stats_reset_label:     { en: "Lifetime stats",                                                                    es: "Estadísticas acumuladas",                                                                    pt: "Estatísticas acumuladas",                                                                    de: "Gesamtstatistiken", fr: "Statistiques cumulées", it: "Statistiche totali", ja: "累計統計" },
  stats_reset_hint:      { en: "Counters persist across sessions. Debug log resets when the browser restarts.", es: "Los contadores se conservan entre sesiones. El log de depuración se reinicia al cerrar el navegador.", pt: "Os contadores persistem entre sessões. O log de depuração é zerado quando o navegador reinicia.", de: "Zähler bleiben sitzungsübergreifend erhalten. Das Debug-Log wird beim Neustart des Browsers zurückgesetzt.", fr: "Les compteurs sont conservés entre les sessions. Le journal de débogage est réinitialisé au redémarrage du navigateur.", it: "I contatori vengono mantenuti tra le sessioni. Il log di debug viene azzerato al riavvio del browser.", ja: "カウンターはセッション間で保持されます。デバッグログはブラウザの再起動時にリセットされます。" },
  stats_reset_btn:       { en: "Reset stats",                                                                       es: "Reiniciar estadísticas",                                                                       pt: "Zerar estatísticas",                                                                       de: "Statistiken zurücksetzen", fr: "Réinitialiser les statistiques", it: "Azzera statistiche", ja: "統計をリセット" },
  stats_reset_confirm:   { en: "Are you sure? This will clear all counters.",                                       es: "¿Seguro? Se borrarán todos los contadores.",                                       pt: "Tem certeza? Isso vai zerar todos os contadores.",                                       de: "Bist du sicher? Das löscht alle Zähler.", fr: "Êtes-vous sûr ? Tous les compteurs seront effacés.", it: "Sei sicuro? Tutti i contatori verranno azzerati.", ja: "本当によろしいですか? すべてのカウンターがクリアされます。" },
  stats_reset_done:      { en: "Stats cleared.",                                                                    es: "Estadísticas borradas.",                                                                    pt: "Estatísticas zeradas.",                                                                    de: "Statistiken gelöscht.", fr: "Statistiques effacées.", it: "Statistiche azzerate.", ja: "統計をクリアしました。" },
  section_data:          { en: "Import / Export",                                                                   es: "Importar / Exportar",                                                                   pt: "Importar / Exportar",                                                                   de: "Importieren / Exportieren", fr: "Importer / Exporter", it: "Importa / Esporta", ja: "インポート / エクスポート" },
  export_btn:            { en: "Export settings",                                                                   es: "Exportar ajustes",                                                                   pt: "Exportar configurações",                                                                   de: "Einstellungen exportieren", fr: "Exporter les paramètres", it: "Esporta impostazioni", ja: "設定をエクスポート" },
  import_btn:            { en: "Import settings",                                                                   es: "Importar ajustes",                                                                   pt: "Importar configurações",                                                                   de: "Einstellungen importieren", fr: "Importer les paramètres", it: "Importa impostazioni", ja: "設定をインポート" },
  export_label:          { en: "Export settings",                                                                   es: "Exportar ajustes",                                                                   pt: "Exportar configurações",                                                                   de: "Einstellungen exportieren", fr: "Exporter les paramètres", it: "Esporta impostazioni", ja: "設定をエクスポート" },
  import_label:          { en: "Import settings",                                                                   es: "Importar ajustes",                                                                   pt: "Importar configurações",                                                                   de: "Einstellungen importieren", fr: "Importer les paramètres", it: "Importa impostazioni", ja: "設定をインポート" },
  import_success:        { en: "Settings imported successfully.",                                                   es: "Ajustes importados correctamente.",                                                                   pt: "Configurações importadas com sucesso.",                                                                   de: "Einstellungen erfolgreich importiert.", fr: "Paramètres importés avec succès.", it: "Impostazioni importate con successo.", ja: "設定を正常にインポートしました。" },
  import_error:          { en: "That doesn't look like a MUGA settings file. Make sure you're importing a .json file exported from MUGA.",  es: "Eso no parece un archivo de ajustes de MUGA. Asegúrate de que sea un .json exportado desde MUGA.",  pt: "Isso não parece um arquivo de configurações do MUGA. Certifique-se de importar um .json exportado pelo MUGA.",  de: "Das sieht nicht wie eine MUGA-Einstellungsdatei aus. Stelle sicher, dass du eine .json-Datei importierst, die von MUGA exportiert wurde.", fr: "Cela ne ressemble pas à un fichier de paramètres MUGA. Assurez-vous d'importer un fichier .json exporté depuis MUGA.", it: "Non sembra un file di impostazioni MUGA. Assicurati di importare un file .json esportato da MUGA.", ja: "MUGAの設定ファイルではないようです。MUGAからエクスポートされた.jsonファイルをインポートしているか確認してください。" },

  // ── Remote rule updates (Options section) ────────────────────────────────────
  // REQ-I18N-1: all four locales required. EN/ES native; PT/DE mechanical.
  // PT/DE: AI-assisted translations. Native-speaker contributions welcome via CONTRIBUTING.md.
  optionsRemoteRulesTitle:        { en: "Remote rule updates",                                                                                                es: "Actualización remota de reglas",                           pt: "Atualizações remotas de regras",              de: "Remote-Regelaktualisierungen", fr: "Mises à jour de règles à distance", it: "Aggiornamenti remoti delle regole", ja: "ルールのリモート更新" },
  optionsRemoteRulesDesc:         { en: "Optional. Download weekly updates to the list of tracking parameters. Off by default.",                             es: "Opcional. Descarga actualizaciones semanales de la lista de parámetros de rastreo. Desactivado por defecto.",  pt: "Opcional. Baixa atualizações semanais da lista de parâmetros de rastreamento. Desativado por padrão.",  de: "Optional. Lädt wöchentliche Aktualisierungen der Tracking-Parameter-Liste herunter. Standardmäßig deaktiviert.", fr: "Facultatif. Télécharge des mises à jour hebdomadaires de la liste des paramètres de pistage. Désactivé par défaut.", it: "Opzionale. Scarica aggiornamenti settimanali dell'elenco dei parametri di tracciamento. Disattivato per impostazione predefinita.", ja: "オプション。トラッキングパラメータリストの週次更新をダウンロードします。デフォルトでオフ。" },
  optionsRemoteRulesToggle:       { en: "Enable weekly updates",                                                                                             es: "Activar actualizaciones semanales",                         pt: "Ativar atualizações semanais",                de: "Wöchentliche Aktualisierungen aktivieren", fr: "Activer les mises à jour hebdomadaires", it: "Attiva aggiornamenti settimanali", ja: "週次更新を有効にする" },
  optionsRemoteRulesLastFetch:    { en: "Last checked:",                                                                                                     es: "Última comprobación:",                                      pt: "Última verificação:",                        de: "Zuletzt geprüft:", fr: "Dernière vérification :", it: "Ultima verifica:", ja: "最終確認:" },
  optionsRemoteRulesParamCount:   { en: "Active remote params:",                                                                                             es: "Parámetros remotos activos:",                               pt: "Parâmetros remotos ativos:",                 de: "Aktive Remote-Parameter:", fr: "Paramètres distants actifs :", it: "Parametri remoti attivi:", ja: "アクティブなリモートパラメータ:" },
  optionsRemoteRulesSource:       { en: "Source",                                                                                                            es: "Fuente",                                                    pt: "Fonte",                                      de: "Quelle", fr: "Source", it: "Origine", ja: "ソース" },
  optionsRemoteRulesError:        { en: "Update failed. Check the console for details.",                                                                     es: "La actualización falló. Consulta la consola para más detalles.", pt: "Atualização falhou. Verifique o console para detalhes.", de: "Aktualisierung fehlgeschlagen. Details in der Konsole.", fr: "Échec de la mise à jour. Consultez la console pour plus de détails.", it: "Aggiornamento fallito. Controlla la console per i dettagli.", ja: "更新に失敗しました。詳細はコンソールを確認してください。" },
  optionsRemoteRulesNeverFetched: { en: "Never checked.",                                                                                                    es: "Nunca comprobado.",                                         pt: "Nunca verificado.",                          de: "Nie geprüft.", fr: "Jamais vérifié.", it: "Mai verificato.", ja: "未確認。" },
  optionsRemoteRulesPermDenied:   { en: "Permission was not granted. Updates remain off.",                                                                   es: "Permiso no concedido. Las actualizaciones siguen desactivadas.", pt: "Permissão não concedida. Atualizações permanecem desativadas.", de: "Berechtigung nicht erteilt. Aktualisierungen bleiben deaktiviert.", fr: "Autorisation refusée. Les mises à jour restent désactivées.", it: "Permesso non concesso. Gli aggiornamenti rimangono disattivati.", ja: "権限が付与されませんでした。更新はオフのままです。" },
  optionsRemoteRulesErrNetwork:   { en: "Could not reach the update server. Previous list still in use.",                                                    es: "No se pudo contactar con el servidor. Se sigue usando la lista anterior.", pt: "Não foi possível contatar o servidor de atualização. A lista anterior ainda está em uso.", de: "Update-Server nicht erreichbar. Vorherige Liste wird weiterhin verwendet.", fr: "Impossible de joindre le serveur de mise à jour. La liste précédente reste utilisée.", it: "Impossibile raggiungere il server di aggiornamento. L'elenco precedente è ancora in uso.", ja: "更新サーバーに到達できませんでした。以前のリストを引き続き使用します。" },
  optionsRemoteRulesErrSchema:    { en: "Update file was malformed.",                                                                                        es: "El archivo de actualización estaba mal formado.",           pt: "Arquivo de atualização malformado.",            de: "Aktualisierungsdatei war fehlerhaft.", fr: "Le fichier de mise à jour était mal formé.", it: "Il file di aggiornamento era malformato.", ja: "更新ファイルの形式が不正でした。" },
  optionsRemoteRulesErrSignature: { en: "Update signature did not match. Update ignored.",                                                                   es: "La firma de la actualización no coincide. Actualización ignorada.", pt: "Assinatura de atualização não correspondeu. Atualização ignorada.", de: "Aktualisierungssignatur stimmte nicht überein. Aktualisierung ignoriert.", fr: "La signature de la mise à jour ne correspond pas. Mise à jour ignorée.", it: "La firma dell'aggiornamento non corrisponde. Aggiornamento ignorato.", ja: "更新の署名が一致しませんでした。更新を無視しました。" },
  optionsRemoteRulesErrFormat:    { en: "Update contained an invalid parameter. Ignored.",                                                                   es: "La actualización contenía un parámetro inválido. Ignorada.", pt: "Atualização continha um parâmetro inválido. Ignorada.", de: "Aktualisierung enthielt einen ungültigen Parameter. Ignoriert.", fr: "La mise à jour contenait un paramètre invalide. Ignorée.", it: "L'aggiornamento conteneva un parametro non valido. Ignorato.", ja: "更新に無効なパラメータが含まれていました。無視しました。" },
  optionsRemoteRulesErrDenylist:  { en: "Update contained a reserved parameter. Ignored.",                                                                   es: "La actualización contenía un parámetro reservado. Ignorada.", pt: "Atualização continha um parâmetro reservado. Ignorada.", de: "Aktualisierung enthielt einen reservierten Parameter. Ignoriert.", fr: "La mise à jour contenait un paramètre réservé. Ignorée.", it: "L'aggiornamento conteneva un parametro riservato. Ignorato.", ja: "更新に予約済みパラメータが含まれていました。無視しました。" },
  optionsRemoteRulesErrOverCap:   { en: "Update was too large. Ignored.",                                                                                    es: "La actualización era demasiado grande. Ignorada.",           pt: "Atualização era grande demais. Ignorada.",      de: "Aktualisierung war zu groß. Ignoriert.", fr: "La mise à jour était trop volumineuse. Ignorée.", it: "L'aggiornamento era troppo grande. Ignorato.", ja: "更新が大きすぎました。無視しました。" },
  optionsRemoteRulesErrVersion:   { en: "Update was older than current. Ignored.",                                                                           es: "La actualización era más antigua que la actual. Ignorada.", pt: "Atualização era mais antiga que a atual. Ignorada.", de: "Aktualisierung war älter als die aktuelle. Ignoriert.", fr: "La mise à jour était plus ancienne que la version actuelle. Ignorée.", it: "L'aggiornamento era più vecchio di quello attuale. Ignorato.", ja: "更新が現在のバージョンより古いものでした。無視しました。" },
  optionsRemoteRulesErrStale:     { en: "Update file was too old. Ignored.",                                                                                 es: "El archivo de actualización era demasiado antiguo. Ignorado.", pt: "Arquivo de atualização era muito antigo. Ignorado.", de: "Aktualisierungsdatei war zu alt. Ignoriert.", fr: "Le fichier de mise à jour était trop ancien. Ignoré.", it: "Il file di aggiornamento era troppo vecchio. Ignorato.", ja: "更新ファイルが古すぎました。無視しました。" },
  optionsRemoteRulesErrUnknown:   { en: "Update failed. Check the console for details.",                                                                     es: "La actualización falló. Consulta la consola para más detalles.", pt: "Atualização falhou. Verifique o console para detalhes.", de: "Aktualisierung fehlgeschlagen. Details in der Konsole.", fr: "Échec de la mise à jour. Consultez la console pour plus de détails.", it: "Aggiornamento fallito. Controlla la console per i dettagli.", ja: "更新に失敗しました。詳細はコンソールを確認してください。" },
  whatsNewRemoteRules:            { en: "New: you can enable optional updates to the tracking-parameter list in Settings. Off by default.",                                     es: "Novedad: podés activar actualizaciones opcionales de la lista de parámetros en Ajustes. Desactivado por defecto.", pt: "Novo: você pode ativar atualizações opcionais da lista de parâmetros em Configurações. Desativado por padrão.", de: "Neu: Optionale Aktualisierungen der Tracking-Parameter-Liste können in den Einstellungen aktiviert werden. Standardmäßig deaktiviert.", fr: "Nouveau : vous pouvez activer les mises à jour facultatives de la liste des paramètres de pistage dans Paramètres. Désactivé par défaut.", it: "Novità: puoi attivare aggiornamenti opzionali dell'elenco dei parametri di tracciamento nelle Impostazioni. Disattivato per impostazione predefinita.", ja: "新機能: トラッキングパラメータリストのオプション更新を設定で有効にできます。デフォルトでオフ。" },
  muga_disabled_for_domain:       { en: "MUGA is disabled on this site",                                                                                     es: "MUGA está desactivado en este sitio",                       pt: "MUGA está desativado neste site",             de: "MUGA ist auf dieser Seite deaktiviert", fr: "MUGA est désactivé sur ce site", it: "MUGA è disattivato su questo sito", ja: "MUGAはこのサイトで無効です" },

  // ── Advanced / Developer options ──────────────────────────────────────────
  section_advanced:           { en: "Advanced",                                                          es: "Avanzado",                                                          pt: "Avançado",                                                          de: "Erweitert", fr: "Avancé", it: "Avanzate", ja: "詳細設定" },
  advanced_mode_label:        { en: "Show advanced settings",                                            es: "Mostrar ajustes avanzados",                                            pt: "Mostrar configurações avançadas",                                            de: "Erweiterte Einstellungen anzeigen", fr: "Afficher les paramètres avancés", it: "Mostra impostazioni avanzate", ja: "詳細設定を表示" },
  advanced_mode_hint:         { en: "Fine-grained control over URL cleaning, privacy, and developer tools", es: "Control detallado de limpieza de URLs, privacidad y herramientas de desarrollo", pt: "Controle detalhado sobre limpeza de URLs, privacidade e ferramentas para desenvolvedores", de: "Detaillierte Kontrolle über URL-Bereinigung, Datenschutz und Entwicklertools", fr: "Contrôle précis du nettoyage des URL, de la confidentialité et des outils de développement", it: "Controllo dettagliato sulla pulizia degli URL, la privacy e gli strumenti di sviluppo", ja: "URLクリーンアップ、プライバシー、開発ツールの詳細制御" },
  // Honor Creator Mode (#435, B12). Plumbing only — no behaviour wired yet.
  honor_creator_mode_label:   { en: "Honor Creator Mode",                                                es: "Modo Honrar al Creador",                                                pt: "Modo Honrar o Criador",                                                de: "Creator-Modus respektieren", fr: "Mode Honorer le créateur", it: "Modalità Onora il creatore", ja: "クリエイター尊重モード" },
  honor_creator_mode_hint:    { en: "Preserve creator referral chains on trusted redirect networks. Off by default; enable to support creators you follow.", es: "Conserva las cadenas de referidos de creadores en redes de redirección de confianza. Desactivado por defecto; activalo para apoyar a creadores que seguís.", pt: "Preserva cadeias de referência de criadores em redes de redirecionamento confiáveis. Desativado por padrão; ative para apoiar criadores que você segue.", de: "Bewahrt Creator-Referral-Ketten auf vertrauenswürdigen Weiterleitungsnetzwerken. Standardmäßig deaktiviert; aktivieren, um Creator zu unterstützen, denen du folgst.", fr: "Préserve les chaînes d'affiliation des créateurs sur les réseaux de redirection de confiance. Désactivé par défaut ; activez-le pour soutenir les créateurs que vous suivez.", it: "Preserva le catene di affiliazione dei creatori sulle reti di reindirizzamento fidate. Disattivato per impostazione predefinita; attivalo per sostenere i creatori che segui.", ja: "信頼できるリダイレクトネットワーク上でクリエイターのリファラルチェーンを保持します。デフォルトでオフ。フォローしているクリエイターを支援するために有効にしてください。" },
  // Creator allowlist editor (#445, B13). Per-creator opt-in list for Honor Creator Mode.
  creator_allowlist_label:        { en: "Creators you support",                                                                                                                          es: "Creadores que apoyas",                                                                                                                                                pt: "Criadores que você apoia",                                                                                                          de: "Creator, die du unterstützt", fr: "Créateurs que vous soutenez", it: "Creator che sostieni", ja: "支援するクリエイター" },
  creator_allowlist_hint:         { en: "Add referrer domains where Honor Creator Mode should preserve creator referral chains (e.g. <code>youtube.com/@LinusTechTips</code>, <code>dot-css-news.com</code>). Up to 100 entries.", es: "Añade dominios de referencia donde el Modo Honrar al Creador debe conservar las cadenas de afiliados (ej: <code>youtube.com/@LinusTechTips</code>, <code>dot-css-news.com</code>). Hasta 100 entradas.", pt: "Adicione domínios de referência onde o Modo Honrar o Criador deve preservar as cadeias de referência (ex: <code>youtube.com/@LinusTechTips</code>, <code>dot-css-news.com</code>). Até 100 entradas.", de: "Füge Referrer-Domains hinzu, auf denen der Creator-Modus Referral-Ketten bewahren soll (z.B. <code>youtube.com/@LinusTechTips</code>, <code>dot-css-news.com</code>). Bis zu 100 Einträge.", fr: "Ajoutez des domaines référents où le Mode Honorer le créateur doit préserver les chaînes d'affiliation des créateurs (ex. <code>youtube.com/@LinusTechTips</code>, <code>dot-css-news.com</code>). Jusqu'à 100 entrées.", it: "Aggiungi domini referrer dove la Modalità Onora il creatore deve preservare le catene di affiliazione (es. <code>youtube.com/@LinusTechTips</code>, <code>dot-css-news.com</code>). Fino a 100 voci.", ja: "クリエイター尊重モードがクリエイターのリファラルチェーンを保持するリファラドメインを追加します (例: <code>youtube.com/@LinusTechTips</code>, <code>dot-css-news.com</code>)。最大100件。" },
  creator_allowlist_placeholder:  { en: "youtube.com/@creator  or  dot-css-news.com",                                                                                                    es: "youtube.com/@creador  o  dot-css-news.com",                                                                                                                            pt: "youtube.com/@criador  ou  dot-css-news.com",                                                                                          de: "youtube.com/@creator  oder  dot-css-news.com", fr: "youtube.com/@createur  ou  dot-css-news.com", it: "youtube.com/@creator  o  dot-css-news.com", ja: "youtube.com/@creator  または  dot-css-news.com" },
  creator_allowlist_add_btn:      { en: "+ Add creator",                                                                                                                                 es: "+ Añadir creador",                                                                                                                                                    pt: "+ Adicionar criador",                                                                                                                de: "+ Creator hinzufügen", fr: "+ Ajouter un créateur", it: "+ Aggiungi creator", ja: "+ クリエイターを追加" },
  creator_allowlist_remove_btn:   { en: "Remove",                                                                                                                                        es: "Eliminar",                                                                                                                                                            pt: "Remover",                                                                                                                            de: "Entfernen", fr: "Supprimer", it: "Rimuovi", ja: "削除" },
  creator_allowlist_err_empty:    { en: "Enter a domain or creator handle (e.g. youtube.com/@creator).",                                                                                 es: "Introduce un dominio o handle de creador (ej: youtube.com/@creador).",                                                                                                pt: "Insira um domínio ou identificador de criador (ex: youtube.com/@criador).",                                                          de: "Gib eine Domain oder einen Creator-Handle ein (z.B. youtube.com/@creator).", fr: "Entrez un domaine ou un identifiant de créateur (ex. youtube.com/@createur).", it: "Inserisci un dominio o un handle del creator (es. youtube.com/@creator).", ja: "ドメインまたはクリエイターハンドルを入力してください (例: youtube.com/@creator)。" },
  creator_allowlist_err_duplicate:{ en: "That creator is already on your allowlist.",                                                                                                    es: "Ese creador ya está en tu lista.",                                                                                                                                    pt: "Esse criador já está na sua lista.",                                                                                                de: "Dieser Creator steht bereits auf deiner Liste.", fr: "Ce créateur est déjà dans votre liste.", it: "Quel creator è già nel tuo elenco.", ja: "そのクリエイターはすでにリストにあります。" },
  // Experimental shape-based param heuristic (#544). Default OFF; toggle
  // sits in the Advanced card next to Honor Creator Mode. Warning copy is a
  // SEPARATE key so the UI can render it with a distinct visual treatment
  // (warning hint) without translators needing to embed inline HTML.
  exp_param_classes_label: {
    en: "Experimental: shape-based param stripping",
    es: "Experimental: limpieza de parámetros por forma",
    pt: "Experimental: remoção de parâmetros por forma",
    de: "Experimentell: Parameter nach Form entfernen",
    fr: "Expérimental : suppression de paramètres basée sur la forme",
    it: "Sperimentale: rimozione parametri basata sulla forma",
    ja: "実験的機能: 形状ベースのパラメータ削除",
  },
  exp_param_classes_hint: {
    en: "Strips params whose value shape matches a tracker pattern (long, high-entropy, base64/hex/uuid). Ships behind this flag because false positives can break some sites.",
    es: "Elimina parámetros cuyo valor tiene forma de identificador de tracker (largos, alta entropía, base64/hex/uuid). Va detrás de este flag porque los falsos positivos pueden romper algunos sitios.",
    pt: "Remove parâmetros cujo valor tem forma de identificador de tracker (longos, alta entropia, base64/hex/uuid). Atrás deste flag porque falsos positivos podem quebrar alguns sites.",
    de: "Entfernt Parameter, deren Wertform einem Tracker-Muster entspricht (lang, hohe Entropie, base64/hex/uuid). Hinter diesem Flag, weil False Positives einige Seiten beschädigen können.",
    fr: "Supprime les paramètres dont la forme de la valeur correspond à un motif de traqueur (longs, à haute entropie, base64/hex/uuid). Protégé par ce drapeau car les faux positifs peuvent casser certains sites.",
    it: "Rimuove parametri il cui valore ha forma di identificatore di tracker (lunghi, alta entropia, base64/hex/uuid). Dietro questo flag perché i falsi positivi possono rompere alcuni siti.",
    ja: "値の形状がトラッカーパターン (長い、高エントロピー、base64/hex/uuid) に一致するパラメータを削除します。誤検出により一部のサイトが壊れる可能性があるため、このフラグの背後に置かれています。",
  },
  exp_param_classes_warn: {
    en: "May break some sites. Disable if you see issues.",
    es: "Puede romper algunos sitios. Desactivalo si ves problemas.",
    pt: "Pode quebrar alguns sites. Desative se vir problemas.",
    de: "Kann einige Seiten beschädigen. Deaktiviere es bei Problemen.",
    fr: "Peut casser certains sites. Désactivez en cas de problème.",
    it: "Può rompere alcuni siti. Disattiva se riscontri problemi.",
    ja: "一部のサイトが壊れる可能性があります。問題が発生した場合は無効にしてください。",
  },
  creator_allowlist_err_max:      { en: "You've reached the 100-creator limit. Remove an entry to add a new one.",                                                                       es: "Has alcanzado el límite de 100 creadores. Elimina una entrada para añadir otra.",                                                                                     pt: "Você atingiu o limite de 100 criadores. Remova uma entrada para adicionar outra.",                                                   de: "Du hast das Limit von 100 Creatorn erreicht. Entferne einen Eintrag, um einen neuen hinzuzufügen.", fr: "Vous avez atteint la limite de 100 créateurs. Supprimez une entrée pour en ajouter une autre.", it: "Hai raggiunto il limite di 100 creator. Rimuovi una voce per aggiungerne una nuova.", ja: "クリエイター100件の上限に達しました。新しいものを追加するにはエントリを削除してください。" },
  section_dev_tools:          { en: "Developer tools",                                                   es: "Herramientas de desarrollo",                                                   pt: "Ferramentas de desenvolvedor",                                                   de: "Entwicklertools", fr: "Outils de développement", it: "Strumenti per sviluppatori", ja: "開発者ツール" },
  dev_preview_notify_label:   { en: "Preview affiliate notification",                                   es: "Previsualizar notificación de afiliado",                                   pt: "Pré-visualizar notificação de afiliado",                                   de: "Affiliate-Benachrichtigung vorschauen", fr: "Prévisualiser la notification d'affiliation", it: "Anteprima notifica di affiliazione", ja: "アフィリエイト通知をプレビュー" },
  dev_preview_notify_hint:    { en: "See how the toast looks when a third-party affiliate is detected", es: "Ve cómo aparece el aviso cuando se detecta un afiliado ajeno", pt: "Veja como o aviso aparece quando um afiliado de terceiro é detectado", de: "Sieh, wie die Benachrichtigung aussieht, wenn ein Drittanbieter-Affiliate erkannt wird", fr: "Voyez à quoi ressemble la notification lorsqu'une affiliation tierce est détectée", it: "Vedi come appare la notifica quando viene rilevata un'affiliazione di terze parti", ja: "サードパーティのアフィリエイトが検出されたときの通知の見た目を確認します" },
  dev_preview_notify_btn:     { en: "Preview",                                                          es: "Vista previa",                                                          pt: "Pré-visualizar",                                                          de: "Vorschau", fr: "Aperçu", it: "Anteprima", ja: "プレビュー" },
  dev_onboarding_label:       { en: "Show welcome screen",                                              es: "Mostrar pantalla de bienvenida",                                              pt: "Mostrar tela de boas-vindas",                                              de: "Willkommensbildschirm anzeigen", fr: "Afficher l'écran de bienvenue", it: "Mostra schermata di benvenuto", ja: "ウェルカム画面を表示" },
  dev_onboarding_hint:        { en: "Re-open the first-run onboarding page",                            es: "Vuelve a abrir el onboarding inicial",                            pt: "Reabrir a página de introdução inicial",                            de: "Die Einführungsseite erneut öffnen", fr: "Rouvrir la page d'accueil du premier lancement", it: "Riapri la pagina di benvenuto iniziale", ja: "初回起動時のオンボーディングページを再度開きます" },
  dev_onboarding_btn:         { en: "Open",                                                             es: "Abrir",                                                             pt: "Abrir",                                                             de: "Öffnen", fr: "Ouvrir", it: "Apri", ja: "開く" },
  dev_log_label:              { en: "Debug log",                                                        es: "Log de depuración",                                                        pt: "Log de depuração",                                                        de: "Debug-Log", fr: "Journal de débogage", it: "Log di debug", ja: "デバッグログ" },
  dev_log_hint:               { en: "Download a log of errors and warnings from the current session",   es: "Descarga un log de errores y avisos de la sesión actual",   pt: "Baixar um log de erros e avisos da sessão atual",   de: "Ein Log mit Fehlern und Warnungen der aktuellen Sitzung herunterladen", fr: "Télécharger un journal des erreurs et avertissements de la session actuelle", it: "Scarica un log di errori e avvisi della sessione corrente", ja: "現在のセッションのエラーと警告のログをダウンロードします" },
  dev_log_btn:                { en: "Export log",                                                       es: "Exportar log",                                                       pt: "Exportar log",                                                       de: "Log exportieren", fr: "Exporter le journal", it: "Esporta log", ja: "ログをエクスポート" },
  dev_nudge_label:            { en: "Preview rating nudge",                                              es: "Previsualizar aviso de valoraci\u00f3n",                                              pt: "Pré-visualizar aviso de avaliação",                                              de: "Bewertungshinweis vorschauen", fr: "Prévisualiser l'invite d'évaluation", it: "Anteprima invito alla valutazione", ja: "評価ナッジをプレビュー" },
  dev_nudge_hint:             { en: "Test the rating nudge. Dismiss increments the counter, Reset clears it.", es: "Prueba el aviso de valoraci\u00f3n. Descartar incrementa el contador, Reset lo limpia.", pt: "Teste o aviso de avaliação. Dispensar incrementa o contador, Zerar o limpa.", de: "Den Bewertungshinweis testen. Schließen erhöht den Zähler, Zurücksetzen löscht ihn.", fr: "Testez l'invite d'évaluation. Ignorer incrémente le compteur, Réinitialiser l'efface.", it: "Testa l'invito alla valutazione. Ignora incrementa il contatore, Azzera lo cancella.", ja: "評価ナッジをテストします。閉じるとカウンターが増加し、リセットでクリアされます。" },
  dev_nudge_btn:              { en: "Preview",                                                           es: "Previsualizar",                                                           pt: "Pré-visualizar",                                                           de: "Vorschau", fr: "Aperçu", it: "Anteprima", ja: "プレビュー" },
  dev_url_tester_label:       { en: "URL tester",                                                       es: "Probador de URLs",                                                       pt: "Testador de URLs",                                                       de: "URL-Tester", fr: "Testeur d'URL", it: "Tester URL", ja: "URLテスター" },
  dev_url_tester_hint:        { en: "Paste any URL to see what MUGA will clean",                        es: "Pega cualquier URL para ver qué limpiará MUGA",                        pt: "Cole qualquer URL para ver o que MUGA vai limpar",                        de: "Füge eine beliebige URL ein, um zu sehen, was MUGA bereinigt", fr: "Collez une URL pour voir ce que MUGA va nettoyer", it: "Incolla un URL per vedere cosa ripulirà MUGA", ja: "任意のURLを貼り付けて、MUGAが何をクリーンアップするか確認します" },
  dev_url_tester_placeholder: { en: "https://example.com?utm_source=google&fbclid=...",                 es: "https://example.com?utm_source=google&fbclid=...",                 pt: "https://example.com?utm_source=google&fbclid=...",                 de: "https://example.com?utm_source=google&fbclid=...", fr: "https://example.com?utm_source=google&fbclid=...", it: "https://example.com?utm_source=google&fbclid=...", ja: "https://example.com?utm_source=google&fbclid=..." },
  dev_url_test_btn:           { en: "Test",                                                             es: "Probar",                                                             pt: "Testar",                                                             de: "Testen", fr: "Tester", it: "Testa", ja: "テスト" },
  dev_url_result_label:       { en: "Result",                                                           es: "Resultado",                                                           pt: "Resultado",                                                           de: "Ergebnis", fr: "Résultat", it: "Risultato", ja: "結果" },
  dev_url_removed:            { en: "Removed: %s",                                                       es: "Eliminados: %s",                                                       pt: "Removidos: %s",                                                       de: "Entfernt: %s", fr: "Supprimés : %s", it: "Rimossi: %s", ja: "削除済み: %s" },
  dev_url_clean:              { en: "No noise here. URL is already clean.",                   es: "Sin ruido aquí. La URL ya está limpia.",                   pt: "Sem ruído aqui. A URL já está limpa.",                   de: "Kein Rauschen hier. URL ist bereits sauber.", fr: "Pas de bruit ici. L'URL est déjà propre.", it: "Nessun rumore qui. L'URL è già pulito.", ja: "ノイズなし。URLはすでにクリーンです。" },
  dev_url_action:             { en: "Action: %s",                                                        es: "Acción: %s",                                                        pt: "Ação: %s",                                                        de: "Aktion: %s", fr: "Action : %s", it: "Azione: %s", ja: "アクション: %s" },
  dev_url_report_btn:         { en: "Report a problem with this URL",                                    es: "Reportar un problema con esta URL",                                    pt: "Reportar um problema com esta URL",                                    de: "Ein Problem mit dieser URL melden", fr: "Signaler un problème avec cette URL", it: "Segnala un problema con questo URL", ja: "このURLの問題を報告" },
  report_broken_label:        { en: "Report a bug or suggest an improvement",                            es: "Reportar un error o sugerir una mejora",                            pt: "Reportar um bug ou sugerir uma melhoria",                            de: "Fehler melden oder Verbesserung vorschlagen", fr: "Signaler un bug ou suggérer une amélioration", it: "Segnala un bug o suggerisci un miglioramento", ja: "バグを報告または改善を提案" },
  report_dirty_url:           { en: "Report a problem with this URL",                                    es: "Reportar un problema con esta URL",                                    pt: "Reportar um problema com esta URL",                                    de: "Ein Problem mit dieser URL melden", fr: "Signaler un problème avec cette URL", it: "Segnala un problema con questo URL", ja: "このURLの問題を報告" },
  preview_count_one:              { en: "MUGA removed 1 bit of noise from this URL",                            es: "MUGA eliminó 1 bit de ruido de esta URL",                              pt: "MUGA removeu 1 bit de ruído desta URL",                              de: "MUGA hat 1 Rauschen-Bit aus dieser URL entfernt", fr: "MUGA a supprimé 1 bit de bruit de cette URL", it: "MUGA ha rimosso 1 bit di rumore da questo URL", ja: "MUGAはこのURLから1つのノイズを除去しました" },
  preview_count_other:            { en: "MUGA removed {n} bits of noise from this URL",                         es: "MUGA eliminó {n} bits de ruido de esta URL",                          pt: "MUGA removeu {n} bits de ruído desta URL",                          de: "MUGA hat {n} Rauschen-Bits aus dieser URL entfernt", fr: "MUGA a supprimé {n} bits de bruit de cette URL", it: "MUGA ha rimosso {n} bit di rumore da questo URL", ja: "MUGAはこのURLから{n}個のノイズを除去しました" },
  preview_count_clean:            { en: "URL was already clean",                                           es: "La URL ya estaba limpia",                                            pt: "A URL já estava limpa",                                              de: "URL war bereits sauber", fr: "L'URL était déjà propre", it: "L'URL era già pulito", ja: "URLはすでにクリーンでした" },
  preview_preserved_creator:      { en: "Creator referral preserved",                                       es: "Referido del creador preservado",                                       pt: "Indicação do criador preservada",                                       de: "Empfehlung des Creators erhalten", fr: "Affiliation du créateur préservée", it: "Affiliazione del creatore preservata", ja: "クリエイターのリファラルを保持" },
  preview_preserved_creator_hint: { en: "MUGA never touches an affiliate tag that isn't ours, so the creator who recommended this still gets credit.", es: "MUGA nunca toca un tag de afiliado que no sea nuestro, así que quien te recomendó esto sigue recibiendo el crédito.", pt: "O MUGA nunca toca em uma tag de afiliado que não seja nossa, então quem recomendou isso continua recebendo o crédito.", de: "MUGA berührt niemals ein Affiliate-Tag, das uns nicht gehört — die Person, die dir das empfohlen hat, bekommt weiterhin die Anrechnung.", fr: "MUGA ne touche jamais à un tag d'affiliation qui n'est pas le nôtre, donc le créateur qui a recommandé ceci reçoit toujours sa contrepartie.", it: "MUGA non tocca mai un tag di affiliazione che non sia il nostro, quindi il creator che ha consigliato questo riceve comunque il credito.", ja: "MUGAは当方のものではないアフィリエイトタグには一切触れません。これを推薦したクリエイターは引き続きクレジットを受け取ります。" },
  dev_report_broken_hint:     { en: "Opens a pre-filled GitHub issue with your browser and extension info", es: "Abre un issue de GitHub pre-rellenado con info de tu navegador y extensi\u00f3n", pt: "Abre uma issue do GitHub pré-preenchida com informações do seu navegador e extensão", de: "Öffnet ein vorab ausgefülltes GitHub-Issue mit deinen Browser- und Erweiterungsinfos", fr: "Ouvre un ticket GitHub pré-rempli avec les informations de votre navigateur et de l'extension", it: "Apre una issue GitHub precompilata con le informazioni del browser e dell'estensione", ja: "ブラウザと拡張機能の情報が事前入力されたGitHub Issueを開きます" },
  dev_report_broken_btn:      { en: "Report",                                                            es: "Reportar",                                                            pt: "Reportar",                                                            de: "Melden", fr: "Signaler", it: "Segnala", ja: "報告" },

  // ── Rate button short label (used by growth bar) ──────────────────────────
  rate_muga_short: { en: "Rate MUGA", es: "Valorar MUGA", pt: "Avaliar MUGA", de: "MUGA bewerten", fr: "Évaluer MUGA", it: "Valuta MUGA", ja: "MUGAを評価" },

  // ── Error messages ───────────────────────────────────────────────────────
  ob_save_error:   { en: "Error — please try again", es: "Error — por favor intentalo de nuevo", pt: "Erro — por favor tente novamente", de: "Fehler — bitte versuche es erneut", fr: "Erreur — veuillez réessayer", it: "Errore — riprova", ja: "エラー — もう一度お試しください" },

  // ── Onboarding success state (#firefox-window-close fallback) ────────────
  // Rendered in-place after consent is persisted. Visible only when the
  // browser blocks the window.close() / chrome.tabs.remove() fallbacks
  // (Firefox refuses window.close() on tabs not opened by JS). The state
  // confirms persistence so the user does not assume the click failed.
  ob_success_title:     { en: "You're set. The noise is off.",                                  es: "Listo. El ruido está apagado.",                                                pt: "Pronto. O ruído está desligado.",                                            de: "Fertig. Das Rauschen ist weg.", fr: "C'est fait. Le bruit est coupé.", it: "Fatto. Il rumore è spento.", ja: "準備完了。ノイズは消えました。" },
  ob_success_msg:       { en: "MUGA is now active. You can close this tab.",     es: "MUGA ya está activo. Podés cerrar esta pestaña.",          pt: "O MUGA já está ativo. Você pode fechar esta aba.",       de: "MUGA ist jetzt aktiv. Du kannst diesen Tab schließen.", fr: "MUGA est maintenant actif. Vous pouvez fermer cet onglet.", it: "MUGA è ora attivo. Puoi chiudere questa scheda.", ja: "MUGAが有効になりました。このタブを閉じることができます。" },
  ob_success_close_btn: { en: "Close tab",                                       es: "Cerrar pestaña",                                            pt: "Fechar aba",                                             de: "Tab schließen", fr: "Fermer l'onglet", it: "Chiudi scheda", ja: "タブを閉じる" },
  dev_url_error:   { en: "Error:", es: "Error:", pt: "Erro:", de: "Fehler:", fr: "Erreur :", it: "Errore:", ja: "エラー:" },

  // ── Dev-mode nudge panel (developer-facing, intentionally minimal) ────────
  dev_nudge_dismiss_btn: { en: "Dismiss", es: "Descartar", pt: "Dispensar", de: "Schließen", fr: "Ignorer", it: "Ignora", ja: "閉じる" },
  dev_nudge_reset_btn:   { en: "Reset counters", es: "Reiniciar contadores", pt: "Zerar contadores", de: "Zähler zurücksetzen", fr: "Réinitialiser les compteurs", it: "Azzera contatori", ja: "カウンターをリセット" },
  dev_nudge_status:      { en: "Status: dismissed=%s1, shown=%s2/3, lastShown=%s3", es: "Estado: descartado=%s1, mostrado=%s2/3, lastShown=%s3", pt: "Status: descartado=%s1, mostrado=%s2/3, lastShown=%s3", de: "Status: verworfen=%s1, gezeigt=%s2/3, zuletzt=%s3", fr: "Statut : ignoré=%s1, affiché=%s2/3, lastShown=%s3", it: "Stato: ignorato=%s1, mostrato=%s2/3, lastShown=%s3", ja: "ステータス: 閉じた=%s1, 表示=%s2/3, lastShown=%s3" },
  dev_nudge_reset_done:  { en: "All nudge counters reset. Ready for testing.", es: "Todos los contadores reiniciados. Listo para probar.", pt: "Todos os contadores zerados. Pronto para testar.", de: "Alle Zähler zurückgesetzt. Bereit zum Testen.", fr: "Tous les compteurs réinitialisés. Prêt pour les tests.", it: "Tutti i contatori azzerati. Pronto per i test.", ja: "すべてのナッジカウンターをリセットしました。テストの準備ができました。" },
  dev_nudge_reset_fresh: { en: "Counters reset to 0. Ready for fresh testing.", es: "Contadores a 0. Listo para una prueba nueva.", pt: "Contadores a 0. Pronto para um novo teste.", de: "Zähler auf 0. Bereit für neue Tests.", fr: "Compteurs remis à 0. Prêt pour de nouveaux tests.", it: "Contatori azzerati a 0. Pronto per un nuovo test.", ja: "カウンターを0にリセットしました。新しいテストの準備ができました。" },

  // ── Context menu ─────────────────────────────────────────────────────────
  ctx_copy_clean_link:      { en: "Copy clean link",                       es: "Copiar enlace limpio",                       pt: "Copiar link limpo",                       de: "Bereinigten Link kopieren", fr: "Copier le lien nettoyé", it: "Copia link ripulito", ja: "クリーンなリンクをコピー" },
  ctx_copy_clean_selection: { en: "Copy clean links in selection",         es: "Copiar enlaces limpios de la selección",         pt: "Copiar links limpos da seleção",         de: "Bereinigte Links in Auswahl kopieren", fr: "Copier les liens nettoyés de la sélection", it: "Copia link ripuliti dalla selezione", ja: "選択範囲のクリーンなリンクをコピー" },

  // ── Toolbar tooltips (#358) ──────────────────────────────────────────────
  tooltip_default:                { en: "MUGA",                                                  es: "MUGA",                                                  pt: "MUGA",                                                  de: "MUGA", fr: "MUGA", it: "MUGA", ja: "MUGA" },
  tooltip_cleaned:                { en: "MUGA — noise removed",                               es: "MUGA — ruido eliminado",                              pt: "MUGA — ruído removido",                          de: "MUGA — Rauschen entfernt", fr: "MUGA — bruit supprimé", it: "MUGA — rumore rimosso", ja: "MUGA — ノイズを除去" },
  tooltip_preserved:              { en: "MUGA — creator referral preserved",                     es: "MUGA — referido del creador preservado",                pt: "MUGA — indicação do criador preservada",                de: "MUGA — Creator-Empfehlung erhalten", fr: "MUGA — affiliation du créateur préservée", it: "MUGA — affiliazione del creator preservata", ja: "MUGA — クリエイターのリファラルを保持" },
  tooltip_cleaned_and_preserved:  { en: "MUGA — tracking removed, creator referral preserved",   es: "MUGA — rastreo eliminado, referido del creador preservado", pt: "MUGA — rastreamento removido, indicação do criador preservada", de: "MUGA — Tracking entfernt, Creator-Empfehlung erhalten", fr: "MUGA — pistage supprimé, affiliation du créateur préservée", it: "MUGA — tracciamento rimosso, affiliazione del creator preservata", ja: "MUGA — トラッキングを削除、クリエイターのリファラルを保持" },

  // ── Content script toast ──────────────────────────────────────────────────
  toast_title:   { en: "MUGA found someone else's affiliate tag", es: "MUGA encontró el tag de afiliado de otro", pt: "MUGA encontrou a tag de afiliado de outra pessoa", de: "MUGA hat ein fremdes Affiliate-Tag gefunden", fr: "MUGA a trouvé un tag d'affiliation de quelqu'un d'autre", it: "MUGA ha trovato il tag di affiliazione di qualcun altro", ja: "MUGAは他者のアフィリエイトタグを検出しました" },
  toast_tag_msg: { en: "has an affiliate tag that isn't ours:", es: "tiene un tag de afiliado que no es nuestro:", pt: "tem uma tag de afiliado que não é nossa:", de: "hat ein Affiliate-Tag, das nicht unseres ist:", fr: "a un tag d'affiliation qui n'est pas le nôtre :", it: "ha un tag di affiliazione che non è il nostro:", ja: "には当方のものではないアフィリエイトタグがあります:" },
  toast_allow:   { en: "Keep it", es: "Mantenerlo", pt: "Manter", de: "Behalten", fr: "Conserver", it: "Mantieni", ja: "保持" },
  toast_block:   { en: "Remove it", es: "Eliminarlo", pt: "Remover", de: "Entfernen", fr: "Supprimer", it: "Rimuovi", ja: "削除" },
  toast_dismiss: { en: "Dismiss", es: "Descartar", pt: "Ignorar", de: "Schließen", fr: "Ignorer", it: "Ignora", ja: "閉じる" },

  // ── Onboarding ──────────────────────────────────────────────────────────
  ob_page_title:            { en: "Welcome to MUGA",                                                         es: "Bienvenido a MUGA",                                                         pt: "Bem-vindo ao MUGA",                                                         de: "Willkommen bei MUGA", fr: "Bienvenue dans MUGA", it: "Benvenuto in MUGA", ja: "MUGAへようこそ" },
  ob_tagline:               { en: "The web, with the noise turned down.",                                                    es: "La web, con el ruido apagado.",                                                    pt: "A web, com o ruído desligado.",                                                    de: "Das Web, mit dem Rauschen abgedreht.", fr: "Le web, avec le bruit coupé.", it: "Il web, con il rumore spento.", ja: "ウェブ、ノイズを消した状態で。" },  ob_tagline_sub:           { en: "Fair to creators · nice to you · honest about both.",                es: "Justo con los creadores · amable contigo · honesto en todo.",         pt: "Justo com os criadores · gentil com você · honesto em tudo.",          de: "Fair zu Creatorn · nett zu dir · ehrlich bei beidem.", fr: "Juste envers les créateurs · agréable pour vous · honnête sur les deux.", it: "Giusto con i creator · gentile con te · onesto su entrambi.", ja: "クリエイターに公平 · あなたに親切 · 両方に正直。" },
  ob_step1_title:           { en: "How MUGA quiets the web",                                          es: "Cómo MUGA aquieta la web",                                          pt: "Como MUGA aquieta a web",                                          de: "Wie MUGA das Web beruhigt", fr: "Comment MUGA apaise le web", it: "Come MUGA acquieta il web", ja: "MUGAがウェブを静かにする方法" },
  ob_feat1_title:           { en: "Removes 450+ noise patterns from every URL",                         es: "Elimina 450+ patrones de ruido de cada URL",                         pt: "Remove 450+ padrões de ruído de cada URL",                         de: "Entfernt 450+ Rauschen-Muster aus jeder URL", fr: "Supprime plus de 450 patterns de bruit de chaque URL", it: "Rimuove oltre 450 pattern di rumore da ogni URL", ja: "すべてのURLから450以上のノイズパターンを除去" },
  ob_feat1_desc:            { en: "fbclid, gclid, UTMs, and hundreds more — gone before the page loads. Nothing is collected. Nothing is sent anywhere.", es: "fbclid, gclid, UTMs y cientos más — desaparecidos antes de que cargue la página. Nada se recopila. Nada se envía a ningún lugar.", pt: "fbclid, gclid, UTMs e centenas mais — desaparecidos antes de a página carregar. Nada é coletado. Nada é enviado a lugar nenhum.", de: "fbclid, gclid, UTMs und Hunderte mehr — weg, bevor die Seite lädt. Nichts wird gesammelt. Nichts wird gesendet.", fr: "fbclid, gclid, UTM et des centaines d'autres — disparus avant le chargement de la page. Rien n'est collecté. Rien n'est envoyé nulle part.", it: "fbclid, gclid, UTM e centinaia di altri — spariti prima del caricamento della pagina. Niente viene raccolto. Niente viene inviato da nessuna parte.", ja: "fbclid、gclid、UTM、その他数百種類 — ページ読み込み前に消える。何も収集されない。どこにも送られない。" },
  ob_feat2_title:           { en: "Unwraps the detours: AMP, ping beacons, redirect wrappers",      es: "Desenvuelve los desvíos: AMP, balizas ping, wrappers de redirección",      pt: "Desfaz os desvios: AMP, balizas ping, wrappers de redirecionamento",      de: "Entpackt die Umwege: AMP, Ping-Beacons, Redirect-Wrapper", fr: "Déballe les détours : AMP, balises ping, wrappers de redirection", it: "Scarta le deviazioni: AMP, beacon ping, wrapper di reindirizzamento", ja: "寄り道を解消: AMP、pingビーコン、リダイレクトラッパー" },
  ob_feat2_desc:            { en: "Every detour the web adds between you and the page you wanted is straightened out, locally, inside your browser.", es: "Cada desvío que la web pone entre tú y la página que querías se corrige localmente, dentro de tu navegador.", pt: "Cada desvio que a web adiciona entre você e a página que você queria é corrigido localmente, dentro do seu navegador.", de: "Jeder Umweg, den das Web zwischen dich und die gewünschte Seite einfügt, wird lokal in deinem Browser begradigt.", fr: "Chaque détour que le web ajoute entre vous et la page souhaitée est corrigé localement, dans votre navigateur.", it: "Ogni deviazione che il web aggiunge tra te e la pagina che volevi viene corretta localmente, nel tuo browser.", ja: "ウェブがあなたと目的ページの間に加えるすべての寄り道を、ブラウザ内でローカルに解消します。" },
  ob_feat3_title:           { en: "Clean URLs are shorter, prettier, and safe to share",                     es: "Las URLs limpias son m\u00e1s cortas, m\u00e1s bonitas y seguras para compartir",                     pt: "URLs limpas são mais curtas, mais bonitas e seguras para compartilhar",                     de: "Saubere URLs sind kürzer, schöner und sicher zum Teilen", fr: "Les URL nettoyées sont plus courtes, plus jolies et sûres à partager", it: "Gli URL ripuliti sono più corti, più belli e sicuri da condividere", ja: "クリーンなURLはより短く、より美しく、安全に共有できます" },
  ob_feat3_desc:            { en: "Sometimes you can barely tell where a link goes with all the noise attached. Right-click any link to copy it clean -- quiet and honest.", es: "A veces casi no puedes saber a dónde va un enlace con tanto ruido pegado. Clic derecho en cualquier enlace para copiarlo limpio -- silencioso y honesto.", pt: "Às vezes mal consegues saber para onde vai um link com tanto ruído. Clique com o botão direito em qualquer link para copiá-lo limpo -- quieto e honesto.", de: "Manchmal kann man kaum erkennen, wohin ein Link führt, mit all dem Rauschen dran. Klicke mit rechts auf jeden Link, um ihn sauber zu kopieren -- ruhig und ehrlich.", fr: "Parfois on devine à peine où mène un lien avec tout ce bruit accroché. Clic droit sur n'importe quel lien pour le copier propre -- silencieux et honnête.", it: "A volte riesci a malapena a capire dove porta un link con tutto quel rumore attaccato. Clic destro su qualsiasi link per copiarlo pulito -- silenzioso e onesto.", ja: "ノイズだらけでリンクの行き先がほとんどわからないことがあります。任意のリンクを右クリックしてクリーンにコピー -- 静かで正直。" },  ob_step2_title:           { en: "How MUGA keeps the lights on",                                                    es: "Cómo MUGA mantiene las luces encendidas",                                            pt: "Como MUGA mantém as luzes acesas",                                          de: "Wie MUGA die Lichter anlässt", fr: "Comment MUGA garde les lumières allumées", it: "Come MUGA mantiene le luci accese", ja: "MUGAが運営を続ける方法" },
  ob_affiliate_desc:        { en: '<strong>Creators come first.</strong> If a creator\'s affiliate tag is already on a link, MUGA never touches it -- we don\'t take credit from people who earned it.<br><br>On selected stores where a link has <strong>no affiliate tag at all</strong>, MUGA can add ours. <strong>Your price never changes.</strong> The code is open source, you can verify it.<br><br>MUGA recognises both styles of affiliate attribution -- some programs put the creator\'s tag directly on the merchant\'s URL, others route the click through an affiliate network\'s own server. We respect both. Whoever earned the click keeps it.', es: '<strong>Los creadores son lo primero.</strong> Si el tag de afiliado de un creador ya está en un enlace, MUGA nunca lo toca -- no tomamos crédito de quienes se lo ganaron.<br><br>En tiendas seleccionadas donde un enlace <strong>no tiene ningún tag de afiliado</strong>, MUGA puede añadir el nuestro. <strong>Tu precio nunca cambia.</strong> El código es open source, puedes comprobarlo.<br><br>MUGA reconoce los dos estilos de atribución de afiliados -- algunos programas ponen el tag del creador directamente en la URL del comercio, otros enrutan el clic por el servidor de una red de afiliados. Respetamos ambos. Quien se ganó el clic, se lo queda.', pt: '<strong>Os criadores vêm primeiro.</strong> Se o tag de afiliado de um criador já está num link, MUGA nunca o toca -- não tomamos crédito de quem o ganhou.<br><br>Em lojas selecionadas onde um link <strong>não tem nenhum tag de afiliado</strong>, MUGA pode adicionar o nosso. <strong>Seu preço nunca muda.</strong> O código é open source, você pode verificar.<br><br>MUGA reconhece os dois estilos de atribuição de afiliados -- alguns programas colocam o tag do criador diretamente na URL da loja, outros encaminham o clique pelo servidor de uma rede de afiliados. Respeitamos ambos. Quem ganhou o clique, fica com ele.', de: '<strong>Creator haben Vorrang.</strong> Wenn das Affiliate-Tag eines Creators bereits in einem Link vorhanden ist, berühren wir es nie -- wir nehmen kein Guthaben von denen, die es verdient haben.<br><br>In ausgewählten Shops, wo ein Link <strong>überhaupt kein Affiliate-Tag hat</strong>, kann MUGA unseres hinzufügen. <strong>Dein Preis ändert sich nie.</strong> Der Code ist open source, du kannst das überprüfen.<br><br>MUGA erkennt beide Stile der Affiliate-Zuordnung an -- manche Programme platzieren das Tag des Creators direkt in der URL des Händlers, andere leiten den Klick über den Server eines Affiliate-Netzwerks. Wir respektieren beide. Wer den Klick verdient hat, behält ihn.', fr: "<strong>Les créateurs passent en premier.</strong> Si le tag d'affiliation d'un créateur est déjà sur un lien, MUGA n'y touche jamais -- nous ne prenons pas le crédit des gens qui l'ont mérité.<br><br>Sur certaines boutiques où un lien n'a <strong>aucun tag d'affiliation</strong>, MUGA peut ajouter le nôtre. <strong>Votre prix ne change jamais.</strong> Le code est open source, vous pouvez le vérifier.<br><br>MUGA reconnaît les deux styles d'attribution d'affiliation -- certains programmes placent le tag du créateur directement sur l'URL du commerçant, d'autres acheminent le clic via le serveur d'un réseau d'affiliation. Nous respectons les deux. Celui qui a mérité le clic le garde.", it: "<strong>I creator vengono prima.</strong> Se il tag di affiliazione di un creator è già su un link, MUGA non lo tocca mai -- non prendiamo credito da chi se lo è guadagnato.<br><br>Su negozi selezionati dove un link <strong>non ha alcun tag di affiliazione</strong>, MUGA può aggiungere il nostro. <strong>Il tuo prezzo non cambia mai.</strong> Il codice è open source, puoi verificarlo.<br><br>MUGA riconosce entrambi gli stili di attribuzione degli affiliati -- alcuni programmi mettono il tag del creator direttamente sull'URL del negoziante, altri instradano il clic attraverso il server di una rete di affiliazione. Rispettiamo entrambi. Chi si è guadagnato il clic se lo tiene.", ja: "<strong>クリエイターが最優先です。</strong>クリエイターのアフィリエイトタグがすでにリンクにある場合、MUGAは一切触れません -- 価値を生んだ人からクレジットを奪いません。<br><br>アフィリエイトタグが<strong>まったくない</strong>リンクの対象ストアでは、MUGAが当方のタグを追加できます。<strong>価格は変わりません。</strong>コードはオープンソースで検証可能です。<br><br>MUGAは2つのアフィリエイト帰属スタイルを認識します -- 一部のプログラムはクリエイターのタグを店舗のURLに直接配置し、他はアフィリエイトネットワーク自身のサーバーを介してクリックをルーティングします。私たちは両方を尊重します。クリックを獲得した人がそれを保持します。" },
  ob_tos_label:             { en: 'I have read and accept the <a href="../privacy/tos.html" target="_blank" rel="noopener noreferrer">Terms of use</a> and <a href="../privacy/privacy.html" target="_blank" rel="noopener noreferrer">Privacy policy</a><small class="tos-required-hint">Required to continue</small>', es: 'He le\u00eddo y acepto los <a href="../privacy/tos.html" target="_blank" rel="noopener noreferrer">T\u00e9rminos de uso</a> y la <a href="../privacy/privacy.html" target="_blank" rel="noopener noreferrer">Pol\u00edtica de privacidad</a><small class="tos-required-hint">Obligatorio para continuar</small>', pt: 'Li e aceito os <a href="../privacy/tos.html" target="_blank" rel="noopener noreferrer">Termos de uso</a> e a <a href="../privacy/privacy.html" target="_blank" rel="noopener noreferrer">Política de privacidade</a><small class="tos-required-hint">Obrigatório para continuar</small>', de: 'Ich habe die <a href="../privacy/tos.html" target="_blank" rel="noopener noreferrer">Nutzungsbedingungen</a> und die <a href="../privacy/privacy.html" target="_blank" rel="noopener noreferrer">Datenschutzrichtlinie</a> gelesen und akzeptiert<small class="tos-required-hint">Erforderlich zum Fortfahren</small>', fr: "J'ai lu et accepté les <a href=\"../privacy/tos.html\" target=\"_blank\" rel=\"noopener noreferrer\">Conditions d'utilisation</a> et la <a href=\"../privacy/privacy.html\" target=\"_blank\" rel=\"noopener noreferrer\">Politique de confidentialité</a><small class=\"tos-required-hint\">Obligatoire pour continuer</small>", it: "Ho letto e accetto i <a href=\"../privacy/tos.html\" target=\"_blank\" rel=\"noopener noreferrer\">Termini di utilizzo</a> e l'<a href=\"../privacy/privacy.html\" target=\"_blank\" rel=\"noopener noreferrer\">Informativa sulla privacy</a><small class=\"tos-required-hint\">Obbligatorio per continuare</small>", ja: "<a href=\"../privacy/tos.html\" target=\"_blank\" rel=\"noopener noreferrer\">利用規約</a>と<a href=\"../privacy/privacy.html\" target=\"_blank\" rel=\"noopener noreferrer\">プライバシーポリシー</a>を読み、同意しました<small class=\"tos-required-hint\">続行するには必須</small>" },
  ob_affiliate_check_label: { en: "Allow MUGA's affiliate tag on links that have none",                     es: "Permitir el tag de afiliado de MUGA en enlaces que no tengan ninguno",                     pt: "Permitir a tag de afiliado do MUGA em links que não têm nenhuma",                     de: "MUGAs Affiliate-Tag bei Links ohne Tag erlauben", fr: "Autoriser le tag d'affiliation de MUGA sur les liens qui n'en ont aucun", it: "Permetti il tag di affiliazione di MUGA sui link che non ne hanno", ja: "アフィリエイトタグがないリンクでMUGAのタグを許可" },
  ob_affiliate_check_hint:  { en: "Same price, always. If a link already has a tag, MUGA never touches it. Verify in our source code.", es: "Mismo precio, siempre. Si un enlace ya tiene un tag, MUGA nunca lo toca. Compru\u00e9balo en nuestro c\u00f3digo fuente.", pt: "Mesmo preço, sempre. Se um link já tem uma tag, MUGA nunca a toca. Verifique no nosso código-fonte.", de: "Immer derselbe Preis. Wenn ein Link bereits ein Tag hat, berührt MUGA es nie. Im Quellcode überprüfbar.", fr: "Même prix, toujours. Si un lien a déjà un tag, MUGA n'y touche jamais. Vérifiez dans notre code source.", it: "Stesso prezzo, sempre. Se un link ha già un tag, MUGA non lo tocca mai. Verifica nel nostro codice sorgente.", ja: "価格は常に同じです。リンクにすでにタグがある場合、MUGAは一切触れません。ソースコードで確認してください。" },
  ob_cta_btn:               { en: "Turn the noise off",                                                   es: "Apagar el ruido",                                                   pt: "Desligar o ruído",                                                   de: "Den Lärm abdrehen", fr: "Couper le bruit", it: "Spegni il rumore", ja: "ノイズを消す" },
  ob_cta_gated_msg:         { en: "Accept the Terms of use and Privacy policy below to continue.",          es: "Acepta los Términos de uso y la Política de privacidad para continuar.",     pt: "Aceite os Termos de uso e a Política de privacidade para continuar.",       de: "Akzeptiere unten die Nutzungsbedingungen und die Datenschutzrichtlinie, um fortzufahren.", fr: "Acceptez les Conditions d'utilisation et la Politique de confidentialité ci-dessous pour continuer.", it: "Accetta i Termini di utilizzo e l'Informativa sulla privacy qui sotto per continuare.", ja: "続行するには、下記の利用規約とプライバシーポリシーに同意してください。" },

  // ── Per-device confirmation prompts (#364) ───────────────────────────────
  ob_synced_from_other_device: { en: "This setting was enabled on another device. Confirm it for this device, or uncheck to keep it off here.", es: "Este ajuste fue activado en otro dispositivo. Confírmalo para este dispositivo o desmarca la casilla para mantenerlo desactivado aquí.", pt: "Esta configuração foi ativada em outro dispositivo. Confirme-a para este dispositivo ou desmarque para mantê-la desativada aqui.", de: "Diese Einstellung wurde auf einem anderen Gerät aktiviert. Bestätige sie für dieses Gerät oder hebe die Auswahl auf, um sie hier deaktiviert zu lassen.", fr: "Ce paramètre a été activé sur un autre appareil. Confirmez-le pour cet appareil, ou décochez pour le laisser désactivé ici.", it: "Questa impostazione è stata attivata su un altro dispositivo. Confermala per questo dispositivo, oppure deseleziona per tenerla disattivata qui.", ja: "この設定は別のデバイスで有効になりました。このデバイスでも確認するか、ここではオフのままにするにはチェックを外してください。" },
  ob_remote_rules_title:    { en: "Remote rule updates",                                                     es: "Actualizaciones remotas de reglas",                                                     pt: "Atualizações remotas de regras",                                                     de: "Remote-Regelaktualisierungen", fr: "Mises à jour de règles à distance", it: "Aggiornamenti remoti delle regole", ja: "ルールのリモート更新" },
  ob_remote_rules_desc:     { en: "Your other device has remote rule updates enabled. With this on, MUGA performs a weekly fetch of a signed tracking-param list from a public GitHub Pages endpoint to keep your protection fresh. No user data is sent.", es: "Tu otro dispositivo tiene activadas las actualizaciones remotas de reglas. Con esto activo, MUGA hace una descarga semanal de una lista firmada de parámetros de rastreo desde un endpoint público de GitHub Pages para mantener tu protección al día. No se envían datos del usuario.", pt: "Seu outro dispositivo tem as atualizações remotas de regras ativadas. Com isto ligado, MUGA faz um download semanal de uma lista assinada de parâmetros de rastreamento de um endpoint público do GitHub Pages para manter sua proteção atualizada. Nenhum dado do usuário é enviado.", de: "Dein anderes Gerät hat Remote-Regelaktualisierungen aktiviert. Wenn aktiviert, lädt MUGA einmal pro Woche eine signierte Tracking-Parameter-Liste von einem öffentlichen GitHub-Pages-Endpunkt, um deinen Schutz aktuell zu halten. Es werden keine Nutzerdaten gesendet.", fr: "Votre autre appareil a les mises à jour de règles à distance activées. Avec cette option, MUGA effectue une récupération hebdomadaire d'une liste signée de paramètres de pistage depuis un endpoint GitHub Pages public pour garder votre protection à jour. Aucune donnée utilisateur n'est envoyée.", it: "L'altro tuo dispositivo ha gli aggiornamenti remoti delle regole attivati. Con questa opzione, MUGA scarica settimanalmente un elenco firmato di parametri di tracciamento da un endpoint pubblico di GitHub Pages per mantenere aggiornata la protezione. Nessun dato utente viene inviato.", ja: "他のデバイスでルールのリモート更新が有効になっています。これを有効にすると、MUGAは公開GitHub Pagesエンドポイントから署名済みのトラッキングパラメータリストを週次取得して保護を最新に保ちます。ユーザーデータは送信されません。" },
  ob_remote_rules_check_label: { en: "Enable remote rule updates on this device",                            es: "Activar actualizaciones remotas de reglas en este dispositivo",                            pt: "Ativar atualizações remotas de regras neste dispositivo",                            de: "Remote-Regelaktualisierungen auf diesem Gerät aktivieren", fr: "Activer les mises à jour de règles à distance sur cet appareil", it: "Attiva gli aggiornamenti remoti delle regole su questo dispositivo", ja: "このデバイスでルールのリモート更新を有効にする" },

  // ── Re-onboard banners (#370) — first-draft copy, review before merge ────
  ob_reonboard_delta_title: { en: "A few terms have been added since you last accepted",                       es: "Se han añadido algunas cláusulas desde la última vez que aceptaste",                       pt: "Algumas cláusulas foram adicionadas desde sua última aceitação",                       de: "Seit deiner letzten Zustimmung wurden einige Klauseln ergänzt", fr: "Quelques clauses ont été ajoutées depuis votre dernière acceptation", it: "Alcune clausole sono state aggiunte dall'ultima volta che hai accettato", ja: "前回の同意以降、いくつかの条項が追加されました" },
  ob_reonboard_delta_desc:  { en: "Your existing acceptance still applies. Review the new clauses below; accepting unlocks the new behaviours, declining keeps MUGA running under your previously accepted terms.", es: "Tu aceptación previa sigue siendo válida. Revisá las cláusulas nuevas abajo; aceptar habilita los nuevos comportamientos, rechazar mantiene MUGA funcionando bajo los términos que ya habías aceptado.", pt: "Sua aceitação anterior continua válida. Revise as novas cláusulas abaixo; aceitar habilita os novos comportamentos, recusar mantém o MUGA funcionando sob os termos previamente aceitos.", de: "Deine bisherige Zustimmung gilt weiterhin. Überprüfe die neuen Klauseln unten; akzeptieren schaltet die neuen Verhaltensweisen frei, ablehnen lässt MUGA unter den zuvor akzeptierten Bedingungen weiterlaufen.", fr: "Votre acceptation existante reste valable. Examinez les nouvelles clauses ci-dessous ; accepter active les nouveaux comportements, refuser laisse MUGA fonctionner selon les conditions précédemment acceptées.", it: "La tua accettazione esistente è ancora valida. Esamina le nuove clausole qui sotto; accettare attiva i nuovi comportamenti, rifiutare mantiene MUGA in esecuzione secondo i termini accettati in precedenza.", ja: "既存の同意は引き続き有効です。下記の新しい条項を確認してください。同意すると新しい動作が有効になり、拒否すると以前同意した条件のままMUGAが動作し続けます。" },
  ob_reonboard_material_title: { en: "Important: terms have changed materially",                              es: "Importante: los términos cambiaron sustancialmente",                              pt: "Importante: os termos mudaram de forma substancial",                              de: "Wichtig: die Nutzungsbedingungen haben sich wesentlich geändert", fr: "Important : les conditions ont changé de manière substantielle", it: "Importante: i termini sono cambiati in modo sostanziale", ja: "重要: 利用規約が実質的に変更されました" },
  ob_reonboard_material_desc:  { en: "MUGA's terms have been updated in a way that affects what you previously agreed to. Continued use of the extension requires accepting the new terms. Please review the linked Terms of Use and Privacy Policy below.", es: "Los términos de MUGA se actualizaron de una manera que afecta lo que aceptaste antes. El uso continuado de la extensión requiere aceptar los nuevos términos. Revisá los Términos de uso y la Política de privacidad enlazados abajo.", pt: "Os termos do MUGA foram atualizados de forma que afeta o que você aceitou anteriormente. O uso contínuo da extensão exige aceitar os novos termos. Revise os Termos de uso e a Política de privacidade vinculados abaixo.", de: "MUGAs Nutzungsbedingungen wurden in einer Weise aktualisiert, die deine bisherige Zustimmung berührt. Die weitere Nutzung der Erweiterung erfordert die Annahme der neuen Bedingungen. Bitte überprüfe die unten verlinkten Nutzungsbedingungen und Datenschutzrichtlinien.", fr: "Les conditions de MUGA ont été mises à jour d'une manière qui affecte ce que vous avez accepté précédemment. L'utilisation continue de l'extension nécessite l'acceptation des nouvelles conditions. Veuillez consulter les Conditions d'utilisation et la Politique de confidentialité ci-dessous.", it: "I termini di MUGA sono stati aggiornati in modo che incide su quanto hai accettato in precedenza. L'uso continuato dell'estensione richiede l'accettazione dei nuovi termini. Esamina i Termini di utilizzo e l'Informativa sulla privacy collegati qui sotto.", ja: "MUGAの利用規約が、以前同意した内容に影響する形で更新されました。拡張機能を引き続き使用するには新しい規約への同意が必要です。下記にリンクされた利用規約とプライバシーポリシーをご確認ください。" },

  // ── Migration banner (#369) — first-draft button copy, review before merge
  migration_accept:   { en: "Enable",                                                                          es: "Activar",                                                                          pt: "Ativar",                                                                          de: "Aktivieren", fr: "Activer", it: "Attiva", ja: "有効にする" },
  migration_decline:  { en: "No thanks",                                                                       es: "No, gracias",                                                                       pt: "Não, obrigado",                                                                     de: "Nein, danke", fr: "Non merci", it: "No, grazie", ja: "結構です" },
  migration_counter:  { en: "{n} of {total}",                                                                  es: "{n} de {total}",                                                                  pt: "{n} de {total}",                                                                    de: "{n} von {total}", fr: "{n} sur {total}", it: "{n} di {total}", ja: "{total}件中{n}件" },  ob_browser_sync_note: {
    en: "MUGA never sends data anywhere. If you have browser sync enabled, your preferences sync through the browser (Google for Chrome, Firefox Accounts for Firefox) — that's a browser feature, not MUGA.",
    es: "MUGA nunca envía datos a ningún lado. Si tenés activada la sincronización del navegador, tus preferencias se sincronizan a través del navegador (Google para Chrome, Cuentas Firefox para Firefox) — es una función del navegador, no de MUGA.",
    pt: "MUGA nunca envia dados para lugar nenhum. Se você tem a sincronização do navegador ativada, suas preferências sincronizam através do navegador (Google para Chrome, Contas Firefox para Firefox) — é um recurso do navegador, não do MUGA.",
    de: "MUGA sendet niemals Daten irgendwohin. Wenn du die Browser-Synchronisierung aktiviert hast, werden deine Einstellungen über den Browser synchronisiert (Google bei Chrome, Firefox-Konten bei Firefox) — das ist eine Browser-Funktion, nicht MUGA.",
    fr: "MUGA n'envoie jamais de données où que ce soit. Si la synchronisation du navigateur est activée, vos préférences sont synchronisées par le navigateur (Google pour Chrome, Comptes Firefox pour Firefox) — c'est une fonctionnalité du navigateur, pas de MUGA.",
    it: "MUGA non invia mai dati da nessuna parte. Se hai la sincronizzazione del browser attiva, le tue preferenze vengono sincronizzate tramite il browser (Google per Chrome, Account Firefox per Firefox) — è una funzione del browser, non di MUGA.",
    ja: "MUGAはデータをどこにも送信しません。ブラウザ同期が有効な場合、設定はブラウザ経由で同期されます（Chromeの場合はGoogle、Firefoxの場合はFirefoxアカウント）— これはブラウザの機能であってMUGAの機能ではありません。",
  },
  ob_cta_note:              { en: "Change any setting anytime.",                                            es: "Cambia cualquier ajuste cuando quieras.",                                  pt: "Altere qualquer configuração quando quiser.",                              de: "Jede Einstellung jederzeit änderbar.", fr: "Modifiez n'importe quel paramètre à tout moment.", it: "Cambia qualsiasi impostazione in qualsiasi momento.", ja: "いつでも設定を変更できます。" },
  // ── URL Unwrapper (#658 — 2.1 denoise pivot; formerly Privacy Proxy) ──────
  // UI copy for the URL Unwrapper toggle section in Options. Under 2.1 the
  // feature scope is reduced: only generic shorteners (bit.ly, tinyurl, etc.)
  // are resolved server-side. Affiliate-network redirects pass through to
  // honor creator attribution. Pref key (`privacyProxyEnabled`) and storage
  // shape are intentionally NOT renamed (storage compat). The i18n key names
  // stay too — only the user-facing strings change.
  // EN/ES: locked copy per product spec. PT/DE: AI-assisted; native-speaker review welcome.
  privacy_proxy_enabled: {
    en: 'Enable URL Unwrapper',
    es: 'Activar Desempaquetador de URL',
    pt: 'Ativar Desempacotador de URL',
    de: 'URL Unwrapper aktivieren',
    fr: "Activer URL Unwrapper",
    it: "Attiva URL Unwrapper",
    ja: "URL Unwrapperを有効にする",
  },
  mode_strict_local: {
    en: 'Strict Local',
    es: 'Estricto Local',
    pt: 'Estrito Local',
    de: 'Strikt lokal',
    fr: "Local strict",
    it: "Locale rigoroso",
    ja: "厳格ローカル",
  },
  mode_honor_creator: {
    en: 'Honor Creator',
    es: 'Respetar Creador',
    pt: 'Honrar Criador',
    de: 'Creator respektieren',
    fr: "Honorer le créateur",
    it: "Onora il creator",
    ja: "クリエイター尊重",
  },
  mode_privacy_proxy: {
    en: 'URL Unwrapper',
    es: 'Desempaquetador de URL',
    pt: 'Desempacotador de URL',
    de: 'URL Unwrapper',
    fr: "URL Unwrapper",
    it: "URL Unwrapper",
    ja: "URL Unwrapper",
  },
  mode_honor_plus_proxy: {
    en: 'Honor + Unwrap',
    es: 'Respetar + Desempaquetar',
    pt: 'Honrar + Desempacotar',
    de: 'Respektieren + Unwrap',
    fr: "Honorer + Unwrap",
    it: "Onora + Unwrap",
    ja: "尊重 + Unwrap",
  },
  privacy_proxy_disclosure: {
    en: 'When URL Unwrapper is enabled, the full URL of generic shortener links (bit.ly, tinyurl.com, t.co, and similar) is sent to unwrap.muga.app — a Cloudflare Worker operated by MUGA — to retrieve the final destination. Affiliate-network redirect links (Awin, CJ, Impact, Partnerize, and others) are NEVER sent: they pass through unchanged so the creator who shared the link still earns their commission. Every response is verified with an Ed25519 digital signature before your browser navigates anywhere; a tampered response is rejected entirely. No browsing history is stored by the Worker. You can disable this feature at any time by toggling this switch off.',
    es: 'Cuando el Desempaquetador de URL está activado, la URL completa de los acortadores genéricos (bit.ly, tinyurl.com, t.co y similares) se envía a unwrap.muga.app — un Worker de Cloudflare operado por MUGA — para obtener el destino final. Los enlaces de redes de afiliados (Awin, CJ, Impact, Partnerize y otros) NUNCA se envían: pasan sin cambios para que el creador que compartió el enlace siga ganando su comisión. Cada respuesta se verifica con una firma digital Ed25519 antes de que el navegador abra cualquier página; una respuesta alterada se rechaza por completo. El Worker no almacena historial de navegación. Puedes desactivar esta función en cualquier momento usando este interruptor.',
    pt: 'Quando o Desempacotador de URL está ativado, a URL completa de encurtadores genéricos (bit.ly, tinyurl.com, t.co e similares) é enviada para unwrap.muga.app — um Worker da Cloudflare operado pelo MUGA — para obter o destino final. Links de redes de afiliados (Awin, CJ, Impact, Partnerize e outros) NUNCA são enviados: passam sem alteração para que o criador que compartilhou o link continue ganhando sua comissão. Toda resposta é verificada com uma assinatura digital Ed25519 antes de o navegador navegar para qualquer lugar; uma resposta adulterada é totalmente rejeitada. Nenhum histórico de navegação é armazenado pelo Worker. Você pode desativar este recurso a qualquer momento usando este interruptor.',
    de: 'Wenn URL Unwrapper aktiviert ist, wird die vollständige URL generischer Kurz-URLs (bit.ly, tinyurl.com, t.co und ähnliche) an unwrap.muga.app gesendet — einen von MUGA betriebenen Cloudflare Worker — um das endgültige Ziel zu ermitteln. Affiliate-Netzwerk-Weiterleitungen (Awin, CJ, Impact, Partnerize und andere) werden NIEMALS gesendet: Sie werden unverändert weitergeleitet, damit der Creator, der den Link geteilt hat, seine Provision weiterhin verdient. Jede Antwort wird vor jeglicher Navigation mit einer digitalen Ed25519-Signatur überprüft; eine manipulierte Antwort wird vollständig abgelehnt. Der Worker speichert keinen Browserverlauf. Du kannst diese Funktion jederzeit über diesen Schalter deaktivieren.',
    fr: "Lorsque URL Unwrapper est activé, l'URL complète des raccourcisseurs génériques (bit.ly, tinyurl.com, t.co et similaires) est envoyée à unwrap.muga.app — un Cloudflare Worker exploité par MUGA — pour récupérer la destination finale. Les liens de redirection des réseaux d'affiliation (Awin, CJ, Impact, Partnerize et autres) ne sont JAMAIS envoyés : ils passent inchangés afin que le créateur qui a partagé le lien continue de toucher sa commission. Chaque réponse est vérifiée par une signature numérique Ed25519 avant que votre navigateur ne navigue où que ce soit ; une réponse altérée est entièrement rejetée. Aucun historique de navigation n'est stocké par le Worker. Vous pouvez désactiver cette fonctionnalité à tout moment en désactivant cet interrupteur.",
    it: "Quando URL Unwrapper è attivo, l'URL completo degli abbreviatori generici (bit.ly, tinyurl.com, t.co e simili) viene inviato a unwrap.muga.app — un Cloudflare Worker gestito da MUGA — per recuperare la destinazione finale. I link di reindirizzamento delle reti di affiliazione (Awin, CJ, Impact, Partnerize e altri) NON vengono MAI inviati: passano invariati in modo che il creator che ha condiviso il link continui a guadagnare la sua commissione. Ogni risposta viene verificata con una firma digitale Ed25519 prima che il browser navighi ovunque; una risposta manomessa viene respinta interamente. Nessuna cronologia di navigazione viene memorizzata dal Worker. Puoi disattivare questa funzione in qualsiasi momento disattivando questo interruttore.",
    ja: "URL Unwrapperが有効になっている場合、汎用短縮URL (bit.ly、tinyurl.com、t.coなど) の完全なURLが unwrap.muga.app — MUGAが運営するCloudflare Worker — に送信され、最終的な宛先を取得します。アフィリエイトネットワークのリダイレクトリンク (Awin、CJ、Impact、Partnerizeなど) は決して送信されません: リンクを共有したクリエイターがコミッションを獲得し続けられるよう、変更されずに通過します。各レスポンスはブラウザがどこかに移動する前にEd25519デジタル署名で検証されます。改ざんされたレスポンスは完全に拒否されます。閲覧履歴はWorkerに保存されません。このスイッチをオフにすることでこの機能をいつでも無効にできます。",
  },
  enable_privacy_proxy_cta: {
    en: 'Enable URL Unwrapper',
    es: 'Activar Desempaquetador de URL',
    pt: 'Ativar Desempacotador de URL',
    de: 'URL Unwrapper aktivieren',
    fr: "Activer URL Unwrapper",
    it: "Attiva URL Unwrapper",
    ja: "URL Unwrapperを有効にする",
  },
  privacy_proxy_hash_label: {
    en: 'Worker build hash',
    es: 'Hash de build del Worker',
    pt: 'Hash do build do Worker',
    de: 'Worker-Build-Hash',
    fr: "Hash de build du Worker",
    it: "Hash di build del Worker",
    ja: "Workerビルドハッシュ",
  },
  privacy_proxy_last_verified: {
    en: 'Last verified',
    es: 'Última verificación',
    pt: 'Última verificação',
    de: 'Zuletzt verifiziert',
    fr: "Dernière vérification",
    it: "Ultima verifica",
    ja: "最終検証",
  },
  privacy_proxy_verify_link: {
    en: 'Verify',
    es: 'Verificar',
    pt: 'Verificar',
    de: 'Verifizieren',
    fr: "Vérifier",
    it: "Verifica",
    ja: "検証",
  },
  // B20 (#453): shown as a toast when the Worker returns a permission error
  // and the feature is auto-disabled after revocation.
  proxy_auto_disabled: {
    en: 'URL Unwrapper auto-disabled: permission was revoked.',
    es: 'Desempaquetador de URL desactivado automáticamente: el permiso fue revocado.',
    pt: 'Desempacotador de URL desativado automaticamente: a permissão foi revogada.',
    de: 'URL Unwrapper automatisch deaktiviert: Berechtigung wurde widerrufen.',
    fr: "URL Unwrapper désactivé automatiquement : l'autorisation a été révoquée.",
    it: "URL Unwrapper disattivato automaticamente: il permesso è stato revocato.",
    ja: "URL Unwrapperを自動的に無効化しました: 権限が取り消されました。",
  },

  // ── Relative time strings (#453, B20 Group A) ─────────────────────────────
  // Used by formatRelativeTime() in src/lib/relative-time.js (and the
  // build-hash cluster in options.js). Parameterized strings use the %s
  // placeholder convention — replaced at call site via .replace("%s", n).
  time_just_now: {
    en: 'just now',
    es: 'hace un momento',
    pt: 'agora mesmo',
    de: 'gerade eben',
    fr: "à l'instant",
    it: "proprio ora",
    ja: "たった今",
  },
  time_minutes_ago: {
    en: '%s minutes ago',
    es: 'hace %s minutos',
    pt: 'há %s minutos',
    de: 'vor %s Minuten',
    fr: "il y a %s minutes",
    it: "%s minuti fa",
    ja: "%s分前",
  },
  time_hours_ago: {
    en: '%s hours ago',
    es: 'hace %s horas',
    pt: 'há %s horas',
    de: 'vor %s Stunden',
    fr: "il y a %s heures",
    it: "%s ore fa",
    ja: "%s時間前",
  },
  time_yesterday: {
    en: 'yesterday',
    es: 'ayer',
    pt: 'ontem',
    de: 'gestern',
    fr: "hier",
    it: "ieri",
    ja: "昨日",
  },
  time_days_ago: {
    en: '%s days ago',
    es: 'hace %s días',
    pt: 'há %s dias',
    de: 'vor %s Tagen',
    fr: "il y a %s jours",
    it: "%s giorni fa",
    ja: "%s日前",
  },

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
