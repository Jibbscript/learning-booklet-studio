import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  NATIVE_MACOS_PROFILES,
  releaseDecision,
  validateNativeEvidence,
} from "../../scripts/verify-oss-release.mjs";

const ARCHIVE_SHA = "a".repeat(64);
const CONTENT_SHA = "b".repeat(64);
const VERSION = "0.1.0";
const PNG_FIXTURE = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function writeEvidence({ profile, architecture, executableArchitecture } = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "lbs-native-evidence-"));
  const artifact = Buffer.from("<!doctype html><title>fixture artifact</title>\n");
  const artifactSha = sha256(artifact);
  await writeFile(path.join(directory, "index.html"), artifact);
  const attachmentSpecs = [
    { path: "environment.txt", kind: "environment", group: "environment" },
    { path: "candidate-binding.txt", kind: "test-result", group: "candidate-binding" },
    { path: "explicit-discovery.png", kind: "screenshot", group: "explicit-discovery" },
    { path: "implicit-discovery.png", kind: "screenshot", group: "implicit-discovery" },
    { path: "interruption.log", kind: "log", group: "interruption" },
    { path: "resume.log", kind: "log", group: "resume" },
    { path: "failure-repair-history.json", kind: "test-result", group: "failure-repair-history" },
    { path: "degraded-recovery.png", kind: "screenshot", group: "degraded-recovery" },
    { path: "restart-reconciliation.log", kind: "log", group: "restart-reconciliation" },
    { path: "keyboard-selection.log", kind: "log", group: "keyboard-selection" },
    { path: "voiceover-checklist.md", kind: "checklist", group: "voiceover" },
    { path: "layout-narrow.png", kind: "screenshot", group: "responsive-layout", layoutContext: "narrow" },
    { path: "layout-normal.png", kind: "screenshot", group: "responsive-layout", layoutContext: "normal" },
    { path: "layout-fullscreen.png", kind: "screenshot", group: "responsive-layout", layoutContext: "fullscreen" },
    { path: "validation-results.txt", kind: "test-result", group: "validation-results" },
  ];
  const groupAttachments = [];
  for (const spec of attachmentSpecs) {
    const visual = spec.kind === "screenshot" || spec.kind === "recording";
    const content = visual ? PNG_FIXTURE : Buffer.from(`${spec.group} validator fixture evidence\n`);
    await writeFile(path.join(directory, spec.path), content);
    groupAttachments.push({
      path: spec.path,
      sha256: sha256(content),
      kind: spec.kind,
      group: spec.group,
      ...(spec.layoutContext ? { layoutContext: spec.layoutContext } : {}),
      privacyReview: {
        method: visual ? "manual-visual-review" : "automated-text-scan",
        status: "pass",
        reviewedAt: "2026-07-22T00:05:00.000Z",
        reviewer: "release verifier fixture",
      },
    });
  }
  const artifactAttachment = {
    path: "index.html",
    sha256: artifactSha,
    kind: "artifact",
    group: "completed-artifact",
    privacyReview: {
      method: "automated-text-scan",
      status: "pass",
      reviewedAt: "2026-07-22T00:05:00.000Z",
      reviewer: "release verifier fixture",
    },
  };
  const refsByCheck = {
    "MAC-001": ["environment.txt"],
    "MAC-002": ["environment.txt", "candidate-binding.txt"],
    "MAC-003": ["explicit-discovery.png", "implicit-discovery.png"],
    "MAC-004": ["interruption.log", "resume.log", "failure-repair-history.json", "index.html"],
    "MAC-005": [
      "keyboard-selection.log",
      "degraded-recovery.png",
      "restart-reconciliation.log",
      "voiceover-checklist.md",
      "layout-narrow.png",
      "layout-normal.png",
      "layout-fullscreen.png",
    ],
    "MAC-006": ["validation-results.txt"],
  };
  const runningArchitecture = architecture ?? profile.architecture;
  const evidence = {
    schemaVersion: 1,
    gate: profile.id,
    status: "pass",
    architecture: architecture ?? profile.architecture,
    translated: false,
    macOS: { version: "15.7.7", build: "24G720" },
    hardware: { modelName: "Test Mac", modelIdentifier: "Test1,1", processor: "Fixture CPU" },
    chatgptDesktop: {
      bundleIdentifier: "com.openai.codex",
      version: "26.715.72028",
      build: "5706",
      surface: "Codex",
      mainExecutableArchitecture: executableArchitecture ?? [...profile.executableArchitectures][0],
      mainExecutableSha256: "e".repeat(64),
      codeDirectoryHash: "fixture-code-directory-hash",
      requiresNativeExecution: true,
      runningProgram: "/Applications/ChatGPT.app/Contents/MacOS/ChatGPT",
      runningPid: 4242,
      runningProcessArchitecture: runningArchitecture,
      runningProcessArchitectureMethod: "proc_pidinfo-PROC_PIDARCHINFO",
      runningProcessArchitectureStatus: "pass",
    },
    plugin: {
      version: VERSION,
      archiveSha256: ARCHIVE_SHA,
      contentDigest: CONTENT_SHA,
      installed: true,
      marketplace: "learning-booklet-native-test",
    },
    modelObserved: "GPT-5.6 Sol",
    runId: "fixture-run",
    artifactSha256: artifactSha,
    journeyIdentities: {
      explicitDiscovery: {
        observationId: "observation-explicit",
        taskId: "task-explicit",
        threadId: "thread-explicit",
        runId: "explicit-run",
        parentRunId: null,
        observedAt: "2026-07-22T00:00:00.000Z",
      },
      implicitDiscovery: {
        observationId: "observation-implicit",
        taskId: "task-representative",
        threadId: "thread-representative",
        runId: "parent-run",
        parentRunId: null,
        observedAt: "2026-07-22T00:01:00.000Z",
      },
      interrupted: {
        observationId: "observation-interrupted",
        taskId: "task-representative",
        threadId: "thread-representative",
        runId: "parent-run",
        parentRunId: null,
        mcpProcessId: 111,
        observedAt: "2026-07-22T00:02:00.000Z",
      },
      resumed: {
        observationId: "observation-resumed",
        taskId: "task-representative",
        threadId: "thread-representative",
        runId: "fixture-run",
        parentRunId: "parent-run",
        mcpProcessId: 111,
        observedAt: "2026-07-22T00:03:00.000Z",
      },
      restarted: {
        observationId: "observation-restarted",
        taskId: "task-representative",
        threadId: "thread-representative",
        runId: "fixture-run",
        parentRunId: "parent-run",
        mcpProcessId: 222,
        observedAt: "2026-07-22T00:04:00.000Z",
      },
    },
    keyboardSelection: {
      status: "pass",
      keysUsed: ["Tab", "Enter"],
      activationKey: "Enter",
      prohibitedInputObserved: false,
      evidenceRef: "keyboard-selection.log",
    },
    checks: ["MAC-001", "MAC-002", "MAC-003", "MAC-004", "MAC-005", "MAC-006"].map((id) => ({
      id,
      status: "pass",
      executed: true,
      summary: "Fixture-only validator coverage.",
      evidenceRefs: refsByCheck[id],
    })),
    attachments: [...groupAttachments, artifactAttachment],
    observedAt: "2026-07-22T00:00:00.000Z",
    tester: "release verifier fixture",
  };
  const evidencePath = path.join(directory, "evidence.json");
  await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
  return { directory, evidencePath };
}

test("Intel and Apple Silicon native evidence validate as independent exact-candidate gates", async () => {
  for (const profile of Object.values(NATIVE_MACOS_PROFILES)) {
    const { evidencePath } = await writeEvidence({ profile });
    const result = validateNativeEvidence(evidencePath, ARCHIVE_SHA, CONTENT_SHA, VERSION, profile);
    assert.deepEqual(result, {
      id: profile.id,
      status: "pass",
      summary: `${profile.label} evidence matches the exact candidate archive.`,
    });
  }
});

test("Apple Silicon evidence is advisory and does not block an Intel-proven production release", () => {
  const decision = releaseDecision([
    { id: "repository-policy", status: "pass" },
    { id: "candidate-package", status: "pass" },
    { id: "native-macos-intel", status: "pass", productionRequired: true },
    {
      id: "native-macos-apple-silicon",
      status: "not_run",
      summary: "No Native Apple Silicon macOS evidence was supplied.",
      productionRequired: false,
    },
  ]);
  assert.deepEqual(decision, {
    status: "pass",
    blockers: [],
    advisories: [
      "native-macos-apple-silicon: No Native Apple Silicon macOS evidence was supplied.",
    ],
  });
});

test("failed Apple Silicon evidence remains advisory and cannot block production", () => {
  const decision = releaseDecision([
    { id: "repository-policy", status: "pass" },
    { id: "candidate-package", status: "pass" },
    { id: "native-macos-intel", status: "pass", productionRequired: true },
    {
      id: "native-macos-apple-silicon",
      status: "fail",
      summary: "Native Apple Silicon macOS evidence is incomplete or stale.",
      productionRequired: false,
    },
  ]);
  assert.deepEqual(decision, {
    status: "pass",
    blockers: [],
    advisories: [
      "native-macos-apple-silicon: Native Apple Silicon macOS evidence is incomplete or stale.",
    ],
  });
});

test("Apple Silicon evidence cannot substitute for required Intel production evidence", () => {
  const decision = releaseDecision([
    {
      id: "native-macos-intel",
      status: "not_run",
      summary: "No Native Intel macOS evidence was supplied.",
      productionRequired: true,
    },
    { id: "native-macos-apple-silicon", status: "pass", productionRequired: false },
  ]);
  assert.deepEqual(decision, {
    status: "partial",
    blockers: ["native-macos-intel: No Native Intel macOS evidence was supplied."],
    advisories: [],
  });
});

test("one architecture cannot satisfy the other architecture gate", async () => {
  const { evidencePath } = await writeEvidence({ profile: NATIVE_MACOS_PROFILES.intel });
  const result = validateNativeEvidence(
    evidencePath,
    ARCHIVE_SHA,
    CONTENT_SHA,
    VERSION,
    NATIVE_MACOS_PROFILES.appleSilicon,
  );
  assert.equal(result.status, "fail");
  assert.ok(result.gaps.some((gap) => gap.includes("gate/status")));
  assert.ok(result.gaps.some((gap) => gap.includes("arm64")));
});

test("a stale candidate digest or altered attachment fails closed", async () => {
  const { directory, evidencePath } = await writeEvidence({ profile: NATIVE_MACOS_PROFILES.intel });
  await writeFile(path.join(directory, "environment.txt"), "tampered\n");
  const result = validateNativeEvidence(
    evidencePath,
    "d".repeat(64),
    CONTENT_SHA,
    VERSION,
    NATIVE_MACOS_PROFILES.intel,
  );
  assert.equal(result.status, "fail");
  assert.ok(result.gaps.includes("plugin archive SHA-256 does not match this candidate"));
  assert.ok(result.gaps.includes("attachment digest mismatch: environment.txt"));
  assert.match(await readFile(evidencePath, "utf8"), /fixture-run/);
});

test("native evidence must satisfy the shared strict schema", async () => {
  const { evidencePath } = await writeEvidence({ profile: NATIVE_MACOS_PROFILES.intel });
  const evidence = JSON.parse(await readFile(evidencePath, "utf8"));
  delete evidence.chatgptDesktop.runningProgram;
  await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);

  const result = validateNativeEvidence(
    evidencePath,
    ARCHIVE_SHA,
    CONTENT_SHA,
    VERSION,
    NATIVE_MACOS_PROFILES.intel,
  );
  assert.equal(result.status, "fail");
  assert.ok(result.gaps.some((gap) => gap.includes("schema /chatgptDesktop") && gap.includes("runningProgram")));
});

test("passing check references and artifact digest must resolve to retained attachments", async () => {
  const { evidencePath } = await writeEvidence({ profile: NATIVE_MACOS_PROFILES.intel });
  const evidence = JSON.parse(await readFile(evidencePath, "utf8"));
  evidence.checks[0].evidenceRefs = ["missing.txt"];
  evidence.artifactSha256 = "d".repeat(64);
  await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);

  const result = validateNativeEvidence(
    evidencePath,
    ARCHIVE_SHA,
    CONTENT_SHA,
    VERSION,
    NATIVE_MACOS_PROFILES.intel,
  );
  assert.equal(result.status, "fail");
  assert.ok(result.gaps.includes("MAC-001 evidenceRef is not a listed attachment: missing.txt"));
  assert.ok(result.gaps.includes("artifactSha256 does not match a completed-artifact attachment of kind artifact"));
});

test("artifactSha256 cannot bind to a non-artifact attachment", async () => {
  const { evidencePath } = await writeEvidence({ profile: NATIVE_MACOS_PROFILES.intel });
  const evidence = JSON.parse(await readFile(evidencePath, "utf8"));
  evidence.artifactSha256 = evidence.attachments.find(({ group }) => group === "environment").sha256;
  await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);

  const result = validateNativeEvidence(
    evidencePath,
    ARCHIVE_SHA,
    CONTENT_SHA,
    VERSION,
    NATIVE_MACOS_PROFILES.intel,
  );
  assert.equal(result.status, "fail");
  assert.ok(result.gaps.includes("artifactSha256 does not match a completed-artifact attachment of kind artifact"));
});

test("native evidence rejects a private path even when the attachment digest is current", async () => {
  const { directory, evidencePath } = await writeEvidence({ profile: NATIVE_MACOS_PROFILES.intel });
  const privateContent = Buffer.from(`workspace=${["", "Users", "fixture-user", "private-run"].join("/")}\n`);
  await writeFile(path.join(directory, "environment.txt"), privateContent);
  const evidence = JSON.parse(await readFile(evidencePath, "utf8"));
  evidence.attachments.find(({ path: entryPath }) => entryPath === "environment.txt").sha256 = sha256(privateContent);
  await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);

  const result = validateNativeEvidence(
    evidencePath,
    ARCHIVE_SHA,
    CONTENT_SHA,
    VERSION,
    NATIVE_MACOS_PROFILES.intel,
  );
  assert.equal(result.status, "fail");
  assert.ok(result.gaps.some((gap) => gap.includes("macOS user-home path")));
});

test("native evidence privacy-scans string values in the manifest itself", async () => {
  const { evidencePath } = await writeEvidence({ profile: NATIVE_MACOS_PROFILES.intel });
  const evidence = JSON.parse(await readFile(evidencePath, "utf8"));
  evidence.limitations = [`captured from ${["", "Users", "fixture-user", "private-task"].join("/")}`];
  await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);

  const result = validateNativeEvidence(
    evidencePath,
    ARCHIVE_SHA,
    CONTENT_SHA,
    VERSION,
    NATIVE_MACOS_PROFILES.intel,
  );
  assert.equal(result.status, "fail");
  assert.ok(result.gaps.some((gap) => gap.includes("Evidence manifest contains") && gap.includes("macOS user-home path")));
});

test("native evidence enforces terminal parent and new child run lineage", async () => {
  const { evidencePath } = await writeEvidence({ profile: NATIVE_MACOS_PROFILES.intel });
  const evidence = JSON.parse(await readFile(evidencePath, "utf8"));
  evidence.journeyIdentities.resumed.runId = evidence.journeyIdentities.interrupted.runId;
  await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);

  const result = validateNativeEvidence(
    evidencePath,
    ARCHIVE_SHA,
    CONTENT_SHA,
    VERSION,
    NATIVE_MACOS_PROFILES.intel,
  );
  assert.equal(result.status, "fail");
  assert.ok(result.gaps.some((gap) => gap.includes("resumed child run must use a new runId")));
});

test("passing restart evidence requires resumed and restarted MCP process identities", async () => {
  for (const identityName of ["resumed", "restarted"]) {
    const { evidencePath } = await writeEvidence({ profile: NATIVE_MACOS_PROFILES.intel });
    const evidence = JSON.parse(await readFile(evidencePath, "utf8"));
    delete evidence.journeyIdentities[identityName].mcpProcessId;
    await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);

    const result = validateNativeEvidence(
      evidencePath,
      ARCHIVE_SHA,
      CONTENT_SHA,
      VERSION,
      NATIVE_MACOS_PROFILES.intel,
    );
    assert.equal(result.status, "fail", `${identityName} without mcpProcessId must fail`);
    assert.ok(
      result.gaps.some((gap) => gap.includes(`/journeyIdentities/${identityName}`) && gap.includes("mcpProcessId")),
      `${identityName} schema failure must identify mcpProcessId`,
    );
  }
});

test("restart reconciliation requires an actual MCP PID change", async () => {
  const { evidencePath } = await writeEvidence({ profile: NATIVE_MACOS_PROFILES.intel });
  const evidence = JSON.parse(await readFile(evidencePath, "utf8"));
  evidence.journeyIdentities.restarted.mcpProcessId = evidence.journeyIdentities.resumed.mcpProcessId;
  await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);

  const result = validateNativeEvidence(
    evidencePath,
    ARCHIVE_SHA,
    CONTENT_SHA,
    VERSION,
    NATIVE_MACOS_PROFILES.intel,
  );
  assert.equal(result.status, "fail");
  assert.ok(result.gaps.some((gap) => gap.includes("changed MCP process identity")));
});

test("desktop journey groups reject generic test-result text in place of typed UI evidence", async () => {
  const cases = [
    { group: "explicit-discovery", expectedKind: "screenshot" },
    { group: "implicit-discovery", expectedKind: "screenshot" },
    { group: "degraded-recovery", expectedKind: "screenshot" },
    { group: "keyboard-selection", expectedKind: "log or recording" },
    { group: "voiceover", expectedKind: "checklist or log" },
    { group: "responsive-layout", expectedKind: "screenshot or recording" },
  ];

  for (const fixtureCase of cases) {
    const { evidencePath } = await writeEvidence({ profile: NATIVE_MACOS_PROFILES.intel });
    const evidence = JSON.parse(await readFile(evidencePath, "utf8"));
    evidence.attachments.find(({ group }) => group === fixtureCase.group).kind = "test-result";
    await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);

    const result = validateNativeEvidence(
      evidencePath,
      ARCHIVE_SHA,
      CONTENT_SHA,
      VERSION,
      NATIVE_MACOS_PROFILES.intel,
    );
    assert.equal(result.status, "fail", `${fixtureCase.group} must require ${fixtureCase.expectedKind}`);
    assert.ok(
      result.gaps.some((gap) => gap.includes("schema /attachments")),
      `${fixtureCase.group} substitution must fail the structural attachment schema`,
    );
  }
});

test("responsive layout evidence requires narrow, normal, and fullscreen captures", async () => {
  const { evidencePath } = await writeEvidence({ profile: NATIVE_MACOS_PROFILES.intel });
  const evidence = JSON.parse(await readFile(evidencePath, "utf8"));
  evidence.attachments.find(({ layoutContext }) => layoutContext === "fullscreen").layoutContext = "normal";
  await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);

  const result = validateNativeEvidence(
    evidencePath,
    ARCHIVE_SHA,
    CONTENT_SHA,
    VERSION,
    NATIVE_MACOS_PROFILES.intel,
  );
  assert.equal(result.status, "fail");
  assert.ok(result.gaps.some((gap) => gap.includes("schema /attachments")));
});
