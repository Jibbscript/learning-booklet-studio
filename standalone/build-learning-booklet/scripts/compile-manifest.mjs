#!/usr/bin/env node

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const FIELD_ORDER = [
  ["topic", "topic"],
  ["topicDomain", "topic_domain"],
  ["userRequest", "user_request"],
  ["sourceUrlsOrDocuments", "source_urls_or_documents"],
  ["targetAudience", "target_audience"],
  ["learnerMotivation", "learner_motivation"],
  ["prerequisites", "prerequisites"],
  ["desiredLearningOutcomes", "desired_learning_outcomes"],
  ["depth", "depth"],
  ["learningDuration", "learning_duration"],
  ["mandatoryConcepts", "mandatory_concepts"],
  ["optionalConcepts", "optional_concepts"],
  ["excludedConcepts", "excluded_concepts"],
  ["technicalScope", "technical_scope"],
  ["desiredInteractions", "desired_interactions"],
  ["assessmentStrategy", "assessment_strategy"],
  ["visualDirection", "visual_direction"],
  ["instructionalTone", "instructional_tone"],
  ["browserTargets", "browser_targets"],
  ["dependencyPolicy", "dependency_policy"],
  ["offlineRequirement", "offline_requirement"],
  ["maximumFileSize", "maximum_file_size"],
  ["citationStyle", "citation_style"],
  ["evidenceStandard", "evidence_standard"],
  ["executionMode", "execution_mode"],
  ["additionalConstraints", "additional_constraints"],
  ["assumptions", "assumptions"],
  ["unresolvedNonblockingItems", "unresolved_nonblocking_items"],
];

const REQUIRED = new Set([
  "topic",
  "topicDomain",
  "userRequest",
  "targetAudience",
  "prerequisites",
  "desiredLearningOutcomes",
  "depth",
  "learningDuration",
  "mandatoryConcepts",
  "desiredInteractions",
  "assessmentStrategy",
  "visualDirection",
  "dependencyPolicy",
  "offlineRequirement",
  "executionMode",
]);

function usage(message) {
  if (message) console.error(message);
  console.error("Usage: compile-manifest.mjs --input <intent.manifest.json|-> [--output <intent.manifest.txt>]");
  process.exit(2);
}

function argsOf(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) usage(`Unexpected argument: ${token}`);
    const key = token.slice(2);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) usage(`Missing value for --${key}`);
    result[key] = value;
    index += 1;
  }
  return result;
}

function unwrap(entry) {
  if (entry && typeof entry === "object" && !Array.isArray(entry) && Object.hasOwn(entry, "value")) {
    return entry.value;
  }
  return entry;
}

function getField(manifest, camel, snake) {
  const containers = [manifest.fields, manifest.values, manifest.intent?.fields, manifest.intent, manifest];
  const compatibilityAliases = {
    topicDomain: ["domain", "topic_domain"],
    userRequest: ["request", "user_request"],
    sourceUrlsOrDocuments: ["sources", "source_material"],
    targetAudience: ["learner", "audience"],
    desiredLearningOutcomes: ["outcomes", "learning_outcomes"],
    learningDuration: ["duration"],
    desiredInteractions: ["interactions"],
    dependencyPolicy: ["dependency", "dependencies"],
    offlineRequirement: ["offline"],
    executionMode: ["mode"],
  };
  const aliases = [camel, snake, `{{${snake}}}`, ...(compatibilityAliases[camel] ?? [])];
  for (const container of containers) {
    if (!container || typeof container !== "object") continue;
    for (const alias of aliases) {
      if (Object.hasOwn(container, alias)) return unwrap(container[alias]);
    }
  }
  const scope = unwrap(manifest.fields?.scope ?? manifest.intent?.fields?.scope ?? manifest.intent?.scope ?? manifest.scope);
  if (scope && typeof scope === "object") {
    if (camel === "mandatoryConcepts") return scope.include ?? scope.mandatory;
    if (camel === "optionalConcepts") return scope.optional;
    if (camel === "excludedConcepts") return scope.exclude ?? scope.excluded;
    if (camel === "technicalScope") return scope.technical;
  }
  if (camel === "visualDirection" && manifest.design?.finalVisualDirection) {
    return {
      selectionBasis: manifest.design.selection?.method ?? "direct",
      ...manifest.design.finalVisualDirection,
    };
  }
  return undefined;
}

function isEmpty(value) {
  return value === undefined || value === null || value === "" || (Array.isArray(value) && value.length === 0);
}

function unresolvedIn(value) {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return /\[\s*TODO\s*[:\]]|<(?:insert|replace|enter|add|canonical|learner|concept|source|value|constraint)\b[^>]*>|\{\{[^}]+\}\}|implement\s+later|lorem\s+ipsum/i.test(text ?? "");
}

function renderScalar(value) {
  if (typeof value === "boolean" || typeof value === "number") return String(value);
  if (value === null || value === undefined || value === "") return "none";
  return String(value).trim();
}

function renderValue(value, indent = 0) {
  const prefix = " ".repeat(indent);
  if (Array.isArray(value)) {
    if (value.length === 0) return "- none";
    return value.map((item) => {
      if (item && typeof item === "object") {
        const nested = renderValue(item, indent + 2).split("\n");
        return `${prefix}- ${nested[0].trimStart()}${nested.length > 1 ? `\n${nested.slice(1).join("\n")}` : ""}`;
      }
      return `${prefix}- ${renderScalar(item)}`;
    }).join("\n");
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value);
    if (entries.length === 0) return "none";
    return entries.map(([key, item]) => {
      if (Array.isArray(item) || (item && typeof item === "object")) {
        return `${prefix}- ${key}:\n${renderValue(item, indent + 2)}`;
      }
      return `${prefix}- ${key}: ${renderScalar(item)}`;
    }).join("\n");
  }
  return renderScalar(value);
}

function findCriticalIssues(manifest) {
  const conflicts = [manifest.conflicts, manifest.intent?.conflicts]
    .flatMap((value) => Array.isArray(value) ? value : value ? [value] : [])
    .filter((issue) => issue?.status !== "resolved" && issue?.severity !== "warning");
  const unresolved = [manifest.unresolvedCritical, manifest.unresolved_critical]
    .flatMap((value) => Array.isArray(value) ? value : value ? [value] : []);
  return [...conflicts, ...unresolved];
}

const options = argsOf(process.argv.slice(2));
if (!options.input) usage("--input is required");

let manifest;
try {
  let source;
  if (options.input === "-") {
    const chunks = [];
    for await (const chunk of process.stdin) chunks.push(chunk);
    source = Buffer.concat(chunks.map((chunk) => Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))).toString("utf8");
  } else {
    source = await readFile(options.input, "utf8");
  }
  manifest = JSON.parse(source);
} catch (error) {
  console.error(`Cannot read manifest: ${error.message}`);
  process.exit(2);
}

const errors = [];
const values = new Map();
for (const [camel, snake] of FIELD_ORDER) {
  const value = getField(manifest, camel, snake);
  values.set(camel, value);
  if (REQUIRED.has(camel) && isEmpty(value)) errors.push(`Missing required field: ${camel}`);
  if (!isEmpty(value) && unresolvedIn(value)) errors.push(`Unresolved placeholder in field: ${camel}`);
}

for (const issue of findCriticalIssues(manifest)) errors.push(`Unresolved critical issue: ${JSON.stringify(issue)}`);

const design = values.get("visualDirection");
if (!isEmpty(design) && (typeof design !== "object" || Array.isArray(design))) {
  errors.push("visualDirection must be a normalized implementation-authoritative object");
} else if (design && typeof design === "object") {
  const basis = design.selectionBasis ?? design.selection_basis ?? design.selection?.method;
  const thesis = design.designThesis ?? design.design_thesis ?? design.thesis ?? design.finalVisualDirection?.designThesis;
  if (!basis) errors.push("visualDirection is missing its selection basis");
  if (!thesis && !design.finalVisualDirection) errors.push("visualDirection is missing an implementation-authoritative design thesis");
  if (Array.isArray(design.options) || Array.isArray(design.rejectedOptions)) {
    errors.push("visualDirection must not contain the design-option catalogue or rejected alternatives");
  }
}

const mode = values.get("executionMode");
if (!isEmpty(mode) && !["manifest_only", "plan_only", "plan_then_build"].includes(String(mode))) {
  errors.push(`Invalid executionMode: ${mode}`);
}

if (errors.length > 0) {
  console.error(JSON.stringify({ status: "fail", errors }, null, 2));
  process.exit(1);
}

const sections = FIELD_ORDER.map(([camel, snake]) => {
  const value = values.get(camel);
  const rendered = isEmpty(value) ? "none" : renderValue(value);
  return `{{${snake}}}:\n${rendered}`;
});
const output = `${sections.join("\n\n")}\n`;

if (options.output) {
  const outputPath = path.resolve(options.output);
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, output, "utf8");
} else {
  process.stdout.write(output);
}
