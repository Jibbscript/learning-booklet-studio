#!/usr/bin/env node

import { access, mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import path from "node:path";
import process from "node:process";

const engineUrl = new URL("../../../packages/workflow-engine/index.mjs", import.meta.url);

function fail(message, details = {}, exitCode = 2) {
  console.error(`${JSON.stringify({ status: "error", message, ...details }, null, 2)}\n`);
  process.exit(exitCode);
}

function usage(message) {
  if (message) console.error(message);
  console.error(`Usage:
  workflow-state.mjs create --workspace <path> --mode <mode> [--request <json-or-text-file>] [--run-id <id>] [--thread-id <id>] [--now <iso-time>] [--run <run-root>]
  workflow-state.mjs resume --workspace <path> --run <parent-run-root-or-state-file> --resume <json-file> [--run-id <id>] [--now <iso-time>] [--child-run <run-root>]
  workflow-state.mjs show --run <run-root-or-state-file>
  workflow-state.mjs apply --run <run-root-or-state-file> --command <type> --payload <json-file> [--expected-version <number>] [--idempotency-key <key>] [--now <iso-time>]`);
  process.exit(2);
}

function parseArgs(argv) {
  const [action, ...tokens] = argv;
  if (!action || !["create", "resume", "show", "apply"].includes(action)) usage("A valid action is required.");
  const options = {};
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (!token.startsWith("--")) usage(`Unexpected argument: ${token}`);
    const key = token.slice(2);
    const value = tokens[index + 1];
    if (!value || value.startsWith("--")) usage(`Missing value for --${key}`);
    if (Object.hasOwn(options, key)) usage(`Duplicate option: --${key}`);
    options[key] = value;
    index += 1;
  }
  return { action, options };
}

async function loadEngine() {
  try {
    return await import(engineUrl.href);
  } catch (error) {
    fail("The bundled workflow engine could not be loaded.", { reason: error.message });
  }
}

async function readJson(file, label) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch (error) {
    fail(`Cannot read ${label}.`, { path: file, reason: error.message });
  }
}

async function atomicWriteJson(file, value) {
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.${randomUUID()}.tmp`);
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
  await rename(temporary, file);
}

function stateFileFrom(run) {
  const resolved = path.resolve(run);
  return path.basename(resolved) === "run-state.json" ? resolved : path.join(resolved, "run-state.json");
}

function safeRunRoot(workspace, requestedRun, runId) {
  const root = requestedRun
    ? path.resolve(requestedRun)
    : path.join(workspace, ".learning-booklet", "runs", runId);
  const relative = path.relative(workspace, root);
  if (
    !relative ||
    relative.startsWith(`..${path.sep}`) ||
    relative === ".." ||
    path.parse(root).root === root ||
    root === homedir()
  ) {
    fail("The run root must be a dedicated directory inside the workspace.", { workspace, runRoot: root });
  }
  return root;
}

function safeRunId(value) {
  const runId = value ?? `${new Date().toISOString().replaceAll(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}`;
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(runId)) {
    fail("run-id must contain only letters, numbers, dots, underscores, and hyphens.", { runId });
  }
  return runId;
}

function suppliedTime(value) {
  if (value === undefined) return undefined;
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) ||
    Number.isNaN(Date.parse(value)) ||
    new Date(value).toISOString() !== value
  ) {
    usage("--now must use canonical UTC ISO-8601 form with millisecond precision");
  }
  return value;
}

async function loadIntent(requestFile) {
  if (!requestFile) return {};
  let raw;
  try {
    raw = await readFile(path.resolve(requestFile), "utf8");
  } catch (error) {
    fail("Cannot read the request file.", { path: requestFile, reason: error.message });
  }
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { userRequest: raw.trim() };
    }
    if (parsed.intent?.fields && typeof parsed.intent.fields === "object") return parsed.intent.fields;
    if (parsed.fields && typeof parsed.fields === "object") return parsed.fields;
    if (parsed.intent && typeof parsed.intent === "object") return parsed.intent;
    return parsed;
  } catch {
    return { userRequest: raw.trim() };
  }
}

function summary(state, stateFile) {
  return {
    status: "ok",
    stateFile,
    runId: state.runId,
    mode: state.mode,
    runStatus: state.status,
    currentLayer: state.currentLayer,
    currentPhase: state.currentPhase,
    stateVersion: state.stateVersion,
    pendingDecision: state.pendingDecision ?? null,
  };
}

async function create(engine, options) {
  if (!options.workspace) usage("create requires --workspace");
  const workspace = path.resolve(options.workspace);
  let workspaceStat;
  try {
    workspaceStat = await stat(workspace);
  } catch (error) {
    fail("The workspace does not exist.", { workspace, reason: error.message });
  }
  if (!workspaceStat.isDirectory()) fail("The workspace must be a directory.", { workspace });

  const runId = safeRunId(options["run-id"]);
  const runRoot = safeRunRoot(workspace, options.run, runId);
  const stateFile = path.join(runRoot, "run-state.json");
  try {
    await access(stateFile);
    fail("A run already exists at this path; refusing to overwrite authoritative state.", { stateFile }, 1);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }

  const mode = options.mode ?? "plan_then_build";
  const intent = await loadIntent(options.request);
  const designRequired = options["design-required"] === undefined
    ? true
    : options["design-required"] !== "false";
  let state;
  try {
    state = engine.createRunState({
      runId,
      threadId: options["thread-id"] ?? runId,
      mode,
      intent,
      designRequired,
      now: suppliedTime(options.now),
    });
  } catch (error) {
    fail("The workflow engine rejected run creation.", {
      code: error.code ?? "ENGINE_ERROR",
      reason: error.message,
      details: error.details ?? {},
    }, 1);
  }
  await atomicWriteJson(stateFile, state);
  process.stdout.write(`${JSON.stringify({ ...summary(state, stateFile), runRoot }, null, 2)}\n`);
}

async function show(options) {
  if (!options.run) usage("show requires --run");
  const stateFile = stateFileFrom(options.run);
  const state = await readJson(stateFile, "run state");
  process.stdout.write(`${JSON.stringify(state, null, 2)}\n`);
}

async function resume(engine, options) {
  if (!options.workspace || !options.run || !options.resume) {
    usage("resume requires --workspace, --run, and --resume");
  }
  const workspace = path.resolve(options.workspace);
  let workspaceStat;
  try {
    workspaceStat = await stat(workspace);
  } catch (error) {
    fail("The workspace does not exist.", { workspace, reason: error.message });
  }
  if (!workspaceStat.isDirectory()) fail("The workspace must be a directory.", { workspace });

  const parentStateFile = stateFileFrom(options.run);
  const parentState = await readJson(parentStateFile, "parent run state");
  const rawResume = await readJson(path.resolve(options.resume), "resume payload");
  const resumeEntries = Array.isArray(rawResume) ? rawResume : rawResume?.resume;
  if (!Array.isArray(resumeEntries)) {
    fail("The resume payload must be an array or an object with a resume array.", {}, 1);
  }

  const runId = safeRunId(options["run-id"]);
  const runRoot = safeRunRoot(workspace, options["child-run"], runId);
  const stateFile = path.join(runRoot, "run-state.json");
  try {
    await access(stateFile);
    fail("A child run already exists at this path; refusing to overwrite authoritative state.", { stateFile }, 1);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }

  let state;
  try {
    state = engine.resumeRunState(parentState, {
      runId,
      threadId: parentState.threadId ?? parentState.runId,
      resume: resumeEntries,
      now: suppliedTime(options.now),
    });
  } catch (error) {
    fail("The workflow engine rejected run resume.", {
      code: error.code ?? "ENGINE_ERROR",
      reason: error.message,
      details: error.details ?? {},
    }, 1);
  }
  await atomicWriteJson(stateFile, state);
  process.stdout.write(`${JSON.stringify({
    ...summary(state, stateFile),
    runRoot,
    parentStateFile,
    threadId: state.threadId,
    parentRunId: state.parentRunId,
    resume: state.resume,
  }, null, 2)}\n`);
}

async function apply(engine, options) {
  if (!options.run || !options.command || !options.payload) {
    usage("apply requires --run, --command, and --payload");
  }
  const stateFile = stateFileFrom(options.run);
  const state = await readJson(stateFile, "run state");
  if (options["expected-version"] !== undefined) {
    const expected = Number(options["expected-version"]);
    if (!Number.isInteger(expected) || expected < 0) usage("--expected-version must be a nonnegative integer");
  }

  const payload = await readJson(path.resolve(options.payload), "command payload");
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    fail("The command payload must be a JSON object.", {}, 1);
  }
  const command = payload.type
    ? { ...payload }
    : { type: options.command, payload };
  if (command.type !== options.command) {
    fail("--command does not match payload.type.", { command: options.command, payloadType: command.type }, 1);
  }
  if (options["idempotency-key"] && !command.idempotencyKey) {
    command.idempotencyKey = options["idempotency-key"];
  }
  if (options["expected-version"] !== undefined) {
    command.expectedStateVersion = Number(options["expected-version"]);
  }

  let outcome;
  try {
    outcome = engine.applyCommand(state, command, { now: suppliedTime(options.now) });
  } catch (error) {
    fail("The workflow command was rejected.", {
      code: error.code ?? "ENGINE_ERROR",
      reason: error.message,
      details: error.details ?? {},
    }, 1);
  }
  const nextState = outcome?.state ?? outcome;
  if (nextState.stateVersion !== state.stateVersion) await atomicWriteJson(stateFile, nextState);
  process.stdout.write(`${JSON.stringify({
    ...summary(nextState, stateFile),
    command: command.type,
    changed: nextState.stateVersion !== state.stateVersion,
    events: outcome?.events ?? [],
    ...(outcome && Object.hasOwn(outcome, "result") ? { result: outcome.result } : {}),
  }, null, 2)}\n`);
}

const { action, options } = parseArgs(process.argv.slice(2));
const engine = await loadEngine();

try {
  if (action === "create") await create(engine, options);
  else if (action === "resume") await resume(engine, options);
  else if (action === "show") await show(options);
  else await apply(engine, options);
} catch (error) {
  fail("Workflow state operation failed.", { reason: error.message });
}
