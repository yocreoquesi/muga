# Security Policy

## Supported versions

Only the latest published release is actively maintained. Older versions
receive no patches.

| Version | Supported |
|---------|-----------|
| latest  | Yes       |
| < latest | No       |

## Reporting a vulnerability

**Do not open a public GitHub issue for suspected security problems.**

Use a private security advisory instead:
<https://github.com/yocreoquesi/muga/security/advisories/new>

We aim to acknowledge reports within 72 hours and to resolve confirmed
vulnerabilities before public disclosure.

## Out-of-band polyfill integrity pin

`src/lib/browser-polyfill.min.js` is vendored and pinned by SHA-256:

```
a2093810df8e00393ee4d3adc243ea82d7e56471b40f0f66b64f8980da944094
```

The pin is enforced on every CI run by `tools/verify-polyfill-integrity.mjs`.
Any change to the polyfill file or to its verifier requires explicit maintainer
review before merging. A CODEOWNERS file would be overkill for a solo
repository; the combination of this documented pin and the existing CI check is
the correct control at this project's scale.
