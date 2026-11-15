// The same page served as a plain document, with no MCP App CSP or sandbox.
// Open it in a normal browser tab first: it is the control that tells a
// device limit apart from a Claude sandbox limit.

import { probeConfig, requestOrigin } from "../lib/config.js";
import { probeHtml } from "../lib/app-html.js";

export default function handler(req, res) {
  const { sources } = probeConfig(requestOrigin(req));
  res.statusCode = 200;
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(probeHtml(sources, "standalone"));
}
