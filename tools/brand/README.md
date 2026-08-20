# Brand mark

The MUGA mark is one drawing, kept in one place and reused everywhere.

| File | Role |
|---|---|
| [`../../src/icons/muga-mark.svg`](../../src/icons/muga-mark.svg) | **Canonical.** viewBox `0 0 104 68`, drawn in `currentColor` so each surface tints it. Used by the popup, options, onboarding, muga.app and every favicon. |
| [`muga-mark-square.svg`](./muga-mark-square.svg) | The same two paths centred on a 128x128 canvas, with the brand purple baked in. This is what the store PNGs are rendered from. |
| [`muga-mark-512.png`](./muga-mark-512.png) | Large raster, for places that cannot take an SVG. |
| `../../src/icons/16.png` · `48.png` · `128.png` | Shipped extension icons, rendered from the square source. |

`tests/unit/brand-mark-integrity.test.mjs` pins that the canonical mark and the square source carry byte-identical path data, so the two can never drift into different drawings.

## Regenerating the store icons

```bash
for size in 16 48 128; do
  magick -background none tools/brand/muga-mark-square.svg \
    -resize "${size}x${size}" "src/icons/${size}.png"
done
```

Verify by eye afterwards, on a dark background, because renderers disagree about antialiasing. A regenerated 128 differs from the committed one by roughly 900 of 16384 pixels purely on edge blending — same shape, different smoothing. **Do not treat a non-zero pixel diff as a failure**; treat a changed silhouette as one.

Only regenerate when the mark itself changes. These are committed artifacts, and a gratuitous re-render is diff noise in every release.

## The brand purple

`#6A2BCF`. Sampled from the shipped `128.png`, and the same value as `--accent` in `landing/index.html`.

## What is not the mark

`src/icons/newicon.png` is a design-tool upload, mirrored under `.muga-design-bundle/`, and **excluded from both store builds** by `build:chrome` and `build:firefox`. It is a different drawing: longer vertical drop, longer arrow shaft. It is not the logo and must not be used as a source.

There used to be a `tools/brand-assets.html` generator here too. It was removed in #1216's follow-up: it drew a *"bold M with bottom stripe"* under the retired denoise identity, which has not been the mark since the violet rebrand, and it exported that drawing under the shipped filenames `muga-128.png` / `muga-48.png` / `muga-16.png`. Anyone who ran it would have overwritten the real icons with a design that was retired two releases ago. The command above replaces it.
