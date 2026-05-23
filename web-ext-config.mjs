// NOTE: web-ext discards `ignoreFiles` from this config when the build
// command passes `--ignore-files` on the CLI (CLI replaces, doesn't merge).
// That means the `build:chrome` / `build:firefox` scripts in package.json
// are the SOURCE OF TRUTH for what gets excluded from shipped artifacts.
// This config is honored by `web-ext run` (dev), where there is no CLI
// `--ignore-files` flag — it's only used to prevent the dev-mode reload
// loop on Chrome-generated `_metadata/`.
export default {
  ignoreFiles: [
    "manifest.v2.json",
    "package.json",
    "web-ext-config.cjs",
    "web-ext-config.mjs",
    "*.md",
    ".git",
    "tests/",
    // The bundle SOURCE (cleaner-bundle-src.mjs) lives next to the
    // generated bundle (cleaner-bundle.js). Only the bundle ships; the
    // source uses ES-module imports that MV3 content scripts can't load
    // cross-browser. See tools/bundle-content.mjs (#356).
    "content/cleaner-bundle-src.mjs",
    // Chrome regenerates these MV3 declarative_net_request artefacts on
    // every load. Watching them creates a reload loop: Chrome rewrites →
    // web-ext reloads → Chrome rewrites → ... (~2 Hz, makes the popup
    // and onboarding flash).
    "_metadata",
    "_metadata/**",
    "_metadata/**/*",
  ],
};
