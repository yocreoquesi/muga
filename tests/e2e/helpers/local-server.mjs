/**
 * MUGA E2E helper — tiny local HTTP servers (referer-beacon-privacy PR 4,
 * Phase 5 mandatory real-Chromium proof).
 *
 * Mirrors the equivalent Firefox smoke helper
 * (tests/e2e-firefox/helpers/local-server.mjs) so both suites prove the
 * SAME thing the same way: a real network destination that records what it
 * actually received on the wire (headers, or whether a request arrived at
 * all), rather than trusting DNR's declarative docs. Relocated (not
 * imported) for the Chromium/Playwright suite because tests/e2e-firefox is
 * a Selenium-only tree with its own fixtures.
 */

import http from "node:http";

/**
 * Starts a local HTTP server on 127.0.0.1 that serves `html` for every
 * request path. Used as the "page" origin so navigations/fetches to a
 * DIFFERENT local server (serveCapturingServer) are genuinely cross-origin.
 *
 * @param {string} html
 * @returns {Promise<{url: string, close: () => Promise<void>}>}
 */
/**
 * Tracks live sockets on a server and force-destroys them on close().
 *
 * Node's http.Server#close() only stops accepting NEW connections — it waits
 * for existing (keep-alive) sockets to end before its callback fires. A real
 * browser keeps its HTTP/1.1 connection to 127.0.0.1 alive by default, so
 * without this, `close()` would hang indefinitely (this bit the first draft
 * of these specs: the test body completed and logged success, but the
 * fixture teardown never resolved, and Playwright's 30s test timeout fired).
 * @param {import('node:http').Server} server
 */
function forceDestroyOnClose(server) {
  const sockets = new Set();
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });
  return () =>
    new Promise((resolve) => {
      server.close(resolve);
      for (const socket of sockets) socket.destroy();
    });
}

export async function serveFixturePage(html) {
  const server = http.createServer((_req, res) => {
    res.setHeader("Connection", "close");
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(html);
  });
  const close = forceDestroyOnClose(server);

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();

  return {
    url: `http://127.0.0.1:${port}/index.html`,
    close,
  };
}

/**
 * Starts a local HTTP server on 127.0.0.1 that serves `html` for every
 * request path AND records every incoming request's method/path/headers.
 * Used as a real network "destination" that specs allowlist/blocklist by
 * hostname and inspect for header presence (Referer) or arrival
 * (ping/sendBeacon).
 *
 * Responds 204 to every request (no body needed by the fixture pages; also
 * satisfies navigator.sendBeacon()'s expectation of a quick, cheap response).
 *
 * @returns {Promise<{url:string, origin:string, requests: Array<{method:string, path:string, headers: object}>, close: () => Promise<void>}>}
 */
export async function serveCapturingServer() {
  const requests = [];
  const server = http.createServer((req, res) => {
    requests.push({ method: req.method, path: req.url, headers: req.headers });
    res.setHeader("Connection", "close");
    res.writeHead(204);
    res.end();
  });
  const close = forceDestroyOnClose(server);

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();

  return {
    url: `http://127.0.0.1:${port}/index.html`,
    origin: `http://127.0.0.1:${port}`,
    requests,
    close,
  };
}
