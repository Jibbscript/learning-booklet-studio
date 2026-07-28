import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { validateAutomatedEvidence } from "../../scripts/verify-oss-release.mjs";

const CONTENT_SHA = "b".repeat(64);
const REQUIRED_CHECKS = [
  "repository",
  "schema-and-unit",
  "bdd",
  "mcp",
  "widget",
  "browser-runtime",
  "accessibility",
  "offline-network",
  "secret-and-license",
];

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function writeAutomatedEvidence() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "lbs-automated-evidence-"));
  await mkdir(path.join(directory, "results"));
  const log = Buffer.from("All deterministic checks passed.\n");
  const browser = Buffer.from(`${JSON.stringify({
    result: "pass",
    externalRequests: [],
    consoleErrors: [],
    pageErrors: [],
    viewports: [320, 768, 1440].map((width) => ({ width, pageOverflows: false })),
  }, null, 2)}\n`);
  await writeFile(path.join(directory, "results", "suite.log"), log);
  await writeFile(path.join(directory, "results", "widget-e2e.json"), browser);
  const checks = REQUIRED_CHECKS.map((id) => ({
    id,
    status: "pass",
    executed: true,
    summary: `${id} passed in the retained suite.`,
    resultRefs: [id === "browser-runtime" ? "results/widget-e2e.json" : "results/suite.log"],
  }));
  const evidence = {
    schemaVersion: 1,
    status: "pass",
    subjectSha256: CONTENT_SHA,
    observedAt: "2026-07-22T00:00:00.000Z",
    environment: {
      platform: "darwin",
      architecture: "x86_64",
      node: process.version,
      npm: "11.0.0",
      playwright: "1.61.1",
      browserEngine: "Chromium fixture",
    },
    checks,
    commands: [{
      command: "npm test",
      exitCode: 0,
      status: "pass",
      toolVersion: `Node ${process.version}`,
      resultPath: "results/suite.log",
      resultSha256: sha256(log),
    }],
    attachments: [
      { path: "results/suite.log", sha256: sha256(log), kind: "log" },
      { path: "results/widget-e2e.json", sha256: sha256(browser), kind: "test-result" },
    ],
  };
  const evidencePath = path.join(directory, "automated.json");
  await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
  return { directory, evidencePath };
}

test("automated evidence resolves exact retained results and browser assertions", async () => {
  const { evidencePath } = await writeAutomatedEvidence();
  assert.deepEqual(validateAutomatedEvidence(evidencePath, CONTENT_SHA), {
    id: "automated-test-evidence",
    status: "pass",
    summary: "Automated, browser, accessibility, offline, privacy, and license evidence is current.",
  });
});

test("automated evidence fails closed on duplicate checks and a tampered result", async () => {
  const { directory, evidencePath } = await writeAutomatedEvidence();
  const evidence = JSON.parse(await readFile(evidencePath, "utf8"));
  evidence.checks.push(evidence.checks[0]);
  await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
  await writeFile(path.join(directory, "results", "suite.log"), "tampered\n");

  const result = validateAutomatedEvidence(evidencePath, CONTENT_SHA);
  assert.equal(result.status, "fail");
  assert.ok(result.gaps.includes("check identifier is duplicated: repository"));
  assert.ok(result.gaps.includes("attachment digest mismatch: results/suite.log"));
});

test("automated evidence rejects personal paths in retained textual results", async () => {
  const { directory, evidencePath } = await writeAutomatedEvidence();
  const privateLog = Buffer.from(`workspace=${["", "Users", "example", "private-project"].join("/")}\n`);
  await writeFile(path.join(directory, "results", "suite.log"), privateLog);
  const evidence = JSON.parse(await readFile(evidencePath, "utf8"));
  evidence.attachments[0].sha256 = sha256(privateLog);
  evidence.commands[0].resultSha256 = sha256(privateLog);
  await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);

  const result = validateAutomatedEvidence(evidencePath, CONTENT_SHA);
  assert.equal(result.status, "fail");
  assert.ok(result.gaps.some((gap) => gap.includes("personal absolute path detected")));
});
