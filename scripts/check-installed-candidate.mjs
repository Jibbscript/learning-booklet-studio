#!/usr/bin/env node

import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function canonicalJson(value) {
  const normalize = (entry) => {
    if (Array.isArray(entry)) return entry.map(normalize);
    if (entry && typeof entry === "object" && !Buffer.isBuffer(entry)) {
      return Object.fromEntries(Object.keys(entry).sort().map((key) => [key, normalize(entry[key])]));
    }
    return entry;
  };
  return `${JSON.stringify(normalize(value), null, 2)}\n`;
}

function readJson(file, label, errors) {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    errors.push(`${label} is not readable JSON: ${error.message}`);
    return null;
  }
}

function parseChecksums(text, errors) {
  const checksums = new Map();
  for (const [index, line] of text.split(/\r?\n/).entries()) {
    if (!line) continue;
    const match = line.match(/^([a-f0-9]{64})  ([^\\]+)$/);
    if (!match) {
      errors.push(`SHA256SUMS line ${index + 1} is malformed.`);
      continue;
    }
    const [, digest, relativePath] = match;
    if (path.isAbsolute(relativePath) || relativePath.split("/").includes("..")) {
      errors.push(`SHA256SUMS path is not a safe relative path: ${relativePath}`);
      continue;
    }
    if (checksums.has(relativePath)) errors.push(`SHA256SUMS path is duplicated: ${relativePath}`);
    checksums.set(relativePath, digest);
  }
  return checksums;
}

function listInstalledFiles(root, errors, directory = root) {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    const relative = path.relative(root, absolute).split(path.sep).join("/");
    const stat = lstatSync(absolute);
    if (stat.isSymbolicLink()) {
      errors.push(`Installed candidate contains a symlink: ${relative}`);
      continue;
    }
    if (stat.isDirectory()) files.push(...listInstalledFiles(root, errors, absolute));
    else if (stat.isFile()) files.push(relative);
    else errors.push(`Installed candidate contains a non-regular entry: ${relative}`);
  }
  return files;
}

export function verifyInstalledCandidate({ installedRoot, releaseReportPath }) {
  const errors = [];
  const root = path.resolve(installedRoot || "");
  const reportPath = path.resolve(releaseReportPath || "");
  if (!installedRoot || !existsSync(root)) errors.push("Installed plugin root does not exist.");
  if (!releaseReportPath || !existsSync(reportPath)) errors.push("Release report does not exist.");
  if (errors.length > 0) return { status: "fail", errors };

  const rootStat = lstatSync(root);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
    return { status: "fail", errors: ["Installed plugin root must be a regular non-symlink directory."] };
  }

  const report = readJson(reportPath, "Release report", errors);
  const manifestPath = path.join(root, "RELEASE-MANIFEST.json");
  const sumsPath = path.join(root, "SHA256SUMS");
  if (!existsSync(manifestPath)) errors.push("Installed RELEASE-MANIFEST.json is missing.");
  if (!existsSync(sumsPath)) errors.push("Installed SHA256SUMS is missing.");
  if (errors.length > 0) return { status: "fail", errors };

  for (const [label, controlPath] of [
    ["RELEASE-MANIFEST.json", manifestPath],
    ["SHA256SUMS", sumsPath],
  ]) {
    const stat = lstatSync(controlPath);
    if (!stat.isFile() || stat.isSymbolicLink()) {
      errors.push(`Installed ${label} must be a regular non-symlink file.`);
    }
  }
  if (errors.length > 0) return { status: "fail", errors };

  const manifestBytes = readFileSync(manifestPath);
  const manifest = readJson(manifestPath, "Installed release manifest", errors);
  const checksums = parseChecksums(readFileSync(sumsPath, "utf8"), errors);
  if (!manifest || !report) return { status: "fail", errors };

  if (manifest.name !== "learning-booklet-studio") errors.push("Installed manifest name is unexpected.");
  if (manifest.version !== report.version) errors.push("Installed plugin version does not match the release report.");
  if (manifest.contentDigest !== report.contentDigest) errors.push("Installed content digest does not match the release report.");
  if (!/^[a-f0-9]{64}$/.test(report.candidate?.sha256 ?? "")) {
    errors.push("Release report candidate archive SHA-256 is missing or invalid.");
  }
  if (sha256(canonicalJson(manifest.files || [])) !== manifest.contentDigest) {
    errors.push("Installed content digest does not reproduce from the manifest file inventory.");
  }

  const manifestPaths = new Set();
  for (const file of manifest.files || []) {
    if (!file || typeof file.path !== "string" || path.isAbsolute(file.path) || file.path.split("/").includes("..")) {
      errors.push("Installed manifest contains an unsafe file path.");
      continue;
    }
    if (manifestPaths.has(file.path)) errors.push(`Installed manifest path is duplicated: ${file.path}`);
    manifestPaths.add(file.path);
    const absolute = path.resolve(root, file.path);
    if (!absolute.startsWith(`${root}${path.sep}`) || !existsSync(absolute)) {
      errors.push(`Installed manifest file is missing: ${file.path}`);
      continue;
    }
    const stat = lstatSync(absolute);
    if (!stat.isFile() || stat.isSymbolicLink()) {
      errors.push(`Installed manifest entry is not a regular non-symlink file: ${file.path}`);
      continue;
    }
    const content = readFileSync(absolute);
    const digest = sha256(content);
    if (digest !== file.sha256 || content.length !== file.size) {
      errors.push(`Installed manifest digest or size mismatch: ${file.path}`);
    }
    if (checksums.get(file.path) !== file.sha256) {
      errors.push(`SHA256SUMS does not match the manifest: ${file.path}`);
    }
  }

  if (checksums.get("RELEASE-MANIFEST.json") !== sha256(manifestBytes)) {
    errors.push("SHA256SUMS does not match RELEASE-MANIFEST.json.");
  }
  const expectedChecksumPaths = new Set([...manifestPaths, "RELEASE-MANIFEST.json"]);
  for (const checksumPath of checksums.keys()) {
    if (!expectedChecksumPaths.has(checksumPath)) errors.push(`SHA256SUMS contains an undeclared path: ${checksumPath}`);
  }
  for (const expectedPath of expectedChecksumPaths) {
    if (!checksums.has(expectedPath)) errors.push(`SHA256SUMS is missing a manifest path: ${expectedPath}`);
  }

  const expectedInstalledPaths = new Set([...manifestPaths, "RELEASE-MANIFEST.json", "SHA256SUMS"]);
  for (const installedPath of listInstalledFiles(root, errors)) {
    if (!expectedInstalledPaths.has(installedPath)) {
      errors.push(`Installed candidate contains an undeclared file: ${installedPath}`);
    }
  }

  return {
    status: errors.length === 0 ? "pass" : "fail",
    errors,
    candidate: {
      name: manifest.name,
      version: manifest.version,
      archiveSha256: report.candidate?.sha256 ?? null,
      contentDigest: manifest.contentDigest,
      installedFileCount: manifest.files?.length ?? 0,
      checksumsVerified: errors.length === 0,
    },
  };
}

function parseArguments(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!flag?.startsWith("--") || value === undefined) throw new Error("Use --installed-root and --release-report.");
    options[flag.slice(2)] = value;
  }
  return {
    installedRoot: options["installed-root"],
    releaseReportPath: options["release-report"],
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const result = verifyInstalledCandidate(parseArguments(process.argv.slice(2)));
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (result.status !== "pass") process.exitCode = 1;
  } catch (error) {
    process.stderr.write(`${JSON.stringify({ status: "fail", errors: [error.message] })}\n`);
    process.exitCode = 1;
  }
}
