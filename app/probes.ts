// Environment, CSP and engine-file checks. None of these needs a tap.

import { describeError, record, step } from "./results.js";

type Glue = {
  default: (options: { module_or_path: unknown }) => Promise<unknown>;
  FugueEngine: new (sampleRate: number) => {
    status(): string;
    free(): void;
  };
};

const kb = (n: number) => `${(n / 1024).toFixed(1)} KB`;
const TINY_WASM = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]);
const TINY_PROCESSOR =
  'registerProcessor("probe", class extends AudioWorkletProcessor { process() { return true; } });';

export function environment(): string[] {
  const nav = navigator as Navigator & {
    userAgentData?: { platform?: string; brands?: { brand: string; version: string }[] };
    userActivation?: { isActive: boolean; hasBeenActive: boolean };
  };
  const policy = (document as Document & {
    featurePolicy?: { allowsFeature(name: string): boolean };
  }).featurePolicy;
  let framed = "unknown";
  try {
    framed = window.self !== window.top ? "yes" : "no";
  } catch {
    framed = "yes";
  }
  const access = (fn: () => unknown) => {
    try {
      fn();
      return "allowed";
    } catch (error) {
      return `blocked (${describeError(error)})`;
    }
  };
  const lines = [
    `user agent: ${navigator.userAgent}`,
    `ua-ch: ${nav.userAgentData?.platform ?? "n/a"} ${(nav.userAgentData?.brands ?? []).map((b) => `${b.brand} ${b.version}`).join(", ")}`,
    `window.origin: ${window.origin}`,
    `location: ${location.protocol}//${location.host} (${location.pathname.slice(0, 40)})`,
    `referrer: ${document.referrer || "(none)"}`,
    `framed: ${framed}; secure context: ${window.isSecureContext}; cross-origin isolated: ${window.crossOriginIsolated}`,
    `viewport: ${innerWidth}x${innerHeight} @${devicePixelRatio}x`,
    `WebAssembly: ${typeof WebAssembly}; compileStreaming: ${typeof WebAssembly?.compileStreaming}; SharedArrayBuffer: ${typeof SharedArrayBuffer}`,
    `AudioContext: ${typeof AudioContext}; webkitAudioContext: ${typeof (window as unknown as { webkitAudioContext?: unknown }).webkitAudioContext}; audioWorklet in prototype: ${"audioWorklet" in (globalThis.AudioContext?.prototype ?? {})}`,
    `document.cookie: ${access(() => document.cookie)}; localStorage: ${access(() => localStorage.length)}`,
    `top.location: ${access(() => window.top?.location.href)}`,
    `user activation now: ${nav.userActivation?.isActive ?? "n/a"}`,
    `permissions policy autoplay allowed: ${policy ? policy.allowsFeature("autoplay") : "n/a"}`,
  ];
  record({
    id: "env",
    title: "Environment",
    status: "info",
    detail: lines.join("\n"),
  });
  return lines;
}

/** Tries things a strict CSP blocks, so the violation events name the policy. */
export async function cspProbes(): Promise<void> {
  await step("csp.eval", "eval-like code (script-src unsafe-eval)", async () => {
    new Function("return 1")();
    return "allowed";
  });
  await step(
    "csp.wasm",
    "WebAssembly.compile of an empty module (script-src wasm-unsafe-eval)",
    async () => {
      await WebAssembly.compile(TINY_WASM);
      return "allowed";
    },
  );
  await step("csp.blob-worker", "new Worker(blob:) (worker-src blob:)", async () => {
    const url = URL.createObjectURL(new Blob(["self.postMessage(1)"]));
    try {
      const worker = new Worker(url);
      await new Promise<void>((resolve, reject) => {
        worker.onmessage = () => resolve();
        worker.onerror = (e) => reject(new Error(e.message || "worker error"));
        setTimeout(() => reject(new Error("no message in 1.5 s")), 1500);
      });
      worker.terminate();
      return "allowed";
    } finally {
      URL.revokeObjectURL(url);
    }
  });
  await step("csp.connect", "fetch to an undeclared origin (connect-src)", async () => {
    await fetch("https://example.com/", { mode: "no-cors" });
    return { status: "info", detail: "allowed (expected blocked under an MCP Apps CSP)" };
  });
  // Violation events are queued; give them a turn before the report is read.
  await new Promise((r) => setTimeout(r, 100));
}

export async function engineFiles(
  source: string,
  base: string,
): Promise<ArrayBuffer | undefined> {
  const id = (name: string) => `${source}.${name}`;
  let bytes: ArrayBuffer | undefined;

  await step(id("fetch-worklet"), `fetch worklet JS from ${base}`, async () => {
    const response = await fetch(`${base}/fugue-audio-worklet.js`);
    const text = await response.text();
    return `HTTP ${response.status}, ${response.headers.get("content-type")}, ${kb(text.length)}`;
  });
  await step(id("fetch-wasm"), "fetch engine .wasm", async () => {
    const response = await fetch(`${base}/generated/fugue_bg.wasm`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    bytes = await response.arrayBuffer();
    return `HTTP ${response.status}, ${response.headers.get("content-type")}, ${kb(bytes.byteLength)}`;
  });
  if (!bytes) return undefined;
  const wasm = bytes;

  await step(id("compile-buffer"), "WebAssembly.compile (ArrayBuffer path)", async () => {
    const module = await WebAssembly.compile(wasm.slice(0));
    return `${WebAssembly.Module.imports(module).length} imports, ${WebAssembly.Module.exports(module).length} exports`;
  });
  await step(id("compile-streaming"), "WebAssembly.compileStreaming (streaming path)", async () => {
    if (typeof WebAssembly.compileStreaming !== "function") {
      return { status: "skip", detail: "compileStreaming is not available" };
    }
    await WebAssembly.compileStreaming(fetch(`${base}/generated/fugue_bg.wasm`));
    return "compiled";
  });
  for (const [path, label] of [
    ["buffer", "ArrayBuffer"],
    ["streaming", "streaming"],
  ] as const) {
    await step(id(`instantiate-${path}`), `engine instantiate via glue (${label})`, async () => {
      const glue = (await import(
        /* webpackIgnore: true */ `${base}/generated/fugue.js?probe=${path}`
      )) as Glue;
      await glue.default({
        module_or_path:
          path === "buffer" ? wasm.slice(0) : fetch(`${base}/generated/fugue_bg.wasm`),
      });
      const engine = new glue.FugueEngine(48000);
      const status = engine.status();
      engine.free();
      return `FugueEngine ran: ${status}`;
    });
  }
  return bytes;
}

/** AudioWorklet module loads that need no tap: by URL, and a blob for comparison. */
export async function worklets(source: string, base: string, wasm?: ArrayBuffer): Promise<void> {
  const id = (name: string) => `${source}.${name}`;

  await step(id("worklet-blob"), "audioWorklet.addModule(blob: URL), comparison", async () => {
    const context = new AudioContext();
    const url = URL.createObjectURL(new Blob([TINY_PROCESSOR], { type: "application/javascript" }));
    try {
      await context.audioWorklet.addModule(url);
      return "allowed";
    } finally {
      URL.revokeObjectURL(url);
      void context.close();
    }
  });

  const context = new AudioContext();
  try {
    const added = await step(
      id("worklet-url"),
      `audioWorklet.addModule(${base}/fugue-audio-worklet.js)`,
      async () => {
        await context.audioWorklet.addModule(`${base}/fugue-audio-worklet.js`);
        return `module added (context ${context.state}, ${context.sampleRate} Hz)`;
      },
    );
    if (!added || !wasm) return;
    await step(id("worklet-engine"), "engine ready inside the worklet (wasm instantiated there)", async () => {
      const node = new AudioWorkletNode(context, "fugue-audio-worklet", {
        numberOfInputs: 0,
        numberOfOutputs: 1,
        outputChannelCount: [2],
        processorOptions: { sampleRate: context.sampleRate, wasmBytes: wasm.slice(0) },
      });
      const outcome = await new Promise<string>((resolve) => {
        node.port.onmessage = (event: MessageEvent<{ type: string; error?: string }>) => {
          if (event.data?.type === "ready") resolve("ready");
          if (event.data?.type === "error") resolve(`error: ${event.data.error}`);
        };
        node.onprocessorerror = () => resolve("processorerror");
        setTimeout(() => resolve("timeout"), 4000);
      });
      node.disconnect();
      if (outcome === "ready") return `worklet reported ready (context ${context.state})`;
      if (outcome === "timeout") {
        return {
          status: "info",
          detail: `no ready message in 4 s with the context ${context.state}; the audio test decides this`,
        };
      }
      throw new Error(outcome);
    });
  } finally {
    void context.close();
  }
}
