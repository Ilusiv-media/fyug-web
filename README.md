# MCP App WASM probe (throwaway)

A diagnostic MCP App that answers one question: on a surface with no local
engine (claude.ai web, Claude iOS, Claude Android), can an MCP App instantiate
Fyug's WASM engine, load its AudioWorklet module by URL from a declared origin,
and play sound? It is a standalone test, not product code.

The server is one stateless streamable-HTTP MCP server (one Vercel function)
with one tool, `wasm_probe`, that opens the page. The page declares the engine
origins in `_meta.ui.csp` (`resourceDomains` and `connectDomains`), runs each
step, shows pass or fail with the error text, and builds a report you can copy
or send to the chat.

Engine files come from two sources, selectable on the page:

- **jsDelivr**: `https://cdn.jsdelivr.net/npm/@ilusiv/fugue-js@2026.5.2/dist`,
  the published package under its old name.
- **this server**: `/engine/*`, a copy of the same package files, served with
  `Access-Control-Allow-Origin: *`. Use it if jsDelivr is ever the problem.

Set the env var `ENGINE_CDN_BASE` on the Vercel project to point the first
source somewhere else. `@ilusiv/fyug-js@2026.5.2` is on npm (published
2026-09-15) and works with the page unchanged:
`ENGINE_CDN_BASE=https://cdn.jsdelivr.net/npm/@ilusiv/fyug-js@2026.5.2/dist`
(redeploy after setting it). Both packages are May engines; a release channel
URL would test today's engine.

## 1. Deploy (Vercel CLI from this directory, or import this repository in Vercel)

```sh
vercel link          # create a NEW project; name it e.g. fyug-wasm-probe;
                     # the code directory is "./" (answer the prompts, keep defaults)
vercel deploy --prod
```

Settings and env vars: none needed. `vercel.json` already sets the build
(`npm run build`: bundles the page, copies the engine files into
`public/engine/`), the function files, the `/mcp` and `/probe` routes and the
CORS headers on `/engine/*`. Use the production URL (`https://<project>.vercel.app`),
not a per-deployment URL.

If the checks below return a Vercel login page or `401`, open the project's
Settings > Deployment Protection and turn Vercel Authentication off for it.
Claude and the sandboxed page cannot sign in to Vercel.

### Confirm it answers

```sh
URL=https://<project>.vercel.app
curl -s "$URL/mcp" -H 'content-type: application/json' \
  -H 'accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"curl","version":"1"}}}'
```

Expected: JSON with `"serverInfo":{"name":"mcp-app-wasm-probe"...}`. For the
full host-style check (tool, `ui://` resource, MIME type, CSP), run:

```sh
npm install && node scripts/check-server.mjs "$URL/mcp"
```

Every line should read `ok`.

### Control run before Claude

Open `$URL/probe` in a normal browser tab on the desktop, then in Safari on the
iPhone and Chrome on the Android phone. It is the same page with no sandbox and
no CSP. Tap "Play: engine worklet by URL". This tells a device or browser limit
apart from a Claude sandbox limit. If the control fails on a phone, stop and
record that: Claude cannot do better.

### Remove it afterward

```sh
vercel project rm fyug-wasm-probe
```

(Use the name you chose.) That deletes the project and its deployments. Also
remove the connector in claude.ai (below). Delete the local `.vercel/` folder.

## 2. Add the connector in claude.ai

1. claude.ai > Customize > Connectors > add a custom connector (on Team or
   Enterprise an Owner adds it under Organization settings > Connectors).
2. Name: `WASM probe`. URL: `https://<project>.vercel.app/mcp`. No sign-in.
3. Mobile only lists a connector you added on web or desktop, so add it there.
4. New chat > `+` > Connectors > turn `WASM probe` on.
5. Send: `Call the wasm_probe tool.` Approve the call. The App renders inline.

Docs: <https://claude.com/docs/connectors/custom/add-unlisted.md>,
<https://claude.com/docs/connectors/building/mcp-apps/getting-started.md>.

## 3. Run it on each surface

Do these in order on **web**, **iOS** and **Android**. The page runs its
checks itself on load (about 10 s). Then:

1. Read the top of the results: "MCP App handshake" should be PASS; the
   `host CSP approved` line shows what Claude granted.
2. Turn the volume low. Tap **Play: engine worklet by URL** (first button).
   Wait about 3 s. Note the result and whether you hear a quiet 220 Hz tone.
3. If it played, tap **Change pitch to 330 Hz** (the tone should rise), then
   **Stop**.
4. Tap **Yes** or **No** under "Did you hear the tone?".
5. Tap **Play: main thread (ScriptProcessor)**, then **Play: default
   (embedded blob)**; these show which fallbacks work.
6. Select **this server (/engine)** under Engine source, tap **Run checks
   again**.
7. Tap **Send report to chat** (easiest on a phone), or **Copy report**, and
   paste the report into the results below. If both fail, select the text in
   the report box by hand.

"Measure only" skips the speakers (the page still measures the engine's
output), for a silent run.

iOS can be inspected from a Mac with Safari's Web Inspector (Develop menu), and
desktop Claude with its Developer Tools; see
<https://claude.com/docs/connectors/building/mcp-apps/troubleshooting.md>.

## 4. Results (fill in)

Date, Claude version and the page's `host:` line go in the first rows.
Mark each step pass, FAIL (with the error text) or n/a.

| | Web (claude.ai) | iOS | Android |
|---|---|---|---|
| Date | | | |
| Device and OS | | | |
| Browser or app version | | | |
| Plain `/probe` control plays | | | |
| MCP App renders, handshake | | | |
| Host CSP approved (line from page) | | | |
| CSP policy line (end of report) | | | |
| `wasm` compile allowed (`csp.wasm`) | | | |
| `blob:` Worker allowed | | | |
| Undeclared origin blocked | | | |
| Fetch engine .wasm from jsDelivr | | | |
| compile: ArrayBuffer / streaming | | | |
| Engine instantiate: ArrayBuffer / streaming | | | |
| `addModule(blob:)` (comparison) | | | |
| `addModule(jsDelivr URL)` | | | |
| Engine ready inside the worklet | | | |
| Same three, from this server's `/engine` | | | |
| AudioContext before tap / after tap | | | |
| Play: worklet by URL, measured output | | | |
| Live `setControl` moves pitch | | | |
| Play: main-thread fallback | | | |
| Play: default embedded path (which path) | | | |
| Heard the tone | | | |
| Notes (Referer, clipboard, layout) | | | |

How to read the outcome:

- `csp.wasm` FAIL means the host's `script-src` lacks `'wasm-unsafe-eval'`.
  The spec has no field for it yet (open proposals:
  <https://github.com/modelcontextprotocol/ext-apps/issues/605> and
  <https://github.com/modelcontextprotocol/ext-apps/pull/667>), and the
  main-thread fallback fails too, because it needs WASM as well.
- `csp.wasm` pass, `addModule(URL)` FAIL: the host's `script-src` does not
  admit the declared origin for worklets.
- Both pass and play passes: an App can run the engine. Check the live
  control and the tone, then compare the fallback rows.
- Play passes with silent output and no tone: look at AudioContext state
  (`suspended` after the tap means the host blocks audio start).

## Local evidence

`local/` runs this page in desktop Chromium and WebKit (Playwright 1.60,
already installed for the product) inside an MCP Apps style host: a host page,
a sandbox proxy on another origin that sets the CSP header, and two nested
sandboxed iframes, built on the SDK's `AppBridge`. It runs the CSP profiles in
`local/csp-profiles.mjs`. It predicts, it does not answer, the Claude question.

```sh
npm install && npm run build          # in this directory
cd local && npm install               # no browser download needed
node run.mjs                          # all profiles, both browsers
node summarize.mjs                    # markdown table from results/runs.json
```

`run.mjs` plays only into an analyser (it checks the box "Measure only"), so
it makes no sound.
