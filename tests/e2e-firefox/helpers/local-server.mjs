/**
 * Tiny local HTTP server for Firefox e2e fixtures (#1128 slice 1).
 *
 * MUGA's content scripts run on http/https pages, not data:/file: URLs, so
 * Selenium (which lacks Playwright's page.route() request interception)
 * needs a real page served over http to exercise the extension against.
 */

import http from "node:http";

/**
 * Starts a local HTTP server on 127.0.0.1 that serves `html` for every
 * request path.
 *
 * @param {string} html
 * @returns {Promise<{url: string, close: () => Promise<void>}>}
 */
export async function serveFixturePage(html) {
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(html);
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();

  return {
    url: `http://127.0.0.1:${port}/index.html`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

/**
 * Starts a local HTTP server on 127.0.0.1 that serves `html` for every
 * request path AND records every incoming request's method/path/headers
 * (referer-beacon-privacy PR 3, tasks 3.3/3.4). Used as a real network
 * "destination" that FF smoke specs can allowlist/blocklist by hostname and
 * inspect for header presence (Referer) or arrival (ping/sendBeacon).
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
    res.writeHead(204);
    res.end();
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();

  return {
    url: `http://127.0.0.1:${port}/index.html`,
    origin: `http://127.0.0.1:${port}`,
    requests,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}
