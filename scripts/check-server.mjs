// Checks a running probe server the way a host would: initialize, list the
// tool, call it, read the ui:// resource and inspect its MIME type and CSP.
//   node scripts/check-server.mjs http://127.0.0.1:8788/mcp
//   node scripts/check-server.mjs https://<project>.vercel.app/mcp

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const url = process.argv[2] ?? "http://127.0.0.1:8788/mcp";
const client = new Client({ name: "probe-check", version: "1" });
await client.connect(new StreamableHTTPClientTransport(new URL(url)));

const failures = [];
const check = (ok, text) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${text}`);
  if (!ok) failures.push(text);
};

const { tools } = await client.listTools();
const tool = tools.find((t) => t.name === "wasm_probe");
check(Boolean(tool), "tool wasm_probe is listed");
const uri = tool?._meta?.ui?.resourceUri;
check(uri === "ui://wasm-probe/page", `tool links ${uri}`);
const called = await client.callTool({ name: "wasm_probe", arguments: {} });
check(!called.isError, "tool call succeeds");

const { contents } = await client.readResource({ uri });
const item = contents[0];
check(item.mimeType === "text/html;profile=mcp-app", `MIME type ${item.mimeType}`);
const csp = item._meta?.ui?.csp;
check(Boolean(csp?.resourceDomains?.length), `resourceDomains ${JSON.stringify(csp?.resourceDomains)}`);
check(Boolean(csp?.connectDomains?.length), `connectDomains ${JSON.stringify(csp?.connectDomains)}`);
check(
  item.text.includes("probe-config") && item.text.length > 50_000,
  `page is ${(item.text.length / 1024).toFixed(0)} KB`,
);
console.log(`self origin in the page config: ${/"self":"([^"]+)"/.exec(item.text)?.[1]}`);
await client.close();
process.exit(failures.length ? 1 : 0);
