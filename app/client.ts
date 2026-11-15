// The probe page: runs the checks, shows each step with its error text, and
// builds a report that can be copied or sent to the chat.

import { App } from "@modelcontextprotocol/ext-apps";
import { audioTest, changePitch, hasPlayer, recordHeard, stopPlayer, type Mode } from "./audio.js";
import { cspProbes, engineFiles, environment, worklets } from "./probes.js";
import {
  allResults,
  describeError,
  onChange,
  record,
  reportText,
  step,
  watchViolations,
} from "./results.js";

type Config = {
  sources: Record<"cdn" | "self", string>;
  mode: "app" | "standalone";
};

const VERSION = "1";
const config = JSON.parse(
  document.getElementById("probe-config")!.textContent ?? "{}",
) as Config;
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

let source: "cdn" | "self" = "cdn";
let probeContext: AudioContext | undefined;
let app: App | undefined;
let envLines: string[] = [];
let busy = false;

watchViolations();

function header(): string[] {
  return [
    `Fyug WASM engine probe v${VERSION}`,
    `time: ${new Date().toISOString()}`,
    `page mode: ${config.mode}`,
    `engine source selected: ${source} = ${config.sources[source]}`,
    ...envLines.map((l) => `  ${l}`),
  ];
}

function render(): void {
  const list = $("results");
  list.replaceChildren(
    ...allResults().map((r) => {
      const item = document.createElement("li");
      const tag = document.createElement("span");
      tag.className = `tag ${r.status}`;
      tag.textContent = r.status.toUpperCase();
      const title = document.createElement("span");
      title.textContent = r.title;
      const detail = document.createElement("span");
      detail.className = "detail";
      detail.textContent = r.detail;
      item.append(tag, title, detail);
      return item;
    }),
  );
  const rs = allResults();
  const count = (s: string) => rs.filter((r) => r.status === s).length;
  $("summary").textContent = `${count("pass")} pass, ${count("fail")} fail, ${count("info")} info`;
  $<HTMLTextAreaElement>("report").value = reportText(header());
}

async function connectHost(): Promise<void> {
  if (config.mode !== "app") {
    record({ id: "host", title: "MCP host", status: "info", detail: "standalone page: no host, no sandbox CSP" });
    return;
  }
  app = new App({ name: "wasm-probe", version: VERSION });
  await step("host", "MCP App handshake and host description", async () => {
    await Promise.race([
      app!.connect(),
      new Promise((_, reject) => setTimeout(() => reject(new Error("no host answer in 6 s")), 6000)),
    ]);
    const context = app!.getHostContext();
    const caps = app!.getHostCapabilities();
    return [
      `host: ${JSON.stringify(app!.getHostVersion())}`,
      `platform: ${context?.platform}; displayMode: ${context?.displayMode}; theme: ${context?.theme}; locale: ${context?.locale}`,
      `host userAgent field: ${(context as { userAgent?: string } | undefined)?.userAgent ?? "n/a"}`,
      `host CSP approved: ${JSON.stringify(caps?.sandbox?.csp ?? null)}`,
      `host permissions granted: ${JSON.stringify(caps?.sandbox?.permissions ?? null)}`,
    ].join("\n");
  });
}

async function runChecks(): Promise<void> {
  if (busy) return;
  busy = true;
  try {
    const base = config.sources[source];
    const wasm = await engineFiles(source, base);
    await worklets(source, base, wasm);
  } finally {
    busy = false;
    render();
  }
}

async function play(mode: Mode): Promise<void> {
  if (busy) return;
  busy = true;
  for (const id of ["play-url", "play-main", "play-embedded", "pitch", "stop"]) {
    $<HTMLButtonElement>(id).disabled = true;
  }
  try {
    await audioTest(mode, config.sources[source], $<HTMLInputElement>("quiet").checked, probeContext);
  } catch (error) {
    record({ id: `audio.${mode}.unexpected`, title: "Unexpected error", status: "fail", detail: describeError(error) });
  } finally {
    busy = false;
    for (const id of ["play-url", "play-main", "play-embedded"]) {
      $<HTMLButtonElement>(id).disabled = false;
    }
    $<HTMLButtonElement>("pitch").disabled = !hasPlayer();
    $<HTMLButtonElement>("stop").disabled = !hasPlayer();
    render();
  }
}

async function copyReport(): Promise<void> {
  const text = $<HTMLTextAreaElement>("report").value;
  const status = $("copy-status");
  try {
    await navigator.clipboard.writeText(text);
    status.textContent = "Copied.";
    return;
  } catch (error) {
    status.textContent = `Clipboard API blocked (${describeError(error)}); trying select-and-copy.`;
  }
  const box = $<HTMLTextAreaElement>("report");
  box.focus();
  box.select();
  try {
    status.textContent += document.execCommand("copy") ? " Copied." : " Select the text below and copy it by hand.";
  } catch {
    status.textContent += " Select the text below and copy it by hand.";
  }
}

async function sendReport(): Promise<void> {
  const status = $("copy-status");
  if (!app) {
    status.textContent = "Not an MCP App page: nothing to send to.";
    return;
  }
  try {
    const result = await app.sendMessage({
      role: "user",
      content: [{ type: "text", text: `Probe report:\n${$<HTMLTextAreaElement>("report").value}` }],
    });
    status.textContent = `Sent to chat${result?.isError ? " (host reported an error)" : ""}.`;
  } catch (error) {
    status.textContent = `Send failed: ${describeError(error)}`;
  }
}

function wire(): void {
  $("mode").textContent =
    config.mode === "app"
      ? "Running as an MCP App in the host's sandbox."
      : "Running as a plain page (control): no host CSP.";
  const row = $("sources");
  for (const key of ["cdn", "self"] as const) {
    const label = document.createElement("label");
    const input = document.createElement("input");
    input.type = "radio";
    input.name = "source";
    input.checked = key === source;
    input.addEventListener("change", () => {
      source = key;
      render();
    });
    label.append(input, ` ${key === "cdn" ? "jsDelivr CDN" : "this server (/engine)"}`);
    row.append(label);
  }
  $("run-checks").addEventListener("click", () => void runChecks());
  $("play-url").addEventListener("click", () => void play("url"));
  $("play-main").addEventListener("click", () => void play("main"));
  $("play-embedded").addEventListener("click", () => void play("embedded"));
  $("pitch").addEventListener("click", () => void changePitch().then(render));
  $("stop").addEventListener("click", () => {
    void stopPlayer().then(() => {
      $<HTMLButtonElement>("pitch").disabled = true;
      $<HTMLButtonElement>("stop").disabled = true;
    });
  });
  $("heard-yes").addEventListener("click", () => { recordHeard(true); render(); });
  $("heard-no").addEventListener("click", () => { recordHeard(false); render(); });
  $("copy").addEventListener("click", () => void copyReport());
  $("send").addEventListener("click", () => void sendReport());
  onChange(render);
}

async function main(): Promise<void> {
  wire();
  envLines = environment();
  await connectHost();
  try {
    probeContext = new AudioContext();
    record({
      id: "context-at-load",
      title: "AudioContext created at load, with no tap",
      status: "info",
      detail: `state ${probeContext.state}, ${probeContext.sampleRate} Hz`,
    });
  } catch (error) {
    record({ id: "context-at-load", title: "AudioContext created at load", status: "fail", detail: describeError(error) });
  }
  await cspProbes();
  await runChecks();
  (window as unknown as { __probeDone: boolean }).__probeDone = true;
  render();
}

(window as unknown as { __probe: unknown }).__probe = {
  results: allResults,
  report: () => $<HTMLTextAreaElement>("report").value,
};
void main();
