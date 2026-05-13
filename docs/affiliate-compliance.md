# Affiliate Compliance Audit — Amazon Associates

> **Status:** DRAFT — pending legal verification of the regional clauses in §3.
> **Owner:** [@yocreoquesi](https://github.com/yocreoquesi)
> **Last reviewed:** 2026-05-13
> **Tracking issue:** [#339](https://github.com/yocreoquesi/muga/issues/339)
> **Scope:** Amazon Associates only. Non-Amazon affiliate programmes (Bookshop.org, Vercel, DigitalOcean, Lemon Squeezy) are out of scope for this document.

This audit answers one question:

> Does MUGA's automatic Amazon affiliate-tag injection comply with the Amazon Associates Operating Agreement, per region?

The risk is concrete: Amazon Associates revokes accounts for "software / extensions generating clicks without explicit pre-approval". An adverse finding here means revenue collapse and forfeiture of escrowed earnings across six regional accounts (US, UK, ES, DE, FR, IT).

The document is organised so that the parts that **do not depend on a lawyer** (what MUGA actually does, what the disclosure flow says, what the kill-switch surface looks like) are precise and code-cited. The parts that **do depend on a lawyer** (regional clause interpretation) are explicitly marked `[VERIFY]` with a link to the live Operating Agreement and the clause family to look for. Do not promote this file out of DRAFT until those placeholders are resolved by someone with authority to interpret the agreements.

---

## §1 — What MUGA does with Amazon links

Every claim in this section is verifiable against the working tree on the commit that introduced this file. If the code changes, this section must be updated in the same PR.

### 1.1 Targeted storefronts

MUGA injects affiliate tags on exactly six Amazon regional storefronts:

| Region | Host           | Our tag      |
| ------ | -------------- | ------------ |
| US     | `amazon.com`   | `muga0b-20`  |
| ES     | `amazon.es`    | `muga0b-21`  |
| DE     | `amazon.de`    | `muga0f-21`  |
| FR     | `amazon.fr`    | `muga08a-21` |
| IT     | `amazon.it`    | `muga04f-21` |
| UK     | `amazon.co.uk` | `muga0a-21`  |

Source: `src/lib/affiliates.js:791-798` (the `OUR_TAGS["amazon-associates"]` map).

Other Amazon storefronts (JP, BR, AU, CA, IN, NL, PL, SE) appear in `domain-rules.json` only for tracking-parameter cleaning. **No affiliate tag is injected on those hosts.** This is structurally important for compliance: if MUGA does not hold an Associates account in a region, MUGA never adds a tag in that region.

### 1.2 Injection mechanism

Affiliate injection is **conditional, client-side, and never overwrites an existing tag**.

The single decision point is `src/lib/cleaner.js:587-599`:

```javascript
if (prefs.injectOwnAffiliate && !prefs.stripAllAffiliates && action !== "detected_foreign" && !blacklistRemovedAffiliate) {
  const hostKeyInject = hostname.replace(/^www\./, "");
  for (const pattern of patterns) {
    const ourTagForHost = pattern.ourTag[hostKeyInject] || pattern.ourTag[hostname] || "";
    if (ourTagForHost && !url.searchParams.has(pattern.param)) {  // ← param absent only
      url.searchParams.set(pattern.param, ourTagForHost);
      action = "injected";
      break;
    }
  }
}
```

Four pre-conditions all have to hold before injection happens:

1. The user opted in (`injectOwnAffiliate === true`). Default is `false` — see `src/lib/storage.js:86`.
2. The user has not requested a strip-all pass (`stripAllAffiliates === false`).
3. The URL was not classified as carrying a foreign creator tag (`action !== "detected_foreign"`). See classifier at `src/lib/cleaner.js:462-480`.
4. A blacklist rule did not already remove an affiliate for this URL (`!blacklistRemovedAffiliate`).

And inside the loop, the literal `!url.searchParams.has(pattern.param)` gate guarantees:

> If `tag=` is already present on the URL — for any reason, set by anyone — MUGA does not touch it.

No redirect chain, no proxy, no server in the path. Navigation goes directly from the user's browser to Amazon. The only network egress in the default install is the optional weekly Ed25519-signed rules fetch from `rules.muga.app` (see [OBJECTIVES.md](../OBJECTIVES.md) principle 2 and `src/lib/remote-rules.js`).

### 1.3 Trigger surface

Once the user has opted in, injection runs on every navigation to a covered Amazon storefront, via three independent entry points (so that SPA re-renders and capture-phase clicks do not bypass the cleaner):

- **Service-worker URL processing** — applied to every navigation. Entry: `src/background/service-worker.js:7` importing `processUrl` from `src/lib/cleaner.js`.
- **Content-script DOM rewrite** — runs at `document_start` and on mutations; rewrites `<a href>` in place. Source: `src/manifest.json:30-42`, `src/content/dom-link-rewriter.js:1-39`.
- **Capture-phase click listener** — re-runs the cleaner on `mousedown`/`click` to catch pages that re-decorate the href after MUGA cleaned it. Source: `src/content/dom-link-rewriter-click.js:1-35`.

There is no popup, overlay, toast, or visual decoration around Amazon links. Injection is silent at the link level. Visibility happens after the fact in the popup's "Recent activity" ledger (i18n key `ledger_badge_inject_affiliate`, `src/lib/i18n.js:106-114`).

### 1.4 Creator-referral handling

MUGA explicitly preserves third-party creator tags. There are two paths:

- **"Tag already present" short-circuit** (`src/lib/cleaner.js:587-599`, line cited above). If `tag=` is on the URL when MUGA sees it — set by the upstream page, by a creator's link, by anyone — MUGA does not modify it. The user lands on Amazon with the original creator's tag intact.
- **Honor Creator Mode** (`src/lib/cleaner.js:309-328`). An opt-in preference (default `false`, `src/lib/storage.js:113-114`) that additionally **preserves redirect-network wrappers** (Skimlinks, Impact, Awin) when the navigation referrer matches a user-maintained allowlist. This mode does not affect direct Amazon links — those are already covered by the tag-already-present short-circuit.

The classifier that decides whether an incoming URL already carries a non-MUGA tag is at `src/lib/cleaner.js:462-480` (`detectPreservedAffiliate`); a positive classification surfaces a "Creator referral preserved" entry in the popup ledger.

---

## §2 — Disclosure & consent flow

The strict reading of Associates §[VERIFY: regional disclosure clause] requires that the user understand affiliate behaviour is happening. MUGA's onboarding is the disclosure surface for that requirement.

### 2.1 What the user is shown

During onboarding (first install), before any opt-in checkbox is enabled, the user reads (English source strings — translations follow the same structure):

> **How MUGA stays free**
>
> On selected stores, if a link has **no affiliate tag at all**, MUGA can add ours. **Your price never changes.** If a creator's tag is already there, we never touch it — the code is open source, you can verify this.
>
> We deliberately rejected 10+ stores whose tracking methods require routing your clicks through external servers. We would rather earn less than compromise how MUGA works.

Source: `src/lib/i18n.js:535` (key `ob_affiliate_desc`).

The opt-in control is a single labelled checkbox:

> ☐ Allow MUGA's affiliate tag on links that have none
>
> *Same price, always. If a link already has a tag, MUGA never touches it. Verify in our source code.*

Sources: `src/lib/i18n.js:537` (`ob_affiliate_check_label`) and `src/lib/i18n.js:538` (`ob_affiliate_check_hint`). Display structure: `src/onboarding/onboarding.html:320-341`.

The default state of `injectOwnAffiliate` is `false` (`src/lib/storage.js:86`). The user has to actively check the box for any injection to occur.

### 2.2 Ongoing reminder

After consent, every successful injection produces a "Recent activity" ledger entry visible from the toolbar popup (`ledger_badge_inject_affiliate`, `src/lib/i18n.js:106-114`). This is the disclosure that persists past onboarding — the user can see "an affiliate tag was added" against the URL it was added to.

### 2.3 Localisation

The disclosure strings are translated for all seven supported locales (EN, ES, PT, DE, FR, IT, JA — see `tools/missing-translations.mjs` and PR #635). Translation drift is gated by `tools/check-i18n-fixme.mjs` in CI (PR #633).

---

## §3 — Operating Agreement clause mapping, per region

This is the section that depends on a lawyer.

The Amazon Associates Operating Agreement is a per-region contract. The clauses differ between US, EU, and UK contracts. The named clause families below are the ones that historically gate browser-extension affiliate programmes; the placeholders are where verbatim quotes belong once the live agreement has been read by someone authorised to interpret it.

**Do not fill these placeholders with content from this audit, from memory, or from a search engine result.** Open the live Operating Agreement at the URL given and quote the in-force version.

### 3.1 US — `amazon.com`

- **Operating Agreement:** https://affiliate-program.amazon.com/help/operating/agreement
- **Programme Policies:** https://affiliate-program.amazon.com/help/operating/policies

| Clause family | What to look for | Verbatim quote | MUGA mapping |
| --- | --- | --- | --- |
| Software / extension distribution | A clause that names "software", "extensions", "applications" or "Special Links generated by software" and either permits or restricts them. | `[VERIFY]` | `[VERIFY]` — current MUGA behaviour is described in §1; expected mapping is *borderline → requires written confirmation*. |
| Disclosure / FTC alignment | The clause that requires affiliate status to be disclosed to end users. | `[VERIFY]` | Disclosure surface documented in §2.1 / §2.2. Expected mapping: **compliant** (explicit checkbox + persistent ledger). |
| Inducement / incentivised clicks | Any prohibition on incentivising clicks (rebates, cashback, points). | `[VERIFY]` | MUGA does not offer rebates, cashback, points, or any incentive to click. Expected mapping: **compliant**. |
| Cookie stuffing / link substitution | Prohibition on substituting another affiliate's tag with your own. | `[VERIFY]` | The `!url.searchParams.has(pattern.param)` gate at `cleaner.js:597` means MUGA never substitutes. Expected mapping: **compliant**. |
| Ad injection / DOM modification | Any prohibition on modifying Amazon pages or surrounding pages. | `[VERIFY]` | MUGA rewrites `<a href>` attributes on third-party pages, never on Amazon pages themselves. Expected mapping: **borderline** — depends on whether "modify" is read narrowly (page-content modification) or broadly (URL modification). |

### 3.2 UK — `amazon.co.uk`

- **Operating Agreement:** https://affiliate-program.amazon.co.uk/help/operating/agreement
- **Programme Policies:** https://affiliate-program.amazon.co.uk/help/operating/policies

Apply the same five clause families from §3.1. The UK agreement historically diverges from the US one on:

- Special Programmes (UK has a narrower Special Programme list; extension-based affiliation may or may not be a Special Programme — `[VERIFY]`).
- Permitted-content rules around "comparison" sites and toolbar extensions.

`[VERIFY: full clause mapping for amazon.co.uk]`

### 3.3 EU agreements

The EU agreements (DE, FR, IT, ES) are governed by a common framework with regional addenda. Each storefront has its own URL:

- DE: https://partnernet.amazon.de/help/operating/agreement
- FR: https://partenaires.amazon.fr/help/operating/agreement
- IT: https://programma-affiliazione.amazon.it/help/operating/agreement
- ES: https://afiliados.amazon.es/help/operating/agreement

`[VERIFY: per-region clause table for DE, FR, IT, ES — same five clause families as §3.1]`

EU-specific items to confirm:

- Whether GDPR/ePrivacy interactions are referenced in the agreement (consent capture for affiliate cookies).
- Whether the regional addenda contain anything stricter than the common framework on extension-based affiliation.

### 3.4 Worst-case scenario per region

`[VERIFY]` — once the clauses above are filled, restate the single clause per region that, if read most strictly, would be the basis for revocation. This is the clause the kill-switch (§4) must defend against.

---

## §4 — Kill-switch surface

### 4.1 What exists today

| Mechanism | Granularity | Requires release? | Source |
| --- | --- | --- | --- |
| Onboarding opt-out (uncheck box) | Per-install, all stores | No — user action | `src/onboarding/onboarding.js:34-120` |
| `injectOwnAffiliate` preference flip via popup | Per-install, all stores | No — user action | `src/lib/storage.js:86` |
| Per-domain blacklist (`domain` entry) | Per-install, single domain | No — user action | `src/lib/cleaner.js:386-392` |
| `stripAllAffiliates` preference | Per-install, all stores (strips MUGA's own tag too) | No — user action | `src/lib/cleaner.js:533-546` |
| Disable extension | Per-install, everything | No — user action | Browser-level |

What every row above has in common: **the user is the actor**. None of these is a maintainer-controlled remote kill-switch. If MUGA needs to globally disable Amazon injection across the install base in response to an Associates ruling, none of these mechanisms reaches into the user's browser.

### 4.2 What is missing

There is no maintainer-controlled, server-pushed kill-switch for Amazon injection per region.

The existing remote-rules pipeline (`src/lib/remote-rules.js`) is signed and gated, but it is scoped to tracking-parameter strip rules — it does not currently express "disable affiliate injection on host X". The closest workaround is to push a remote rule that strips MUGA's own affiliate parameter from Amazon URLs after injection; that is **functionally** a kill (no tag survives) but **structurally** ugly (the injection still happens, then is reverted).

A clean kill-switch requires extending the rules manifest with a per-host `disableInjection: true` flag and a corresponding gate in `cleaner.js:587-599`. This is the scope of [#339 Deliverable 3](https://github.com/yocreoquesi/muga/issues/339) — design proposal pending separately from this audit.

### 4.3 Decision criteria for triggering a kill

The criteria below are policy, not code. They are written here so that there is a documented threshold; the actual decision is the maintainer's.

A regional Amazon injection should be disabled when **any one** of the following is true:

1. The regional Associates support team responds in writing that MUGA's behaviour as described in §1 is not permitted, and the response is not contradicted by a higher-confidence reading of the live Operating Agreement.
2. An Associates account is suspended or warned and the suspension reference cites extension-based affiliation, ad-injection, or any clause in §3.
3. The Operating Agreement for the region is updated and the new version contains language that, under a plain reading, prohibits MUGA's behaviour as described in §1.

In all three cases the kill-switch (once implemented) is the first response; a release with the storefront removed from `OUR_TAGS` is the second.

---

## §5 — Acceptance criteria status

The acceptance criteria for [#339](https://github.com/yocreoquesi/muga/issues/339) are:

- [x] Audit doc published in repo — **this file**.
- [ ] At least 3 of the 6 Associates regions have written clarification — **maintainer task, not closed by this PR**.
- [ ] Mitigation kill-switch implemented and tested — **separate issue, see §4.2**.
- [x] Outcome documented in `OBJECTIVES.md` under "Risks" — see the new "Risks" section in [OBJECTIVES.md](../OBJECTIVES.md).

This PR closes only the first and fourth boxes. The remaining two stay open under #339 until the maintainer has the tickets in hand and the kill-switch design is approved.

---

## Maintenance

- This file must be updated in the same PR as any change to `OUR_TAGS` in `src/lib/affiliates.js`, the injection gate in `src/lib/cleaner.js:587-599`, or the onboarding disclosure strings in `src/lib/i18n.js`.
- The `[VERIFY]` placeholders in §3 must be resolved before the DRAFT banner is removed.
- The decision criteria in §4.3 are reviewed alongside [OBJECTIVES.md](../OBJECTIVES.md) (every 6 months, next 2026-11-07) or sooner if a regional ruling forces it.
