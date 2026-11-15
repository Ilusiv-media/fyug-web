import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  RESOURCE_MIME_TYPE,
  registerAppResource,
  registerAppTool,
} from "@modelcontextprotocol/ext-apps/server";
import { probeHtml } from "./app-html.js";
import { PROBE_VERSION, RESOURCE_URI, probeConfig } from "./config.js";

/** One stateless MCP server per request; `selfOrigin` is this deployment. */
export function buildServer(selfOrigin) {
  const server = new McpServer({
    name: "mcp-app-wasm-probe",
    version: PROBE_VERSION,
  });
  const { sources, csp } = probeConfig(selfOrigin);

  registerAppTool(
    server,
    "wasm_probe",
    {
      title: "WASM engine probe",
      description:
        "Open the diagnostic page that tests whether this chat can run the Fyug WASM engine and play sound. Call it once, then tell the user to follow the page.",
      inputSchema: {},
      _meta: { ui: { resourceUri: RESOURCE_URI } },
    },
    async () => ({
      content: [
        {
          type: "text",
          text: "The probe page is open. The user runs its checks and the audio test on the page and copies the report.",
        },
      ],
    }),
  );

  registerAppResource(
    server,
    "WASM engine probe page",
    RESOURCE_URI,
    { mimeType: RESOURCE_MIME_TYPE },
    async (uri) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: RESOURCE_MIME_TYPE,
          text: probeHtml(sources, "app"),
          // Claude reads csp, domain and permissions from the content item.
          _meta: { ui: { csp, prefersBorder: true } },
        },
      ],
    }),
  );

  return server;
}
