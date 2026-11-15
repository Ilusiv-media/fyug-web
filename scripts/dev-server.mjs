// Local stand-in for the Vercel deployment: /mcp, /probe and /engine/*, with
// the same headers vercel.json sets. `npm run dev` listens on 8788.

import { createServer } from "node:http";
import { createReadStream, existsSync, statSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import mcp from "../api/mcp.js";
import probe from "../api/probe.js";

const root = fileURLToPath(new URL("..", import.meta.url));
const TYPES = { ".js": "text/javascript", ".wasm": "application/wasm", ".html": "text/html" };

export function startDevServer(port) {
  const server = createServer((req, res) => {
    const path = new URL(req.url, "http://x").pathname;
    if (path === "/mcp") return void mcp(req, res);
    if (path === "/probe") return void probe(req, res);
    if (path.startsWith("/engine/")) {
      const file = normalize(join(root, "public", path));
      if (!file.startsWith(join(root, "public", "engine")) || !existsSync(file) || !statSync(file).isFile()) {
        res.statusCode = 404;
        return void res.end("not found");
      }
      res.setHeader("Content-Type", TYPES[extname(file)] ?? "application/octet-stream");
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
      return void createReadStream(file).pipe(res);
    }
    res.statusCode = 404;
    res.end("not found");
  });
  return new Promise((resolve) => server.listen(port, "127.0.0.1", () => resolve(server)));
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PORT ?? 8788);
  await startDevServer(port);
  console.log(`probe dev server: http://127.0.0.1:${port}/probe  (MCP at /mcp)`);
}
