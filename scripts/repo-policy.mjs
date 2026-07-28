#!/usr/bin/env node

import {
  existsSync,
  lstatSync,
  readFileSync,
  readdirSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

export const REQUIRED_REPOSITORY_PATHS = [
  ".codex-plugin/plugin.json",
  ".mcp.json",
  "README.md",
  "CONTRIBUTING.md",
  "SECURITY.md",
  "CODE_OF_CONDUCT.md",
  "CHANGELOG.md",
  "LICENSE",
  "NOTICE-AG-UI.md",
  "package.json",
  "package-lock.json",
  "contracts/README.md",
  "docs/README.md",
  "docs/architecture/apple-silicon-verification.md",
  "docs/architecture/runtime-mcp-apps.md",
  "docs/traceability.md",
  "packages/mcp-server/server.mjs",
  "packages/widget/package.json",
  "packages/widget/src/App.jsx",
  "packages/workflow-engine/index.mjs",
  "skills/build-learning-booklet/SKILL.md",
];

export const RELEASE_SOURCE_PREFIXES = [
  ".codex-plugin/",
  "contracts/",
  "docs/",
  "skills/",
];

export const RELEASE_SOURCE_FILES = new Set([
  ".mcp.json",
  "CHANGELOG.md",
  "CODE_OF_CONDUCT.md",
  "CONTRIBUTING.md",
  "LICENSE",
  "NOTICE-AG-UI.md",
  "README.md",
  "SECURITY.md",
  "package.json",
]);

const IGNORED_DIRECTORY_NAMES = new Set([
  ".git",
  ".learning-booklet-runs",
  "dist",
  "node_modules",
  "playwright-report",
  "test-results",
]);

const TEXT_EXTENSIONS = new Set([
  "",
  ".cjs",
  ".css",
  ".feature",
  ".html",
  ".js",
  ".json",
  ".jsx",
  ".md",
  ".mjs",
  ".sh",
  ".txt",
  ".yaml",
  ".yml",
]);

export function normalizeRelative(filePath) {
  return path.relative(ROOT, filePath).split(path.sep).join("/");
}

export function readJson(relativePath) {
  const absolutePath = path.join(ROOT, relativePath);
  try {
    return JSON.parse(readFileSync(absolutePath, "utf8"));
  } catch (error) {
    throw new Error(`${relativePath}: invalid JSON (${error.message})`);
  }
}

export function listRepositoryFiles({ includeDist = false } = {}) {
  const files = [];

  function walk(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (IGNORED_DIRECTORY_NAMES.has(entry.name)) {
          if (!(includeDist && entry.name === "dist" && directory === ROOT)) {
            continue;
          }
        }
        walk(path.join(directory, entry.name));
        continue;
      }

      const absolutePath = path.join(directory, entry.name);
      if (entry.isSymbolicLink() || lstatSync(absolutePath).isSymbolicLink()) {
        files.push({ absolutePath, relativePath: normalizeRelative(absolutePath), symlink: true });
      } else if (entry.isFile()) {
        files.push({ absolutePath, relativePath: normalizeRelative(absolutePath), symlink: false });
      }
    }
  }

  walk(ROOT);
  return files.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
}

export function isTextFile(relativePath) {
  return TEXT_EXTENSIONS.has(path.extname(relativePath).toLowerCase());
}

export function validatePluginManifest() {
  const errors = [];
  const manifest = readJson(".codex-plugin/plugin.json");
  const requiredStrings = ["name", "version", "description"];

  for (const field of requiredStrings) {
    if (typeof manifest[field] !== "string" || manifest[field].trim() === "") {
      errors.push(`.codex-plugin/plugin.json: ${field} must be a non-empty string`);
    }
  }

  if (manifest.name && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(manifest.name)) {
    errors.push(".codex-plugin/plugin.json: name must use lowercase kebab-case");
  }
  if (manifest.version && !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(manifest.version)) {
    errors.push(".codex-plugin/plugin.json: version must be valid SemVer");
  }

  for (const [field, expected] of [["skills", "directory"], ["mcpServers", "file"]]) {
    const value = manifest[field];
    if (typeof value !== "string" || path.isAbsolute(value)) {
      errors.push(`.codex-plugin/plugin.json: ${field} must be a relative path`);
      continue;
    }
    const resolved = path.resolve(ROOT, value);
    if (!resolved.startsWith(`${ROOT}${path.sep}`) || !existsSync(resolved)) {
      errors.push(`.codex-plugin/plugin.json: ${field} path does not exist`);
      continue;
    }
    const stat = lstatSync(resolved);
    if ((expected === "directory" && !stat.isDirectory()) || (expected === "file" && !stat.isFile())) {
      errors.push(`.codex-plugin/plugin.json: ${field} must reference a ${expected}`);
    }
  }

  const interfaceFields = [
    "displayName",
    "shortDescription",
    "longDescription",
    "developerName",
    "category",
    "capabilities",
    "defaultPrompt",
  ];
  for (const field of interfaceFields) {
    if (manifest.interface?.[field] === undefined) {
      errors.push(`.codex-plugin/plugin.json: interface.${field} is required`);
    }
  }
  if (!Array.isArray(manifest.interface?.capabilities) || manifest.interface.capabilities.length === 0) {
    errors.push(".codex-plugin/plugin.json: interface.capabilities must be a non-empty array");
  }

  const mcpConfig = readJson(".mcp.json");
  const servers = Object.values(mcpConfig.mcpServers ?? {});
  if (servers.length !== 1) {
    errors.push(".mcp.json: exactly one local MCP server must be declared");
  }
  for (const server of servers) {
    if (server.command !== "node" || !Array.isArray(server.args) || server.args.length !== 1) {
      errors.push(".mcp.json: local server must use node with one relative entry argument");
    }
    const entry = server.args?.[0];
    if (typeof entry !== "string" || path.isAbsolute(entry) || entry.includes("..")) {
      errors.push(".mcp.json: server entry must be a safe relative path");
    }
  }

  return { errors, manifest };
}

export function parseSkillFrontmatter(markdown) {
  const match = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
  if (!match) return null;
  const fields = {};
  for (const line of match[1].split(/\r?\n/)) {
    const separator = line.indexOf(":");
    if (separator < 1) continue;
    fields[line.slice(0, separator).trim()] = line.slice(separator + 1).trim();
  }
  return fields;
}

export function validatePublicSkill() {
  const errors = [];
  const skillRoot = path.join(ROOT, "skills");
  const publicSkills = readdirSync(skillRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(path.join(skillRoot, entry.name, "SKILL.md")))
    .map((entry) => entry.name);

  if (publicSkills.length !== 1) {
    errors.push(`skills/: expected exactly one public skill, found ${publicSkills.length}`);
    return { errors, fields: null };
  }

  const skillName = publicSkills[0];
  const markdown = readFileSync(path.join(skillRoot, skillName, "SKILL.md"), "utf8");
  const fields = parseSkillFrontmatter(markdown);
  if (!fields) {
    errors.push(`skills/${skillName}/SKILL.md: missing YAML frontmatter`);
    return { errors, fields: null };
  }
  if (fields.name !== skillName) {
    errors.push(`skills/${skillName}/SKILL.md: frontmatter name must match its directory`);
  }
  if (!fields.description || fields.description.length < 40 || fields.description.length > 1024) {
    errors.push(`skills/${skillName}/SKILL.md: description must be 40–1024 characters`);
  }
  if (!/^#[^#]/m.test(markdown.slice(markdown.indexOf("---", 3) + 3))) {
    errors.push(`skills/${skillName}/SKILL.md: missing top-level heading`);
  }
  return { errors, fields };
}

export function scanRepositoryText(files = listRepositoryFiles()) {
  const findings = [];
  const personalPath = new RegExp(
    ["/", "(Users|home)", "/", "[A-Za-z0-9._-]+", "/"].join(""),
    "g",
  );
  const windowsPersonalPath = new RegExp(
    ["[A-Za-z]:", "\\\\", "Users", "\\\\", "[A-Za-z0-9._-]+", "\\\\"].join(""),
    "g",
  );
  const secretPatterns = [
    ["private-key", /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
    ["openai-key", /\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{20,}\b/],
    ["github-token", /\b(?:ghp|gho|ghs|ghu|github_pat)_[A-Za-z0-9_]{20,}\b/],
    ["aws-access-key", /\bAKIA[0-9A-Z]{16}\b/],
  ];
  const placeholderPatterns = [
    ["todo", /\b(?:TODO|TBD|FIXME)\b/],
    ["replace-me", /\b(?:REPLACE[_ -]?ME|CHANGEME)\b/i],
    ["template-token", /\{\{[^}\n]+\}\}/],
  ];

  for (const file of files) {
    if (file.symlink) {
      findings.push({ kind: "symlink", path: file.relativePath, detail: "release sources must not be symlinks" });
      continue;
    }
    if (!isTextFile(file.relativePath)) continue;
    const text = readFileSync(file.absolutePath, "utf8");

    for (const match of text.matchAll(personalPath)) {
      findings.push({ kind: "personal-path", path: file.relativePath, detail: match[0] });
    }
    for (const match of text.matchAll(windowsPersonalPath)) {
      findings.push({ kind: "personal-path", path: file.relativePath, detail: match[0] });
    }
    for (const [kind, pattern] of secretPatterns) {
      const match = text.match(pattern);
      if (match) findings.push({ kind, path: file.relativePath, detail: "credential-like value" });
    }

    // Scripts that implement placeholder detection necessarily contain these words.
    const scannerImplementation = file.relativePath === "scripts/repo-policy.mjs"
      || file.relativePath.endsWith("/audit-html.mjs")
      || file.relativePath.endsWith("/compile-manifest.mjs");
    const githubWorkflow = file.relativePath.startsWith(".github/workflows/");
    if (!scannerImplementation) {
      for (const [kind, pattern] of placeholderPatterns) {
        if (kind === "template-token" && githubWorkflow) continue;
        if (pattern.test(text)) findings.push({ kind, path: file.relativePath, detail: "unfinished marker" });
      }
    }
  }
  return findings;
}

export function validatePackagePolicy() {
  const errors = [];
  const packageJson = readJson("package.json");
  const manifest = readJson(".codex-plugin/plugin.json");
  const forbiddenLifecycle = ["preinstall", "install", "postinstall"];
  for (const name of forbiddenLifecycle) {
    if (packageJson.scripts?.[name]) {
      errors.push(`package.json: install-time lifecycle script ${name} is prohibited`);
    }
  }
  if (packageJson.version !== manifest.version) {
    errors.push("package.json and plugin.json versions must match");
  }
  if (packageJson.license !== "MIT") {
    errors.push("package.json: expected MIT project license");
  }
  if (!/^>=20(?:\.0\.0)?$/.test(packageJson.engines?.node ?? "")) {
    errors.push("package.json: supported Node.js floor must be explicit (>=20)");
  }

  const allowedLicenses = new Set([
    "Apache-2.0",
    "BSD-2-Clause",
    "BSD-3-Clause",
    "ISC",
    "MIT",
    "MPL-2.0",
    "Python-2.0",
    "UNLICENSED",
  ]);
  const lock = readJson("package-lock.json");
  const rootPackage = lock.packages?.[""] ?? {};
  const versionedPackages = [
    [".codex-plugin/plugin.json", manifest.version],
    ["package-lock.json top-level", lock.version],
    ["package-lock.json root package", rootPackage.version],
    ["package-lock.json MCP package", lock.packages?.["packages/mcp-server"]?.version],
    ["packages/mcp-server/package.json", readJson("packages/mcp-server/package.json").version],
    ["packages/workflow-engine/package.json", readJson("packages/workflow-engine/package.json").version],
  ];
  for (const [label, version] of versionedPackages) {
    if (version !== packageJson.version) {
      errors.push(`${label}: version ${version ?? "missing"} must match package.json ${packageJson.version}`);
    }
  }
  const runtimeVersionSources = [
    ["packages/mcp-server/server.mjs", /name:\s*"learning-booklet-studio"\s*,\s*version:\s*"([^"]+)"/],
    ["packages/widget/src/mcp-host.js", /name:\s*"learning-booklet-studio"\s*,\s*version:\s*"([^"]+)"/],
  ];
  for (const [relativePath, pattern] of runtimeVersionSources) {
    const match = readFileSync(path.join(ROOT, relativePath), "utf8").match(pattern);
    if (!match) {
      errors.push(`${relativePath}: Learning Booklet Studio runtime version descriptor is missing`);
    } else if (match[1] !== packageJson.version) {
      errors.push(`${relativePath}: runtime version ${match[1]} must match package.json ${packageJson.version}`);
    }
  }
  const directDependencies = {
    ...(rootPackage.dependencies ?? {}),
    ...(rootPackage.devDependencies ?? {}),
  };
  for (const dependency of Object.keys(directDependencies)) {
    const record = lock.packages?.[`node_modules/${dependency}`];
    if (!record) {
      errors.push(`package-lock.json: missing direct dependency record for ${dependency}`);
      continue;
    }
    if (dependency === "@ag-ui/core") {
      if (!existsSync(path.join(ROOT, "NOTICE-AG-UI.md"))) {
        errors.push("NOTICE-AG-UI.md is required for @ag-ui/core attribution");
      }
      continue;
    }
    if (!allowedLicenses.has(record.license)) {
      errors.push(`package-lock.json: unresolved direct dependency license for ${dependency} (${record.license ?? "missing"})`);
    }
  }
  return { errors, packageJson };
}

export function collectRepositoryChecks() {
  const errors = [];
  for (const relativePath of REQUIRED_REPOSITORY_PATHS) {
    if (!existsSync(path.join(ROOT, relativePath))) {
      errors.push(`${relativePath}: required path is missing`);
    }
  }
  if (errors.length > 0) return { errors, findings: [] };

  errors.push(...validatePluginManifest().errors);
  errors.push(...validatePublicSkill().errors);
  errors.push(...validatePackagePolicy().errors);
  const findings = scanRepositoryText();
  for (const finding of findings) {
    errors.push(`${finding.path}: ${finding.kind} (${finding.detail})`);
  }
  return { errors, findings };
}

export function printResult(label, errors) {
  if (errors.length === 0) {
    console.log(`PASS ${label}`);
    return true;
  }
  console.error(`FAIL ${label}`);
  for (const error of errors) console.error(`  - ${error}`);
  return false;
}
