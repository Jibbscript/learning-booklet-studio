#!/usr/bin/env node

import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { gzipSync } from "node:zlib";

import Ajv2020 from "ajv/dist/2020.js";

import { validateEvidenceBundle } from "../evidence/intel-macos-native/validate-evidence.mjs";

import {
  ROOT,
  collectRepositoryChecks,
  listRepositoryFiles,
  readJson,
} from "./repo-policy.mjs";

const RELEASE_ROOT_FILES = new Set([
  ".gitignore",
  ".mcp.json",
  "CHANGELOG.md",
  "CODE_OF_CONDUCT.md",
  "CONTRIBUTING.md",
  "design-qa.md",
  "LICENSE",
  "NOTICE-AG-UI.md",
  "README.md",
  "SECURITY.md",
  "package-lock.json",
  "package.json",
]);
const RELEASE_PREFIXES = [
  ".codex-plugin/",
  "contracts/",
  "docs/",
  "packages/",
  "scripts/",
  "skills/",
  "tests/",
  "evidence/intel-macos-native/README.md",
  "evidence/intel-macos-native/intel-checklist.md",
  "evidence/intel-macos-native/capture-host.sh",
  "evidence/intel-macos-native/process-architecture.c",
  "evidence/intel-macos-native/prepare-marketplace.sh",
  "evidence/intel-macos-native/keyboard-select.applescript",
  "evidence/intel-macos-native/run-keyboard-selection.sh",
  "evidence/intel-macos-native/front-window-id.c",
  "evidence/intel-macos-native/capture-chatgpt-window.sh",
  "evidence/intel-macos-native/native-macos-evidence.schema.json",
  "evidence/intel-macos-native/validate-evidence.mjs",
];
const REQUIRED_DIST_FILES = [
  "dist/mcp/presentation.mjs",
  "dist/mcp/server.mjs",
  "dist/mcp/store.mjs",
  "dist/widget/widget.html",
  "dist/workflow-engine/canonical.mjs",
  "dist/workflow-engine/codex-skill-ui-adapter.mjs",
  "dist/workflow-engine/engine.mjs",
  "dist/workflow-engine/errors.mjs",
  "dist/workflow-engine/index.mjs",
  "dist/workflow-engine/native-fixture-cli.mjs",
  "dist/workflow-engine/native-fixture.mjs",
  "dist/workflow-engine/phases.mjs",
];
const EXECUTABLE_RELEASE_FILES = new Set([
  "evidence/intel-macos-native/capture-host.sh",
  "evidence/intel-macos-native/prepare-marketplace.sh",
  "evidence/intel-macos-native/run-keyboard-selection.sh",
  "evidence/intel-macos-native/capture-chatgpt-window.sh",
]);
const REQUIRED_NATIVE_CHECKS = ["MAC-001", "MAC-002", "MAC-003", "MAC-004", "MAC-005", "MAC-006"];
export const NATIVE_MACOS_PROFILES = Object.freeze({
  intel: {
    id: "native-macos-intel",
    architecture: "x86_64",
    executableArchitectures: new Set(["x86_64"]),
    label: "Native Intel macOS",
    productionRequired: true,
  },
  appleSilicon: {
    id: "native-macos-apple-silicon",
    architecture: "arm64",
    executableArchitectures: new Set(["arm64", "universal"]),
    label: "Native Apple Silicon macOS",
    productionRequired: false,
  },
});
const ALLOWED_STATUSES = new Set(["pass", "fail", "partial", "not_run", "not_applicable"]);
const nativeEvidenceSchema = JSON.parse(readFileSync(
  path.join(ROOT, "evidence", "intel-macos-native", "native-macos-evidence.schema.json"),
  "utf8",
));
const automatedEvidenceSchema = JSON.parse(readFileSync(
  path.join(ROOT, "contracts", "automated-test-evidence.schema.json"),
  "utf8",
));
const nativeEvidenceAjv = new Ajv2020({
  allErrors: true,
  strict: false,
  formats: {
    "date-time": /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/,
  },
});
const validateNativeEvidenceSchema = nativeEvidenceAjv.compile(nativeEvidenceSchema);
const validateAutomatedEvidenceSchema = nativeEvidenceAjv.compile(automatedEvidenceSchema);

function parseArguments(argv) {
  const options = {
    allowPartial: false,
    nativeIntelEvidence: process.env.LBS_NATIVE_INTEL_EVIDENCE,
    nativeAppleSiliconEvidence: process.env.LBS_NATIVE_APPLE_SILICON_EVIDENCE ?? process.env.LBS_NATIVE_EVIDENCE,
    testEvidence: process.env.LBS_TEST_EVIDENCE,
    evalEvidence: process.env.LBS_EVAL_EVIDENCE,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--allow-partial") options.allowPartial = true;
    else if ([
      "--native-intel-evidence",
      "--native-apple-silicon-evidence",
      "--native-evidence",
      "--test-evidence",
      "--eval-evidence",
    ].includes(token)) {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) throw new Error(`Missing value for ${token}`);
      const key = token === "--native-evidence"
        ? "nativeAppleSiliconEvidence"
        : token.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
      options[key] = value;
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${token}`);
    }
  }
  return options;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function canonicalJson(value) {
  const normalize = (entry) => {
    if (Array.isArray(entry)) return entry.map(normalize);
    if (entry && typeof entry === "object" && !Buffer.isBuffer(entry)) {
      return Object.fromEntries(
        Object.keys(entry).sort().map((key) => [key, normalize(entry[key])]),
      );
    }
    return entry;
  };
  return `${JSON.stringify(normalize(value), null, 2)}\n`;
}

function walkFiles(directory, relativeBase) {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const absolutePath = path.join(directory, entry.name);
    const relativePath = path.posix.join(relativeBase, entry.name);
    if (entry.isSymbolicLink() || lstatSync(absolutePath).isSymbolicLink()) {
      throw new Error(`Release input must not be a symlink: ${relativePath}`);
    }
    if (entry.isDirectory()) files.push(...walkFiles(absolutePath, relativePath));
    else if (entry.isFile()) files.push({ relativePath, absolutePath });
  }
  return files;
}

function isRuntimeDependencyFile(file) {
  const segments = file.relativePath.split("/");
  const basename = segments.at(-1).toLowerCase();
  const parentSegments = segments.slice(0, -1).map((segment) => segment.toLowerCase());
  const licenseLike = /^(?:licen[cs]e|copying|notice)(?:[._-]|$)/i.test(basename);
  if (licenseLike || basename === "package.json") return true;
  if (parentSegments.some((segment) => [
    ".github",
    "bench",
    "benchmark",
    "benchmarks",
    "coverage",
    "docs",
    "example",
    "examples",
    "test",
    "tests",
  ].includes(segment))) return false;
  if (/\.(?:d\.ts|md|map|ts|tsx)$/i.test(basename)) return false;
  return true;
}

function collectProductionDependencies(lock) {
  const errors = [];
  const files = [];
  const dependencies = [];
  const allowedLicenses = new Set(["Apache-2.0", "BSD-2-Clause", "BSD-3-Clause", "ISC", "MIT", "MPL-2.0"]);
  const records = Object.entries(lock.packages ?? {})
    .filter(([packagePath, record]) => packagePath.startsWith("node_modules/") && !record.dev && !record.link)
    .sort(([left], [right]) => left.localeCompare(right));

  for (const [packagePath, record] of records) {
    const absolutePath = path.join(ROOT, ...packagePath.split("/"));
    if (!existsSync(absolutePath)) {
      errors.push(`${packagePath}: production dependency is not installed; run npm ci`);
      continue;
    }
    if (packagePath === "node_modules/@ag-ui/core") {
      if (!existsSync(path.join(ROOT, "NOTICE-AG-UI.md"))) {
        errors.push("@ag-ui/core requires NOTICE-AG-UI.md");
      }
    } else if (!allowedLicenses.has(record.license)) {
      errors.push(`${packagePath}: unresolved or incompatible license (${record.license ?? "missing"})`);
    }
    dependencies.push({
      name: packagePath.slice(packagePath.lastIndexOf("node_modules/") + "node_modules/".length),
      version: record.version,
      license: packagePath === "node_modules/@ag-ui/core" ? "MIT" : record.license,
      packagePath,
      attribution: packagePath === "node_modules/@ag-ui/core" ? "NOTICE-AG-UI.md" : "bundled package license file",
    });
    files.push(...walkFiles(absolutePath, packagePath).filter(isRuntimeDependencyFile));
  }
  return { errors, files, dependencies };
}

function collectReleaseInputs() {
  const errors = [];
  const sourceFiles = listRepositoryFiles()
    .filter(({ relativePath }) => (
      RELEASE_ROOT_FILES.has(relativePath)
      || RELEASE_PREFIXES.some((prefix) => relativePath.startsWith(prefix))
    ))
    .filter(({ relativePath }) => !relativePath.endsWith("/AGENTS.md"));

  for (const relativePath of REQUIRED_DIST_FILES) {
    const absolutePath = path.join(ROOT, ...relativePath.split("/"));
    if (!existsSync(absolutePath)) errors.push(`${relativePath}: required build output is missing`);
    else sourceFiles.push({ relativePath, absolutePath, symlink: false });
  }

  const lock = readJson("package-lock.json");
  const production = collectProductionDependencies(lock);
  errors.push(...production.errors);
  sourceFiles.push(...production.files.map((file) => ({ ...file, symlink: false })));

  const unique = new Map();
  for (const file of sourceFiles) {
    if (file.symlink) errors.push(`${file.relativePath}: release input must not be a symlink`);
    else unique.set(file.relativePath, file.absolutePath);
  }
  return {
    errors,
    dependencies: production.dependencies,
    files: [...unique.entries()]
      .map(([relativePath, absolutePath]) => ({ relativePath, content: readFileSync(absolutePath) }))
      .sort((left, right) => left.relativePath.localeCompare(right.relativePath)),
  };
}

function scanCandidateContent(files) {
  const errors = [];
  const secretPatterns = [
    /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----\s+[A-Za-z0-9+/=\r\n]{40,}\s+-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
    /\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{20,}\b/,
    /\b(?:ghp|gho|ghs|ghu|github_pat)_[A-Za-z0-9_]{20,}\b/,
    /\bAKIA[0-9A-Z]{16}\b/,
  ];
  const personalPath = new RegExp(["/", "(Users|home)", "/", "[A-Za-z0-9._-]+", "/"].join(""));

  for (const file of files) {
    if (file.content.includes(0)) continue;
    const text = file.content.toString("utf8");
    if (personalPath.test(text)) errors.push(`${file.relativePath}: personal absolute path detected`);
    if (secretPatterns.some((pattern) => pattern.test(text))) {
      errors.push(`${file.relativePath}: credential-like value detected`);
    }
  }
  return errors;
}

function splitTarPath(filePath) {
  if (Buffer.byteLength(filePath) <= 100) return { name: filePath, prefix: "" };
  const segments = filePath.split("/");
  for (let split = segments.length - 1; split > 0; split -= 1) {
    const prefix = segments.slice(0, split).join("/");
    const name = segments.slice(split).join("/");
    if (Buffer.byteLength(prefix) <= 155 && Buffer.byteLength(name) <= 100) return { name, prefix };
  }
  throw new Error(`Path is too long for deterministic ustar output: ${filePath}`);
}

function writeString(header, value, offset, length) {
  const bytes = Buffer.from(value, "utf8");
  if (bytes.length > length) throw new Error(`Tar header value exceeds ${length} bytes: ${value}`);
  bytes.copy(header, offset);
}

function writeOctal(header, value, offset, length) {
  const rendered = value.toString(8).padStart(length - 1, "0");
  if (rendered.length > length - 1) throw new Error(`Tar numeric value is too large: ${value}`);
  writeString(header, `${rendered}\0`, offset, length);
}

function tarHeader(filePath, size, mode) {
  const header = Buffer.alloc(512, 0);
  const { name, prefix } = splitTarPath(filePath);
  writeString(header, name, 0, 100);
  writeOctal(header, mode, 100, 8);
  writeOctal(header, 0, 108, 8);
  writeOctal(header, 0, 116, 8);
  writeOctal(header, size, 124, 12);
  writeOctal(header, 0, 136, 12);
  header.fill(0x20, 148, 156);
  header[156] = "0".charCodeAt(0);
  writeString(header, "ustar\0", 257, 6);
  writeString(header, "00", 263, 2);
  writeString(header, "root", 265, 32);
  writeString(header, "root", 297, 32);
  writeString(header, prefix, 345, 155);
  const checksum = header.reduce((sum, byte) => sum + byte, 0);
  writeString(header, `${checksum.toString(8).padStart(6, "0")}\0 `, 148, 8);
  return header;
}

function createTar(files, prefix) {
  const chunks = [];
  for (const file of files) {
    const archivePath = path.posix.join(prefix, file.relativePath);
    const executable = (
      archivePath.endsWith("dist/mcp/server.mjs")
      || /\/(?:scripts)\/[^/]+\.mjs$/.test(archivePath)
      || EXECUTABLE_RELEASE_FILES.has(file.relativePath)
    );
    chunks.push(tarHeader(archivePath, file.content.length, executable ? 0o755 : 0o644));
    chunks.push(file.content);
    const remainder = file.content.length % 512;
    if (remainder !== 0) chunks.push(Buffer.alloc(512 - remainder));
  }
  chunks.push(Buffer.alloc(1024));
  return Buffer.concat(chunks);
}

function packageCandidate(inputFiles, version, dependencies) {
  const dependencyInventory = Buffer.from(canonicalJson({
    schemaVersion: 1,
    source: "package-lock.json",
    dependencies,
  }));
  const candidateInputs = [
    ...inputFiles,
    { relativePath: "THIRD-PARTY-LICENSES.json", content: dependencyInventory },
  ].sort((left, right) => left.relativePath.localeCompare(right.relativePath));
  const baseEntries = candidateInputs.map((file) => ({
    path: file.relativePath,
    sha256: sha256(file.content),
    size: file.content.length,
  }));
  const contentDigest = sha256(canonicalJson(baseEntries));
  const embeddedManifest = {
    schemaVersion: 1,
    name: "learning-booklet-studio",
    version,
    contentDigest,
    files: baseEntries,
  };
  const manifestContent = Buffer.from(canonicalJson(embeddedManifest));
  const checksumLines = [
    ...baseEntries.map((entry) => `${entry.sha256}  ${entry.path}`),
    `${sha256(manifestContent)}  RELEASE-MANIFEST.json`,
  ].join("\n") + "\n";
  const packagedFiles = [
    ...candidateInputs,
    { relativePath: "RELEASE-MANIFEST.json", content: manifestContent },
    { relativePath: "SHA256SUMS", content: Buffer.from(checksumLines) },
  ].sort((left, right) => left.relativePath.localeCompare(right.relativePath));
  const archive = gzipSync(createTar(packagedFiles, "learning-booklet-studio"), { level: 9, mtime: 0 });
  // RFC 1952 permits 255 (unknown) for the OS byte; normalizing it prevents a host-specific header.
  archive[9] = 255;
  return { archive, embeddedManifest, packagedFiles };
}

function readEvidence(label, requestedPath) {
  const displayLabel = label.replaceAll("-", " ");
  if (!requestedPath) {
    return { gate: { id: label, status: "not_run", summary: `${displayLabel} was not supplied.` } };
  }
  const absolutePath = path.resolve(requestedPath);
  if (!existsSync(absolutePath)) {
    return { gate: { id: label, status: "fail", summary: `${displayLabel} path does not exist.` } };
  }
  try {
    return {
      absolutePath,
      evidence: JSON.parse(readFileSync(absolutePath, "utf8")),
    };
  } catch (error) {
    return { gate: { id: label, status: "fail", summary: `${displayLabel} is invalid JSON: ${error.message}` } };
  }
}

function validateEvidenceEnvelope(label, requestedPath, contentDigest) {
  const loaded = readEvidence(label, requestedPath);
  if (loaded.gate) return loaded;
  const { evidence } = loaded;
  if (!ALLOWED_STATUSES.has(evidence.status) || evidence.status !== "pass") {
    return {
      gate: {
        id: label,
        status: evidence.status === "fail" ? "fail" : "partial",
        summary: `${label} evidence is not an executed pass.`,
      },
    };
  }
  if (evidence.subjectSha256 !== contentDigest) {
    return { gate: { id: label, status: "fail", summary: `${label} evidence does not match the candidate content digest.` } };
  }
  if (!evidence.observedAt || !evidence.environment || typeof evidence.environment !== "object") {
    return { gate: { id: label, status: "fail", summary: `${label} evidence lacks its observed time or environment.` } };
  }
  return loaded;
}

export function validateAutomatedEvidence(requestedPath, contentDigest) {
  const label = "automated-test-evidence";
  const loaded = validateEvidenceEnvelope(label, requestedPath, contentDigest);
  if (loaded.gate) return loaded.gate;
  const { absolutePath, evidence } = loaded;
  const requiredChecks = [
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
  const gaps = [];
  if (!validateAutomatedEvidenceSchema(evidence)) {
    for (const error of validateAutomatedEvidenceSchema.errors ?? []) {
      gaps.push(`schema ${error.instancePath || "/"}: ${error.message}`);
    }
  }
  const checks = new Map();
  for (const check of evidence.checks ?? []) {
    if (checks.has(check.id)) gaps.push(`check identifier is duplicated: ${check.id}`);
    checks.set(check.id, check);
  }
  for (const id of requiredChecks) {
    const check = checks.get(id);
    if (check?.status !== "pass" || check?.executed !== true) gaps.push(`${id} is not an executed pass`);
  }

  const evidenceDirectory = path.dirname(absolutePath);
  const attachmentPaths = new Map();
  for (const attachment of evidence.attachments ?? []) {
    if (!attachment || typeof attachment.path !== "string") continue;
    if (attachmentPaths.has(attachment.path)) {
      gaps.push(`attachment path is duplicated: ${attachment.path}`);
      continue;
    }
    const attachmentPath = path.resolve(evidenceDirectory, attachment.path);
    if (!attachmentPath.startsWith(`${evidenceDirectory}${path.sep}`) || !existsSync(attachmentPath)) {
      gaps.push(`attachment is missing or outside the evidence directory: ${attachment.path}`);
      continue;
    }
    if (!lstatSync(attachmentPath).isFile() || lstatSync(attachmentPath).isSymbolicLink()) {
      gaps.push(`attachment is not a regular non-symlink file: ${attachment.path}`);
      continue;
    }
    const content = readFileSync(attachmentPath);
    const digest = sha256(content);
    if (digest !== attachment.sha256) gaps.push(`attachment digest mismatch: ${attachment.path}`);
    attachmentPaths.set(attachment.path, { ...attachment, content, digest });
  }

  for (const check of evidence.checks ?? []) {
    for (const resultRef of check.resultRefs ?? []) {
      if (!attachmentPaths.has(resultRef)) gaps.push(`${check.id} resultRef is not a listed attachment: ${resultRef}`);
    }
  }
  const commandResultPaths = new Set();
  for (const command of evidence.commands ?? []) {
    if (commandResultPaths.has(command.resultPath)) gaps.push(`command resultPath is duplicated: ${command.resultPath}`);
    commandResultPaths.add(command.resultPath);
    const attachment = attachmentPaths.get(command.resultPath);
    if (!attachment) gaps.push(`command resultPath is not a listed attachment: ${command.resultPath}`);
    else if (command.resultSha256 !== attachment.digest) gaps.push(`command result digest mismatch: ${command.resultPath}`);
  }

  gaps.push(...scanCandidateContent(
    [...attachmentPaths.entries()].map(([relativePath, attachment]) => ({
      relativePath,
      content: attachment.content,
    })),
  ).map((finding) => `evidence attachment ${finding}`));

  const browserCheck = checks.get("browser-runtime");
  for (const resultRef of browserCheck?.resultRefs ?? []) {
    const attachment = attachmentPaths.get(resultRef);
    if (!attachment || !resultRef.endsWith(".json")) continue;
    try {
      const report = JSON.parse(attachment.content.toString("utf8"));
      if (report.result !== "pass") gaps.push(`${resultRef}: browser report result is not pass`);
      if ((report.externalRequests ?? []).length > 0) gaps.push(`${resultRef}: browser report contains external requests`);
      if ((report.consoleErrors ?? []).length > 0 || (report.pageErrors ?? []).length > 0) {
        gaps.push(`${resultRef}: browser report contains console or page errors`);
      }
      const widths = new Set((report.viewports ?? []).map((viewport) => viewport.width));
      for (const width of [320, 768, 1440]) {
        if (!widths.has(width)) gaps.push(`${resultRef}: browser report is missing the ${width}px viewport`);
      }
    } catch (error) {
      gaps.push(`${resultRef}: browser report is invalid JSON: ${error.message}`);
    }
  }
  return gaps.length === 0
    ? { id: label, status: "pass", summary: "Automated, browser, accessibility, offline, privacy, and license evidence is current." }
    : { id: label, status: "fail", summary: "Automated test evidence is incomplete.", gaps };
}

function validateSolEvidence(requestedPath, contentDigest) {
  const label = "gpt56-sol-evaluation";
  const loaded = validateEvidenceEnvelope(label, requestedPath, contentDigest);
  if (loaded.gate) return loaded.gate;
  const { evidence } = loaded;
  const gaps = [];
  if (!/gpt[- ]?5\.6[- ]?sol/i.test(evidence.modelObserved ?? "")) gaps.push("observed model label is not GPT-5.6 Sol");
  const caseKinds = new Map((evidence.cases ?? []).map((entry) => [entry.kind, entry.status]));
  for (const kind of ["golden", "adversarial", "degraded"]) {
    if (caseKinds.get(kind) !== "pass") gaps.push(`${kind} case is not pass`);
  }
  if (!Array.isArray(evidence.commands) || evidence.commands.length === 0 || evidence.commands.some((command) => (
    !command.command || command.exitCode !== 0 || command.status !== "pass" || !command.resultPath
  ))) gaps.push("successful evaluation harness command evidence is missing");
  return gaps.length === 0
    ? { id: label, status: "pass", summary: "GPT-5.6 Sol golden, adversarial, and degraded evaluations are current." }
    : { id: label, status: "fail", summary: "GPT-5.6 Sol evaluation evidence is incomplete.", gaps };
}

export function validateNativeEvidence(requestedPath, archiveDigest, contentDigest, version, profile) {
  const hostArchitecture = os.arch();
  if (!requestedPath) {
    return {
      id: profile.id,
      status: "not_run",
      summary: `No ${profile.label} evidence was supplied; current verification host architecture is ${hostArchitecture}.`,
      requiredChecks: REQUIRED_NATIVE_CHECKS,
    };
  }
  const absolutePath = path.resolve(requestedPath);
  if (!existsSync(absolutePath)) {
    return { id: profile.id, status: "fail", summary: `${profile.label} evidence path does not exist.` };
  }
  let evidence;
  try {
    evidence = JSON.parse(readFileSync(absolutePath, "utf8"));
  } catch (error) {
    return { id: profile.id, status: "fail", summary: `${profile.label} evidence is invalid JSON: ${error.message}` };
  }
  const gaps = [];
  const semanticValidation = validateEvidenceBundle(absolutePath);
  if (semanticValidation.status !== "pass") {
    gaps.push(...semanticValidation.errors.map((error) => `bundle ${error}`));
  }
  if (!validateNativeEvidenceSchema(evidence)) {
    for (const error of validateNativeEvidenceSchema.errors ?? []) {
      gaps.push(`schema ${error.instancePath || "/"}: ${error.message}`);
    }
  }
  if (evidence.schemaVersion !== 1) gaps.push("schemaVersion is not 1");
  if (evidence.gate !== profile.id || evidence.status !== "pass") gaps.push("gate/status is not pass");
  if (evidence.architecture !== profile.architecture || evidence.translated !== false) {
    gaps.push(`host is not proven native ${profile.architecture}`);
  }
  if (evidence.chatgptDesktop?.surface !== "Codex") gaps.push("ChatGPT Desktop Codex surface is not recorded");
  if (evidence.chatgptDesktop?.bundleIdentifier !== "com.openai.codex") gaps.push("ChatGPT Desktop bundle identity is not recorded");
  if (!profile.executableArchitectures.has(evidence.chatgptDesktop?.mainExecutableArchitecture)) {
    gaps.push(`ChatGPT Desktop executable architecture is not valid for ${profile.architecture}`);
  }
  if (evidence.chatgptDesktop?.runningProcessArchitectureStatus !== "pass") {
    gaps.push("running ChatGPT Desktop process architecture is not an executed pass");
  }
  if (!evidence.chatgptDesktop?.version || !evidence.chatgptDesktop?.build || !evidence.macOS?.version || !evidence.macOS?.build || !evidence.hardware) {
    gaps.push("environment identity is incomplete");
  }
  if (evidence.plugin?.version !== version) gaps.push("plugin version does not match");
  const recordedArchiveDigest = evidence.plugin?.archiveSha256 ?? evidence.plugin?.sha256;
  if (recordedArchiveDigest !== archiveDigest) gaps.push("plugin archive SHA-256 does not match this candidate");
  if (evidence.plugin?.contentDigest !== contentDigest) gaps.push("plugin content digest does not match this candidate");
  if (evidence.plugin?.installed !== true) gaps.push("plugin installation is not recorded as complete");
  if (!evidence.modelObserved || !evidence.runId || !evidence.artifactSha256 || !evidence.observedAt || !evidence.tester) {
    gaps.push("run/model/artifact/time/tester identity is incomplete");
  }
  const checks = new Map((evidence.checks ?? []).map((check) => [check.id, check]));
  if (checks.size !== REQUIRED_NATIVE_CHECKS.length) gaps.push("native check identifiers are missing or duplicated");
  for (const id of REQUIRED_NATIVE_CHECKS) {
    const check = checks.get(id);
    if (check?.status !== "pass" || check?.executed !== true || !Array.isArray(check?.evidenceRefs) || check.evidenceRefs.length === 0) {
      gaps.push(`${id} is not an attributable executed pass`);
    }
  }
  if (!Array.isArray(evidence.attachments) || evidence.attachments.length === 0) {
    gaps.push("attachments are missing");
  } else {
    const evidenceDirectory = path.dirname(absolutePath);
    const attachmentPaths = new Set();
    const completedArtifactDigests = new Set();
    for (const attachment of evidence.attachments) {
      if (!attachment || typeof attachment.path !== "string" || path.isAbsolute(attachment.path) || !attachment.sha256) {
        gaps.push("an attachment lacks a relative path or SHA-256");
        continue;
      }
      if (attachmentPaths.has(attachment.path)) gaps.push(`attachment path is duplicated: ${attachment.path}`);
      attachmentPaths.add(attachment.path);
      if (attachment.group === "completed-artifact" && attachment.kind === "artifact") {
        completedArtifactDigests.add(attachment.sha256);
      }
      const attachmentPath = path.resolve(evidenceDirectory, attachment.path);
      if (!attachmentPath.startsWith(`${evidenceDirectory}${path.sep}`) || !existsSync(attachmentPath)) {
        gaps.push(`attachment is missing or outside the evidence directory: ${attachment.path}`);
        continue;
      }
      if (sha256(readFileSync(attachmentPath)) !== attachment.sha256) gaps.push(`attachment digest mismatch: ${attachment.path}`);
    }
    for (const check of evidence.checks ?? []) {
      for (const evidenceRef of check.evidenceRefs ?? []) {
        if (!attachmentPaths.has(evidenceRef)) gaps.push(`${check.id} evidenceRef is not a listed attachment: ${evidenceRef}`);
      }
    }
    if (evidence.artifactSha256 && !completedArtifactDigests.has(evidence.artifactSha256)) {
      gaps.push("artifactSha256 does not match a completed-artifact attachment of kind artifact");
    }
  }
  return gaps.length === 0
    ? { id: profile.id, status: "pass", summary: `${profile.label} evidence matches the exact candidate archive.` }
    : { id: profile.id, status: "fail", summary: `${profile.label} evidence is incomplete or stale.`, gaps };
}

export function releaseDecision(gates) {
  const requiredGates = gates.filter((gate) => gate.productionRequired !== false);
  const failed = requiredGates.filter((gate) => gate.status === "fail");
  const incomplete = requiredGates.filter((gate) => gate.status !== "pass");
  const advisories = gates
    .filter((gate) => gate.productionRequired === false && gate.status !== "pass")
    .map((gate) => `${gate.id}: ${gate.summary}`);
  if (failed.length > 0) {
    return {
      status: "fail",
      blockers: failed.map((gate) => `${gate.id}: ${gate.summary}`),
      advisories,
    };
  }
  if (incomplete.length > 0) {
    return {
      status: "partial",
      blockers: incomplete.map((gate) => `${gate.id}: ${gate.summary}`),
      advisories,
    };
  }
  return { status: "pass", blockers: [], advisories };
}

function writeReleaseOutputs(candidate, version, gates) {
  const releaseDir = path.join(ROOT, "dist", "release");
  mkdirSync(releaseDir, { recursive: true });
  const archiveName = `learning-booklet-studio-${version}.tar.gz`;
  const archivePath = path.join(releaseDir, archiveName);
  writeFileSync(archivePath, candidate.archive);
  const archiveDigest = sha256(candidate.archive);
  const manifestPath = path.join(releaseDir, "release-manifest.json");
  const outerManifest = {
    ...candidate.embeddedManifest,
    archive: { path: archiveName, sha256: archiveDigest, size: candidate.archive.length },
  };
  writeFileSync(manifestPath, canonicalJson(outerManifest));
  const manifestDigest = sha256(readFileSync(manifestPath));
  writeFileSync(
    path.join(releaseDir, "SHA256SUMS"),
    `${archiveDigest}  ${archiveName}\n${manifestDigest}  release-manifest.json\n`,
  );
  const report = {
    schemaVersion: 1,
    version,
    candidate: outerManifest.archive,
    contentDigest: candidate.embeddedManifest.contentDigest,
    verificationHost: { architecture: os.arch(), platform: os.platform(), node: process.version },
    gates,
    decision: releaseDecision(gates),
  };
  writeFileSync(path.join(releaseDir, "release-report.json"), canonicalJson(report));
  return { report, archiveDigest, releaseDir };
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const packageJson = readJson("package.json");
  const repository = collectRepositoryChecks();
  const initialGates = [
    {
      id: "repository-policy",
      status: repository.errors.length === 0 ? "pass" : "fail",
      summary: repository.errors.length === 0
        ? "Repository structure, manifests, privacy, and direct dependency policy pass."
        : `${repository.errors.length} repository policy finding(s).`,
      ...(repository.errors.length > 0 ? { gaps: repository.errors } : {}),
    },
  ];

  const inputs = collectReleaseInputs();
  const contentErrors = inputs.errors.length === 0 ? scanCandidateContent(inputs.files) : [];
  const packagingErrors = [...inputs.errors, ...contentErrors];
  initialGates.push({
    id: "candidate-package",
    status: packagingErrors.length === 0 ? "pass" : "fail",
    summary: packagingErrors.length === 0
      ? "Candidate inputs, production dependencies, licenses, and privacy scan pass."
      : `${packagingErrors.length} candidate packaging finding(s).`,
    ...(packagingErrors.length > 0 ? { gaps: packagingErrors } : {}),
  });

  if (packagingErrors.length > 0) {
    const releaseDir = path.join(ROOT, "dist", "release");
    mkdirSync(releaseDir, { recursive: true });
    const report = {
      schemaVersion: 1,
      version: packageJson.version,
      verificationHost: { architecture: os.arch(), platform: os.platform(), node: process.version },
      gates: initialGates,
      decision: releaseDecision(initialGates),
    };
    writeFileSync(path.join(releaseDir, "release-report.json"), canonicalJson(report));
    console.error(`Release decision: ${report.decision.status}`);
    for (const blocker of report.decision.blockers) console.error(`- ${blocker}`);
    process.exitCode = 1;
    return;
  }

  const candidate = packageCandidate(inputs.files, packageJson.version, inputs.dependencies);
  const provisionalArchiveDigest = sha256(candidate.archive);
  const evidenceGates = [
    validateAutomatedEvidence(options.testEvidence, candidate.embeddedManifest.contentDigest),
    validateSolEvidence(options.evalEvidence, candidate.embeddedManifest.contentDigest),
    {
      ...validateNativeEvidence(
        options.nativeIntelEvidence,
        provisionalArchiveDigest,
        candidate.embeddedManifest.contentDigest,
        packageJson.version,
        NATIVE_MACOS_PROFILES.intel,
      ),
      productionRequired: NATIVE_MACOS_PROFILES.intel.productionRequired,
    },
    {
      ...validateNativeEvidence(
        options.nativeAppleSiliconEvidence,
        provisionalArchiveDigest,
        candidate.embeddedManifest.contentDigest,
        packageJson.version,
        NATIVE_MACOS_PROFILES.appleSilicon,
      ),
      productionRequired: NATIVE_MACOS_PROFILES.appleSilicon.productionRequired,
    },
  ];
  const { report, releaseDir } = writeReleaseOutputs(candidate, packageJson.version, [...initialGates, ...evidenceGates]);
  console.log(`Candidate: ${path.relative(ROOT, path.join(releaseDir, report.candidate.path))}`);
  console.log(`SHA-256: ${report.candidate.sha256}`);
  console.log(`Release decision: ${report.decision.status}`);
  for (const blocker of report.decision.blockers) console.log(`- ${blocker}`);
  for (const advisory of report.decision.advisories) console.log(`Advisory: ${advisory}`);
  if (report.decision.status !== "pass" && !options.allowPartial) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(`Release verification failed: ${error.message}`);
    process.exitCode = 1;
  });
}
