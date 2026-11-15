// The built-in test piece: one sine voice through a mixer to the speakers.
// Trivial content, quiet (peak about 0.07, -23 dBFS). The published engine package
// (May 2026) names the mixer's ports differently from the current engine, so
// the piece comes in both spellings and the page uses the first that loads.

const link = (from: string, from_port: string, to: string, to_port: string) => ({
  from,
  from_port,
  to,
  to_port,
});

const voice = { id: "osc", type: "oscillator", config: { waveform: "sine", frequency: 220 } };

/** Port names of the engine published as @ilusiv/fugue-js 2026.5.2. */
const published = {
  version: "1.0.0",
  title: "Probe tone",
  modules: [
    voice,
    { id: "mixer", type: "mixer", config: { levels: [0.2], master: 0.5 } },
    { id: "dac", type: "dac" },
  ],
  connections: [
    link("osc", "audio", "mixer", "in1"),
    link("mixer", "left", "dac", "audio_left"),
    link("mixer", "right", "dac", "audio_right"),
  ],
};

/** Port names of the current engine. */
const current = {
  version: "1.0.0",
  title: "Probe tone",
  modules: [
    voice,
    { id: "mixer", type: "mixer", config: { levels: [0.2], master: 0.5 } },
    { id: "dac", type: "dac" },
  ],
  connections: [
    link("osc", "audio", "mixer", "audio.0"),
    link("mixer", "audio_left", "dac", "audio_left"),
    link("mixer", "audio_right", "dac", "audio_right"),
  ],
};

export const TEST_INVENTIONS: { name: string; json: string }[] = [
  { name: "published-engine ports", json: JSON.stringify(published) },
  { name: "current-engine ports", json: JSON.stringify(current) },
];
