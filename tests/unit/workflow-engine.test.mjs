import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import Ajv2020 from "ajv/dist/2020.js";

import {
  COMMAND_TYPES,
  CODEX_SKILL_UI_PROTOCOL,
  EVIDENCE_STATUS,
  PHASES,
  PHASE_IDS,
  applyCommand,
  compileManifest,
  completePhase,
  createRunState,
  evaluatePhaseGate,
  failPhase,
  gateResultIsCurrent,
  getMissingIntentFields,
  getUnauthoritativeIntentFields,
  hashValue,
  isEvidenceFresh,
  patchIntentManifest,
  projectCodexSkillUiEvents,
  projectCodexSkillUiJourney,
  proposeDesignOptions,
  recordArtifact,
  recordEvidence,
  recordFinding,
  registerSource,
  releaseDecision,
  runNativeFailureRepairFixture,
  requestInput,
  resumeRunState,
  requiredIntentQuestions,
  resolveFinding,
  selectDesign,
  startPhase,
  createNativeFailureFixture,
  repairNativeFailureFixture,
  validateDesignOptions,
  validateCodexSkillUiSequence,
  validateEventLog,
  validatePortableArtifact,
} from "../../packages/workflow-engine/index.mjs";

const execFileAsync = promisify(execFile);

const FIXTURE_DIR = new URL("../fixtures/", import.meta.url);
const CONTRACT_DIR = new URL("../../contracts/", import.meta.url);
const AT = "2026-07-22T12:00:00.000Z";

async function fixture(name) {
  return JSON.parse(await readFile(new URL(name, FIXTURE_DIR), "utf8"));
}

function expectWorkflowError(code, operation) {
  assert.throws(operation, (error) => {
    assert.equal(error?.name, "WorkflowError");
    assert.equal(error?.code, code);
    return true;
  });
}

async function newStringZillaRun({ mode = "plan_then_build", runId = `run-${mode}` } = {}) {
  const intentFixture = await fixture("stringzilla-intent.json");
  return createRunState({
    runId,
    mode,
    intent: intentFixture.fields,
    permissions: { network: false, shell: false, filesystem: false },
    now: AT,
  });
}

async function readyI0({ mode = "plan_then_build", runId } = {}) {
  const design = await fixture("stringzilla-design-options.json");
  let state = await newStringZillaRun({ mode, runId });
  state = startPhase(state, "I0", { now: AT });
  state = proposeDesignOptions(state, design.options, { now: AT });
  state = selectDesign(
    state,
    { method: "user-selected", selectedOptionId: "memory-lab" },
    { now: AT, selectedBy: "fixture-user" },
  );
  state = recordArtifact(
    state,
    {
      id: "artifact-intent",
      kind: "intent",
      data: compileManifest(state),
      metadata: { fixture: "stringzilla-intent.json" },
    },
    { now: AT },
  );
  state = passCurrentGates(state, "I0");
  return completePhase(state, "I0", { now: AT });
}

function passCurrentGates(inputState, phaseId) {
  let state = inputState;
  const phase = PHASES.find(({ id }) => id === phaseId);
  const artifact = state.artifacts[state.artifactIndex[phase.outputKind]];
  assert.ok(artifact, `current ${phase.outputKind} artifact is required by the test helper`);
  phase.gates.forEach((gateId, gateIndex) => {
    const evidenceId = `evidence-${phaseId}-${gateIndex}-${state.eventCursor + 1}`;
    state = recordEvidence(
      state,
      {
        id: evidenceId,
        phaseId,
        gateId,
        status: "pass",
        executed: true,
        critical: true,
        artifactId: artifact.id,
        artifactHash: artifact.hash,
        details: { fixtureCheck: gateId },
      },
      { now: AT },
    );
    state = evaluatePhaseGate(
      state,
      { phaseId, gateId, evidenceIds: [evidenceId] },
      { now: AT },
    );
  });
  return state;
}

async function preparePhase(inputState, phaseId, { complete = true } = {}) {
  const phase = PHASES.find(({ id }) => id === phaseId);
  let state = startPhase(inputState, phaseId, { now: AT });
  let artifact;
  if (phaseId === "P7") {
    const production = await fixture("stringzilla-production-input.json");
    artifact = production;
  } else {
    artifact = {
      id: `artifact-${phase.outputKind}`,
      kind: phase.outputKind,
      phaseId,
      data: {
        fixture: "StringZilla",
        phaseId,
        output: phase.outputKind,
        complete: true,
      },
      metadata: { selfContained: phaseId === "P6" ? true : undefined },
    };
  }
  state = recordArtifact(state, artifact, { now: AT });
  state = passCurrentGates(state, phaseId);
  return complete ? completePhase(state, phaseId, { now: AT }) : state;
}

async function throughPhase(targetPhaseId, { mode = "plan_then_build" } = {}) {
  let state = await readyI0({ mode, runId: `through-${targetPhaseId}-${mode}` });
  for (const phaseId of PHASE_IDS.slice(1)) {
    if (!PHASE_IDS.slice(1, PHASE_IDS.indexOf(targetPhaseId) + 1).includes(phaseId)) break;
    state = await preparePhase(state, phaseId);
  }
  return state;
}

test("canonical phase and evidence vocabularies are exact", () => {
  assert.deepEqual(PHASE_IDS, ["I0", "P0", "P1", "P2", "P3", "P4", "P5", "P6", "P7", "P8", "P9", "P10"]);
  assert.deepEqual(EVIDENCE_STATUS, ["pass", "fail", "partial", "not_run", "not_applicable"]);
  assert.ok(COMMAND_TYPES.includes("release.decide"));
  assert.ok(COMMAND_TYPES.includes("phase.reopen"));
  assert.equal(new Set(PHASE_IDS).size, 12);
});

test("run creation writes a valid first event and a gap-free version", async () => {
  const state = await newStringZillaRun({ runId: "create-run" });
  assert.equal(state.events.length, 1);
  assert.equal(state.events[0].type, "run.created");
  assert.equal(state.events[0].seq, 1);
  assert.equal(state.events[0].stateVersion, 1);
  assert.equal(state.eventCursor, 1);
  assert.equal(state.stateVersion, 1);
  assert.deepEqual(validateEventLog(state), { valid: true, errors: [] });
  expectWorkflowError("INVALID_TIMESTAMP", () => createRunState({ runId: "bad-time", now: "0" }));
});

test("event-log validation binds every event and the creation payload to canonical run identity", async () => {
  const state = await newStringZillaRun({ runId: "identity-bound-events" });
  expectWorkflowError("INVALID_TIMESTAMP_ORDER", () => applyCommand(state, {
    type: "intent.patch",
    payload: { patch: { timeProbe: true }, meta: { now: "2026-07-21T12:00:00.000Z" } },
  }));
  const mutations = [
    ["event id", (draft) => { draft.events[0].id = "forged:1"; }],
    ["event runId", (draft) => { draft.events[0].runId = "forged"; }],
    ["creation thread", (draft) => { draft.events[0].payload.threadId = "forged-thread"; }],
    ["creation parent", (draft) => { draft.events[0].payload.parentRunId = "forged-parent"; }],
    ["creation resume", (draft) => { draft.events[0].payload.resume = [{ interruptId: "forged", value: {} }]; }],
    ["creation mode", (draft) => { draft.events[0].payload.mode = "plan_only"; }],
    ["creation time", (draft) => { draft.createdAt = "2020-01-01T00:00:00.000Z"; }],
    ["nonterminal execution", (draft) => { draft.executionStatus = "success"; draft.status = "completed"; }],
  ];
  for (const [label, mutate] of mutations) {
    const draft = structuredClone(state);
    mutate(draft);
    assert.equal(validateEventLog(draft).valid, false, label);
  }

  const duplicateResume = structuredClone(state);
  duplicateResume.resume = [
    { interruptId: "decision:1", value: {} },
    { interruptId: "decision:1", value: {} },
  ];
  duplicateResume.events[0].payload.resume = structuredClone(duplicateResume.resume);
  assert.equal(validateEventLog(duplicateResume).valid, false);
});

test("defaults and inference cannot silently overwrite locked user intent", async () => {
  let state = await newStringZillaRun({ runId: "intent-lock" });
  const originalLearner = state.intent.fields.learner;
  state = patchIntentManifest(
    state,
    { learner: "engineering leaders" },
    { origin: "defaulted", confidence: 0.1, now: AT },
  );
  assert.deepEqual(state.intent.fields.learner, originalLearner);
  assert.equal(state.intent.conflicts.length, 0);

  state = patchIntentManifest(
    state,
    { duration: "2 hours" },
    { origin: "inferred", confidence: 0.7, now: AT },
  );
  assert.equal(state.intent.fields.duration.value, "35 minutes");
  assert.equal(state.intent.conflicts.length, 1);
  assert.equal(state.intent.conflicts[0].field, "duration");
  assert.equal(state.intent.conflicts[0].status, "open");

  state = patchIntentManifest(
    state,
    { duration: { value: "50 minutes", origin: "user", locked: true, confidence: 1 } },
    { now: AT },
  );
  assert.equal(state.intent.fields.duration.value, "50 minutes");
  assert.equal(state.intent.fields.duration.origin, "user");
  assert.equal(state.intent.fields.duration.locked, true);
  assert.equal(state.intent.conflicts[0].status, "resolved");
});

test("known authoritative context is not asked again", async () => {
  const state = await newStringZillaRun({ runId: "known-context" });
  assert.deepEqual(getMissingIntentFields(state), []);
  assert.deepEqual(getUnauthoritativeIntentFields(state), []);
  assert.deepEqual(requiredIntentQuestions(state), []);
});

test("interrupt is terminal and complete resume creates a same-thread child run", async () => {
  const design = await fixture("stringzilla-design-options.json");
  let parent = createRunState({
    runId: "interrupt-parent",
    threadId: "thread-native-intel",
    intent: { topic: { value: "StringZilla", origin: "user", locked: true } },
    now: AT,
  });
  parent = startPhase(parent, "I0", { now: AT });
  parent = requestInput(
    parent,
    { type: "intent", fields: ["learner"], prompt: "Who is this for?" },
    { now: AT },
  );
  assert.equal(parent.status, "awaiting_user");
  assert.equal(parent.phases.I0.status, "awaiting_user");
  assert.equal(parent.executionStatus, "interrupt");
  assert.equal(parent.terminalOutcome, "interrupt");
  assert.deepEqual(parent.events.at(-1).payload, {
    outcome: "interrupt",
    finalRevision: parent.stateVersion,
    evidenceIds: [],
  });
  assert.equal(parent.events.at(-1).type, "run.finished");
  expectWorkflowError("RUN_TERMINAL", () =>
    patchIntentManifest(
      parent,
      { learner: { value: "Python developers", origin: "user", locked: true } },
      { now: AT },
    ),
  );
  expectWorkflowError("INTERRUPT_SET_INCOMPLETE", () =>
    resumeRunState(parent, { runId: "interrupt-child-incomplete", resume: [], now: AT }),
  );
  expectWorkflowError("INTERRUPT_NOT_OPEN", () =>
    resumeRunState(parent, {
      runId: "interrupt-child-unknown",
      resume: [{ interruptId: "decision:unknown", value: {} }],
      now: AT,
    }),
  );

  const intentInterruptId = parent.pendingDecision.id;
  expectWorkflowError("INVALID_TIMESTAMP_ORDER", () => resumeRunState(parent, {
    runId: "interrupt-child-in-the-past",
    resume: [{ interruptId: intentInterruptId, value: { patch: { learner: "Python developers" } } }],
    now: "2026-07-21T12:00:00.000Z",
  }));
  let child = resumeRunState(parent, {
    runId: "interrupt-child",
    threadId: "thread-native-intel",
    resume: [{
      interruptId: intentInterruptId,
      value: { patch: { learner: { value: "Python developers", origin: "user", locked: true } } },
    }],
    now: AT,
  });
  assert.equal(parent.pendingDecision.id, intentInterruptId, "parent state must remain immutable");
  assert.equal(child.threadId, parent.threadId);
  assert.equal(child.runId, "interrupt-child");
  assert.equal(child.parentRunId, parent.runId);
  assert.equal(child.pendingDecision, null);
  assert.equal(child.status, "active");
  assert.equal(child.phases.I0.status, "active");
  assert.equal(child.executionStatus, "running");
  assert.equal(child.events[0].type, "run.created");
  assert.deepEqual(child.events[0].payload.resume, child.resume);

  child = proposeDesignOptions(child, design.options, { now: AT });
  child = requestInput(
    child,
    { type: "design_selection", prompt: "Choose a direction." },
    { now: AT },
  );
  const designInterruptId = child.pendingDecision.id;
  const grandchild = resumeRunState(child, {
    runId: "interrupt-grandchild",
    resume: [{
      interruptId: designInterruptId,
      value: { selection: { method: "user-selected", selectedOptionId: "memory-lab" } },
    }],
    now: AT,
  });
  assert.equal(grandchild.threadId, parent.threadId);
  assert.equal(grandchild.parentRunId, child.runId);
  assert.equal(grandchild.design.selection.selectedOptionId, "memory-lab");
  assert.equal(grandchild.pendingDecision, null);
  assert.deepEqual(validateEventLog(parent), { valid: true, errors: [] });
  assert.deepEqual(validateEventLog(child), { valid: true, errors: [] });
  assert.deepEqual(validateEventLog(grandchild), { valid: true, errors: [] });
});

test("codex-skill-ui adapter emits ordered terminal parent and resumed child sequences", () => {
  const fixtureRun = runNativeFailureRepairFixture({
    threadId: "transport-thread",
    parentRunId: "transport-parent",
    runId: "transport-child",
    now: AT,
  });
  const journey = projectCodexSkillUiJourney(fixtureRun.interruptedState, fixtureRun.state);
  assert.equal(journey.protocol, CODEX_SKILL_UI_PROTOCOL);
  assert.equal(journey.threadId, "transport-thread");
  assert.equal(journey.parentRunId, "transport-parent");
  assert.equal(journey.childRunId, "transport-child");
  assert.deepEqual(journey.validation.parent, { valid: true, errors: [] });
  assert.deepEqual(journey.validation.child, { valid: true, errors: [] });

  for (const events of [journey.parentEvents, journey.childEvents]) {
    assert.equal(events[0].type, "RUN_STARTED");
    events.forEach((event, index) => {
      assert.equal(event.protocol, CODEX_SKILL_UI_PROTOCOL);
      assert.equal(event.seq, index);
      assert.equal(event.threadId, "transport-thread");
      assert.equal(event.runId, events[0].runId);
      assert.equal(event.parentRunId, events[0].parentRunId);
      assert.equal(JSON.stringify(event).includes("/Users/"), false);
      assert.equal(JSON.stringify(event).includes("privateKey"), false);
    });
    const terminals = events.filter(({ type }) => ["RUN_FINISHED", "RUN_ERROR"].includes(type));
    assert.equal(terminals.length, 1);
    assert.equal(events.at(-1), terminals[0]);
    assert.deepEqual(validateCodexSkillUiSequence(events), { valid: true, errors: [] });
  }

  const parentMessages = journey.parentEvents.filter(({ type }) => type === "MESSAGES_SNAPSHOT");
  assert.equal(parentMessages.length, 1);
  assert.deepEqual(parentMessages[0].payload.openInterruptIds, [fixtureRun.interruptId]);
  assert.equal(parentMessages[0].payload.question, "Choose one of the available design directions.");
  assert.equal(journey.parentEvents.at(-1).payload.outcome, "interrupt");

  assert.notEqual(journey.parentEvents[0].runId, journey.childEvents[0].runId);
  assert.equal(journey.childEvents[0].parentRunId, journey.parentEvents[0].runId);
  assert.deepEqual(journey.childEvents[0].payload.resume, fixtureRun.state.resume);
  assert.deepEqual(journey.childEvents[1].payload.openInterrupts, []);
  assert.equal(journey.childEvents.at(-1).payload.outcome, "success");
  assert.equal(journey.childEvents.at(-1).payload.workflowStatus, "completed");
  assert.ok(journey.childEvents.some(({ type }) => type === "STEP_FINISHED"));
  assert.ok(journey.childEvents.some(({ type }) => type === "STATE_SNAPSHOT"));
  const finalSnapshot = journey.childEvents.at(-2).payload;
  assert.deepEqual(
    finalSnapshot.defects.map(({ code, status }) => ({ code, status })),
    [{ code: "NATIVE_FIXTURE_FOCUS_OBSCURED", status: "resolved" }],
  );
});

test("codex-skill-ui adapter rejects canonical events after terminal", () => {
  const fixtureRun = runNativeFailureRepairFixture({ now: AT });
  const corrupted = structuredClone(fixtureRun.interruptedState);
  const terminal = corrupted.events.at(-1);
  corrupted.events.push({
    ...structuredClone(terminal),
    id: `${corrupted.runId}:${terminal.seq + 1}`,
    seq: terminal.seq + 1,
    stateVersion: terminal.stateVersion + 1,
    type: "run.updated",
    payload: { section: "illegal-after-terminal" },
  });
  corrupted.eventCursor += 1;
  corrupted.stateVersion += 1;
  expectWorkflowError("INVALID_TRANSITION", () => projectCodexSkillUiEvents(corrupted));
});

test("codex-skill-ui adapter redacts resume secrets and never publishes raw decision prompts", () => {
  const personalPath = ["", "Users", "alice", "private", "key.txt"].join("/");
  const promptSecret = ["raw", "secret", "in", "prompt"].join("-");
  const resumeSecret = ["raw", "secret", "in", "resume"].join("-");
  let parent = createRunState({ runId: "safe-parent", threadId: "safe-thread", now: AT });
  parent = startPhase(parent, "I0", { now: AT });
  parent = requestInput(
    parent,
    {
      type: "approval",
      prompt: `Use ${personalPath} with ${promptSecret}?`,
    },
    { now: AT },
  );
  const parentEvents = projectCodexSkillUiEvents(parent);
  const parentJson = JSON.stringify(parentEvents);
  assert.equal(parentJson.includes(personalPath), false);
  assert.equal(parentJson.includes(promptSecret), false);
  assert.equal(
    parentEvents.find(({ type }) => type === "MESSAGES_SNAPSHOT").payload.question,
    "Resolve the open workflow decision.",
  );

  const child = resumeRunState(parent, {
    runId: "safe-child",
    resume: [{
      interruptId: parent.pendingDecision.id,
      value: {
        approved: true,
        privateKey: resumeSecret,
        localPath: personalPath,
      },
    }],
    now: AT,
  });
  const childEvents = projectCodexSkillUiEvents(child);
  const childJson = JSON.stringify(childEvents);
  assert.equal(childJson.includes(resumeSecret), false);
  assert.equal(childJson.includes(personalPath), false);
  assert.ok(childJson.includes("[redacted]"));
  assert.deepEqual(validateCodexSkillUiSequence(childEvents, { requireTerminal: false }), {
    valid: true,
    errors: [],
  });
});

test("packaged native fixture preserves failed history, repairs P7 attempt 2, and reruns P8-P10", () => {
  const failed = createNativeFailureFixture({
    threadId: "fixture-thread",
    parentRunId: "fixture-parent",
    runId: "fixture-child",
    now: AT,
  });
  assert.equal(failed.interruptedState.terminalOutcome, "interrupt");
  assert.equal(failed.state.threadId, failed.interruptedState.threadId);
  assert.equal(failed.state.parentRunId, failed.interruptedState.runId);
  assert.equal(failed.state.phases.P8.status, "failed");
  assert.equal(failed.state.phases.P8.failure.code, "NATIVE_FIXTURE_FOCUS_OBSCURED");
  assert.equal(failed.state.phases.P8.failure.rootCause.phaseId, "P7");
  assert.equal(failed.state.phases.P8.attempts[0].status, "failed");
  assert.equal(failed.state.evidence[failed.failedEvidenceId].status, "fail");
  const failedAttempt = structuredClone(failed.state.phases.P8.attempts[0]);
  const failedEvidenceCore = {
    ...structuredClone(failed.state.evidence[failed.failedEvidenceId]),
    stale: undefined,
    staleReason: undefined,
  };
  const reopenCommand = {
    type: "phase.reopen",
    payload: {
      reopen: {
        failedPhaseId: "P8",
        responsiblePhaseId: "P7",
        reason: "native_fixture_p8_failure_rooted_in_p7",
      },
    },
    idempotencyKey: "fixture-reopen",
    expectedStateVersion: failed.state.stateVersion,
  };
  const reopened = applyCommand(failed.state, reopenCommand, { now: AT });
  const reopenedRetry = applyCommand(reopened.state, reopenCommand, { now: AT });
  assert.equal(reopened.events.at(-1).type, "phase.reopened");
  assert.equal(reopenedRetry.events.length, 0);
  assert.equal(reopenedRetry.state.stateVersion, reopened.state.stateVersion);

  const repaired = repairNativeFailureFixture(failed, { now: AT });
  assert.equal(repaired.state.phases.P7.attempt, 2);
  assert.equal(repaired.state.phases.P8.attempt, 2);
  assert.deepEqual(repaired.state.phases.P8.attempts[0], failedAttempt);
  assert.deepEqual(
    {
      ...repaired.state.evidence[failed.failedEvidenceId],
      stale: undefined,
      staleReason: undefined,
    },
    failedEvidenceCore,
  );
  assert.equal(repaired.state.phases.P7.reopenHistory[0].failedPhaseId, "P8");
  assert.equal(repaired.state.phases.P7.reopenHistory[0].responsiblePhaseId, "P7");
  assert.equal(repaired.state.phases.P8.attempts[1].status, "passed");
  assert.equal(repaired.state.phases.P9.status, "passed");
  assert.equal(repaired.state.phases.P10.status, "passed");
  assert.equal(repaired.state.status, "completed");
  assert.equal(repaired.state.terminalOutcome, "success");
  assert.equal(repaired.decision.decision, "pass");
  assert.deepEqual(validateEventLog(repaired.state), { valid: true, errors: [] });
});

test("native repair fixture is callable through the packaged public CLI", async () => {
  const cli = new URL("../../packages/workflow-engine/native-fixture-cli.mjs", import.meta.url);
  const args = [
    cli.pathname,
    "--stage", "complete",
    "--thread-id", "cli-thread",
    "--parent-run-id", "cli-parent",
    "--run-id", "cli-child",
    "--now", AT,
  ];
  const cliOptions = { maxBuffer: 8 * 1024 * 1024 };
  const { stdout, stderr } = await execFileAsync(process.execPath, args, cliOptions);
  const repeated = await execFileAsync(process.execPath, args, cliOptions);
  assert.equal(stderr, "");
  assert.equal(repeated.stderr, "");
  assert.equal(repeated.stdout, stdout, "the packaged fixture report must be byte-deterministic");
  const report = JSON.parse(stdout);
  assert.equal(report.status, "pass");
  assert.equal(report.lineage.threadId, "cli-thread");
  assert.equal(report.lineage.parentRunId, "cli-parent");
  assert.equal(report.injectedFailure.code, "NATIVE_FIXTURE_FOCUS_OBSCURED");
  assert.equal(report.attempts.P7.length, 2);
  assert.equal(report.attempts.P8[0].status, "failed");
  assert.equal(report.attempts.P8[1].status, "passed");
  assert.equal(report.final.releaseDecision, "pass");
  assert.equal(report.final.eventLog.valid, true);
  assert.equal(report.transport.validation.parent.valid, true);
  assert.equal(report.transport.validation.child.valid, true);
  assert.equal(report.transport.parentEvents.at(-1).payload.outcome, "interrupt");
  assert.equal(report.transport.childEvents.at(-1).payload.outcome, "success");
});

test("native fixture CLI writes retained evidence atomically without echoing a private path", async () => {
  const temporary = await mkdtemp(path.join(tmpdir(), "learning-booklet-native-output-"));
  try {
    const outputPath = path.join(temporary, "nested", "native-fixture.json");
    const cli = new URL("../../packages/workflow-engine/native-fixture-cli.mjs", import.meta.url);
    const { stdout, stderr } = await execFileAsync(process.execPath, [
      cli.pathname,
      "--stage", "complete",
      "--output", outputPath,
    ], { maxBuffer: 8 * 1024 * 1024 });
    assert.equal(stderr, "");
    const receipt = JSON.parse(stdout);
    const retained = await readFile(outputPath, "utf8");
    const report = JSON.parse(retained);
    assert.equal(receipt.status, "written");
    assert.equal(receipt.bytes, Buffer.byteLength(retained));
    assert.doesNotMatch(stdout, new RegExp(temporary.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.equal(report.status, "pass");
    assert.equal(report.final.releaseDecision, "pass");
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test("packaged workflow-state resume creates a new run root and leaves the parent immutable", async () => {
  const design = await fixture("stringzilla-design-options.json");
  let parent = await newStringZillaRun({ runId: "script-parent" });
  parent = startPhase(parent, "I0", { now: AT });
  parent = proposeDesignOptions(parent, design.options, { now: AT });
  parent = requestInput(parent, { type: "design_selection", prompt: "Choose." }, { now: AT });
  const parentBefore = JSON.stringify(parent);
  const temporary = await mkdtemp(path.join(tmpdir(), "learning-booklet-resume-"));
  try {
    const parentRoot = path.join(temporary, "parent");
    const parentStateFile = path.join(parentRoot, "run-state.json");
    const resumeFile = path.join(temporary, "resume.json");
    await mkdir(parentRoot, { recursive: true });
    await writeFile(parentStateFile, `${parentBefore}\n`, "utf8");
    await writeFile(
      resumeFile,
      `${JSON.stringify({
        resume: [{
          interruptId: parent.pendingDecision.id,
          value: { selection: { method: "user-selected", selectedOptionId: "memory-lab" } },
        }],
      })}\n`,
      "utf8",
    );
    const script = new URL("../../skills/build-learning-booklet/scripts/workflow-state.mjs", import.meta.url);
    const { stdout, stderr } = await execFileAsync(process.execPath, [
      script.pathname,
      "resume",
      "--workspace", temporary,
      "--run", parentRoot,
      "--resume", resumeFile,
      "--run-id", "script-child",
      "--now", AT,
    ]);
    assert.equal(stderr, "");
    const result = JSON.parse(stdout);
    const child = JSON.parse(await readFile(result.stateFile, "utf8"));
    assert.equal(child.runId, "script-child");
    assert.equal(child.threadId, parent.threadId);
    assert.equal(child.parentRunId, parent.runId);
    assert.equal(child.createdAt, AT);
    assert.equal(child.design.selection.selectedOptionId, "memory-lab");
    assert.equal(child.pendingDecision, null);
    assert.equal(await readFile(parentStateFile, "utf8"), `${parentBefore}\n`);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test("packaged workflow-state CLI rejects noncanonical synchronization timestamps", async () => {
  const temporary = await mkdtemp(path.join(tmpdir(), "learning-booklet-time-"));
  try {
    const script = new URL("../../skills/build-learning-booklet/scripts/workflow-state.mjs", import.meta.url);
    await assert.rejects(
      execFileAsync(process.execPath, [
        script.pathname,
        "create",
        "--workspace", temporary,
        "--mode", "plan_then_build",
        "--run-id", "bad-time",
        "--now", "0",
      ]),
      (error) => {
        assert.equal(error.code, 2);
        assert.match(error.stderr, /canonical UTC ISO-8601/i);
        return true;
      },
    );
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test("design validation requires exactly three distinct options and one recommendation", async () => {
  const design = await fixture("stringzilla-design-options.json");
  assert.equal(validateDesignOptions(design.options).valid, true);
  assert.equal(validateDesignOptions(design.options.slice(0, 2)).valid, false);
  assert.equal(
    validateDesignOptions(design.options.map((option) => ({ ...option, recommended: false }))).valid,
    false,
  );
  assert.equal(
    validateDesignOptions([
      design.options[0],
      { ...design.options[1], visualDirection: design.options[0].visualDirection },
      design.options[2],
    ]).valid,
    false,
  );
});

test("design selection command is idempotent and rejected designs are not compiled", async () => {
  const design = await fixture("stringzilla-design-options.json");
  let state = await newStringZillaRun({ runId: "idempotent-selection" });
  state = startPhase(state, "I0", { now: AT });
  state = proposeDesignOptions(state, design.options, { now: AT });
  const expectedStateVersion = state.stateVersion;
  const command = {
    type: "design.select",
    payload: {
      selection: { method: "user-selected", selectedOptionId: "memory-lab" },
      selectedBy: "fixture-user",
    },
    idempotencyKey: "choose-memory-lab",
    expectedStateVersion,
  };
  const first = applyCommand(state, command, { now: AT });
  const second = applyCommand(first.state, command, { now: AT });
  assert.equal(first.events.length, 1);
  assert.equal(second.events.length, 0);
  assert.equal(second.state.stateVersion, first.state.stateVersion);
  assert.equal(second.state.design.selection.selectedOptionId, "memory-lab");
  const compiled = compileManifest(second.state);
  assert.equal(compiled.design.selection.selectedOptionId, "memory-lab");
  assert.equal(Object.hasOwn(compiled.design, "options"), false);
  assert.equal(Object.hasOwn(compiled.design, "rejectedOptionIds"), false);
  assert.equal(JSON.stringify(compiled).includes("search-map"), false);
  assert.equal(JSON.stringify(compiled).includes("benchmark-dossier"), false);
  expectWorkflowError("IDEMPOTENCY_CONFLICT", () =>
    applyCommand(
      second.state,
      {
        ...command,
        payload: {
          ...command.payload,
          selection: { method: "user-selected", selectedOptionId: "search-map" },
        },
      },
      { now: AT },
    ),
  );
});

test("P5 cannot re-propose three directions after I0 closes", async () => {
  const state = await readyI0({ runId: "closed-design" });
  const design = await fixture("stringzilla-design-options.json");
  expectWorkflowError("DESIGN_PHASE_CLOSED", () => proposeDesignOptions(state, design.options, { now: AT }));
});

test("a selection made after an intent artifact forces that artifact to be recompiled", async () => {
  const design = await fixture("stringzilla-design-options.json");
  let state = await newStringZillaRun({ runId: "late-selection" });
  state = startPhase(state, "I0", { now: AT });
  state = proposeDesignOptions(state, design.options, { now: AT });
  state = recordArtifact(
    state,
    { id: "artifact-intent-before-selection", kind: "intent", data: compileManifest(state) },
    { now: AT },
  );
  state = selectDesign(
    state,
    { method: "user-selected", selectedOptionId: "memory-lab" },
    { now: AT },
  );
  assert.equal(state.artifacts["artifact-intent-before-selection"].stale, true);
  assert.equal(state.phases.I0.status, "active");
  expectWorkflowError("PHASE_GATE_BLOCKED", () => completePhase(state, "I0", { now: AT }));
});

test("a failed or missing hard gate prevents completion and advancement", async () => {
  let state = await readyI0({ runId: "blocked-gate" });
  state = startPhase(state, "P0", { now: AT });
  state = recordArtifact(
    state,
    { id: "artifact-charter", kind: "charter", data: { viable: false } },
    { now: AT },
  );
  const artifact = state.artifacts["artifact-charter"];
  state = recordEvidence(
    state,
    {
      id: "evidence-charter-fail",
      phaseId: "P0",
      gateId: "charter.scope_feasible",
      status: "fail",
      executed: true,
      critical: true,
      artifactId: artifact.id,
      artifactHash: artifact.hash,
    },
    { now: AT },
  );
  state = evaluatePhaseGate(
    state,
    { phaseId: "P0", gateId: "charter.scope_feasible", evidenceIds: ["evidence-charter-fail"] },
    { now: AT },
  );
  assert.equal(state.gateResults["P0:charter.scope_feasible"].status, "fail");
  expectWorkflowError("PHASE_GATE_BLOCKED", () => completePhase(state, "P0", { now: AT }));
  state = failPhase(state, "P0", { code: "SCOPE_NOT_FEASIBLE" }, { now: AT });
  expectWorkflowError("UPSTREAM_PHASE_INCOMPLETE", () => startPhase(state, "P1", { now: AT }));
});

test("an artifact cannot bypass the declared dependency graph", async () => {
  let state = await readyI0({ runId: "dependency-bypass" });
  state = startPhase(state, "P0", { now: AT });
  expectWorkflowError("ARTIFACT_DEPENDENCY_MISMATCH", () =>
    recordArtifact(
      state,
      {
        id: "artifact-charter-bypass",
        kind: "charter",
        dependencies: [],
        data: { triesToSkip: "artifact-intent" },
      },
      { now: AT },
    ),
  );
});

test("partial, not-run, and missing evidence never pass a hard gate", async () => {
  for (const status of ["partial", "not_run", "fail"]) {
    let state = await readyI0({ runId: `evidence-${status}` });
    state = startPhase(state, "P0", { now: AT });
    state = recordArtifact(
      state,
      { id: `artifact-charter-${status}`, kind: "charter", data: { status } },
      { now: AT },
    );
    const artifact = state.artifacts[`artifact-charter-${status}`];
    const evidenceId = `evidence-${status}`;
    state = recordEvidence(
      state,
      {
        id: evidenceId,
        phaseId: "P0",
        gateId: "charter.topic_learner_alignment",
        status,
        executed: status === "not_run" ? false : true,
        critical: true,
        artifactId: artifact.id,
        artifactHash: artifact.hash,
      },
      { now: AT },
    );
    state = evaluatePhaseGate(
      state,
      { phaseId: "P0", gateId: "charter.topic_learner_alignment", evidenceIds: [evidenceId] },
      { now: AT },
    );
    assert.equal(state.gateResults["P0:charter.topic_learner_alignment"].status, "fail");
  }

  let missing = await readyI0({ runId: "evidence-missing" });
  missing = startPhase(missing, "P0", { now: AT });
  missing = recordArtifact(missing, { id: "artifact-charter-missing", kind: "charter", data: {} }, { now: AT });
  missing = evaluatePhaseGate(
    missing,
    { phaseId: "P0", gateId: "charter.topic_learner_alignment", evidenceIds: [] },
    { now: AT },
  );
  assert.deepEqual(
    missing.gateResults["P0:charter.topic_learner_alignment"].reasons.sort(),
    ["missing_evidence", "no_passing_evidence"],
  );
});

test("changing an upstream artifact stales transitive artifacts, evidence, and phases", async () => {
  let state = await throughPhase("P3");
  const oldResearchEvidence = Object.values(state.evidence).find(({ phaseId }) => phaseId === "P1");
  const oldLearningId = state.artifactIndex.learning;
  const oldIaId = state.artifactIndex.ia;
  state = recordArtifact(
    state,
    {
      id: "artifact-research-v2",
      kind: "research",
      data: { fixture: "StringZilla", correction: "benchmark scope qualified", revision: 2 },
    },
    { now: AT },
  );
  assert.equal(state.artifacts[oldLearningId].stale, true);
  assert.equal(state.artifacts[oldIaId].stale, true);
  assert.equal(state.evidence[oldResearchEvidence.id].stale, true);
  assert.equal(state.phases.P1.status, "stale");
  assert.equal(state.phases.P2.status, "stale");
  assert.equal(state.phases.P3.status, "stale");
  assert.equal(gateResultIsCurrent(state, "P1", oldResearchEvidence.gateId), false);
});

test("a newly opened critical intent conflict invalidates prior passes", async () => {
  let state = await throughPhase("P0");
  state = patchIntentManifest(
    state,
    { duration: "2 hours" },
    { origin: "inferred", confidence: 0.7, now: AT },
  );
  assert.equal(state.intent.conflicts.some(({ status }) => status === "open"), true);
  assert.equal(state.artifacts[state.artifactIndex.intent].stale, true);
  assert.equal(state.artifacts[state.artifactIndex.charter].stale, true);
  assert.equal(state.phases.I0.status, "stale");
  assert.equal(state.phases.P0.status, "stale");
  assert.equal(gateResultIsCurrent(state, "I0", "intent.no_critical_conflicts"), false);
});

test("pass evidence is bound to the exact current artifact hash", async () => {
  let state = await throughPhase("P0");
  const evidence = Object.values(state.evidence).find(({ phaseId }) => phaseId === "P0");
  const oldHash = evidence.artifactHash;
  state = recordArtifact(
    state,
    { id: "artifact-charter", kind: "charter", data: { fixture: "StringZilla", revision: 2 } },
    { now: AT },
  );
  assert.notEqual(state.artifacts["artifact-charter"].hash, oldHash);
  assert.equal(isEvidenceFresh(state, evidence.id), false);
  expectWorkflowError("EVIDENCE_HASH_NOT_CURRENT", () =>
    recordEvidence(
      state,
      {
        id: "evidence-old-hash",
        phaseId: "P0",
        gateId: "charter.scope_feasible",
        status: "pass",
        executed: true,
        critical: true,
        artifactId: "artifact-charter",
        artifactHash: oldHash,
      },
      { now: AT },
    ),
  );
});

test("artifact metadata and file contract changes are included in the evidence digest", async () => {
  let state = await throughPhase("P0");
  const artifact = state.artifacts[state.artifactIndex.charter];
  const evidence = Object.values(state.evidence).find(({ phaseId }) => phaseId === "P0");
  const priorHash = artifact.hash;
  state = recordArtifact(
    state,
    {
      id: artifact.id,
      kind: artifact.kind,
      data: artifact.data,
      metadata: { reviewBoundary: "changed without changing prose" },
      files: artifact.files,
    },
    { now: AT },
  );
  assert.notEqual(state.artifacts[artifact.id].hash, priorHash);
  assert.equal(state.evidence[evidence.id].stale, true);
});

test("passing evidence cannot use an artifact from another phase", async () => {
  let state = await readyI0({ runId: "cross-phase-evidence" });
  state = startPhase(state, "P0", { now: AT });
  expectWorkflowError("EVIDENCE_ARTIFACT_SCOPE_MISMATCH", () =>
    recordEvidence(
      state,
      {
        id: "evidence-wrong-artifact",
        phaseId: "P0",
        gateId: "charter.scope_feasible",
        status: "pass",
        executed: true,
        critical: true,
        artifactId: "artifact-intent",
        artifactHash: state.artifacts["artifact-intent"].hash,
      },
      { now: AT },
    ),
  );
});

test("plan_only ends planned without production or completion claims", async () => {
  let state = await readyI0({ mode: "plan_only", runId: "plan-only" });
  for (const phaseId of ["P0", "P1", "P2", "P3", "P4", "P5", "P6"]) {
    state = await preparePhase(state, phaseId);
  }
  assert.equal(state.status, "planned");
  assert.equal(state.terminalReason, "plan_only_complete");
  assert.equal(state.artifactIndex.production, undefined);
  assert.equal(state.events.some(({ type }) => type === "run.completed"), false);
  expectWorkflowError("PHASE_OUTSIDE_MODE", () => startPhase(state, "P7", { now: AT }));
});

test("citation anchors are allowed but runtime CDN dependencies fail portability", async () => {
  const production = await fixture("stringzilla-production-input.json");
  assert.deepEqual(validatePortableArtifact(production), {
    valid: true,
    reasons: [],
    artifactId: production.id,
    artifactHash: null,
  });
  const withCdn = structuredClone(production);
  withCdn.metadata.externalRuntimeResources = ["https://cdn.example.invalid/runtime.js"];
  const result = validatePortableArtifact(withCdn);
  assert.equal(result.valid, false);
  assert.ok(result.reasons.includes("external_runtime_resources_present"));

  const hiddenCdn = structuredClone(production);
  hiddenCdn.metadata.externalRuntimeResources = [];
  hiddenCdn.content = hiddenCdn.content.replace(
    "</head>",
    '<script src="https://cdn.example.invalid/runtime.js"></script></head>',
  );
  const inspected = validatePortableArtifact(hiddenCdn);
  assert.equal(inspected.valid, false);
  assert.ok(inspected.reasons.includes("external_runtime_resources_present"));

  const dataUri = structuredClone(production);
  dataUri.content = dataUri.content.replace(
    "</head>",
    '<style>.icon{background-image:url("data:image/svg+xml,%3Csvg/%3E")}</style></head>',
  );
  assert.equal(validatePortableArtifact(dataUri).valid, true);
});

test("untrusted source content cannot change workflow, permissions, or evidence", async () => {
  const hostile = await fixture("prompt-injection-source.json");
  let state = await newStringZillaRun({ runId: "untrusted-source" });
  const permissionsBefore = structuredClone(state.permissions);
  const phaseIdsBefore = Object.keys(state.phases);
  state = registerSource(state, hostile, { now: AT });
  assert.equal(state.sources[hostile.id].trust, "untrusted");
  assert.deepEqual(state.permissions, permissionsBefore);
  assert.deepEqual(Object.keys(state.phases), phaseIdsBefore);
  assert.deepEqual(state.evidence, {});
  assert.equal(state.status, "draft");
  assert.equal(state.sources[hostile.id].data.content.fakeEvidence.status, "pass");
});

test("command wrapper supports envelopes, optimistic versioning, and safe release reads", async () => {
  const state = await newStringZillaRun({ runId: "commands" });
  const patched = applyCommand(
    state,
    {
      type: "intent.patch",
      payload: {
        patch: { format: { value: "interactive booklet", origin: "user", locked: true } },
      },
      idempotencyKey: "intent-format",
      expectedStateVersion: state.stateVersion,
    },
    { now: AT },
  );
  assert.equal(patched.state.intent.fields.format.value, "interactive booklet");
  assert.equal(patched.events.length, 1);
  expectWorkflowError("STATE_VERSION_CONFLICT", () =>
    applyCommand(patched.state, {
      type: "phase.start",
      payload: { phaseId: "I0" },
      expectedStateVersion: state.stateVersion,
    }),
  );
  const releaseRead = applyCommand(patched.state, {
    type: "release.decide",
    payload: { evaluatedAt: AT },
    expectedStateVersion: patched.state.stateVersion,
  });
  assert.equal(releaseRead.state, patched.state);
  assert.deepEqual(releaseRead.events, []);
  assert.equal(releaseRead.result.decision, "fail");
});

test("an open major finding blocks release until it is resolved", async () => {
  let state = await throughPhase("P9");
  state = recordFinding(
    state,
    {
      id: "finding-contrast",
      severity: "major",
      phaseId: "P5",
      title: "Focus contrast below target",
      status: "open",
    },
    { now: AT },
  );
  state = await preparePhase(state, "P10", { complete: false });
  const blocked = releaseDecision(state, { evaluatedAt: AT });
  assert.equal(blocked.decision, "fail");
  assert.equal(blocked.openFindingsBySeverity.major, 1);
  assert.ok(blocked.blockingReasons.includes("blocker_or_major_findings_open"));
  expectWorkflowError("RELEASE_BLOCKED", () => completePhase(state, "P10", { now: AT }));

  state = resolveFinding(state, "finding-contrast", {
    resolution: { repair: "Raised focus-ring contrast and reran regressions." },
    now: AT,
  });
  const ready = releaseDecision(state, { evaluatedAt: AT });
  assert.equal(ready.decision, "pass");
  state = completePhase(state, "P10", { now: AT });
  assert.equal(state.status, "completed");
  assert.equal(state.terminalReason, "release_passed");
  assert.deepEqual(validateEventLog(state), { valid: true, errors: [] });
});

test("JSON contracts compile and validate pristine and completed states", async () => {
  const contractFiles = (await readdir(CONTRACT_DIR)).filter((name) => name.endsWith(".json"));
  assert.ok(contractFiles.length >= 11);
  const schemas = [];
  for (const name of contractFiles) {
    schemas.push(JSON.parse(await readFile(new URL(name, CONTRACT_DIR), "utf8")));
  }
  const ajv = new Ajv2020({ allErrors: true, strict: false, validateFormats: false });
  for (const schema of schemas) ajv.addSchema(schema);

  const validateRun = ajv.getSchema("https://learning-booklet.studio/contracts/run-state.schema.json");
  const pristine = createRunState({ runId: "pristine-schema", now: AT });
  assert.equal(validateRun(pristine), true, JSON.stringify(validateRun.errors));
  const completed = await throughPhase("P10");
  assert.equal(validateRun(completed), true, JSON.stringify(validateRun.errors));
  let interrupted = createRunState({ runId: "schema-interrupted", threadId: "schema-thread", now: AT });
  interrupted = startPhase(interrupted, "I0", { now: AT });
  interrupted = requestInput(interrupted, { type: "approval", prompt: "Continue?" }, { now: AT });
  assert.equal(validateRun(interrupted), true, JSON.stringify(validateRun.errors));
  const resumed = resumeRunState(interrupted, {
    runId: "schema-resumed",
    resume: [{ interruptId: interrupted.pendingDecision.id, value: { approved: true } }],
    now: AT,
  });
  assert.equal(validateRun(resumed), true, JSON.stringify(validateRun.errors));

  const validateUiEvent = ajv.getSchema(
    "https://learning-booklet.studio/contracts/codex-skill-ui-event.schema.json",
  );
  for (const event of projectCodexSkillUiEvents(interrupted)) {
    assert.equal(validateUiEvent(event), true, JSON.stringify(validateUiEvent.errors));
  }
  for (const event of projectCodexSkillUiEvents(completed)) {
    assert.equal(validateUiEvent(event), true, JSON.stringify(validateUiEvent.errors));
  }

  const validateRelease = ajv.getSchema("https://learning-booklet.studio/contracts/release-decision.schema.json");
  const decision = releaseDecision(completed, { evaluatedAt: AT });
  assert.equal(validateRelease(decision), true, JSON.stringify(validateRelease.errors));

  const validateCommand = ajv.getSchema("https://learning-booklet.studio/contracts/workflow-command.schema.json");
  assert.equal(
    validateCommand({
      type: "phase.start",
      payload: { phaseId: "I0" },
      idempotencyKey: "schema-command",
      expectedStateVersion: 1,
    }),
    true,
    JSON.stringify(validateCommand.errors),
  );
  assert.equal(
    validateCommand({
      type: "phase.reopen",
      payload: {
        reopen: {
          failedPhaseId: "P8",
          responsiblePhaseId: "P7",
          reason: "runtime failure rooted in production",
        },
      },
    }),
    true,
    JSON.stringify(validateCommand.errors),
  );

  const fixtureFiles = (await readdir(FIXTURE_DIR)).filter((name) => name.endsWith(".json"));
  assert.ok(fixtureFiles.length >= 6);
  for (const name of fixtureFiles) {
    JSON.parse(await readFile(new URL(name, FIXTURE_DIR), "utf8"));
  }
});

test("hashing is canonical across object key order", () => {
  assert.equal(hashValue({ a: 1, b: 2 }), hashValue({ b: 2, a: 1 }));
});
