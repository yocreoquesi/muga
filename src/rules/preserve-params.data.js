// muga rule artifact: params some host explicitly preserves (#1221).
// DO NOT EDIT BY HAND. Derived from src/rules/domain-rules.json by
// `npm run compile:rules`; CI re-runs it and diffs src/rules/.
//
// A name in here must never be published to the GLOBAL remote channel: that
// channel cannot express a host scope, so publishing one strips it on the very
// hosts that declared they need it — #1212's failure class, reached through the
// signed payload instead of through ingestion.
export const PRESERVED_PARAMS = [
  "_fcid",
  "_ipg",
  "_nkw",
  "_pgn",
  "_sacat",
  "_sop",
  "ab_channel",
  "action",
  "adj_t",
  "adultos",
  "adults",
  "after",
  "altersgruppe",
  "app",
  "applyshoesizefilter",
  "articleid",
  "as_q",
  "as_sdt",
  "as_sitesearch",
  "as_yhi",
  "as_ylo",
  "at",
  "attr_values",
  "auth",
  "b",
  "bct",
  "before",
  "beginindex",
  "bkcat",
  "brand",
  "brands",
  "bs",
  "cabinclass",
  "cat_id",
  "cate",
  "catecd",
  "category",
  "category_id",
  "category_no",
  "categoryid",
  "catid",
  "checkin",
  "checkout",
  "children",
  "cid",
  "cites",
  "cluster",
  "color",
  "context",
  "count",
  "ctgid",
  "ctgrno",
  "cuid",
  "curator_clanid",
  "curid",
  "currency",
  "d",
  "da",
  "daddr",
  "data",
  "date",
  "departmentid",
  "dest_id",
  "dest_type",
  "destination",
  "destino",
  "diff",
  "dirflg",
  "domain",
  "e",
  "ei",
  "erid",
  "eventtype",
  "f",
  "f_c",
  "f_e",
  "f_jt",
  "f_tpr",
  "f.product.brandname",
  "f.range.derived.variant.discount",
  "f.range.product.averageoverallrating",
  "facetselected",
  "farbe",
  "fechaida",
  "fechavuelta",
  "field-keywords",
  "filtercat",
  "filters",
  "filtertype",
  "first",
  "flow",
  "form",
  "fp",
  "fr",
  "fr2",
  "from",
  "fromage",
  "ftid",
  "fundingsource",
  "gdno",
  "geoid",
  "gl",
  "go",
  "goodscode",
  "group_adults",
  "group_children",
  "groupsort",
  "habitaciones",
  "hl",
  "home",
  "i",
  "ia",
  "iax",
  "iaxm",
  "id",
  "ie",
  "index",
  "infants",
  "intent",
  "interval",
  "intl",
  "isnodeid",
  "itemno",
  "jbv",
  "jovenes",
  "jt",
  "k",
  "ka",
  "kac",
  "kad",
  "kaf",
  "kb",
  "kd",
  "keyword",
  "keywords",
  "kf",
  "kg",
  "kh",
  "kl",
  "km",
  "kn",
  "ko",
  "kp",
  "kr",
  "ks",
  "kt",
  "kv",
  "kw",
  "kwd",
  "kz",
  "l",
  "laenge",
  "lang",
  "layer",
  "lc",
  "lh_auction",
  "lh_bin",
  "limit",
  "list",
  "listing",
  "ll",
  "localidad",
  "location",
  "lr",
  "ls",
  "max",
  "max_price",
  "maxprice",
  "maxrooms",
  "maxsurface",
  "mayores",
  "me",
  "mejores_ofertas",
  "merchant",
  "metros",
  "min",
  "min_price",
  "minprice",
  "minrooms",
  "minsurface",
  "mo",
  "mt",
  "n",
  "nao",
  "navigationitemid",
  "nd",
  "nflt",
  "nfpr",
  "ninos",
  "nkw",
  "no",
  "no_rooms",
  "node",
  "nso",
  "num",
  "nv_mid",
  "o",
  "ob",
  "oldid",
  "oldrev",
  "oly_enc_id",
  "ordenado-por",
  "order",
  "orderby",
  "origen",
  "origin",
  "os",
  "outbounddate",
  "p",
  "page",
  "page_num",
  "page_size",
  "pagenum",
  "pageroffset",
  "pagesize",
  "pagetype",
  "pagina",
  "pagingindex",
  "pagingsize",
  "pb",
  "per_page",
  "period",
  "picktype",
  "pq",
  "prdcd",
  "prdno",
  "precio",
  "preselect",
  "price_from",
  "price_max",
  "price_min",
  "price_to",
  "productid",
  "pz",
  "q",
  "qs",
  "qt",
  "query",
  "radius",
  "rating",
  "redirect",
  "ref",
  "ref_",
  "region",
  "returndate",
  "rev",
  "rh",
  "rocketall",
  "rooms",
  "rqlang",
  "rs",
  "rsp",
  "rsv_iqid",
  "rsv_spt",
  "rt",
  "s",
  "s_keyword",
  "s_type",
  "saddr",
  "safe",
  "salary",
  "sc",
  "scisbd",
  "se",
  "search",
  "search_key",
  "search_pos",
  "search_query",
  "search_type",
  "search_value",
  "searchquery",
  "searchtext",
  "searchtype",
  "section",
  "seqid",
  "set",
  "ship_to",
  "shipcountry",
  "shopid",
  "size",
  "sk",
  "sku",
  "sl",
  "sll",
  "sort",
  "sort_type",
  "sortby",
  "sorted_type",
  "sorter",
  "sortiertnach",
  "sorting",
  "sorttype",
  "sp",
  "sr_detail",
  "src_tab_page_id",
  "srch",
  "ss",
  "sspn",
  "st",
  "start",
  "storetype",
  "story_fbid",
  "stype",
  "subcategory",
  "sword",
  "symbol",
  "t",
  "tab",
  "target",
  "taxonomy_id",
  "tbm",
  "tbs",
  "term",
  "text",
  "th",
  "theme",
  "tipo",
  "tipobusqueda",
  "title",
  "tl",
  "tn",
  "to",
  "token",
  "transactiontype",
  "triptype",
  "ttype",
  "type",
  "utf8",
  "utm_campaign",
  "utm_content",
  "utm_medium",
  "utm_referrer",
  "utm_source",
  "utm_term",
  "v",
  "view",
  "viewtype",
  "w",
  "wd",
  "where",
  "within",
  "z"
];

// Per-host view of the same data (#1221 slice 1). The union above answers
// "may this name be published GLOBALLY"; a host-SCOPED fact needs the
// narrower question "does THIS host preserve it", because the whole point of
// a scoped payload is that one name can be a tracker on one host and
// load-bearing on another. Checking a scoped fact against the union would
// reinstate exactly the flat model the scope exists to escape.
export const PRESERVED_BY_HOST = {
  "11st.co.kr": [
    "ctgrno",
    "keyword",
    "kwd",
    "page",
    "prdno",
    "sort"
  ],
  "20minutos.es": [
    "q"
  ],
  "29cm.co.kr": [
    "keyword"
  ],
  "adj.st": [
    "adj_t"
  ],
  "aladin.co.kr": [
    "cid",
    "date",
    "search",
    "start",
    "type"
  ],
  "aliexpress.com": [
    "catid",
    "filtercat",
    "groupsort",
    "maxprice",
    "minprice",
    "page",
    "searchtext",
    "shipcountry",
    "sorttype"
  ],
  "alternate.de": [
    "articleid",
    "id",
    "listing",
    "q"
  ],
  "amazon.ca": [
    "field-keywords",
    "i",
    "k",
    "keywords",
    "me",
    "merchant",
    "n",
    "node",
    "page",
    "rh",
    "s",
    "th"
  ],
  "amazon.co.jp": [
    "field-keywords",
    "i",
    "k",
    "keywords",
    "me",
    "merchant",
    "n",
    "node",
    "page",
    "rh",
    "s",
    "th"
  ],
  "amazon.co.uk": [
    "field-keywords",
    "i",
    "k",
    "keywords",
    "me",
    "merchant",
    "n",
    "node",
    "page",
    "rh",
    "s",
    "th"
  ],
  "amazon.com": [
    "field-keywords",
    "i",
    "k",
    "keywords",
    "me",
    "merchant",
    "n",
    "node",
    "page",
    "rh",
    "s",
    "th"
  ],
  "amazon.com.au": [
    "field-keywords",
    "i",
    "k",
    "keywords",
    "me",
    "merchant",
    "n",
    "node",
    "page",
    "rh",
    "s",
    "th"
  ],
  "amazon.com.br": [
    "field-keywords",
    "i",
    "k",
    "keywords",
    "me",
    "merchant",
    "n",
    "node",
    "page",
    "rh",
    "s",
    "th"
  ],
  "amazon.com.mx": [
    "field-keywords",
    "i",
    "k",
    "keywords",
    "me",
    "merchant",
    "n",
    "node",
    "page",
    "rh",
    "s",
    "th"
  ],
  "amazon.de": [
    "field-keywords",
    "i",
    "k",
    "keywords",
    "me",
    "merchant",
    "n",
    "node",
    "page",
    "rh",
    "s",
    "th"
  ],
  "amazon.es": [
    "field-keywords",
    "i",
    "k",
    "keywords",
    "me",
    "merchant",
    "n",
    "node",
    "page",
    "rh",
    "s",
    "th"
  ],
  "amazon.fr": [
    "field-keywords",
    "i",
    "k",
    "keywords",
    "me",
    "merchant",
    "n",
    "node",
    "page",
    "rh",
    "s",
    "th"
  ],
  "amazon.in": [
    "field-keywords",
    "i",
    "k",
    "keywords",
    "me",
    "merchant",
    "n",
    "node",
    "page",
    "rh",
    "s",
    "th"
  ],
  "amazon.it": [
    "field-keywords",
    "i",
    "k",
    "keywords",
    "me",
    "merchant",
    "n",
    "node",
    "page",
    "rh",
    "s",
    "th"
  ],
  "amazon.nl": [
    "field-keywords",
    "i",
    "k",
    "keywords",
    "me",
    "merchant",
    "n",
    "node",
    "page",
    "rh",
    "s",
    "th"
  ],
  "amazon.pl": [
    "field-keywords",
    "i",
    "k",
    "keywords",
    "me",
    "merchant",
    "n",
    "node",
    "page",
    "rh",
    "s",
    "th"
  ],
  "amazon.se": [
    "field-keywords",
    "i",
    "k",
    "keywords",
    "me",
    "merchant",
    "n",
    "node",
    "page",
    "rh",
    "s",
    "th"
  ],
  "amazon.sg": [
    "field-keywords",
    "i",
    "k",
    "keywords",
    "me",
    "merchant",
    "n",
    "node",
    "page",
    "rh",
    "s",
    "th"
  ],
  "americanas.com.br": [
    "page",
    "q",
    "sort"
  ],
  "apple.com": [
    "app",
    "at",
    "id",
    "l",
    "ls",
    "mt"
  ],
  "apps.apple.com": [
    "l",
    "ls",
    "mt"
  ],
  "as.com": [
    "q"
  ],
  "auction.co.kr": [
    "category",
    "gdno",
    "itemno",
    "keyword",
    "page",
    "sort"
  ],
  "baidu.com": [
    "bs",
    "f",
    "ie",
    "rqlang",
    "rsp",
    "rsv_iqid",
    "rsv_spt",
    "tn",
    "wd"
  ],
  "bbc.co.uk": [
    "page",
    "q",
    "seqid"
  ],
  "bbc.com": [
    "page",
    "q",
    "seqid"
  ],
  "bestbuy.com": [
    "id",
    "intl",
    "page",
    "q"
  ],
  "bhphotovideo.com": [
    "q"
  ],
  "bilibili.com": [
    "p",
    "t"
  ],
  "bing.com": [
    "first",
    "form",
    "pq",
    "q",
    "qs",
    "sc",
    "sk",
    "sp"
  ],
  "bloomberg.com": [
    "q"
  ],
  "bonprix.de": [
    "navigationitemid",
    "query",
    "shopid",
    "text"
  ],
  "booking.com": [
    "adults",
    "checkin",
    "checkout",
    "children",
    "currency",
    "dest_id",
    "dest_type",
    "group_adults",
    "group_children",
    "lang",
    "nflt",
    "no_rooms",
    "rooms",
    "ss"
  ],
  "canadacompanyregistry.com": [
    "utm_campaign"
  ],
  "carrefourpl.snrpage.com": [
    "utm_source"
  ],
  "cnbc.com": [
    "q"
  ],
  "cnn.com": [
    "q"
  ],
  "coolblue.nl": [
    "page",
    "q",
    "sort"
  ],
  "coppel.com": [
    "beginindex",
    "mejores_ofertas",
    "orderby",
    "search"
  ],
  "coupang.com": [
    "brand",
    "filtertype",
    "maxprice",
    "minprice",
    "page",
    "picktype",
    "q",
    "rating",
    "rocketall",
    "sorter"
  ],
  "cyberport.de": [
    "q"
  ],
  "dailymail.co.uk": [
    "q"
  ],
  "danawa.com": [
    "brand",
    "cate",
    "keyword",
    "maxprice",
    "minprice",
    "page",
    "prdcd",
    "q",
    "sort"
  ],
  "daum.net": [
    "da",
    "p",
    "page",
    "period",
    "q",
    "sort",
    "w"
  ],
  "dcinside.com": [
    "id",
    "no",
    "page",
    "s_keyword",
    "s_type",
    "search_pos"
  ],
  "deepl.com": [
    "sl",
    "text",
    "tl"
  ],
  "docmorris.de": [
    "category",
    "page",
    "query"
  ],
  "douglas.de": [
    "query"
  ],
  "duckduckgo.com": [
    "ia",
    "iax",
    "iaxm",
    "ka",
    "kac",
    "kad",
    "kaf",
    "kb",
    "kd",
    "kf",
    "kg",
    "kh",
    "kl",
    "km",
    "kn",
    "ko",
    "kp",
    "kr",
    "ks",
    "kt",
    "kv",
    "kw",
    "kz",
    "q",
    "t"
  ],
  "dzen.ru": [
    "text"
  ],
  "ebay.co.uk": [
    "_fcid",
    "_ipg",
    "_nkw",
    "_pgn",
    "_sacat",
    "_sop",
    "lh_auction",
    "lh_bin",
    "nkw",
    "rt"
  ],
  "ebay.com": [
    "_fcid",
    "_ipg",
    "_nkw",
    "_pgn",
    "_sacat",
    "_sop",
    "lh_auction",
    "lh_bin",
    "nkw",
    "rt"
  ],
  "ebay.de": [
    "_fcid",
    "_ipg",
    "_nkw",
    "_pgn",
    "_sacat",
    "_sop",
    "lh_auction",
    "lh_bin",
    "nkw",
    "rt"
  ],
  "ebay.es": [
    "_fcid",
    "_ipg",
    "_nkw",
    "_pgn",
    "_sacat",
    "_sop",
    "lh_auction",
    "lh_bin",
    "nkw",
    "rt"
  ],
  "ebay.fr": [
    "_fcid",
    "_ipg",
    "_nkw",
    "_pgn",
    "_sacat",
    "_sop",
    "lh_auction",
    "lh_bin",
    "nkw",
    "rt"
  ],
  "ebay.it": [
    "_fcid",
    "_ipg",
    "_nkw",
    "_pgn",
    "_sacat",
    "_sop",
    "lh_auction",
    "lh_bin",
    "nkw",
    "rt"
  ],
  "elcorteingles.es": [
    "brand",
    "category",
    "page",
    "q",
    "s",
    "sort"
  ],
  "elmundo.es": [
    "page",
    "q"
  ],
  "elpais.com": [
    "page",
    "q"
  ],
  "em.dynamicyield.com": [
    "cuid"
  ],
  "emart.com": [
    "keyword"
  ],
  "epicgames.com": [
    "count",
    "q",
    "sortby"
  ],
  "etsy.com": [
    "max",
    "min",
    "order",
    "page",
    "q",
    "search_type",
    "ship_to",
    "taxonomy_id"
  ],
  "exito.com": [
    "q"
  ],
  "facebook.com": [
    "filters",
    "id",
    "q",
    "set",
    "story_fbid",
    "type",
    "v"
  ],
  "falabella.com": [
    "f.product.brandname",
    "f.range.derived.variant.discount",
    "f.range.product.averageoverallrating",
    "facetselected",
    "pagetype",
    "q"
  ],
  "falabella.com.co": [
    "f.range.product.averageoverallrating",
    "q"
  ],
  "fandom.com": [
    "query",
    "search"
  ],
  "fb.com": [
    "filters",
    "id",
    "q",
    "story_fbid",
    "v"
  ],
  "fiverr.com": [
    "category_id",
    "page",
    "query"
  ],
  "flipkart.com": [
    "p",
    "page",
    "q",
    "sort"
  ],
  "fnac.com": [
    "mo",
    "se",
    "searchquery",
    "sl",
    "stype"
  ],
  "fnac.es": [
    "mo",
    "se",
    "searchquery",
    "sl",
    "stype"
  ],
  "forbes.ru": [
    "erid"
  ],
  "fotocasa.es": [
    "l",
    "maxprice",
    "maxrooms",
    "maxsurface",
    "minprice",
    "minrooms",
    "minsurface",
    "page",
    "transactiontype"
  ],
  "fravega.com": [
    "keyword"
  ],
  "gamestop.com": [
    "q"
  ],
  "gaugau.futabanet.jp": [
    "utm_content"
  ],
  "github.com": [
    "l",
    "o",
    "p",
    "q",
    "ref",
    "s",
    "search_value",
    "tab",
    "type",
    "utf8"
  ],
  "gitlab.com": [
    "page",
    "q",
    "ref",
    "sort",
    "tab",
    "type"
  ],
  "glavnoe.life": [
    "utm_campaign",
    "utm_content",
    "utm_medium",
    "utm_referrer",
    "utm_source",
    "utm_term"
  ],
  "gmarket.co.kr": [
    "category",
    "gdno",
    "goodscode",
    "keyword",
    "page",
    "sort"
  ],
  "google.com": [
    "as_q",
    "as_sitesearch",
    "cid",
    "gl",
    "hl",
    "nfpr",
    "num",
    "q",
    "safe",
    "start",
    "tbm",
    "tbs"
  ],
  "greenbuildingadvisor.com": [
    "oly_enc_id"
  ],
  "humblebundle.com": [
    "srch"
  ],
  "iberia.com": [
    "adults",
    "cabinclass",
    "children",
    "destination",
    "infants",
    "origin",
    "outbounddate",
    "returndate",
    "triptype"
  ],
  "idealista.com": [
    "habitaciones",
    "localidad",
    "metros",
    "ordenado-por",
    "order",
    "pagina",
    "precio",
    "tipo"
  ],
  "iforms.americanexpress.com": [
    "cuid"
  ],
  "imdb.com": [
    "q",
    "ref_"
  ],
  "immobilienscout24.de": [
    "pageroffset",
    "searchquery",
    "sorting"
  ],
  "indeed.com": [
    "fromage",
    "jt",
    "l",
    "q",
    "radius",
    "salary"
  ],
  "instagram.com": [
    "hl"
  ],
  "interpark.com": [
    "q"
  ],
  "jd.com": [
    "keyword"
  ],
  "kabum.com.br": [
    "pagina",
    "q"
  ],
  "kaufland.de": [
    "q"
  ],
  "kickstarter.com": [
    "category_id",
    "term"
  ],
  "kommersant.ru": [
    "erid"
  ],
  "kurly.com": [
    "page",
    "per_page",
    "sorted_type",
    "sword"
  ],
  "lenovo.com": [
    "page",
    "q",
    "sort"
  ],
  "lifehacker.ru": [
    "erid"
  ],
  "linkedin.com": [
    "f_c",
    "f_e",
    "f_jt",
    "f_tpr",
    "geoid",
    "keywords",
    "location",
    "pagenum",
    "sortby",
    "start"
  ],
  "liverpool.com.mx": [
    "s"
  ],
  "maps.google.com": [
    "cid",
    "daddr",
    "data",
    "dirflg",
    "ftid",
    "layer",
    "ll",
    "pb",
    "q",
    "saddr",
    "sll",
    "sspn",
    "ttype",
    "z"
  ],
  "marca.com": [
    "q"
  ],
  "mediamarkt.de": [
    "page",
    "pagesize",
    "query",
    "searchtype",
    "sort"
  ],
  "mediamarkt.es": [
    "page",
    "pagesize",
    "query",
    "searchtype",
    "sort"
  ],
  "meetup.com": [
    "categoryid",
    "eventtype",
    "location",
    "q"
  ],
  "mercadolibre.cl": [
    "q"
  ],
  "mercadolibre.com.ar": [
    "q"
  ],
  "mercadolibre.com.co": [
    "q"
  ],
  "mercadolibre.com.mx": [
    "q"
  ],
  "mercadolivre.com.br": [
    "q"
  ],
  "mercari.com": [
    "id",
    "keyword"
  ],
  "metabase.com": [
    "utm_term"
  ],
  "mootoon.co.kr": [
    "cuid"
  ],
  "msn.com": [
    "q"
  ],
  "musimundo.com": [
    "query"
  ],
  "musinsa.com": [
    "brand",
    "category",
    "category_no",
    "keyword",
    "page",
    "price_max",
    "price_min",
    "q",
    "sort"
  ],
  "namu.wiki": [
    "oldrev",
    "page",
    "q",
    "rev",
    "target"
  ],
  "naver.com": [
    "ie",
    "nso",
    "page",
    "period",
    "query",
    "sort",
    "start",
    "where"
  ],
  "netflix.com": [
    "jbv",
    "q"
  ],
  "newegg.com": [
    "d",
    "isnodeid",
    "keyword",
    "limit",
    "start",
    "storetype",
    "subcategory"
  ],
  "nike.com": [
    "q"
  ],
  "notebooksbilliger.de": [
    "q"
  ],
  "nytimes.com": [
    "query",
    "sort",
    "type"
  ],
  "office.com": [
    "auth",
    "from",
    "home"
  ],
  "oliveyoung.co.kr": [
    "brand",
    "catecd",
    "keyword",
    "page",
    "query",
    "sort"
  ],
  "open.spotify.com": [
    "context",
    "go",
    "nd",
    "theme"
  ],
  "otto.de": [
    "altersgruppe",
    "applyshoesizefilter",
    "farbe",
    "laenge",
    "q",
    "sku",
    "sortiertnach",
    "view"
  ],
  "palacio.mx": [
    "q"
  ],
  "paris.cl": [
    "page",
    "q",
    "sortby"
  ],
  "paypal.com": [
    "flow",
    "fundingsource",
    "intent",
    "token"
  ],
  "pccomponentes.com": [
    "brands",
    "category",
    "page",
    "price_max",
    "price_min",
    "q",
    "sort"
  ],
  "pinterest.com": [
    "page",
    "q",
    "rs"
  ],
  "play.google.com": [
    "gl",
    "hl",
    "id"
  ],
  "rd.bizrate.com": [
    "utm_campaign",
    "utm_medium"
  ],
  "reddit.app.link": [
    "utm_content"
  ],
  "reddit.com": [
    "after",
    "before",
    "context",
    "count",
    "limit",
    "q",
    "sort",
    "sr_detail",
    "t",
    "type"
  ],
  "redirects.tradedoubler.com": [
    "utm_campaign",
    "utm_content"
  ],
  "renfe.com": [
    "adultos",
    "destino",
    "fechaida",
    "fechavuelta",
    "jovenes",
    "mayores",
    "ninos",
    "origen",
    "tipobusqueda"
  ],
  "ripley.cl": [
    "q"
  ],
  "rtve.es": [
    "page",
    "q"
  ],
  "scholar.google.com": [
    "as_sdt",
    "as_yhi",
    "as_ylo",
    "cites",
    "cluster",
    "hl",
    "num",
    "q",
    "scisbd",
    "start"
  ],
  "sharepoint.com": [
    "cid",
    "e",
    "id"
  ],
  "shein.com": [
    "attr_values",
    "brand",
    "page",
    "q",
    "search_type",
    "sort",
    "src_tab_page_id"
  ],
  "shopee.com": [
    "keyword",
    "page"
  ],
  "shopping.naver.com": [
    "cat_id",
    "catid",
    "nv_mid",
    "pagingindex",
    "pagingsize",
    "productid",
    "query",
    "sort",
    "viewtype"
  ],
  "slickdeals.net": [
    "page",
    "q",
    "sort"
  ],
  "ssg.com": [
    "brand",
    "ctgid",
    "page",
    "q",
    "query",
    "sort"
  ],
  "stackoverflow.com": [
    "page",
    "pagesize",
    "q",
    "sort",
    "tab"
  ],
  "steampowered.com": [
    "curator_clanid"
  ],
  "target.com": [
    "category",
    "nao",
    "preselect",
    "q",
    "s",
    "sortby"
  ],
  "temu.com": [
    "page_num",
    "page_size",
    "search_key",
    "search_type",
    "sort_type"
  ],
  "thomann.de": [
    "departmentid",
    "q",
    "type"
  ],
  "tiktok.com": [
    "lang",
    "q",
    "region"
  ],
  "tistory.com": [
    "category",
    "page"
  ],
  "tmon.co.kr": [
    "keyword"
  ],
  "tokopedia.com": [
    "ob",
    "page",
    "q"
  ],
  "tradingview.com": [
    "interval",
    "symbol"
  ],
  "trendyol.com": [
    "os",
    "q",
    "qt",
    "st"
  ],
  "twitch.tv": [
    "query",
    "type"
  ],
  "twitter.com": [
    "f",
    "lang",
    "q"
  ],
  "ulta.com": [
    "search"
  ],
  "usprobioticguide.com": [
    "utm_campaign"
  ],
  "vercel.com": [
    "ref"
  ],
  "video-shoper.ru": [
    "utm_source"
  ],
  "vk.com": [
    "q",
    "section",
    "w",
    "z"
  ],
  "walmart.com": [
    "cat_id",
    "max_price",
    "min_price",
    "page",
    "q",
    "query",
    "sort"
  ],
  "wayfair.com": [
    "keyword"
  ],
  "wikipedia.org": [
    "action",
    "curid",
    "diff",
    "oldid",
    "redirect",
    "search",
    "section",
    "title"
  ],
  "wsj.com": [
    "page",
    "query"
  ],
  "x.com": [
    "f",
    "lang",
    "q"
  ],
  "yahoo.co.jp": [
    "b",
    "bct",
    "bkcat",
    "ei",
    "fp",
    "fr",
    "fr2",
    "n",
    "p",
    "pz"
  ],
  "yahoo.com": [
    "b",
    "bct",
    "bkcat",
    "ei",
    "fp",
    "fr",
    "fr2",
    "n",
    "p",
    "pz"
  ],
  "yandex.com": [
    "from",
    "lang",
    "lr",
    "p",
    "text",
    "to",
    "within"
  ],
  "yandex.go.link": [
    "adj_t"
  ],
  "yandex.ru": [
    "from",
    "lang",
    "lr",
    "p",
    "text",
    "to",
    "within"
  ],
  "yes24.com": [
    "domain",
    "query"
  ],
  "youtu.be": [
    "index",
    "list",
    "t"
  ],
  "youtube.com": [
    "ab_channel",
    "index",
    "lc",
    "list",
    "search_query",
    "t",
    "v"
  ],
  "zalando.de": [
    "brand",
    "color",
    "order",
    "p",
    "price_from",
    "price_to",
    "q",
    "size"
  ],
  "zalando.es": [
    "brand",
    "color",
    "order",
    "p",
    "price_from",
    "price_to",
    "q",
    "size"
  ],
  "zigzag.kr": [
    "keyword"
  ]
};
