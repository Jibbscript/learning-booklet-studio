#!/usr/bin/env node
import {
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const clientDir = path.join(root, "dist", "client");
const publicAssets = path.join(root, "public", "assets");
const outputDir = path.join(root, "dist", "mcp");
const indexPath = path.join(clientDir, "index.html");

let html = readFileSync(indexPath, "utf8");
const cssMatch = html.match(/<link[^>]+href="([^"]+\.css)"[^>]*>/);
const jsMatch = html.match(/<script[^>]+src="([^"]+\.js)"[^>]*><\/script>/);

if (!cssMatch || !jsMatch) {
  throw new Error("Expected one Vite CSS asset and one Vite JavaScript asset.");
}

const resolveBuiltAsset = (relative) =>
  path.resolve(clientDir, relative.replace(/^\.\//, ""));

const css = readFileSync(resolveBuiltAsset(cssMatch[1]), "utf8");
let js = readFileSync(resolveBuiltAsset(jsMatch[1]), "utf8");

for (const filename of readdirSync(publicAssets)) {
  const filePath = path.join(publicAssets, filename);
  const extension = path.extname(filename).slice(1).toLowerCase();
  const mime = extension === "jpg" || extension === "jpeg" ? "image/jpeg" : `image/${extension}`;
  const dataUri = `data:${mime};base64,${readFileSync(filePath).toString("base64")}`;
  js = js
    .split(`/assets/${filename}`)
    .join(dataUri)
    .split(`./assets/${filename}`)
    .join(dataUri);
}

html = html
  .replace(cssMatch[0], () => `<style>${css}</style>`)
  .replace(
    jsMatch[0],
    () => `<script type="module">${js.replaceAll("</script", "<\\/script")}</script>`,
  );

mkdirSync(outputDir, { recursive: true });
writeFileSync(path.join(outputDir, "widget.html"), html, "utf8");
console.log("Prepared MCP Apps widget: dist/mcp/widget.html");
