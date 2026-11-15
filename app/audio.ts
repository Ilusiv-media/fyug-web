// The audio test: runs inside a tap. It plays the built-in tone through the
// real FuguePlayer, then measures the output with an analyser, so a pass does
// not rest on someone's ears alone.

import { TEST_INVENTIONS } from "./invention.js";
import { describeError, record, step } from "./results.js";

export type Mode = "url" | "main" | "embedded";

type Player = {
  loadInvention(json: string): Promise<void>;
  play(): Promise<void>;
  stop(): void;
  setControl(moduleId: string, key: string, value: number): Promise<void>;
  dispose(): Promise<void>;
};

type Options = Record<string, unknown>;

const MODE_TITLE: Record<Mode, string> = {
  url: "worklet and wasm by URL, no fallback",
  main: "main thread (ScriptProcessorNode)",
  embedded: "default: embedded blob worklet, fallback allowed",
};

let current: { player: Player; context: AudioContext; analyser: AnalyserNode } | undefined;

export function hasPlayer(): boolean {
  return current !== undefined;
}

export async function stopPlayer(): Promise<void> {
  const active = current;
  current = undefined;
  if (!active) return;
  try {
    active.player.stop();
    await active.player.dispose();
  } catch {
    // Already stopped.
  }
  await active.context.close().catch(() => undefined);
}

/** Measures the analyser: peak level and the strongest frequency. */
async function measure(analyser: AnalyserNode, sampleRate: number, ms: number) {
  const wave = new Float32Array(analyser.fftSize);
  const spectrum = new Float32Array(analyser.frequencyBinCount);
  let peak = 0;
  let freq = 0;
  let bestDb = -Infinity;
  const end = performance.now() + ms;
  while (performance.now() < end) {
    await new Promise((r) => setTimeout(r, 100));
    analyser.getFloatTimeDomainData(wave);
    for (const v of wave) peak = Math.max(peak, Math.abs(v));
    analyser.getFloatFrequencyData(spectrum);
    spectrum.forEach((db, bin) => {
      if (db > bestDb) {
        bestDb = db;
        freq = (bin * sampleRate) / analyser.fftSize;
      }
    });
  }
  return { peak, freq: bestDb > -100 ? freq : 0 };
}

export async function audioTest(
  mode: Mode,
  base: string,
  quiet: boolean,
  probeContext: AudioContext | undefined,
): Promise<boolean> {
  const id = (name: string) => `audio.${mode}.${name}`;
  await stopPlayer();

  if (probeContext) {
    const before = probeContext.state;
    await step("audio.tap-context", "AudioContext made at load, before and after the tap", async () => {
      await probeContext.resume();
      return `state before tap: ${before}; after resume() in the tap: ${probeContext.state}`;
    });
  }

  const errors: string[] = [];
  const context = new AudioContext();
  const analyser = context.createAnalyser();
  analyser.fftSize = 8192;
  analyser.smoothingTimeConstant = 0;
  if (quiet) {
    // An analyser reads only while something pulls the graph; mute the pull.
    const mute = context.createGain();
    mute.gain.value = 0;
    analyser.connect(mute).connect(context.destination);
  } else {
    analyser.connect(context.destination);
  }
  record({
    id: id("context"),
    title: `AudioContext for "${MODE_TITLE[mode]}"`,
    status: "info",
    detail: `state ${context.state} at creation in the tap, ${context.sampleRate} Hz, baseLatency ${context.baseLatency}`,
  });

  let player: Player | undefined;
  const created = await step(id("create"), `FuguePlayer.create: ${MODE_TITLE[mode]}`, async () => {
    const { FuguePlayer } = (await import(/* webpackIgnore: true */ `${base}/index.js`)) as {
      FuguePlayer: { create(options: Options): Promise<Player> };
    };
    const options: Options = {
      audioContext: context,
      destination: analyser,
      wasmUrl: `${base}/generated/fugue_bg.wasm`,
      onError: (error: Error) => errors.push(describeError(error)),
    };
    if (mode === "url") {
      options.workletUrl = `${base}/fugue-audio-worklet.js`;
      options.preferMainThread = false;
    } else if (mode === "main") {
      options.preferMainThread = true;
    } else {
      delete options.wasmUrl;
      options.preferMainThread = "fallback";
    }
    player = await FuguePlayer.create(options);
    const path = player.constructor.name === "MainThreadFuguePlayer" ? "main thread (ScriptProcessorNode)" : "AudioWorklet";
    return `engine path used: ${path}${errors.length ? `\nreported before falling back: ${errors.join(" | ")}` : ""}`;
  });
  if (!created || !player) {
    await context.close().catch(() => undefined);
    return false;
  }
  current = { player, context, analyser };

  const loaded = await step(id("load"), "loadInvention (built-in tone)", async () => {
    const refused: string[] = [];
    for (const piece of TEST_INVENTIONS) {
      try {
        await player!.loadInvention(piece.json);
        return `loaded the ${piece.name} spelling${refused.length ? `\nrefused first: ${refused.join(" | ")}` : ""}`;
      } catch (error) {
        refused.push(`${piece.name}: ${describeError(error)}`);
      }
    }
    throw new Error(refused.join(" | "));
  });
  if (!loaded) return false;

  const played = await step(id("play"), "play() and measure the output", async () => {
    await player!.play();
    const { peak, freq } = await measure(analyser, context.sampleRate, 900);
    const detail = `context ${context.state}; peak ${peak.toFixed(4)}; strongest frequency ${freq.toFixed(0)} Hz (expect about 220); currentTime ${context.currentTime.toFixed(2)} s`;
    if (peak < 0.002) throw new Error(`silent output. ${detail}`);
    return detail;
  });
  return played;
}

export async function changePitch(): Promise<void> {
  const active = current;
  if (!active) return;
  await step("audio.live-control", "setControl osc.frequency 220 -> 330 while playing", async () => {
    await active.player.setControl("osc", "frequency", 330);
    const { peak, freq } = await measure(active.analyser, active.context.sampleRate, 900);
    const detail = `peak ${peak.toFixed(4)}; strongest frequency ${freq.toFixed(0)} Hz (expect about 330)`;
    if (Math.abs(freq - 330) > 25) throw new Error(`pitch did not move. ${detail}`);
    return detail;
  });
}

export function recordHeard(heard: boolean): void {
  record({
    id: "audio.heard",
    title: "Heard the tone (person's answer)",
    status: heard ? "pass" : "fail",
    detail: heard ? "yes" : "no",
  });
}
