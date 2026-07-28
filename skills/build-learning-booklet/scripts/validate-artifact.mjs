#!/usr/bin/env node

import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import process from "node:process";

function usage(message) {
  if (message) console.error(message);
  console.error("Usage: validate-artifact.mjs --artifact <json> --schema <schema.json> [--report <report.json>]");
  process.exit(2);
}

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith("--") || !value) usage(`Invalid argument near ${key ?? "end"}`);
    result[key.slice(2)] = value;
  }
  return result;
}

async function loadValidator() {
  try {
    let imported;
    try {
      imported = await import("ajv/dist/2020.js");
    } catch {
      imported = await import("ajv");
    }
    const Ajv = imported.default ?? imported.Ajv ?? imported;
    const ajv = new Ajv({ allErrors: true, strict: false, allowUnionTypes: true });
    try {
      const formats = await import("ajv-formats");
      (formats.default ?? formats)(ajv);
    } catch {
      // Formats are optional; structural validation remains available.
    }
    return {
      name: "ajv",
      validate(schema, artifact, relatedSchemas = []) {
        for (const related of relatedSchemas) {
          if (related?.$id && related.$id !== schema.$id && !ajv.getSchema(related.$id)) {
            ajv.addSchema(related, related.$id);
          }
        }
        const compiled = ajv.compile(schema);
        const valid = compiled(artifact);
        return { valid: Boolean(valid), errors: compiled.errors ?? [] };
      },
    };
  } catch {
    // Fall through to an engine-provided validator when dependencies are bundled there.
  }

  const engineUrl = new URL("../../../packages/workflow-engine/index.mjs", import.meta.url);
  try {
    const engine = await import(engineUrl.href);
    if (typeof engine.validateArtifact === "function") {
      return {
        name: "workflow-engine",
        async validate(schema, artifact) {
          const result = await engine.validateArtifact(artifact, schema);
          return typeof result === "boolean" ? { valid: result, errors: [] } : result;
        },
      };
    }
  } catch {
    // The operational error below is intentionally honest.
  }

  return null;
}

const options = parseArgs(process.argv.slice(2));
if (!options.artifact || !options.schema) usage("--artifact and --schema are required");

let artifact;
let schema;
let relatedSchemas = [];
try {
  [artifact, schema] = await Promise.all([
    readFile(options.artifact, "utf8").then(JSON.parse),
    readFile(options.schema, "utf8").then(JSON.parse),
  ]);
  const schemaDirectory = path.dirname(path.resolve(options.schema));
  const siblingNames = (await readdir(schemaDirectory)).filter((name) => name.endsWith(".schema.json"));
  relatedSchemas = await Promise.all(siblingNames.map(async (name) => {
    try {
      return JSON.parse(await readFile(path.join(schemaDirectory, name), "utf8"));
    } catch {
      return null;
    }
  }));
  relatedSchemas = relatedSchemas.filter(Boolean);
} catch (error) {
  console.error(JSON.stringify({ status: "not_run", reason: `Cannot load JSON: ${error.message}` }, null, 2));
  process.exit(2);
}

const validator = await loadValidator();
if (!validator) {
  const report = {
    status: "not_run",
    artifact: pathToFileURL(options.artifact).href,
    schema: pathToFileURL(options.schema).href,
    reason: "No JSON Schema validator is available. Install the plugin dependencies or expose workflow-engine.validateArtifact.",
  };
  if (options.report) await writeFile(options.report, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.error(JSON.stringify(report, null, 2));
  process.exit(2);
}

let result;
try {
  result = await validator.validate(schema, artifact, relatedSchemas);
} catch (error) {
  console.error(JSON.stringify({ status: "not_run", validator: validator.name, reason: error.message }, null, 2));
  process.exit(2);
}

const report = {
  status: result.valid ? "pass" : "fail",
  validator: validator.name,
  artifact: options.artifact,
  schema: options.schema,
  errors: result.errors ?? [],
};
if (options.report) await writeFile(options.report, `${JSON.stringify(report, null, 2)}\n`, "utf8");
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
process.exit(result.valid ? 0 : 1);
