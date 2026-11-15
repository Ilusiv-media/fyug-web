// Builds the probe page: the template with the client bundle and the engine
// source config inlined, so the page is one document (script-src allows
// inline script under every MCP Apps CSP).

import { readFileSync } from "node:fs";

const read = (name) =>
  readFileSync(new URL(`../app/${name}`, import.meta.url), "utf8");

export function probeHtml(sources, mode) {
  const template = read("index.html");
  const bundle = read("client.bundle.js");
  const config = JSON.stringify({ sources, mode }).replaceAll("<", "\\u003c");
  return template
    .replace("/*CONFIG*/", () => config)
    .replace("/*BUNDLE*/", () => bundle.replaceAll("</script", "<\\/script"));
}
