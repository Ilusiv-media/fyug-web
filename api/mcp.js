// Stateless streamable-HTTP MCP endpoint: one server and transport per
// request, JSON responses (no SSE), no sessions. Deploys as one Vercel
// serverless function.

import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { requestOrigin } from "../lib/config.js";
import { buildServer } from "../lib/server.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    // Stateless: no server-initiated stream and no session to delete.
    res.statusCode = 405;
    res.setHeader("Allow", "POST");
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        jsonrpc: "2.0",
        error: { code: -32000, message: "Method not allowed." },
        id: null,
      }),
    );
    return;
  }
  const server = buildServer(requestOrigin(req));
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  res.on("close", () => {
    void transport.close();
    void server.close();
  });
  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body ?? (await readJson(req)));
  } catch (error) {
    console.error("mcp request failed", error);
    if (!res.headersSent) {
      res.statusCode = 500;
      res.setHeader("Content-Type", "application/json");
      res.end(
        JSON.stringify({
          jsonrpc: "2.0",
          error: { code: -32603, message: "Internal server error." },
          id: null,
        }),
      );
    }
  }
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const text = Buffer.concat(chunks).toString("utf8");
  return text === "" ? undefined : JSON.parse(text);
}
