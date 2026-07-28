#!/usr/bin/env node

import { createHash } from "node:crypto";
import { mkdirSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";

import {
  createNativeFailureFixture,
  nativeFailureFixtureReport,
  runNativeFailureRepairFixture,
} from "./native-fixture.mjs";

function parseArgs(tokens) {
  const options = {};
  for (let index = 0; index < tokens.length; index += 2) {
    const key = tokens[index];
    const value = tokens[index + 1];
    if (!key?.startsWith("--") || value === undefined) {
      throw new Error("Arguments must use --name value pairs.");
    }
    options[key.slice(2)] = value;
  }
  if (options.stage && !["failed", "complete"].includes(options.stage)) {
    throw new Error("--stage must be failed or complete.");
  }
  return options;
}

function writeAtomic(outputPath, content) {
  const absolutePath = path.resolve(outputPath);
  const parent = path.dirname(absolutePath);
  mkdirSync(parent, { recursive: true });
  const temporaryPath = path.join(parent, `.${path.basename(absolutePath)}.${process.pid}.tmp`);
  try {
    writeFileSync(temporaryPath, content, { encoding: "utf8", mode: 0o600 });
    renameSync(temporaryPath, absolutePath);
  } catch (error) {
    try {
      unlinkSync(temporaryPath);
    } catch {
      // The temporary file may not have been created.
    }
    throw error;
  }
}

try {
  const args = parseArgs(process.argv.slice(2));
  const options = {
    ...(args["thread-id"] ? { threadId: args["thread-id"] } : {}),
    ...(args["parent-run-id"] ? { parentRunId: args["parent-run-id"] } : {}),
    ...(args["run-id"] ? { runId: args["run-id"] } : {}),
    ...(args.now ? { now: args.now } : {}),
  };
  const result = args.stage === "failed"
    ? createNativeFailureFixture(options)
    : runNativeFailureRepairFixture(options);
  const output = {
    ...nativeFailureFixtureReport(result),
    ...(args["include-state"] === "true" ? { state: result.state } : {}),
  };
  const serialized = `${JSON.stringify(output, null, 2)}\n`;
  if (args.output) {
    writeAtomic(args.output, serialized);
    process.stdout.write(`${JSON.stringify({
      status: "written",
      bytes: Buffer.byteLength(serialized),
      sha256: createHash("sha256").update(serialized).digest("hex"),
    })}\n`);
  } else {
    process.stdout.write(serialized);
  }
} catch (error) {
  process.stderr.write(`${JSON.stringify({ status: "error", code: error.code ?? "FIXTURE_ERROR", message: error.message })}\n`);
  process.exitCode = 1;
}
