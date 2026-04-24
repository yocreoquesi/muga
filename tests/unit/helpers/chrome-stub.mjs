/**
 * Shared Chrome API stub factory for unit tests.
 *
 * Usage:
 *   import { makeChromeMock } from "./helpers/chrome-stub.mjs";
 *   globalThis.chrome = makeChromeMock();                        // defaults
 *   globalThis.chrome = makeChromeMock({ hasSession: false });   // Firefox MV2
 *   globalThis.chrome = makeChromeMock({ promiseShape: false });  // callback form
 *
 * Options:
 *   hasSession   {boolean} — include chrome.storage.session (default: true)
 *   hasAlarms    {boolean} — include chrome.alarms (default: true)
 *   hasDNR       {boolean} — include chrome.declarativeNetRequest (default: true)
 *   promiseShape {boolean} — use Promise-returning stubs; false → callback form (default: true)
 */
export function makeChromeMock({
  hasSession = true,
  hasAlarms = true,
  hasDNR = true,
  promiseShape = true,
} = {}) {
  function makeStorage(promiseBased) {
    if (promiseBased) {
      return {
        get: () => Promise.resolve({}),
        set: () => Promise.resolve(),
        remove: () => Promise.resolve(),
      };
    }
    return {
      get: (defaults, cb) => cb && cb({}),
      set: (_data, cb) => cb && cb(),
      remove: (_keys, cb) => cb && cb(),
    };
  }

  const storage = {
    sync: makeStorage(promiseShape),
    local: makeStorage(promiseShape),
  };

  if (hasSession) {
    storage.session = makeStorage(promiseShape);
  }

  const mock = {
    storage,
    runtime: {
      lastError: null,
      onSuspend: { addListener: () => {} },
    },
  };

  if (hasAlarms) {
    mock.alarms = {
      create: () => {},
      clear: () => {},
      onAlarm: { addListener: () => {} },
    };
  }

  if (hasDNR) {
    mock.declarativeNetRequest = {
      updateDynamicRules: () => Promise.resolve(),
      getDynamicRules: () => Promise.resolve([]),
    };
  }

  return mock;
}
