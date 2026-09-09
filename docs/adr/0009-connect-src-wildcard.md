# ADR-0009: `connect-src` stays permissive, because enumerating it cannot work

**Date**: 2026-09-09
**Status**: **Accepted** — the wildcard is structural, not an oversight
**Issue**: [#1258](https://github.com/yocreoquesi/muga/issues/1258) item 2, closing the tail of [#1035](https://github.com/yocreoquesi/muga/issues/1035)
**Builds on**: [ADR-0004](./0004-decommission-unwrap-server-native-shortener-resolution.md) (native, in-browser shortener resolution)

## Context

`src/manifest.json` sets:

```
connect-src 'self' https: http:
```

That permits a request to any origin over either scheme. Combined with the
`<all_urls>` host permission that content scripts require, it means the
20-entry `optional_host_permissions` list is **consent UX and nothing more** —
it imposes no technical limit. The Settings toggle is the real gate. So the one
platform-enforced boundary on egress is absent, and what stands between "clean
URLs" and "fetch anything, anywhere" is review discipline.

That is an uncomfortable place for a privacy extension to be, and #1258 asked
the obvious question: why not enumerate the origins MUGA actually talks to?

The list is short and knowable. There are exactly two network call sites in the
whole codebase:

| Call site | Destination |
|---|---|
| `src/lib/remote-rules.js` | `rules.muga.app` |
| `src/lib/native-shortener-resolver.js` | the `GENERIC_SHORTENERS` hosts |

Every other `fetch` resolves a packaged file through `chrome.runtime.getURL`,
which is `'self'`.

#1035 had already proposed exactly this: *"add the 7 `GENERIC_SHORTENERS`
origins to `connect-src` in both manifests, plus a regression test asserting
`connect-src` is a superset of the resolver's origins"*. It also flagged the
step that decides whether that works:

> **Before fixing, confirm at runtime** whether the MV3 service worker / MV2
> background fetch is actually subject to `extension_pages` `connect-src`
> (static analysis says yes; a quick live check removes all doubt).

That confirmation never happened. What shipped was the wildcard, and the reason
was never written down, which is how it came back as an open question.

## The measurement

A throwaway MV3 extension, two local origins on different ports, and the
extension's own service-worker code performing the fetches. `connect-src`
allowed **only** origin A.

| Probe | Purpose | Result |
|---|---|---|
| `A/ok` | control: the allowed origin works | **200** |
| `B/dest` direct | control: is CSP enforced in the SW at all? | **Failed to fetch** |
| `A/redirect` → 302 → `B/dest` | the question | **Failed to fetch** |

Then the same run with `connect-src` widened to allow B as well, changing
nothing else:

| Probe | Result |
|---|---|
| `A/redirect` → 302 → `B/dest` | **200**, `finalUrl = B/dest` |

Two findings, both now measured rather than reasoned about:

1. **An MV3 service worker's `fetch` IS subject to `extension_pages`
   `connect-src`.** This is the runtime check #1035 asked for.
2. **`connect-src` is re-checked against the REDIRECT TARGET.** The only
   variable between failure and success was the origin list, so CSP is the
   cause.

## Decision

**Keep `connect-src 'self' https: http:`.** Enumerating it is not a harder or
riskier version of the same fix; it is incompatible with what the resolver
does.

A shortener's entire purpose is to redirect to somewhere else. That destination
is arbitrary by definition and unknowable in advance — it is the thing the user
asked MUGA to reveal. An enumerated policy would list `bit.ly` and `tinyurl`,
the fetch would reach them, and then CSP would refuse the final hop of **every
real short link**, surfacing as `{ok: false, reason: "network"}`.

That is precisely the #1035 failure mode, which was diagnosed then as a missing
list. It was actually the first symptom of a policy shape that cannot express
"follow this redirect wherever it goes".

## Consequences

- **The `optional_host_permissions` list stays honest about what it is.** It is
  consent UX: it tells the user which shortener hosts MUGA will contact and
  lets them revoke. It is not, and cannot be made into, a technical boundary
  while the resolver follows redirects.
- **Egress discipline stays a code-review property.** The two call sites above
  are the whole surface; a third one appearing is a review question, not
  something the platform will catch. That is the cost being accepted here.
- **The comment that claimed otherwise is gone.** `native-shortener-resolver.js`
  used to state that "CSP connect-src whitelists only https shortener origins",
  which was false as shipped and corrected under #1258 item 1.
- **`redirect: "manual"` would change this**, by making each hop an explicit,
  inspectable step instead of one browser-driven chain. ADR-0004 records that
  it is unusable in a service worker, which is why the resolver follows the
  chain and checks `isPrivateHost` on the final URL. If that constraint ever
  lifts, this decision is worth revisiting.

## Not decided here

**Whether to narrow `http:` out**, leaving `connect-src 'self' https:`. That
still permits any https origin, so redirects keep working, and the resolver
already upgrades its request to https. The cost is that a shortener redirecting
to a plaintext `http://` destination would stop resolving.

Whether that is a feature or a regression is a product call, not a security
one, and it is deliberately left open rather than folded into this record. Note
that unlike everything above, this paragraph is **inference from the same
mechanism, not a separate measurement**.
