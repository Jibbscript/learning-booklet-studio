import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";

import { verifyInstalledCandidate } from "../../scripts/check-installed-candidate.mjs";

const execFileAsync = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

test("the extracted release imports every runtime and executes its native fixture CLI", async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "lbs-installed-package-smoke-"));
  try {
    await execFileAsync(process.execPath, [
      path.join(root, "scripts", "verify-oss-release.mjs"),
      "--allow-partial",
    ], { cwd: root, maxBuffer: 8 * 1024 * 1024 });

    const releaseReportPath = path.join(root, "dist", "release", "release-report.json");
    const report = JSON.parse(await readFile(releaseReportPath, "utf8"));
    const archivePath = path.join(root, "dist", "release", report.candidate.path);
    await execFileAsync("tar", ["-xzf", archivePath, "-C", temporary]);
    const installedRoot = path.join(temporary, "learning-booklet-studio");

    const installed = verifyInstalledCandidate({ installedRoot, releaseReportPath });
    assert.equal(installed.status, "pass", installed.errors?.join("\n"));

    const engine = await import(pathToFileURL(path.join(installedRoot, "dist", "workflow-engine", "index.mjs")));
    assert.equal(typeof engine.createRunState, "function");
    assert.equal(typeof engine.projectCodexSkillUiJourney, "function");
    assert.equal(typeof engine.runNativeFailureRepairFixture, "function");

    const mcp = await import(pathToFileURL(path.join(installedRoot, "dist", "mcp", "server.mjs")));
    assert.equal(typeof mcp.createWorkflowServer, "function");

    const fixtureOutput = path.join(temporary, "retained", "native-fixture.json");
    const cliPath = path.join(installedRoot, "dist", "workflow-engine", "native-fixture-cli.mjs");
    const { stdout, stderr } = await execFileAsync(process.execPath, [
      cliPath,
      "--stage", "complete",
      "--thread-id", "installed-smoke-thread",
      "--parent-run-id", "installed-smoke-parent",
      "--run-id", "installed-smoke-run",
      "--now", "2026-07-22T12:00:00.000Z",
      "--output", fixtureOutput,
    ], { cwd: installedRoot, maxBuffer: 8 * 1024 * 1024 });
    assert.equal(stderr, "");
    assert.equal(JSON.parse(stdout).status, "written");
    const fixture = JSON.parse(await readFile(fixtureOutput, "utf8"));
    assert.equal(fixture.status, "pass");
    assert.equal(fixture.final.releaseDecision, "pass");
    assert.equal(fixture.lineage.resumedRunId, "installed-smoke-run");

    for (const relativePath of [
      "evidence/intel-macos-native/capture-host.sh",
      "evidence/intel-macos-native/prepare-marketplace.sh",
      "evidence/intel-macos-native/run-keyboard-selection.sh",
      "evidence/intel-macos-native/capture-chatgpt-window.sh",
    ]) {
      const mode = (await stat(path.join(installedRoot, relativePath))).mode & 0o777;
      assert.equal(mode, 0o755, `${relativePath} must remain directly executable after extraction`);
    }
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});
