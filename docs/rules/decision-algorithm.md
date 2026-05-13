# CAPS — Creator Attribution Preservation rules

**Version:** 1.0.0-rc1
**Status:** Internal MUGA documentation. The CAPS rules are not operated as a multi-party standard — they are MUGA's own decision algorithm and rule artefacts, documented here so every decision is auditable from outside the project. See [`../../OBJECTIVES.md` → Non-goals](../../OBJECTIVES.md) for the explicit decision not to pursue standards-body governance until external implementers emerge.
**Editor:** yocreoquesi
**License:** GPL-3.0 (same as the parent MUGA repository)

---

## Abstract

This document describes the decision algorithm MUGA applies to distinguish legitimate creator referrals from cross-site tracking. It defines terminology, a deterministic decision algorithm using RFC 2119 keywords for precision, a machine-readable manifest format for recognized affiliate programs (`src/rules/caps-manifest.json`), and the contract MUGA's runtime tests enforce.

CAPS is descriptive of MUGA's behaviour, not prescriptive of anyone else's. It specifies *which parameters constitute legitimate creator attribution* and *what categories of action exist for handling them*. It does not dictate user-interface choices, default modes, permissions, or product positioning. Any third-party tool that finds the algorithm useful is welcome to read and implement it; we will not run a conformance programme around it.

## 1. Conventions

The key words "MUST", "MUST NOT", "REQUIRED", "SHALL", "SHALL NOT", "SHOULD", "SHOULD NOT", "RECOMMENDED", "MAY", and "OPTIONAL" in this document are to be interpreted as described in [RFC 2119](https://www.rfc-editor.org/rfc/rfc2119) and [RFC 8174](https://www.rfc-editor.org/rfc/rfc8174) when, and only when, they appear in all capitals as shown here.

Sections labelled **(Informative)** are non-normative. All other sections are normative.

## 2. Terminology

The following terms are binding. Implementations MUST use these definitions when interpreting this specification.

**Affiliate program.** A commercial arrangement in which a third party (the *creator*) earns a commission from a *merchant* when a *user* completes a transaction after following a link the creator published.

**Direct-injection program.** An affiliate program in which attribution is carried by a parameter in the merchant's own first-party URL. Examples: Amazon Associates (`tag=`), eBay Partner Network (`campid=`), Booking.com Affiliate Programme (`aid=`), Vercel (`?ref=`), Linear (`?ref=`).

**Network-redirect program.** An affiliate program in which attribution requires routing the click through an affiliate-network server before the user reaches the merchant. Examples: Awin, ShareASale, Skimlinks, Impact Radius, Rakuten LinkShare, TradeTracker, AliExpress `s.click`, CJ Affiliate, Admitad.

**Creator referral.** A query parameter in a URL whose `(host, paramName)` tuple matches an entry in the CAPS manifest under `programType = "direct-injection"`, AND whose value is not empty. The value of the parameter is the *creator's identifier* for that program.

**Tracker decoration.** A query parameter that does not identify a creator referral and that the broader anti-tracking community classifies as cross-site identification (UTM, click IDs, session correlators, fingerprinting tokens). CAPS does not enumerate tracker decorations; that work belongs to filter-list projects.

**Implementer's own tag.** When a conforming implementation has its own affiliate identifier registered for a direct-injection program (for example, MUGA owns Amazon Associates IDs `muga0b-21`, `muga0b-20`, etc.), that identifier is the *implementer's own tag* for that program. An implementation MAY have zero, one, or multiple own tags. The presence or absence of own tags does not affect conformance.

**Conforming implementation.** A tool whose observable behaviour on the published CAPS test-vector corpus matches the expected output for the conformance level the tool claims.

**User.** The natural person whose browser, device, or session is making the HTTP request being processed. CAPS treats the user as a first-class actor with privacy-relevant interests; the spec is silent on UI but normative on what constitutes acting *on the user's behalf*.

## 3. Decision Algorithm (Normative)

For every URL processed by a conforming implementation, the implementation MUST perform the following steps in order. The output is a decision and the lists of preserved and removed parameters.

### 3.1 Inputs

The algorithm takes as input:

- `url`: the URL being processed, as a structured object with at minimum a hostname, path, and query parameters.
- `manifest`: the current CAPS manifest, as defined in Section 5.
- `ownerTag` (optional): the implementer's own tag for the program identified, if any.

### 3.2 Procedure

1. **Identify creator referrals.** The implementation MUST scan the URL's query parameters. For each parameter, the implementation MUST check whether the tuple `(canonicalHost(url.hostname), paramName)` matches any entry in `manifest.programs[]` whose `programType` equals `"direct-injection"`. The implementation MUST treat parameters with empty values as not creator referrals. Entries whose `programType` is `"deprecated"` MUST NOT be matched in this step (they are retained for transparency only; see Section 5.1.1).

   The function `canonicalHost(h)` returns `h` lowercased with a leading `www.` stripped. Implementations MUST use this canonicalisation.

2. **Apply the creator-first rule.** If two or more creator referrals are present and they target the same direct-injection program (same `id` in the manifest), the implementation MUST resolve the conflict as follows:

   - If exactly one of the values equals the implementer's own tag for that program, that value MUST be removed and the other value (the third-party creator's referral) MUST be preserved.
   - If none of the values equals the implementer's own tag, the implementation MUST preserve the parameter that appears first in the URL's query string and MUST remove all other instances.
   - If all values are equal, the implementation MUST preserve a single instance.

   Conformance level Strict additionally requires the behaviour described in Section 4.3.

3. **Preserve identified creator referrals.** All parameters identified as creator referrals in step 1 MUST be preserved through any subsequent cleaning logic. They MUST NOT be removed, modified, or replaced (except by the creator-first rule in step 2).

4. **Apply implementer's own tracker-removal logic.** All parameters that are not creator referrals MAY be removed, preserved, modified, or otherwise processed by the implementation's existing tracker-removal logic. CAPS does not require nor forbid stripping anything outside of creator referrals. This is the explicit boundary between CAPS and existing filter-list projects.

5. **Categorise redirect-network URLs.** If the URL's hostname matches an entry in `manifest.programs[]` whose `programType` equals `"network-redirect"`, the implementation MUST categorise the URL as `network-redirect`. The implementation MUST surface this categorisation to the layer that decides whether to follow, strip, or block the redirect, but CAPS does not specify the resulting behaviour at conformance levels Basic and Full. See Section 4 for the additional requirement at Strict. Entries whose `programType` is `"deprecated"` MUST NOT trigger this categorisation.

6. **Apply the Contextual extension (when claimed).** Implementations claiming the Contextual extension (Section 4.4) MUST additionally evaluate **bounded scoping** for ambiguous parameters. The implementation MUST scan the URL's query parameters for the presence of any **anchor tracker** in the canonical list defined in Section 4.4. If at least one anchor is present AND step 5 did not short-circuit on a `network-redirect` host, the implementation MUST add to `removedParams` every URL parameter whose name matches an entry in the canonical **contextual pairs** list defined in Section 4.4, EXCEPT for parameters already in `preservedParams` from step 2 (affiliate precedence). Matching of both anchor names and pair names MUST be case-insensitive; the parameter's original casing MUST be preserved in the output. Implementations MUST emit at most one `removedParams` entry per unique lowercased pair name. Implementations not claiming Contextual MUST NOT execute this step.

### 3.3 Output

The algorithm produces:

- `decision` ∈ `{ "preserve", "strip", "defer", "network-redirect" }`. Multiple decisions MAY apply per URL; implementations MUST report all that apply.
- `preservedParams[]`: the list of parameter names preserved as creator referrals.
- `removedParams[]`: the list of parameter names removed by the implementation's own logic in step 4.
- `notes[]`: free-form diagnostic strings (informative, not part of conformance).

## 4. Conformance Levels

A conforming implementation MUST claim exactly one of the following levels. Higher levels include all requirements of lower levels.

### 4.1 Basic

An implementation conforms at level **Basic** if and only if:

- It MUST correctly identify creator referrals as defined in Section 3.1 against the CAPS manifest version it claims to support.
- It MUST preserve identified creator referrals as required by Section 3.2 step 3.
- It MUST apply the creator-first rule as required by Section 3.2 step 2.
- It MUST pass every test vector in `test-vectors/basic/` for the manifest version it claims.

Basic is the minimum bar. Tools that strip creator referrals do not conform at any level.

### 4.2 Full

An implementation conforms at level **Full** if it meets all Basic requirements AND:

- It MUST correctly categorise URLs whose hostname matches a `network-redirect` program as `network-redirect` per Section 3.2 step 5.
- It MUST surface the `network-redirect` categorisation to the user via the implementation's user-facing surface (UI, log, API, or other observable channel — CAPS is silent on the channel choice). The categorisation MUST be honest: an implementation MUST NOT silently honor or silently strip a `network-redirect` URL while claiming Full conformance.
- It MUST pass every test vector in `test-vectors/full/` for the manifest version it claims.

### 4.3 Strict

An implementation conforms at level **Strict** if it meets all Full requirements AND:

- The implementation's default behaviour on `network-redirect` URLs MUST be either (a) blocking the redirect, (b) stripping affiliate-attribution parameters from the URL, or (c) deferring to user policy. The default MUST NOT be silently honoring the redirect.
- An implementation MAY offer an opt-in mode in which `network-redirect` URLs are honored, but the opt-in MUST require an explicit user action and MUST NOT be the factory default.
- It MUST pass every test vector in `test-vectors/strict/` for the manifest version it claims.

### 4.4 Contextual Extension (Normative, Optional)

The **Contextual extension** is an OPTIONAL conformance claim that an implementation MAY add to its base level (Basic, Full, or Strict). An implementation claiming Contextual MUST implement Section 3.2 step 6 and MUST pass every test vector in `test-vectors/contextual.json`. The extension is independent of the base levels: a Basic+Contextual implementation is well-defined, as is Strict+Contextual.

Contextual is the spec's response to the long tail of *ambiguous* tracking parameters — names like `pid` that carry tracking information on marketing landing pages but functional information (project id, partner id, pixel id) on neutral URLs. Stripping such parameters unconditionally would break functional URLs; preserving them everywhere lets cross-site tracking through. **Bounded scoping** resolves the dilemma: strip the ambiguous parameter ONLY when a definitive tracker — an *anchor* — is also present in the URL, proving the URL came from a marketing pipeline.

#### 4.4.1 Anchor trackers (Normative)

The canonical anchor list. Membership is fixed for CAPS 1.x. Adding an anchor is a minor version bump of this specification.

| Anchor | Origin |
|---|---|
| `gclid` | Google Ads click identifier |
| `fbclid` | Meta (Facebook) click identifier |
| `msclkid` | Microsoft Advertising click identifier |
| `dclid` | Google Display click identifier |
| `twclid` | Twitter Ads click identifier |
| `gbraid`, `wbraid` | Google iOS / web app click identifiers |
| `utm_source`, `utm_medium`, `utm_campaign` | UTM core tracking parameters |
| `mc_eid`, `mc_cid` | Mailchimp email + campaign identifiers |

Every anchor on the list carries no legitimate functional meaning on a clean URL — its presence proves intent to track. Implementations MUST treat the list as canonical and MUST NOT silently expand it: extending the anchor list is a CAPS minor version bump per `GOVERNANCE.md`.

#### 4.4.2 Contextual pairs (Normative)

The canonical pair list. Membership is fixed for CAPS 1.x. Adding or removing a pair is a minor version bump of this specification.

| Pair | Functional risk if stripped unconditionally |
|---|---|
| `pid` | Project id on GitHub, partner id on countless SaaS, pixel id on Facebook ad landings |
| `icid` | Internal campaign identifier on news CMS templates |
| `icmp` | Internal campaign identifier (variant) |
| `CMP` | Campaign code on newsletter opens |
| `NLID` | Newsletter id |
| `soc_src` | Social-share source identifier |

Each entry is documented with the functional risk that justifies bounded scoping. Implementations claiming Contextual MUST treat the list as canonical and MUST NOT silently extend it.

#### 4.4.3 Affiliate precedence

If a parameter present in the URL appears in BOTH the canonical pair list AND `preservedParams` from Section 3.2 step 2, the parameter MUST be preserved. The Contextual rule MUST NOT override Section 3.2 step 3. The reference implementation enforces this by skipping any pair whose lowercased name matches a parameter already in `preservedParams`.

This is what makes Contextual safely composable with the base levels: an affiliate program that happens to use a generic-looking parameter name (a hypothetical merchant whose creator-referral parameter is `pid`) remains correctly preserved on its own host.

#### 4.4.4 Claim format

An implementation claiming Contextual MUST disclose the combined level using the `+` notation. Examples:

- `Basic + Contextual`
- `Strict + Contextual`

A bare `Contextual` claim is undefined and MUST NOT be used. The base level is always required.

#### 4.4.5 Forward compatibility

The Contextual extension is an *additive* spec layer. Adding a new anchor or pair in a future CAPS minor version MUST NOT cause a previously-conforming implementation to lose conformance against the lists frozen at the version it claims. Implementations MAY pin the anchor and pair lists to a specific CAPS version and refuse a list expansion until reviewed.

### 4.5 Claiming Conformance

A conforming implementation SHOULD display a CAPS conformance badge corresponding to its claimed level. Badges are published in `badges/`. Conformance is self-claimed: there is no central certification authority. Implementations that misrepresent their conformance level MAY be subject to public scrutiny but face no formal CAPS sanction.

## 5. Manifest

The CAPS manifest is the single source of truth for which affiliate programs are recognized. The manifest is distributed as a single JSON document, served over HTTPS at a stable URL, and signed with Ed25519.

### 5.1 Schema (Normative)

The full schema is published as `manifest.schema.json` in this repository. The following fields are REQUIRED:

- `caps_version` (string, SemVer): the CAPS specification version this manifest conforms to.
- `manifest_version` (integer, monotonically increasing): bumped on every published manifest. Implementations MUST treat lower values as older.
- `programs[]` (array): the recognized affiliate programs.

The following field is OPTIONAL at the manifest top level:

- `supported_caps_range` (string, SemVer range): informational signal of the `caps_version` range adopters are expected to support, e.g., `">=1.0.0 <2.0.0"`. Adopters MAY use it to advertise compatibility expectations and SHOULD reject manifests whose `caps_version` falls outside the range they have hardcoded support for. The field is informational only — adopters MUST NOT rely on it as a security boundary.

The following fields are REQUIRED in production manifests, and MAY be `null` in pre-release manifests:

- `signed_at` (RFC 3339 timestamp): when the manifest was signed.
- `signer_pubkey` (string, base64-encoded Ed25519 public key, 32 bytes): the public key corresponding to the signing key.
- `signature` (string, base64-encoded Ed25519 signature, 64 bytes): the signature over the canonical JSON serialization of the manifest with the `signature` field elided.

Each entry in `programs[]` MUST contain:

- `id` (string, stable): unique identifier for the program. Implementations MUST treat `id` as a stable key — once published, an `id` value MUST NOT be reused for a different program.
- `name` (string): human-readable program name.
- `programType` (string, enum: `"direct-injection"`, `"network-redirect"`, or `"deprecated"`). The `"deprecated"` value identifies entries that have been soft-removed from active matching; see Section 5.1.1.
- `domains[]` (array of strings): hostnames associated with the program. Implementations MUST canonicalize hostnames (lowercase, leading `www.` stripped) when matching.
- `param` (string): the URL parameter name carrying attribution. For `network-redirect` programs, the parameter is the network's click identifier (which CAPS uses for categorisation, not preservation). For `"deprecated"` entries the field MUST be retained for traceability but carries no normative meaning.

Each entry in `programs[]` MAY contain:

- `valueShape` (string, regex or `"non-empty"`): a constraint on the parameter value. Implementations MAY use this to reduce false positives.
- `notes` (string, informational).
- `references[]` (array of objects): public documentation confirming the attribution model. Each item MUST contain `url` (string, URI). Items MAY contain `archivedAt` (string, ISO 8601 date YYYY-MM-DD) and `archivedUrl` (string, URI on `web.archive.org` or `archive.today` and its mirrors `archive.ph` / `archive.is` / `archive.li` / `archive.md`). For entries with `programType: "direct-injection"`, every reference item MUST include `archivedAt` and `archivedUrl` so that the maintainer's evidence chain is preserved against silent post-merge edits to the upstream documentation. RECOMMENDED for all entries; REQUIRED in entries that pass the CI hard gates documented in `GOVERNANCE.md`.

When `programType` is `"deprecated"`, the entry MUST also contain:

- `deprecatedAt` (string, ISO 8601 date YYYY-MM-DD): when the program was soft-deprecated.
- `deprecationReason` (string): human-readable rationale for the deprecation (e.g., program shutdown, malicious entry revocation, classification correction).

#### 5.1.1 Deprecated entries (Normative)

A program MAY be removed from active matching by setting its `programType` to `"deprecated"` rather than deleting the entry. Deprecated entries:

- MUST NOT be matched as creator referrals in Section 3.2 step 1.
- MUST NOT trigger the `network-redirect` categorisation in Section 3.2 step 5.
- MUST retain the original `id` for the lifetime of the manifest, so that historical citations and adopter caches remain interpretable.
- SHOULD be considered by adopters when auditing their own internal allowlists.

Deprecation is the soft-revocation primitive; hard deletion is reserved for legal removals. The procedure that produces deprecation events is documented in `GOVERNANCE.md`.

### 5.2 Signing (Normative)

The manifest signature is computed as follows:

1. The manifest object is serialised to JSON using a deterministic canonical form: keys sorted lexicographically, no insignificant whitespace, no trailing newline, UTF-8 encoding. Implementations MUST use [RFC 8785 (JSON Canonicalization Scheme)](https://www.rfc-editor.org/rfc/rfc8785) or an equivalent procedure.
2. The `signature` field is omitted from the canonical form prior to signing.
3. The signature is computed over the canonical bytes using Ed25519 per [RFC 8032](https://www.rfc-editor.org/rfc/rfc8032).
4. The signature is base64-encoded (RFC 4648 §4) and placed in the `signature` field.

Verifiers MUST reproduce the canonical form using the same procedure and MUST verify the signature against the `signer_pubkey`.

### 5.3 Distribution (Normative)

The canonical URL of the CAPS v1.0 manifest is:

```
https://caps.muga.app/manifest.json
```

The manifest MUST be served over HTTPS at this stable URL. The editor commits to maintaining the URL across hosting changes; if the underlying infrastructure migrates (for example, from one CDN to another), the URL itself does not change.

Implementations MAY cache the manifest. Implementations SHOULD refresh no more frequently than once per hour and no less frequently than once per week. Implementations MUST verify the signature on every fetched manifest before applying its contents. The manifest's signing public key (`signer_pubkey`) is published alongside the manifest at:

```
https://caps.muga.app/signer-pubkey.txt
```

Implementations SHOULD pin the public key on first fetch and refuse to accept a manifest signed by a different key without an explicit user action. A change of signing key by the editor is announced in `CHANGELOG.md` and in `OUTREACH.md` so adopters can audit the rotation.

### 5.4 Versioning (Normative)

This specification (`SPEC.md`) follows Semantic Versioning per [GOVERNANCE.md](GOVERNANCE.md#versioning).

The manifest carries its own version (`manifest_version`) independent of the spec version. Manifest updates that add new programs, fix typos in existing entries, or correct `references[]` MUST increment `manifest_version` and MUST NOT change the `caps_version` field. Manifest updates that change schema-relevant fields require a CAPS major or minor version bump (per the rules in `GOVERNANCE.md`) and MUST update `caps_version` accordingly.

### 5.5 Discovered Candidates Artifact (Normative)

The `src/rules/discovered/` directory (when present) hosts signed candidate-tracker reports proposed by the [`caps-crawler`](https://github.com/yocreoquesi/caps-crawler) repository for human review by the MUGA maintainer. Each report is one JSON file conforming to `src/rules/discovered.schema.json`.

**Required fields** (top-level object, no others):

- `discovered_at` (string, RFC 3339 / ISO 8601 UTC timestamp): when the crawl run completed.
- `crawler_version` (string, lowercase hex git SHA, 7 to 40 chars): commit of the producing crawler.
- `corpus` (array of lowercase hostname strings, non-empty): the actual sites visited during this run.
- `candidates` (array, MAY be empty): each candidate is an object with EXACTLY these fields:
  - `param` (string, non-empty): the parameter name observed in the post-load URL but absent from the original href.
  - `first_seen_on` (string, lowercase hostname): where the candidate was first observed.
  - `injected_by` (string, non-empty): identifier of the redirect chain or script that injected the parameter.
  - `occurrence_count` (integer ≥ 1): number of distinct first-party domains in this run on which the candidate appeared.
- `signature` (string, lowercase hex, EXACTLY 128 chars = 64 bytes): Ed25519 signature over the canonicalized payload.

**Signature procedure** mirrors §5.2 with two differences (signing key + encoding):

1. The artifact object is serialised to JSON in canonical form: object keys sorted lexicographically at every depth, arrays in document order, no insignificant whitespace, UTF-8 encoding.
2. The `signature` field is omitted from the canonical form prior to signing.
3. The signature is computed over the canonical bytes using Ed25519 per [RFC 8032](https://www.rfc-editor.org/rfc/rfc8032).
4. The signature is hex-encoded (lowercase) and placed in the `signature` field. Hex (rather than base64 as for the manifest) is used so the artifact can be inspected with shell tools without decoding ambiguity.

**Verification** uses the public key published at `https://caps.muga.app/crawler-pubkey.txt`, NOT the manifest signer key. This separation ensures that compromise of the crawler's CI signing secret cannot produce a forged `manifest.json` — only forged candidate proposals, which still require human merge to enter the trust boundary of any consumer.

**Lifecycle**:

1. The crawler signs and opens a PR adding `discovered/<date>.json`.
2. CI runs the schema validator and signature check (`validator/discovered-schema.test.mjs`); both MUST pass before merge.
3. The MUGA maintainer reviews the candidates against the false-positive principle and accepts, rejects, or scopes them.
4. Merge is always a deliberate human action. Automated merge of `discovered/` PRs is prohibited.

The directory's [`README.md`](discovered/README.md) carries the operational reviewer checklist.

## 5A. Wrappers Normative Artifact

The CAPS *wrappers artifact* is a separate normative document from the manifest. It enumerates the redirect-wrapper recipes — affiliate redirect networks and link shorteners that hide a destination URL inside their query string — that conforming implementations MUST recognise when categorising URLs as `network-redirect` (per Section 3.2 step 5) and that the muga-unwrap Privacy Proxy Worker MUST use as the allowlist of hosts it will fetch on the user's behalf.

The artifact is distributed as a single JSON document, served over HTTPS at a stable URL, and signed with Ed25519 by the same key that signs `worker-pubkey.txt` (see [worker-pubkey.md](worker-pubkey.md)).

### 5A.1 Schema (Normative)

The full schema is published as `wrappers.schema.json` in this repository. The artifact MUST be a JSON array. Each entry MUST contain:

- `id` (string, kebab-case, stable): unique identifier for the wrapper recipe. Implementations MUST treat `id` as a stable key — once published, an `id` value MUST NOT be reused for a different wrapper.
- `label` (string): human-readable network name.
- `hostPatterns` (array, MUST contain ≥1 item): each entry is either (a) an exact lowercase hostname, or (b) a regex source string anchored at both ends with `^` and `$`. Implementations MUST treat any pattern that begins with `^` or ends with `$` as a regex; all others MUST match by case-insensitive equality after canonicalisation.
- `extractor` (object): one of three known shapes:
  1. `{ "kind": "fromParam", "paramName": "<string>" }` — the destination URL lives in a single named query parameter.
  2. `{ "kind": "fromAnyParam", "paramName": ["<string>", ...] }` — try each named query parameter in order; the first that yields a well-formed http(s) URL wins.
  3. `{ "kind": "fromUrlAfterQuery" }` — the destination URL appears immediately after `?` with no parameter key (the "naked query" privacy-proxy shape, e.g. `https://href.li/?https://example.com`).
- `notes` (string): audit context — source of the recipe, rationale for the host/path constraints, gotchas. REQUIRED for traceability.
- `addedIn` (string, SemVer): version of the wrappers artifact in which this entry first appeared. Implementations MAY display this for change-tracking.

Each entry MAY contain:

- `pathPrefix` (string, MUST start with `/`): when present, implementations MUST require `url.pathname` to start with this string before treating the URL as a wrapper. Recipes without `pathPrefix` match on host alone.

### 5A.2 Consumer expectations (Normative)

- Browser-extension cleaners that perform local unwrap MUST honour `pathPrefix` when present and MUST NOT extract from URLs whose pathname fails the prefix check, even if the host matches.
- The muga-unwrap Privacy Proxy Worker SHOULD use `hostPatterns` as the authoritative allowlist of hosts it will fetch. Hosts not present in `wrappers.json` SHOULD be refused.
- Implementations MUST treat regex `hostPatterns` as anchored full-host matches (not partial substrings). Pattern compilation failure MUST be treated as a configuration error, not a permissive fallback.
- Consumers MUST validate the artifact's signature against the same public key chain documented in `worker-pubkey.md` before applying its contents.

### 5A.3 Signing (Normative)

The wrappers artifact signature is computed identically to the manifest signature procedure in Section 5.2: deterministic JSON canonicalisation per RFC 8785, signed with Ed25519 per RFC 8032, base64-encoded. The signature lives in a separate file (`wrappers.json.sig`) rather than embedded in the artifact, because the artifact is consumed as a JSON array (no top-level object available to host the signature field).

The signing key is the same key that signs `worker-pubkey.txt` — see [worker-pubkey.md](worker-pubkey.md) for the rotation policy.

### 5A.4 Distribution (Normative)

The canonical URLs of the CAPS v1.0 wrappers artifact are:

```
https://caps.muga.app/wrappers.json
https://caps.muga.app/wrappers.json.sig
```

Both MUST be served over HTTPS. Implementations MAY cache the artifact under the same SHOULD-refresh policy as the manifest (no more frequently than once per hour, no less frequently than once per week).

## 6. Governance and Change Process

Detailed governance is documented in [GOVERNANCE.md](GOVERNANCE.md). The normative summary:

- CAPS v1.0 ships under single-editor governance. The editor is named in `MAINTAINERS.md`.
- Changes to normative sections of this specification (sections numbered above) require the RFC process documented in `GOVERNANCE.md`.
- CAPS transitions from single-editor to community-maintainer governance when at least two independent implementations pass Strict conformance against the published test-vector corpus. "Independent" means distinct organisational origin, distinct maintainer team, and distinct deployment.
- Programs are added to `manifest.json` by pull request. Each new program MUST include a `references[]` entry linking to public documentation that confirms direct-injection attribution (or, for network-redirect programs, that confirms the redirect-based attribution model).

## 7. Security Considerations (Informative)

CAPS is a narrow specification: it tells implementations which parameters to preserve. It does not by itself defend against tracking, fingerprinting, supply-chain attacks on the manifest distribution, or misuse of the spec by adversaries claiming false conformance. Implementations remain responsible for:

- **Manifest integrity.** Verify the Ed25519 signature on every fetched manifest. A compromised distribution endpoint without signature verification can be used to inject tracker decorations disguised as creator referrals.
- **Adversarial manifest content.** The acceptance criteria for new entries require public documentation, but the editor (or, post-transition, the community maintainers) is the single point of trust. Implementations MAY choose to pin a specific `manifest_version` and reject newer manifests until reviewed.
- **Same-name parameter collisions.** Some merchants use parameter names like `ref` for both navigation context and affiliate attribution. CAPS resolves this by matching `(canonicalHost, paramName)` tuples against the manifest, but a misconfigured manifest entry that accepts `ref` on a host where `ref` is not an affiliate parameter would cause incorrect preservation. The `references[]` requirement and the test-vector corpus exist to catch this.

## 8. Privacy Considerations (Informative)

CAPS is designed to make a single privacy claim auditable: that creator referrals are preserved, while the implementation remains free to strip everything else. The spec is deliberately silent on:

- What the implementation does with `network-redirect` URLs (Strict requires a non-silent default; otherwise it is a UI choice).
- Whether the implementation makes network requests (some implementations may resolve opaque wrappers via a privacy proxy; this is out of scope for CAPS).
- What, if anything, the implementation logs about user behaviour.

Implementations claiming CAPS conformance gain nothing from the spec on the privacy front beyond the creator-attribution claim itself. Anti-tracking, anti-fingerprinting, telemetry, and storage hygiene remain the implementation's responsibility.

## 9. References (Informative)

- [RFC 2119](https://www.rfc-editor.org/rfc/rfc2119) — Key words for use in RFCs to indicate requirement levels.
- [RFC 8174](https://www.rfc-editor.org/rfc/rfc8174) — Ambiguity of uppercase vs lowercase in RFC 2119 key words.
- [RFC 8032](https://www.rfc-editor.org/rfc/rfc8032) — Edwards-Curve Digital Signature Algorithm (EdDSA).
- [RFC 8785](https://www.rfc-editor.org/rfc/rfc8785) — JSON Canonicalization Scheme (JCS).
- [RFC 4648](https://www.rfc-editor.org/rfc/rfc4648) — The Base16, Base32, and Base64 Data Encodings.
- [RFC 3339](https://www.rfc-editor.org/rfc/rfc3339) — Date and Time on the Internet: Timestamps.
- [Mozilla Anti-Tracking Policy](https://wiki.mozilla.org/Security/Anti_tracking_policy) — context for the distinction between bounce tracking and link decoration.
- [WebKit Tracking Prevention Policy](https://webkit.org/tracking-prevention/) — context for ITP's classification of cross-site identification.

## 10. Acknowledgements

To be populated in `ACKNOWLEDGMENTS.md` after the v1.0 release-candidate review per `GOVERNANCE.md`.
