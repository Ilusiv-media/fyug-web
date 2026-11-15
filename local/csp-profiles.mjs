// The CSP a host's sandbox could put on the View, as a header string.
// `spec*` follow the "CSP Construction from Metadata" example in the MCP Apps
// specification (2026-01-26); `reference-host` is the SDK basic-host's
// buildCspHeader, which is looser.

const join = (list) => (list ?? []).filter((d) => !/[;\r\n'" ]/.test(d)).join(" ");

export const PROFILES = {
  spec: {
    about: "spec example, as written",
    build: (csp) => specCsp(csp, ""),
  },
  "spec+wasm": {
    about: "spec example plus 'wasm-unsafe-eval'",
    build: (csp) => specCsp(csp, " 'wasm-unsafe-eval'"),
  },
  "spec+wasm+blob": {
    about: "spec example plus 'wasm-unsafe-eval' and blob: scripts and workers",
    build: (csp) => specCsp(csp, " 'wasm-unsafe-eval' blob:", `worker-src 'self' blob: ${join(csp?.resourceDomains)}`),
  },
  "reference-host": {
    about: "SDK basic-host buildCspHeader (unsafe-eval, blob:, worker-src)",
    build: (csp) => {
      const r = join(csp?.resourceDomains);
      const c = join(csp?.connectDomains);
      return [
        "default-src 'self' 'unsafe-inline'",
        `script-src 'self' 'unsafe-inline' 'unsafe-eval' blob: data: ${r}`,
        `style-src 'self' 'unsafe-inline' blob: data: ${r}`,
        `img-src 'self' data: blob: ${r}`,
        `font-src 'self' data: blob: ${r}`,
        `media-src 'self' data: blob: ${r}`,
        `connect-src 'self' ${c}`,
        `worker-src 'self' blob: ${r}`,
        "frame-src 'none'",
        "object-src 'none'",
        "base-uri 'none'",
      ].join("; ");
    },
  },
};

function specCsp(csp, scriptExtra, extraDirective) {
  const r = join(csp?.resourceDomains);
  const c = join(csp?.connectDomains);
  return [
    "default-src 'none'",
    `script-src 'self' 'unsafe-inline'${scriptExtra} ${r}`,
    `style-src 'self' 'unsafe-inline' ${r}`,
    `connect-src 'self' ${c}`,
    `img-src 'self' data: ${r}`,
    `font-src 'self' ${r}`,
    `media-src 'self' data: ${r}`,
    "frame-src 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    ...(extraDirective ? [extraDirective] : []),
  ].join("; ");
}
