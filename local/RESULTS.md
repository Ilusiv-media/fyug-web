# Local results (prediction, not the answer)

Run 2026-11-14 on macOS (Darwin 27.2, Apple silicon) with Playwright 1.60.0:
Chromium (Chrome for Testing) 148.0.7778.96 and WebKit 26.4, headless, probe
page v1, engine `@ilusiv/fugue-js@2026.5.2` from jsDelivr, also served from
the local dev server as the "this server" source. Each run opens the page in a
host page with two nested sandboxed iframes (the SDK basic-host layout), the
CSP set as an HTTP header by a sandbox proxy on another origin. The audio test
measured the output with an analyser ("Measure only"), so no sound came out.

This is a prediction. It says what a host following a given CSP would allow in
desktop Chromium and WebKit. It does not say what Claude's iframe (web) or
native WebView (iOS, Android) applies. Playwright's browsers autoplay, so the
"AudioContext state before the tap" row is meaningless here; real devices
start suspended.

CSP profiles (`csp-profiles.mjs`), all with the page's declared origins
(`cdn.jsdelivr.net` and the server's own origin) in `resourceDomains` and
`connectDomains`:

- `spec`: the "CSP Construction from Metadata" example in the MCP Apps
  specification (2026-01-26). `script-src 'self' 'unsafe-inline' <resourceDomains>`;
  no `wasm-unsafe-eval`, no `blob:`, no `worker-src`.
- `spec+wasm`: `spec` plus `'wasm-unsafe-eval'`.
- `spec+wasm+blob`: `spec+wasm` plus `blob:` in `script-src` and a `worker-src`.
- `reference-host`: the SDK basic-host's `buildCspHeader` (`unsafe-eval`, `blob:`,
  `worker-src`). It is looser than the spec; the SDK maintainers say so in
  ext-apps issue 199.

Sandbox variants: `ref` (inner iframe `allow-scripts allow-same-origin
allow-forms`, what the basic-host sets) and `opaque` (inner iframe
`allow-scripts` only, origin `null`). Results are identical between them
except where noted under WebKit.

## Chromium 148

| step | chromium spec/ref | chromium spec+wasm/ref | chromium spec+wasm+blob/ref | chromium reference-host/ref | chromium standalone |
|---|---|---|---|---|---|
| wasm compile allowed by CSP | FAIL | pass | pass | pass | pass |
| blob: Worker allowed | FAIL | FAIL | pass | pass | pass |
| undeclared origin blocked | blocked | blocked | blocked | blocked | NOT blocked |
| fetch .wasm from CDN | pass | pass | pass | pass | pass |
| wasm compile, ArrayBuffer | FAIL | pass | pass | pass | pass |
| wasm compile, streaming | FAIL | pass | pass | pass | pass |
| engine instantiate, ArrayBuffer | FAIL | pass | pass | pass | pass |
| engine instantiate, streaming | FAIL | pass | pass | pass | pass |
| addModule(blob:), comparison | FAIL | FAIL | pass | pass | pass |
| addModule(CDN URL) | pass | pass | pass | pass | pass |
| engine ready in worklet | FAIL | pass | pass | pass | pass |
| FuguePlayer, worklet by URL | FAIL | pass (AudioWorklet) | pass (AudioWorklet) | pass (AudioWorklet) | pass (AudioWorklet) |
| plays, measured output | - | pass | pass | pass | pass |
| live setControl moves pitch | - | pass | pass | pass | pass |
| main-thread ScriptProcessor plays | - | pass | pass | pass | pass |
| default embedded path (creates) | FAIL | pass (main) | pass (AudioWorklet) | pass (AudioWorklet) | pass (AudioWorklet) |
| default embedded path plays | - | pass | pass | pass | pass |
| addModule(this server's URL) | pass | pass | pass | pass | pass |
| engine ready in worklet (this server) | FAIL | pass | pass | pass | pass |


## WebKit 26.4

| step | webkit spec/ref | webkit spec+wasm/ref | webkit spec+wasm+blob/ref | webkit reference-host/ref | webkit standalone |
|---|---|---|---|---|---|
| wasm compile allowed by CSP | pass | pass | pass | pass | pass |
| blob: Worker allowed | FAIL | FAIL | pass | pass | pass |
| undeclared origin blocked | blocked | blocked | blocked | blocked | NOT blocked |
| fetch .wasm from CDN | pass | pass | pass | pass | pass |
| wasm compile, ArrayBuffer | pass | pass | pass | pass | pass |
| wasm compile, streaming | pass | pass | pass | pass | pass |
| engine instantiate, ArrayBuffer | FAIL | pass | pass | pass | pass |
| engine instantiate, streaming | FAIL | pass | pass | pass | pass |
| addModule(blob:), comparison | FAIL | FAIL | pass | pass | pass |
| addModule(CDN URL) | pass | pass | pass | pass | pass |
| engine ready in worklet | pass | pass | pass | pass | pass |
| FuguePlayer, worklet by URL | pass (AudioWorklet) | pass (AudioWorklet) | pass (AudioWorklet) | pass (AudioWorklet) | pass (AudioWorklet) |
| plays, measured output | pass | pass | pass | pass | pass |
| live setControl moves pitch | pass | pass | pass | pass | pass |
| main-thread ScriptProcessor plays | - | pass | pass | pass | pass |
| default embedded path (creates) | FAIL | pass (main) | pass (AudioWorklet) | pass (AudioWorklet) | pass (AudioWorklet) |
| default embedded path plays | - | pass | pass | pass | pass |
| addModule(this server's URL) | pass | pass | pass | pass | pass |
| engine ready in worklet (this server) | pass | pass | pass | pass | pass |


## What it shows

1. Loading the worklet module by URL from a declared origin passes in every
   profile in both browsers (spec `script-src` admits `resourceDomains` for
   worklets). So does fetching the `.wasm` (`connect-src` needs the same
   origin: the engine fetch is a `fetch`, the worklet is a script load, so the
   origin goes in both `connectDomains` and `resourceDomains`).
2. Under the spec's CSP, WASM instantiation fails in Chromium, on the main
   thread and inside the worklet, so no engine path plays. Adding
   `'wasm-unsafe-eval'` is the only change needed for the by-URL worklet path
   and for the ScriptProcessor fallback in both browsers.
3. `blob:` worklets pass only when `blob:` is granted. With `spec+wasm` (the
   closest match to the earlier artifact measurement) the default embedded
   path falls back to ScriptProcessorNode with `AbortError: Unable to load a
   worklet's module`, which is what the issue recorded.
4. WebKit 26.4 enforces the CSP for WASM on the main thread but not inside
   the AudioWorklet scope: under the strict spec CSP the by-URL worklet path
   still plays and `setControl` still works, while the main-thread fallback
   fails. Its empty-module `WebAssembly.compile` also passes where real
   instantiation is refused, so the `csp.wasm` row is not decisive there.
   Treat this as a WebKit quirk that may change; do not design around it.
5. WebKit with the opaque sandbox: `addModule(blob:)` fails even when `blob:`
   is granted, and the default embedded path falls back to the main thread.
6. Undeclared origins are blocked in every sandboxed run; the plain page is the
   control and blocks nothing.

Raw per-run reports are written to `results/` by `run.mjs` (git-ignored).
