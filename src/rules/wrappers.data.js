// muga rule artifact: wrapper recipe table (#715). Ed25519-signed (see wrappers.json.sig).
// DO NOT EDIT BY HAND. Regenerate via the rules pipeline.
export const WRAPPERS_RAW = [
  {
    "id": "anonymto",
    "label": "anonym.to (privacy proxy)",
    "hostPatterns": [
      "anonym.to"
    ],
    "extractor": {
      "kind": "fromUrlAfterQuery"
    },
    "notes": "Naked-query privacy proxy: destination travels directly after `?` with no parameter key. Must NOT survive in the final URL. Tracked separately from href.li so metrics can distinguish them. Source: muga/src/lib/wrapper-engine.js (PR #436 era).",
    "addedIn": "1.0.0"
  },
  {
    "id": "awin",
    "label": "Awin",
    "hostPatterns": [
      "awin1.com",
      "www.awin1.com"
    ],
    "pathPrefix": "/cread.php",
    "extractor": {
      "kind": "fromParam",
      "paramName": "p"
    },
    "notes": "Awin's primary redirect endpoint (also accepts /awclick.php) carries the destination merchant URL in `p`. Source: muga/src/lib/wrapper-engine.js WRAPPERS table.",
    "addedIn": "1.0.0"
  },
  {
    "id": "cc-loginfra-com",
    "label": "cc.loginfra.com (ClearURLs redirect)",
    "hostPatterns": [
      "cc.loginfra.com"
    ],
    "extractor": {
      "kind": "fromParam",
      "paramName": "u"
    },
    "notes": "Harvested from ClearURLs redirections (provider: cc.loginfra.com). Auto-harvested; verify before release.",
    "addedIn": "2.4.0"
  },
  {
    "id": "click-redditmail-com",
    "label": "click.redditmail.com (ClearURLs redirect)",
    "hostPatterns": [
      "click.redditmail.com"
    ],
    "extractor": {
      "kind": "fromParam",
      "paramName": "url"
    },
    "notes": "Harvested from ClearURLs redirections (provider: reddit). Auto-harvested; verify before release.",
    "addedIn": "2.4.0"
  },
  {
    "id": "curseforge-com",
    "label": "curseforge.com (ClearURLs redirect)",
    "hostPatterns": [
      "curseforge.com",
      "www.curseforge.com"
    ],
    "pathPrefix": "/linkout",
    "extractor": {
      "kind": "fromParam",
      "paramName": "remoteUrl"
    },
    "notes": "Harvested from ClearURLs redirections (provider: curseforge.com). Auto-harvested; verify before release.",
    "addedIn": "2.4.0"
  },
  {
    "id": "duckduckgo-com",
    "label": "duckduckgo.com (ClearURLs redirect)",
    "hostPatterns": [
      "duckduckgo.com",
      "www.duckduckgo.com"
    ],
    "pathPrefix": "/l/",
    "extractor": {
      "kind": "fromParam",
      "paramName": "uddg"
    },
    "notes": "Harvested from ClearURLs redirections (provider: duckduckgo). Auto-harvested; verify before release.",
    "addedIn": "2.4.0"
  },
  {
    "id": "facebook-l",
    "label": "Facebook Outbound (web)",
    "hostPatterns": [
      "l.facebook.com"
    ],
    "pathPrefix": "/l.php",
    "extractor": {
      "kind": "fromParam",
      "paramName": "u"
    },
    "notes": "Outbound link wrapper lives exclusively on the `l.` subdomain. Matching the parent facebook.com would catch unrelated profile/post URLs.",
    "addedIn": "1.0.0"
  },
  {
    "id": "facebook-lm",
    "label": "Facebook Outbound (mobile)",
    "hostPatterns": [
      "lm.facebook.com"
    ],
    "pathPrefix": "/l.php",
    "extractor": {
      "kind": "fromParam",
      "paramName": "u"
    },
    "notes": "Same wrapper schema as facebook-l but on the mobile-web surface. Tracked separately so metrics can distinguish where outbound clicks originate.",
    "addedIn": "1.0.0"
  },
  {
    "id": "gate-sc",
    "label": "gate.sc (ClearURLs redirect)",
    "hostPatterns": [
      "gate.sc",
      "www.gate.sc"
    ],
    "extractor": {
      "kind": "fromParam",
      "paramName": "url"
    },
    "notes": "Harvested from ClearURLs redirections (provider: gate.sc). Auto-harvested; verify before release.",
    "addedIn": "2.4.0"
  },
  {
    "id": "hrefli",
    "label": "href.li (privacy proxy)",
    "hostPatterns": [
      "href.li"
    ],
    "extractor": {
      "kind": "fromUrlAfterQuery"
    },
    "notes": "Naked-query privacy proxy: destination URL appears directly after `?` with no parameter key (e.g. `https://href.li/?https://example.com/article`). Must NOT survive in the final URL.",
    "addedIn": "1.0.0"
  },
  {
    "id": "impact",
    "label": "Impact Radius",
    "hostPatterns": [
      "^[a-z0-9-]+(?:\\.[a-z0-9-]+)*\\.pxf\\.io$"
    ],
    "extractor": {
      "kind": "fromParam",
      "paramName": "u"
    },
    "notes": "Impact assigns brand-specific subdomains on pxf.io (gohealth.pxf.io, target.pxf.io, ...). Anchors require >=1 subdomain label and a literal `.pxf.io` suffix to block apex pxf.io and suffix look-alikes (notpxf.io, pxf.iox). Pattern is a regex source string; consumers MUST compile with anchors as written.",
    "addedIn": "1.0.0"
  },
  {
    "id": "instagram-l",
    "label": "Instagram Outbound",
    "hostPatterns": [
      "l.instagram.com"
    ],
    "extractor": {
      "kind": "fromParam",
      "paramName": "u"
    },
    "notes": "Only `l.instagram.com` — parent instagram.com is the social network itself and must never be flagged. The outbound wrapper has no fixed path prefix; the destination travels in `?u=` directly off the root.",
    "addedIn": "1.0.0"
  },
  {
    "id": "l-messenger-com",
    "label": "l.messenger.com (ClearURLs redirect)",
    "hostPatterns": [
      "l.messenger.com"
    ],
    "pathPrefix": "/l.php",
    "extractor": {
      "kind": "fromParam",
      "paramName": "u"
    },
    "notes": "Harvested from ClearURLs redirections (provider: messenger.com). Auto-harvested; verify before release.",
    "addedIn": "2.4.0"
  },
  {
    "id": "medium-link",
    "label": "Medium Short Link",
    "hostPatterns": [
      "link.medium.com"
    ],
    "extractor": {
      "kind": "fromAnyParam",
      "paramName": [
        "url",
        "u"
      ]
    },
    "notes": "Path-based short link that resolves through an HTTP redirect the engine cannot follow. Registered so detection flags the host (useful for metrics + caps validator); query fallback `?url=`/`?u=` covers upstream-attached destinations. Same pattern as t.co (issue #440).",
    "addedIn": "1.0.0"
  },
  {
    "id": "rakuten",
    "label": "Rakuten LinkShare",
    "hostPatterns": [
      "click.linksynergy.com"
    ],
    "pathPrefix": "/deeplink",
    "extractor": {
      "kind": "fromParam",
      "paramName": "murl"
    },
    "notes": "Rakuten Advertising (formerly LinkShare) deeplink endpoint carries the merchant URL in `murl`.",
    "addedIn": "1.0.0"
  },
  {
    "id": "reddit-out",
    "label": "Reddit Outbound",
    "hostPatterns": [
      "out.reddit.com"
    ],
    "extractor": {
      "kind": "fromParam",
      "paramName": "url"
    },
    "notes": "Only `out.reddit.com` is the outbound wrapper. The apex reddit.com (and www./old./new.) are the social network itself and must never be flagged.",
    "addedIn": "1.0.0"
  },
  {
    "id": "shareasale",
    "label": "ShareASale",
    "hostPatterns": [
      "shareasale.com",
      "www.shareasale.com"
    ],
    "pathPrefix": "/r.cfm",
    "extractor": {
      "kind": "fromParam",
      "paramName": "urllink"
    },
    "notes": "ShareASale's redirect endpoint `/r.cfm` carries the destination merchant URL in `urllink`.",
    "addedIn": "1.0.0"
  },
  {
    "id": "skimlinks-redirectingat",
    "label": "Skimlinks (go.redirectingat.com)",
    "hostPatterns": [
      "go.redirectingat.com"
    ],
    "extractor": {
      "kind": "fromParam",
      "paramName": "url"
    },
    "notes": "Skimlinks publisher redirect host. Destination merchant URL in `url`. Split from skimresources host so consumers can attribute metrics per surface.",
    "addedIn": "1.0.0"
  },
  {
    "id": "skimlinks-skimresources",
    "label": "Skimlinks (go.skimresources.com)",
    "hostPatterns": [
      "go.skimresources.com"
    ],
    "extractor": {
      "kind": "fromParam",
      "paramName": "url"
    },
    "notes": "Alternate Skimlinks publisher redirect host. Same shape as go.redirectingat.com; both share the upstream `url` parameter.",
    "addedIn": "1.0.0"
  },
  {
    "id": "snap-exit",
    "label": "Snap Exit",
    "hostPatterns": [
      "exit.sc"
    ],
    "extractor": {
      "kind": "fromParam",
      "paramName": "url"
    },
    "notes": "Snap's exit-redirect host (separate from snapchat.com). No path constraint — the destination travels in `?url=` off the root.",
    "addedIn": "1.0.0"
  },
  {
    "id": "steamcommunity-com",
    "label": "steamcommunity.com (ClearURLs redirect)",
    "hostPatterns": [
      "steamcommunity.com",
      "www.steamcommunity.com"
    ],
    "pathPrefix": "/linkfilter/",
    "extractor": {
      "kind": "fromParam",
      "paramName": "url"
    },
    "notes": "Harvested from ClearURLs redirections (provider: steamcommunity). Auto-harvested; verify before release.",
    "addedIn": "2.4.0"
  },
  {
    "id": "t-umblr-com",
    "label": "t.umblr.com (ClearURLs redirect)",
    "hostPatterns": [
      "t.umblr.com"
    ],
    "pathPrefix": "/redirect",
    "extractor": {
      "kind": "fromParam",
      "paramName": "z"
    },
    "notes": "Harvested from ClearURLs redirections (provider: t.umblr.com). Auto-harvested; verify before release.",
    "addedIn": "2.4.0"
  },
  {
    "id": "tco",
    "label": "Twitter t.co",
    "hostPatterns": [
      "t.co"
    ],
    "extractor": {
      "kind": "fromAnyParam",
      "paramName": [
        "url",
        "u"
      ]
    },
    "notes": "Exact host only — `t.co`. Subdomains like `api.t.co` are unrelated services and must NOT be flagged. Canonical form is path-based and resolves via 301 (engine cannot follow); allowlist of `?url=`/`?u=` is a best-effort fallback (issue #440).",
    "addedIn": "1.0.0"
  },
  {
    "id": "tradetracker",
    "label": "TradeTracker",
    "hostPatterns": [
      "tc.tradetracker.net"
    ],
    "extractor": {
      "kind": "fromParam",
      "paramName": "u"
    },
    "notes": "TradeTracker EU affiliate network click endpoint carries the destination URL in `u`.",
    "addedIn": "1.0.0"
  },
  {
    "id": "vk-away",
    "label": "VK Away",
    "hostPatterns": [
      "away.vk.com"
    ],
    "pathPrefix": "/away.php",
    "extractor": {
      "kind": "fromParam",
      "paramName": "to"
    },
    "notes": "VK's outbound wrapper lives only at `away.vk.com/away.php`. The apex vk.com is the social network itself and must NOT be flagged.",
    "addedIn": "1.0.0"
  },
  {
    "id": "youtube-com",
    "label": "youtube.com (ClearURLs redirect)",
    "hostPatterns": [
      "youtube.com",
      "www.youtube.com"
    ],
    "pathPrefix": "/redirect",
    "extractor": {
      "kind": "fromParam",
      "paramName": "q"
    },
    "notes": "Harvested from ClearURLs redirections (provider: youtube). Auto-harvested; verify before release.",
    "addedIn": "2.4.0"
  }
];
