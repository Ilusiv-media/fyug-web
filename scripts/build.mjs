// Bundles the page script and copies the published engine files into
// public/engine/ so this deployment can serve them as the second source.

import { build } from "esbuild";
import { cpSync, mkdirSync, rmSync } from "node:fs";

await build({
  entryPoints: ["app/client.ts"],
  bundle: true,
  format: "iife",
  target: "es2022",
  platform: "browser",
  outfile: "app/client.bundle.js",
  legalComments: "none",
  minify: true,
});

const dist = "node_modules/@ilusiv/fugue-js/dist";
rmSync("public/engine", { recursive: true, force: true });
mkdirSync("public/engine", { recursive: true });
cpSync(dist, "public/engine", {
  recursive: true,
  filter: (src) => !src.endsWith(".map") && !src.endsWith(".d.ts"),
});
console.log("built app/client.bundle.js and public/engine/");
