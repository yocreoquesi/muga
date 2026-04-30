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
  ],
};
