// A minimal MCP Apps host page, built on the SDK's AppBridge the way the
// SDK's basic-host example is: a sandbox proxy iframe on another origin, then
// the View's HTML sent to it once it says it is ready.
//   host.html?profile=<csp profile>&inner=<ref|opaque>&sandbox=<port>&resource=<url>

import { AppBridge, PostMessageTransport } from "@modelcontextprotocol/ext-apps/app-bridge";

const params = new URL(location.href).searchParams;
const sandboxPort = params.get("sandbox") ?? "8791";
const profile = params.get("profile") ?? "spec";
const inner = params.get("inner") ?? "ref";

const resource = (await (await fetch("/resource.json")).json()) as {
  html: string;
  csp: Record<string, string[]>;
};

const frame = document.createElement("iframe");
frame.style.cssText = "width:900px;height:1400px;border:1px solid #888";
// What the SDK's basic-host sets on the outer frame.
frame.setAttribute("sandbox", "allow-scripts allow-same-origin allow-forms");
document.body.append(frame);

const ready = new Promise<void>((resolve) => {
  addEventListener("message", (event) => {
    if (event.source === frame.contentWindow && event.data?.method === "ui/notifications/sandbox-proxy-ready") {
      resolve();
    }
  });
});
const url = new URL(`http://localhost:${sandboxPort}/sandbox.html`);
url.searchParams.set("profile", profile);
url.searchParams.set("inner", inner);
url.searchParams.set("csp", JSON.stringify(resource.csp));
frame.src = url.href;
await ready;

const bridge = new AppBridge(
  null,
  { name: "probe-host", version: "1" },
  { message: { text: {} }, sandbox: { csp: resource.csp } },
  { hostContext: { platform: "web", displayMode: "inline", availableDisplayModes: ["inline"], theme: "light", locale: "en-US", userAgent: navigator.userAgent } },
);
bridge.onmessage = async () => ({});
bridge.onsizechange = ({ height }) => {
  if (height) frame.style.height = `${Math.max(height, 400)}px`;
};
bridge.oninitialized = () => {
  void bridge.sendToolInput({ arguments: {} });
  void bridge.sendToolResult({ content: [{ type: "text", text: "The probe page is open." }] });
};
await bridge.connect(new PostMessageTransport(frame.contentWindow!, frame.contentWindow!));
await bridge.sendSandboxResourceReady({ html: resource.html, csp: resource.csp });
document.title = "host ready";
