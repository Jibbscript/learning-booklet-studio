#!/usr/bin/env node
import { copyFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const entry = path.join(root, "packages", "mcp-server", "server.mjs");
const widget = path.join(root, "packages", "widget", "dist", "mcp", "widget.html");
const sourceMcp = path.join(root, "packages", "mcp-server");
const sourceEngine = path.join(root, "packages", "workflow-engine");
const distMcp = path.join(root, "dist", "mcp");
const distEngine = path.join(root, "dist", "workflow-engine");
const distWidget = path.join(root, "dist", "widget");

for (const required of [entry, widget]) {
  if (!existsSync(required)) {
    throw new Error(`Missing build input: ${required}`);
  }
}

mkdirSync(distMcp, { recursive: true });
mkdirSync(distEngine, { recursive: true });
mkdirSync(distWidget, { recursive: true });

for (const file of readdirSync(sourceMcp).filter((name) => name.endsWith(".mjs"))) {
  copyFileSync(path.join(sourceMcp, file), path.join(distMcp, file));
}
for (const file of readdirSync(sourceEngine).filter((name) => name.endsWith(".mjs"))) {
  copyFileSync(path.join(sourceEngine, file), path.join(distEngine, file));
}

copyFileSync(widget, path.join(distWidget, "widget.html"));
console.log("Copied the deterministic Node runtime and self-contained MCP widget.");
