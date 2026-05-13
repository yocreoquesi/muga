# Test vectors

Conformance fixtures for the [CAPS decision algorithm](../SPEC.md#3-decision-algorithm-normative). Any conforming implementation MUST produce the expected output for every vector at the level it claims.

## Layout

| File | Vectors | Tests |
|---|---|---|
| `basic.json` | 10 | Fundamental preserve / defer / creator-first conflict resolution. |
| `full.json` | 10 | Adds network-redirect categorisation and the short-circuit semantics. |
| `strict.json` | 10 | Edge cases: subdomains, case sensitivity, multiple programs, three-way creator-first conflicts. |

Conformance is incremental:

- **Basic** = passes `basic.json`.
- **Full** = passes `basic.json` AND `full.json`.
- **Strict** = passes `basic.json` AND `full.json` AND `strict.json`.

## Shared manifest

All vectors are evaluated against `manifest.json` in this directory. It is small and deterministic — 10 programs covering Amazon (US + ES), eBay, Booking, Vercel, DigitalOcean, Humble Bundle (direct-injection) plus Awin, Skimlinks, Impact Radius (network-redirect).

Adopters MAY substitute their own manifest when running the runner against their implementation; see the runner script for usage. The vectors themselves cite real program documentation, so they remain meaningful regardless of which manifest is supplied — provided the substitute manifest declares the same programs with the same shape.

## Vector format

Every vector validates against [`vector.schema.json`](vector.schema.json):

```json
{
  "name": "amazon-tag-preserve",
  "description": "Single Amazon affiliate tag → preserve.",
  "input": {
    "url": "https://amazon.com/dp/B08N5WRWNW?tag=creator-21",
    "ownerTag": "muga0b-20"
  },
  "expected": {
    "decision": ["preserve"],
    "preservedParams": [{ "name": "tag", "value": "creator-21" }],
    "removedParams": []
  },
  "citation": "https://affiliate-program.amazon.com/help/topic/t10 — tag is the canonical Associate ID parameter."
}
```

## Running the vectors

The runner imports the reference validator and applies it to every vector at the requested level:

```bash
# Build the validator first so its dist/ exists
cd ../validator && npm install && npm run build

# Run every level
cd ../test-vectors && node runner.mjs

# Run a specific level
node runner.mjs basic
node runner.mjs basic full
```

Exit code 0 = all passing. Exit code 1 = at least one mismatch (details printed).

## Adding a vector

A pull request that adds a new vector MUST include:

- A descriptive `name` (kebab-case).
- A `description` explaining what the vector exercises in the algorithm.
- A `citation` linking to public documentation, a real captured URL with date, or a regression report.
- Verification that the reference validator produces the expected output (the runner returns 0 on the new vector).

Vectors that exercise behaviour not yet defined in the SPEC are rejected — the SPEC is the source of truth, vectors are its conformance contract.

## Why this corpus is small on purpose

The corpus tests **algorithm branches**, not **affiliate programs in the wild**. Adding a new program to the manifest does not require new vectors unless it exposes a new algorithmic branch. The minimum useful corpus exercises every conditional in the algorithm; everything beyond that is redundant with the validator's own unit tests.
