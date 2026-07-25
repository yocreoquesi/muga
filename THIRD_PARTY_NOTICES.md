# Third-Party Notices

MUGA is licensed under the GNU General Public License v3.0 (see `LICENSE`). This file lists
third-party software whose code or data was used to derive material now bundled with MUGA,
together with the attribution and license text each requires.

---

## Consent-O-Matic (cavi-au/Consent-O-Matic)

**Copyright (c) 2019,2020,2021,2022 Janus Bager Kristensen and Rolf Bagge, CAVI - Center for Advanced Visualization and Interaction, Aarhus University**
(https://github.com/cavi-au/Consent-O-Matic)

**License: MIT**

MUGA's Cookie Consent Minimizer Tier 2 rule data (`src/lib/cmp-tier2-rules.js`) is **derived and
adapted from Consent-O-Matic's cookie-management ruleset — it is not a verbatim redistribution.**
Every entry is produced through a one-way, hand-reviewed transform tool
(`tools/build-tier2-rules.mjs`) that:

- reads a locally vetted copy of Consent-O-Matic `rules/*.json` files (the Consent-O-Matic
  repository itself is **not vendored** into MUGA — the tool takes a local path as an argument);
- applies a hard field-allowlist on ingestion: only reject/necessary-only selector data and
  banner-presence selector data survive the transform. Every accept-path field, toggle/consent
  matcher, and save/persist field on the source rule (e.g. Consent-O-Matic's `trueAction`,
  `DO_CONSENT` consent matchers, and `SAVE_CONSENT` method) is discarded on ingestion and never
  reaches MUGA's rule data — see `tools/build-tier2-rules.mjs`'s docblock and its unit tests
  (`tests/unit/build-tier2-rules.test.mjs`) for the enforced allowlist; and
- requires a maintainer to manually review and hand-merge the tool's output into
  `src/lib/cmp-tier2-rules.js` — the tool itself never writes to that file, or to any file.

This is consistent with MUGA's own never-accept-by-construction data model: `src/lib/
cmp-tier2-rules.js`'s rule shape (`{id, present, reject, openSettings}`) has no field capable of
expressing an accept/allow-all action in the first place, so a Consent-O-Matic-derived rule
cannot carry one forward even by mistake.

MIT is compatible with, and does not restrict, redistribution under GPLv3; attribution is the
license's only ongoing obligation, satisfied by this file.

### MIT License text

> The copyright line below was verified byte-for-byte against the upstream `LICENSE` file
> (https://github.com/cavi-au/Consent-O-Matic/blob/master/LICENSE) on 2026-07-25. Re-confirm it
> if a future upstream release changes the holder or year range.

```
MIT License

Copyright (c) 2019,2020,2021,2022 Janus Bager Kristensen and Rolf Bagge, CAVI - Center for Advanced Visualization and Interaction, Aarhus University

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
