// Runs the probe page in desktop Chromium and WebKit, inside an MCP Apps
// style host (host origin, sandbox proxy origin, CSP header, sandboxed
// iframes), once per CSP profile and sandbox variant, plus a plain-page
// control. Writes results/<run>.json and prints a table.
//   node run.mjs [--browsers chromium,webkit] [--profiles spec,spec+wasm] [--inner ref,opaque]
// Needs ../npm run build first, and the browsers Playwright 1.60 pins.

import { createServer } from "node:http";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { build } from "esbuild";
import { chromium, webkit } from "playwright";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { startDevServer } from "../scripts/dev-server.mjs";
import { PROFILES } from "./csp-profiles.mjs";

const arg = (name, fallback) => {
  const at = process.argv.indexOf(`--${name}`);
  return at >= 0 ? process.argv[at + 1].split(",") : fallback;
};
const browsers = arg("browsers", ["chromium", "webkit"]);
const profiles = arg("profiles", [...Object.keys(PROFILES), "standalone"]);
const inners = arg("inner", ["ref", "opaque"]);

const PROBE = 8788, HOST = 8790, SANDBOX = 8791;
await build({
  entryPoints: ["host-client.ts"], bundle: true, format: "esm", outfile: "dist/host.js",
  target: "es2022", platform: "browser", logLevel: "error",
});
const probeServer = await startDevServer(PROBE);

// The View HTML and CSP come from the MCP server exactly as a host reads them.
const client = new Client({ name: "harness", version: "1" });
await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${PROBE}/mcp`)));
const { contents } = await client.readResource({ uri: "ui://wasm-probe/page" });
const resource = { html: contents[0].text, csp: contents[0]._meta.ui.csp };
await client.close();

const send = (res, type, body, headers = {}) => {
  res.writeHead(200, { "Content-Type": type, "Cache-Control": "no-store", ...headers });
  res.end(body);
};
const hostServer = createServer((req, res) => {
  const path = new URL(req.url, "http://x").pathname;
  if (path === "/host.html") return send(res, "text/html", readFileSync("host.html"));
  if (path === "/host.js") return send(res, "text/javascript", readFileSync("dist/host.js"));
  if (path === "/resource.json") return send(res, "application/json", JSON.stringify(resource));
  res.writeHead(404).end();
});
const sandboxServer = createServer((req, res) => {
  const url = new URL(req.url, "http://x");
  if (url.pathname !== "/sandbox.html") return void res.writeHead(404).end();
  const csp = JSON.parse(url.searchParams.get("csp") ?? "{}");
  const profile = PROFILES[url.searchParams.get("profile")] ?? PROFILES.spec;
  send(res, "text/html", readFileSync("sandbox.html"), { "Content-Security-Policy": profile.build(csp) });
});
await new Promise((r) => hostServer.listen(HOST, "127.0.0.1", r));
await new Promise((r) => sandboxServer.listen(SANDBOX, "127.0.0.1", r));

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function findProbeFrame(page, timeout = 60000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    for (const frame of page.frames()) {
      if (await frame.evaluate(() => typeof window.__probe !== "undefined").catch(() => false)) return frame;
    }
    await wait(300);
  }
  throw new Error("probe frame never appeared");
}
const ids = (frame) => frame.evaluate(() => window.__probe.results().map((r) => r.id));
async function waitFor(frame, id, timeout = 40000) {
  // Settled when the step exists, or when an earlier step of its audio mode failed.
  const mode = /^audio\.(url|main|embedded)\./.exec(id)?.[1];
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const results = await frame.evaluate(() => window.__probe.results());
    if (results.some((r) => r.id === id)) return true;
    if (mode && results.some((r) => r.id.startsWith(`audio.${mode}.`) && r.status === "fail")) return false;
    await wait(300);
  }
  return false;
}

async function runOne(type, name, profile, inner) {
  const browser = await type.launch(type === chromium ? { args: ["--mute-audio"] } : {});
  const page = await browser.newPage({ viewport: { width: 1000, height: 1600 } });
  const consoleLines = [];
  page.on("console", (m) => consoleLines.push(`${m.type()}: ${m.text()}`.slice(0, 300)));
  const version = browser.version();
  const target = profile === "standalone"
    ? `http://127.0.0.1:${PROBE}/probe`
    : `http://127.0.0.1:${HOST}/host.html?profile=${encodeURIComponent(profile)}&inner=${inner}&sandbox=${SANDBOX}`;
  await page.goto(target);
  const frame = await findProbeFrame(page);
  const loaded = await frame.evaluate(() => new Promise((resolve) => {
    const end = Date.now() + 60000;
    const tick = () => (window.__probeDone ? resolve(true) : Date.now() > end ? resolve(false) : setTimeout(tick, 250));
    tick();
  }));
  if (loaded) {
    await frame.check("#quiet");
    await frame.click("#play-url");
    await waitFor(frame, "audio.url.play");
    if ((await ids(frame)).includes("audio.url.play")) {
      await frame.click("#pitch").catch(() => undefined);
      await waitFor(frame, "audio.live-control");
    }
    await frame.click("#play-main");
    await waitFor(frame, "audio.main.play");
    await frame.click("#play-embedded");
    await waitFor(frame, "audio.embedded.play", 20000);
    // The second engine source: this server's /engine path.
    await frame.check("input[name=source] >> nth=1");
    await frame.click("#run-checks");
    await waitFor(frame, "self.worklet-engine", 30000);
    await frame.click("#stop").catch(() => undefined);
  }
  const results = await frame.evaluate(() => window.__probe.results()).catch(() => []);
  const report = await frame.evaluate(() => window.__probe.report()).catch(() => "");
  await browser.close();
  return { browser: name, version, profile, inner, loaded, results, report, console: consoleLines.slice(0, 40) };
}

mkdirSync("results", { recursive: true });
const runs = [];
for (const [name, type] of [["chromium", chromium], ["webkit", webkit]]) {
  if (!browsers.includes(name)) continue;
  for (const profile of profiles) {
    for (const inner of profile === "standalone" ? ["-"] : inners) {
      process.stdout.write(`${name} ${profile} ${inner} ... `);
      try {
        const run = await runOne(type, name, profile, inner);
        runs.push(run);
        writeFileSync(`results/${name}-${profile}-${inner}.txt`, `${run.version}\n${run.report}\n\nconsole:\n${run.console.join("\n")}\n`);
        console.log(run.loaded ? "done" : "page never finished");
      } catch (error) {
        console.log(`error: ${error.message}`);
        runs.push({ browser: name, profile, inner, loaded: false, results: [], error: error.message });
      }
    }
  }
}
writeFileSync("results/runs.json", JSON.stringify(runs, null, 2));
hostServer.close(); sandboxServer.close(); probeServer.close();
process.exit(0);
