/**
 * MUGA E2E helpers — re-exports (#398)
 *
 * Single import point for tests:
 *   import { seedStorage, killServiceWorker, ... } from "./helpers/index.mjs";
 */
export { seedStorage, installTestModeSentinel, clearTestModeSentinel } from "./storage.mjs";
export { killServiceWorker, simulateUnresponsiveSW } from "./sw-control.mjs";
export { readActionSurface } from "./action-surface.mjs";
export { withFixtureManifest, clearFixtures } from "./fixtures.mjs";
