import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, symlink, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { verifyInstalledCandidate } from "../../scripts/check-installed-candidate.mjs";

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function canonicalJson(value) {
  const normalize = (entry) => {
    if (Array.isArray(entry)) return entry.map(normalize);
    if (entry && typeof entry === "object") {
      return Object.fromEntries(Object.keys(entry).sort().map((key) => [key, normalize(entry[key])]));
    }
    return entry;
  };
  return `${JSON.stringify(normalize(value), null, 2)}\n`;
}

async function installedFixture() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "lbs-installed-candidate-"));
  const installedRoot = path.join(directory, "plugin");
  await mkdir(installedRoot);
  const payload = Buffer.from("exact installed payload\n");
  await writeFile(path.join(installedRoot, "payload.txt"), payload);
  const files = [{ path: "payload.txt", sha256: sha256(payload), size: payload.length }];
  const contentDigest = sha256(canonicalJson(files));
  const manifest = {
    schemaVersion: 1,
    name: "learning-booklet-studio",
    version: "0.1.0",
    contentDigest,
    files,
  };
  const manifestBytes = Buffer.from(canonicalJson(manifest));
  await writeFile(path.join(installedRoot, "RELEASE-MANIFEST.json"), manifestBytes);
  await writeFile(
    path.join(installedRoot, "SHA256SUMS"),
    `${files[0].sha256}  payload.txt\n${sha256(manifestBytes)}  RELEASE-MANIFEST.json\n`,
  );
  const releaseReportPath = path.join(directory, "release-report.json");
  await writeFile(releaseReportPath, `${JSON.stringify({
    version: "0.1.0",
    contentDigest,
    candidate: { sha256: "a".repeat(64) },
  }, null, 2)}\n`);
  return { installedRoot, releaseReportPath };
}

test("installed candidate reproduces its manifest and exact release identity", async () => {
  const fixture = await installedFixture();
  const result = verifyInstalledCandidate(fixture);
  assert.equal(result.status, "pass");
  assert.equal(result.candidate.archiveSha256, "a".repeat(64));
  assert.equal(result.candidate.installedFileCount, 1);
  assert.equal(result.candidate.checksumsVerified, true);
});

test("installed candidate verification fails after payload tampering", async () => {
  const fixture = await installedFixture();
  await writeFile(path.join(fixture.installedRoot, "payload.txt"), "tampered\n");
  const result = verifyInstalledCandidate(fixture);
  assert.equal(result.status, "fail");
  assert.ok(result.errors.includes("Installed manifest digest or size mismatch: payload.txt"));
});

test("installed candidate verification fails when checksum inventory is altered", async () => {
  const fixture = await installedFixture();
  const sumsPath = path.join(fixture.installedRoot, "SHA256SUMS");
  const current = await readFile(sumsPath, "utf8");
  await writeFile(sumsPath, `${current}${"c".repeat(64)}  undeclared.txt\n`);
  const result = verifyInstalledCandidate(fixture);
  assert.equal(result.status, "fail");
  assert.ok(result.errors.includes("SHA256SUMS contains an undeclared path: undeclared.txt"));
});

test("installed candidate verification rejects undeclared extracted files", async () => {
  const fixture = await installedFixture();
  await writeFile(path.join(fixture.installedRoot, "local-state.json"), "{}\n");
  const result = verifyInstalledCandidate(fixture);
  assert.equal(result.status, "fail");
  assert.ok(result.errors.includes("Installed candidate contains an undeclared file: local-state.json"));
});

test("installed candidate verification rejects symlinked control manifests", async () => {
  const fixture = await installedFixture();
  const manifestPath = path.join(fixture.installedRoot, "RELEASE-MANIFEST.json");
  const realManifestPath = path.join(fixture.installedRoot, "manifest-target.json");
  const manifest = await readFile(manifestPath);
  await writeFile(realManifestPath, manifest);
  await unlink(manifestPath);
  await symlink(realManifestPath, manifestPath);
  const result = verifyInstalledCandidate(fixture);
  assert.equal(result.status, "fail");
  assert.ok(result.errors.includes("Installed RELEASE-MANIFEST.json must be a regular non-symlink file."));
});
