// Where the probe page loads the engine from, and the CSP it declares for it.

/** Exact-version npm CDN path of the already published engine package. */
export const CDN_ORIGIN = "https://cdn.jsdelivr.net";
export const CDN_BASE =
  process.env.ENGINE_CDN_BASE ??
  `${CDN_ORIGIN}/npm/@ilusiv/fugue-js@2026.5.2/dist`;

export const RESOURCE_URI = "ui://wasm-probe/page";
export const PROBE_VERSION = "1";

/**
 * The page's engine sources and CSP for a request. `selfOrigin` is the origin
 * this server is reached at, which also serves the engine files under
 * /engine/ as the second source.
 */
export function probeConfig(selfOrigin) {
  const sources = {
    cdn: CDN_BASE,
    self: `${selfOrigin}/engine`,
  };
  const origins = [...new Set([new URL(CDN_BASE).origin, selfOrigin])];
  return {
    sources,
    csp: { resourceDomains: origins, connectDomains: origins },
  };
}

/** The origin a request reached, honoring the proxy headers Vercel sets. */
export function requestOrigin(req) {
  const host = req.headers["x-forwarded-host"] ?? req.headers.host;
  const proto =
    req.headers["x-forwarded-proto"] ??
    (String(host).startsWith("localhost") || String(host).startsWith("127.")
      ? "http"
      : "https");
  return `${String(proto).split(",")[0]}://${String(host).split(",")[0]}`;
}
