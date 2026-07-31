#!/usr/bin/env node

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const engineUrl = new URL("../lib/index.mjs", import.meta.url);

function usage(message) {
  if (message) console.error(message);
  console.error("Usage: verify-release.mjs --run <run-root-or-run-state.json> [--report <release-manifest.json>]");
  process.exit(2);
}

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith("--") || !value) usage(`Invalid argument near ${key ?? "end"}`);
    result[key.slice(2)] = value;
  }
  return result;
}

const options = parseArgs(process.argv.slice(2));
if (!options.run) usage("--run is required");

const runPath = path.resolve(options.run);
const stateFile = path.basename(runPath) === "run-state.json" ? runPath : path.join(runPath, "run-state.json");
let state;
let engine;
try {
  [state, engine] = await Promise.all([
    readFile(stateFile, "utf8").then(JSON.parse),
    import(engineUrl.href),
  ]);
} catch (error) {
  console.error(`${JSON.stringify({ status: "not_run", stateFile, reason: error.message }, null, 2)}\n`);
  process.exit(2);
}

let decision;
try {
  const outcome = engine.applyCommand(state, {
    type: "release.decide",
    payload: { evaluatedAt: new Date().toISOString() },
  });
  decision = outcome.result;
} catch (error) {
  console.error(`${JSON.stringify({
    status: "not_run",
    stateFile,
    code: error.code ?? "ENGINE_ERROR",
    reason: error.message,
    details: error.details ?? {},
  }, null, 2)}\n`);
  process.exit(2);
}

const eventLog = typeof engine.validateEventLog === "function"
  ? engine.validateEventLog(state)
  : { valid: false, errors: ["workflow-engine.validateEventLog is unavailable"] };
if (!eventLog.valid) {
  decision.decision = "fail";
  decision.terminalStatus = "failed_gate";
  decision.blockingReasons = [...new Set([...(decision.blockingReasons ?? []), "invalid_event_log"])];
}

const report = {
  status: decision.decision === "pass" ? "pass" : "fail",
  mode: state.mode,
  stateVersion: state.stateVersion,
  stateFile,
  eventLog,
  ...decision,
};

if (options.report) {
  const reportPath = path.resolve(options.report);
  await mkdir(path.dirname(reportPath), { recursive: true });
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
}
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
process.exit(report.status === "pass" ? 0 : 1);
