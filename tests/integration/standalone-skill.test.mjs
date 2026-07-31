import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { cp, mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);
const repositoryRoot = path.resolve(import.meta.dirname, "../..");
const source = path.join(repositoryRoot, "standalone/build-learning-booklet");

async function filesBelow(root, directory = root) {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) result.push(...await filesBelow(root, absolute));
    else result.push(path.relative(root, absolute).split(path.sep).join("/"));
  }
  return result.sort();
}

test("stand-alone skill contains every local runtime layer", async () => {
  const files = await filesBelow(source);
  for (const required of [
    "SKILL.md",
    "agents/openai.yaml",
    "assets/index.template.html",
    "contracts/run-state.schema.json",
    "contracts/workflow-command.schema.json",
    "contracts/workflow-event.schema.json",
    "lib/index.mjs",
    "lib/engine.mjs",
    "references/workflow-contract.md",
    "references/phase-10-release.md",
    "scripts/workflow-state.mjs",
    "scripts/compile-manifest.mjs",
    "scripts/audit-html.mjs",
    "scripts/audit-browser.mjs",
    "scripts/validate-artifact.mjs",
    "scripts/verify-release.mjs",
  ]) assert.ok(files.includes(required), `missing ${required}`);

  const runtimeFiles = files.filter((file) => /\.(?:md|mjs|json|yaml)$/.test(file));
  const content = (await Promise.all(runtimeFiles.map((file) => readFile(path.join(source, file), "utf8")))).join("\n");
  assert.doesNotMatch(content, /(?:\.\.\/){2,}|packages\/workflow-engine|codex-skill-ui|\bMCP\b|\bwidget\b/i);
});

test("copied skill creates and reads state without its source repository", async (t) => {
  const temporary = await mkdtemp(path.join(tmpdir(), "learning-booklet-skill-"));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  const installed = path.join(temporary, "installed-anywhere");
  const workspace = path.join(temporary, "workspace");
  const run = path.join(workspace, "run");
  await cp(source, installed, { recursive: true });
  await mkdir(workspace);

  const script = path.join(installed, "scripts/workflow-state.mjs");
  const created = await execFileAsync(process.execPath, [script, "create", "--workspace", workspace, "--mode", "manifest_only", "--run", run]);
  const createResult = JSON.parse(created.stdout);
  assert.equal(createResult.mode, "manifest_only");
  assert.equal(createResult.runStatus, "draft");

  const shown = await execFileAsync(process.execPath, [script, "show", "--run", run]);
  assert.equal(JSON.parse(shown.stdout).runId, createResult.runId);
});

test("bundled schema validator needs no installed package", async () => {
  const { validateArtifact } = await import(path.join(source, "lib/json-schema.mjs"));
  const schema = JSON.parse(await readFile(path.join(source, "contracts/intent-field.schema.json"), "utf8"));
  const valid = validateArtifact({
    value: "engineers",
    origin: "user",
    locked: true,
    confidence: 1,
    updatedAt: "2026-07-31T00:00:00.000Z",
    evidenceRefs: [],
  }, schema);
  assert.equal(valid.valid, true);
  const invalid = validateArtifact({ origin: "invented", confidence: 2 }, schema);
  assert.equal(invalid.valid, false);
  assert.ok(invalid.errors.length >= 5);
});

test("bundled schema validator resolves contract references relative to the current schema", async () => {
  const contractsDirectory = path.join(source, "contracts");
  const schemas = await Promise.all(
    (await readdir(contractsDirectory))
      .filter((file) => file.endsWith(".schema.json"))
      .map(async (file) => JSON.parse(await readFile(path.join(contractsDirectory, file), "utf8"))),
  );
  const runSchema = schemas.find((schema) => schema.$id.endsWith("/run-state.schema.json"));
  const { createRunState } = await import(path.join(source, "lib/index.mjs"));
  const { validateArtifact } = await import(path.join(source, "lib/json-schema.mjs"));
  const state = createRunState({
    runId: "schema-reference-test",
    mode: "manifest_only",
    now: "2026-07-31T00:00:00.000Z",
  });

  const validation = validateArtifact(state, runSchema, schemas);
  assert.equal(validation.valid, true, JSON.stringify(validation.errors, null, 2));
});

test("manifest-only intent requirements cover every non-derived compiler input", async () => {
  const { createRunState, getMissingIntentFields } = await import(path.join(source, "lib/index.mjs"));
  const state = createRunState({
    runId: "manifest-requirements-test",
    mode: "manifest_only",
    intent: {
      topic: "State machines",
      learner: "Engineers",
      depth: "Intermediate",
      duration: "30 minutes",
      scope: { include: ["Transitions"] },
    },
    now: "2026-07-31T00:00:00.000Z",
  });

  assert.deepEqual(getMissingIntentFields(state), [
    "topicDomain",
    "userRequest",
    "prerequisites",
    "desiredLearningOutcomes",
    "desiredInteractions",
    "assessmentStrategy",
    "dependencyPolicy",
    "offlineRequirement",
  ]);
});

test("state creation rejects a run root redirected outside the workspace", async (t) => {
  const temporary = await mkdtemp(path.join(tmpdir(), "learning-booklet-symlink-"));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  const workspace = path.join(temporary, "workspace");
  const outside = path.join(temporary, "outside");
  await Promise.all([mkdir(workspace), mkdir(outside)]);
  await symlink(outside, path.join(workspace, ".learning-booklet"), "dir");

  const script = path.join(source, "scripts/workflow-state.mjs");
  await assert.rejects(
    execFileAsync(process.execPath, [
      script,
      "create",
      "--workspace",
      workspace,
      "--mode",
      "manifest_only",
      "--run-id",
      "redirected",
    ]),
    (error) => {
      assert.match(error.stderr, /run root must resolve inside the workspace/i);
      return true;
    },
  );
  await assert.rejects(readFile(path.join(outside, "runs/redirected/run-state.json"), "utf8"));
});

test("parallel state commands serialize without losing updates", async (t) => {
  const temporary = await mkdtemp(path.join(tmpdir(), "learning-booklet-lock-"));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  const workspace = path.join(temporary, "workspace");
  const run = path.join(workspace, "run");
  await mkdir(workspace);

  const script = path.join(source, "scripts/workflow-state.mjs");
  await execFileAsync(process.execPath, [
    script,
    "create",
    "--workspace",
    workspace,
    "--mode",
    "manifest_only",
    "--run",
    run,
  ]);
  const before = JSON.parse(await readFile(path.join(run, "run-state.json"), "utf8"));
  const commandCount = 8;
  const payloads = await Promise.all(Array.from({ length: commandCount }, async (_, index) => {
    const payload = path.join(temporary, `payload-${index}.json`);
    await writeFile(payload, JSON.stringify({ patch: { [`parallelField${index}`]: `value-${index}` } }));
    return payload;
  }));

  await Promise.all(payloads.map((payload) => execFileAsync(process.execPath, [
    script,
    "apply",
    "--run",
    run,
    "--command",
    "intent.patch",
    "--payload",
    payload,
  ])));

  const after = JSON.parse(await readFile(path.join(run, "run-state.json"), "utf8"));
  assert.equal(after.stateVersion, before.stateVersion + commandCount);
  assert.equal(after.events.length, before.events.length + commandCount);
  for (let index = 0; index < commandCount; index += 1) {
    assert.equal(after.intent.fields[`parallelField${index}`].value, `value-${index}`);
  }
});
