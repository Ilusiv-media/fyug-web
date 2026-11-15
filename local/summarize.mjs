// Prints the markdown table of results/runs.json: one column per run, one row
// per step that decides the question.
import { readFileSync } from "node:fs";

// Optional filters: node summarize.mjs [browser] [inner], e.g. webkit opaque.
const [only, innerOnly] = process.argv.slice(2);
const runs = JSON.parse(readFileSync("results/runs.json", "utf8")).filter(
  (r) => (!only || r.browser === only) && (!innerOnly || r.inner === innerOnly || r.profile === "standalone"),
);
const rows = [
  ["csp.wasm", "wasm compile allowed by CSP"],
  ["csp.blob-worker", "blob: Worker allowed"],
  ["csp.connect", "undeclared origin blocked"],
  ["cdn.fetch-wasm", "fetch .wasm from CDN"],
  ["cdn.compile-buffer", "wasm compile, ArrayBuffer"],
  ["cdn.compile-streaming", "wasm compile, streaming"],
  ["cdn.instantiate-buffer", "engine instantiate, ArrayBuffer"],
  ["cdn.instantiate-streaming", "engine instantiate, streaming"],
  ["cdn.worklet-blob", "addModule(blob:), comparison"],
  ["cdn.worklet-url", "addModule(CDN URL)"],
  ["cdn.worklet-engine", "engine ready in worklet"],
  ["audio.url.create", "FuguePlayer, worklet by URL"],
  ["audio.url.play", "plays, measured output"],
  ["audio.live-control", "live setControl moves pitch"],
  ["audio.main.play", "main-thread ScriptProcessor plays"],
  ["audio.embedded.create", "default embedded path (creates)"],
  ["audio.embedded.play", "default embedded path plays"],
  ["self.worklet-url", "addModule(this server's URL)"],
  ["self.worklet-engine", "engine ready in worklet (this server)"],
];
const cell = (run, id) => {
  const r = run.results.find((x) => x.id === id);
  if (!r) return run.loaded ? "-" : "n/a";
  const tag = r.status === "pass" ? "pass" : r.status === "fail" ? "FAIL" : r.status;
  if (id === "audio.embedded.create" || id === "audio.url.create") {
    return `${tag}${/engine path used: (\S+)/.exec(r.detail)?.[1] ? ` (${/engine path used: (\S+)/.exec(r.detail)[1]})` : ""}`;
  }
  if (id === "csp.connect") return r.status === "info" ? "NOT blocked" : "blocked";
  return tag;
};
const head = runs.map((r) => `${r.browser} ${r.profile}${r.inner && r.inner !== "-" ? `/${r.inner}` : ""}`);
console.log(`| step | ${head.join(" | ")} |`);
console.log(`|---|${head.map(() => "---").join("|")}|`);
for (const [id, label] of rows) console.log(`| ${label} | ${runs.map((r) => cell(r, id)).join(" | ")} |`);
console.log("\nVersions:", [...new Set(runs.map((r) => `${r.browser} ${r.version}`))].join("; "));
