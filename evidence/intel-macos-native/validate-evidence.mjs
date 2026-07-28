#!/usr/bin/env node

import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import Ajv2020 from "ajv/dist/2020.js";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const schemaPath = path.join(scriptDirectory, "native-macos-evidence.schema.json");

export const EXPECTED_CHECK_IDS = ["MAC-001", "MAC-002", "MAC-003", "MAC-004", "MAC-005", "MAC-006"];

export const REQUIRED_ATTACHMENT_GROUPS = [
  "environment",
  "candidate-binding",
  "explicit-discovery",
  "implicit-discovery",
  "interruption",
  "resume",
  "failure-repair-history",
  "degraded-recovery",
  "restart-reconciliation",
  "keyboard-selection",
  "voiceover",
  "responsive-layout",
  "completed-artifact",
  "validation-results",
];

const CHECK_ATTACHMENT_GROUPS = {
  "MAC-001": ["environment"],
  "MAC-002": ["environment", "candidate-binding"],
  "MAC-003": ["explicit-discovery", "implicit-discovery"],
  "MAC-004": ["interruption", "resume", "failure-repair-history", "completed-artifact"],
  "MAC-005": ["keyboard-selection", "degraded-recovery", "restart-reconciliation", "voiceover", "responsive-layout"],
  "MAC-006": ["validation-results"],
};

const REQUIRED_LAYOUT_CONTEXTS = ["narrow", "normal", "fullscreen"];

const TEXT_EXTENSIONS = new Set([
  ".csv", ".html", ".htm", ".js", ".json", ".log", ".md", ".mjs", ".sh", ".text", ".tsv", ".txt", ".xml", ".yaml", ".yml",
]);

const SECRET_PATTERNS = [
  ["private-key material", /-----BEGIN (?:[A-Z0-9 ]+ )?PRIVATE KEY-----/i],
  ["OpenAI-style API key", /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/],
  ["GitHub access token", /\bgh[pousr]_[A-Za-z0-9]{20,}\b/],
  ["AWS access key", /\bAKIA[A-Z0-9]{16}\b/],
  ["bearer credential", /\bBearer\s+[A-Za-z0-9._~+/=-]{12,}/i],
  [
    "assigned credential",
    /\b(?:api[_-]?key|access[_-]?token|auth[_-]?token|client[_-]?secret|password)\b\s*[=:]\s*["']?(?!redacted\b|none\b|null\b|<)[A-Za-z0-9._~+/=-]{12,}/i,
  ],
];

const PRIVATE_PATH_PATTERNS = [
  ["macOS user-home path", /(?:^|[\s"'=(])\/Users\/[^/\s"']+(?:\/[^\s"']*)?/m],
  ["Unix user-home path", /(?:^|[\s"'=(])\/home\/[^/\s"']+(?:\/[^\s"']*)?/m],
  ["Windows user-home path", /\b[A-Za-z]:\\Users\\[^\\\s"']+(?:\\[^\s"']*)?/],
  ["macOS private temporary path", /(?:^|[\s"'=(])\/private\/var\/folders\/[^\s"']+/m],
];

function sha256(content) {
  return createHash("sha256").update(content).digest("hex");
}

function isTextAttachment(attachment) {
  if (attachment.kind === "screenshot" || attachment.kind === "recording") return false;
  return TEXT_EXTENSIONS.has(path.extname(attachment.path).toLowerCase());
}

export function scanTextForPrivateData(text) {
  const findings = [];
  for (const [label, expression] of SECRET_PATTERNS) {
    if (expression.test(text)) findings.push(label);
  }
  for (const [label, expression] of PRIVATE_PATH_PATTERNS) {
    if (expression.test(text)) findings.push(label);
  }
  return findings;
}

function scanManifestStrings(value, location = "$", findings = []) {
  if (typeof value === "string") {
    for (const finding of scanTextForPrivateData(value)) findings.push(`${location}: ${finding}`);
    return findings;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => scanManifestStrings(entry, `${location}[${index}]`, findings));
    return findings;
  }
  if (value && typeof value === "object") {
    for (const [key, entry] of Object.entries(value)) scanManifestStrings(entry, `${location}.${key}`, findings);
  }
  return findings;
}

function loadJson(filePath, label, errors) {
  try {
    return JSON.parse(readFileSync(filePath, "utf8"));
  } catch (error) {
    errors.push(`${label} could not be read: ${error.message}`);
    return null;
  }
}

function schemaErrors(schema, manifest) {
  const ajv = new Ajv2020({
    allErrors: true,
    strict: false,
    formats: {
      "date-time": /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/,
    },
  });
  const validate = ajv.compile(schema);
  if (validate(manifest)) return [];
  return (validate.errors ?? []).map((error) => `${error.instancePath || "/"}: ${error.message}`);
}

function validateJourneyIdentities(manifest, errors) {
  if (manifest.status !== "pass") return;
  const identities = manifest.journeyIdentities;
  const orderedKeys = ["explicitDiscovery", "implicitDiscovery", "interrupted", "resumed", "restarted"];
  if (!identities || orderedKeys.some((key) => !identities[key])) return;

  const observationIds = orderedKeys.map((key) => identities[key].observationId);
  if (new Set(observationIds).size !== observationIds.length) {
    errors.push("Journey explicit, implicit, interrupted, resumed, and restarted observations require unique observationId values.");
  }

  if (identities.explicitDiscovery.taskId === identities.implicitDiscovery.taskId) {
    errors.push("Explicit and implicit discovery must be retained from separate fresh Codex task identities.");
  }

  const representative = ["implicitDiscovery", "interrupted", "resumed", "restarted"];
  const taskIds = new Set(representative.map((key) => identities[key].taskId));
  const threadIds = new Set(representative.map((key) => identities[key].threadId));
  if (taskIds.size !== 1) {
    errors.push("Implicit, interrupted, resumed, and restarted observations must preserve one representative task identity.");
  }
  if (threadIds.size !== 1) {
    errors.push("Implicit, interrupted, resumed, and restarted observations must preserve one transport thread identity.");
  }
  if (identities.implicitDiscovery.runId !== identities.interrupted.runId) {
    errors.push("The interrupted run must be the same run observed during implicit discovery.");
  }
  if (identities.resumed.runId === identities.interrupted.runId) {
    errors.push("A resumed child run must use a new runId.");
  }
  if (identities.resumed.parentRunId !== identities.interrupted.runId) {
    errors.push("The resumed child must name the interrupted run as parentRunId.");
  }
  if (identities.restarted.runId !== identities.resumed.runId || identities.restarted.parentRunId !== identities.interrupted.runId) {
    errors.push("Restart reconciliation must recover the resumed child run and its parent lineage.");
  }
  if (manifest.runId !== identities.resumed.runId) {
    errors.push("The evidence manifest runId must identify the resumed representative child run.");
  }
  if (!Number.isInteger(identities.resumed.mcpProcessId) || identities.resumed.mcpProcessId < 1) {
    errors.push("The resumed observation must record a positive MCP process identity.");
  }
  if (!Number.isInteger(identities.restarted.mcpProcessId) || identities.restarted.mcpProcessId < 1) {
    errors.push("The restarted observation must record a positive MCP process identity.");
  }
  if (identities.resumed.mcpProcessId === identities.restarted.mcpProcessId) {
    errors.push("Restart reconciliation must record a changed MCP process identity.");
  }

  const chronological = ["implicitDiscovery", "interrupted", "resumed", "restarted"];
  for (let index = 1; index < chronological.length; index += 1) {
    const previous = Date.parse(identities[chronological[index - 1]].observedAt);
    const current = Date.parse(identities[chronological[index]].observedAt);
    if (current < previous) {
      errors.push(`Journey observation ${chronological[index]} predates ${chronological[index - 1]}.`);
    }
  }
}

function validateKeyboardSelection(manifest, attachmentByPath, errors) {
  if (manifest.status !== "pass" || !manifest.keyboardSelection) return;
  const keyboard = manifest.keyboardSelection;
  const allowed = new Set(["Tab", "Shift+Tab", "Space", "Enter"]);
  if (keyboard.keysUsed.some((key) => !allowed.has(key))) {
    errors.push("Keyboard selection evidence contains an input outside Tab, Shift+Tab, Space, and Enter.");
  }
  if (!keyboard.keysUsed.includes("Tab")) {
    errors.push("Keyboard selection evidence must include Tab navigation.");
  }
  if (!keyboard.keysUsed.includes(keyboard.activationKey)) {
    errors.push("Keyboard selection activationKey must appear in keysUsed.");
  }
  const evidenceAttachment = attachmentByPath.get(keyboard.evidenceRef);
  if (!evidenceAttachment) {
    errors.push(`Keyboard selection evidenceRef is not a listed attachment: ${keyboard.evidenceRef}`);
  } else if (evidenceAttachment.group !== "keyboard-selection") {
    errors.push("Keyboard selection evidenceRef must point to the keyboard-selection attachment group.");
  } else if (!["log", "recording"].includes(evidenceAttachment.kind)) {
    errors.push("Keyboard selection evidenceRef must point to a keyboard log or recording.");
  }
}

function validateNativeEvidenceShapes(manifest, errors) {
  if (manifest.status !== "pass") return;
  const attachments = manifest.attachments ?? [];
  const hasShape = (group, kinds, predicate = () => true) => attachments.some((attachment) => (
    attachment.group === group && kinds.includes(attachment.kind) && predicate(attachment)
  ));

  for (const group of ["explicit-discovery", "implicit-discovery", "degraded-recovery"]) {
    if (!hasShape(group, ["screenshot"])) {
      errors.push(`Required ${group} evidence must include a native-window screenshot.`);
    }
  }
  if (!hasShape("keyboard-selection", ["log", "recording"])) {
    errors.push("Keyboard selection evidence must include a keyboard log or recording.");
  }
  if (!hasShape("voiceover", ["checklist", "log"])) {
    errors.push("VoiceOver evidence must include a dedicated checklist or inspection log.");
  }
  for (const layoutContext of REQUIRED_LAYOUT_CONTEXTS) {
    if (!hasShape("responsive-layout", ["screenshot", "recording"], (attachment) => attachment.layoutContext === layoutContext)) {
      errors.push(`Responsive layout evidence is missing a ${layoutContext} screenshot or recording.`);
    }
  }
}

export function validateEvidenceBundle(manifestArgument) {
  const errors = [];
  const manifestPath = path.resolve(manifestArgument);
  const manifestDirectory = path.dirname(manifestPath);
  const schema = loadJson(schemaPath, "Evidence schema", errors);
  const manifest = loadJson(manifestPath, "Evidence JSON", errors);
  if (!schema || !manifest) return { status: "fail", errors, manifest: null };

  for (const finding of scanManifestStrings(manifest)) {
    errors.push(`Evidence manifest contains ${finding}.`);
  }

  errors.push(...schemaErrors(schema, manifest));
  if (errors.length > 0) return { status: "fail", errors, manifest };

  const observedCheckIds = manifest.checks.map((check) => check.id);
  if (
    new Set(observedCheckIds).size !== EXPECTED_CHECK_IDS.length
    || EXPECTED_CHECK_IDS.some((id) => !observedCheckIds.includes(id))
  ) {
    errors.push("Evidence must contain exactly one entry for each MAC-001 through MAC-006 check.");
  }

  const attachmentByPath = new Map();
  for (const attachment of manifest.attachments) {
    if (attachmentByPath.has(attachment.path)) {
      errors.push(`Attachment path is duplicated: ${attachment.path}`);
      continue;
    }
    attachmentByPath.set(attachment.path, attachment);
    const absoluteAttachment = path.resolve(manifestDirectory, attachment.path);
    if (!absoluteAttachment.startsWith(`${manifestDirectory}${path.sep}`)) {
      errors.push(`Attachment escapes the evidence directory: ${attachment.path}`);
      continue;
    }
    if (!existsSync(absoluteAttachment)) {
      errors.push(`Attachment does not exist: ${attachment.path}`);
      continue;
    }
    const attachmentStat = lstatSync(absoluteAttachment);
    if (!attachmentStat.isFile() || attachmentStat.isSymbolicLink()) {
      errors.push(`Attachment is not a regular non-symlink file: ${attachment.path}`);
      continue;
    }
    const content = readFileSync(absoluteAttachment);
    if (sha256(content) !== attachment.sha256) {
      errors.push(`Attachment digest does not match: ${attachment.path}`);
      continue;
    }

    if (attachment.kind === "screenshot" || attachment.kind === "recording") {
      if (!["manual-visual-review", "automated-and-manual"].includes(attachment.privacyReview.method)) {
        errors.push(`Visual attachment requires a documented manual privacy review: ${attachment.path}`);
      }
      continue;
    }

    if (isTextAttachment(attachment)) {
      if (!["automated-text-scan", "automated-and-manual"].includes(attachment.privacyReview.method)) {
        errors.push(`Text attachment requires an automated text privacy scan: ${attachment.path}`);
      }
      const findings = scanTextForPrivateData(content.toString("utf8"));
      for (const finding of findings) {
        errors.push(`Text attachment contains ${finding}: ${attachment.path}`);
      }
    }
  }

  if (manifest.status === "pass") {
    const observedGroups = new Set(manifest.attachments.map((attachment) => attachment.group));
    for (const group of REQUIRED_ATTACHMENT_GROUPS) {
      if (!observedGroups.has(group)) errors.push(`Required attachment group is missing: ${group}`);
    }

    for (const check of manifest.checks) {
      const referencedGroups = new Set();
      for (const evidenceRef of check.evidenceRefs) {
        const attachment = attachmentByPath.get(evidenceRef);
        if (!attachment) {
          errors.push(`${check.id} evidence reference is not a listed attachment: ${evidenceRef}`);
        } else {
          referencedGroups.add(attachment.group);
        }
      }
      for (const requiredGroup of CHECK_ATTACHMENT_GROUPS[check.id] ?? []) {
        if (!referencedGroups.has(requiredGroup)) {
          errors.push(`${check.id} does not reference required attachment group: ${requiredGroup}`);
        }
      }
    }

    const completedArtifacts = manifest.attachments.filter((attachment) => (
      attachment.group === "completed-artifact" && attachment.kind === "artifact"
    ));
    if (manifest.artifactSha256 && !completedArtifacts.some((attachment) => attachment.sha256 === manifest.artifactSha256)) {
      errors.push("artifactSha256 does not match a completed-artifact attachment of kind artifact.");
    }

    if (manifest.chatgptDesktop.runningProcessArchitecture !== manifest.architecture) {
      errors.push("Running ChatGPT process architecture does not match the native host architecture gate.");
    }
  }

  validateJourneyIdentities(manifest, errors);
  validateKeyboardSelection(manifest, attachmentByPath, errors);
  validateNativeEvidenceShapes(manifest, errors);

  return {
    status: errors.length === 0 ? "pass" : "fail",
    errors,
    manifest,
  };
}

function runCli() {
  const manifestArgument = process.argv[2];
  if (!manifestArgument) {
    console.error("Usage: node evidence/intel-macos-native/validate-evidence.mjs path/to/evidence.json");
    process.exitCode = 1;
    return;
  }
  const result = validateEvidenceBundle(manifestArgument);
  if (result.status !== "pass") {
    for (const error of result.errors) console.error(error);
    process.exitCode = 1;
    return;
  }
  console.log(`Native evidence validation: pass (${result.manifest.gate}, status ${result.manifest.status})`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) runCli();
