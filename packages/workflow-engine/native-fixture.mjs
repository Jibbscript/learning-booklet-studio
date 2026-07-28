import { clone } from "./canonical.mjs";
import { projectCodexSkillUiJourney } from "./codex-skill-ui-adapter.mjs";
import {
  compileManifest,
  completePhase,
  createRunState,
  evaluatePhaseGate,
  failPhase,
  recordArtifact,
  recordEvidence,
  releaseDecision,
  reopenPhaseFromFailure,
  requestInput,
  resumeRunState,
  proposeDesignOptions,
  startPhase,
  validateEventLog,
} from "./engine.mjs";
import { PHASE_BY_ID } from "./phases.mjs";

export const NATIVE_FAILURE_FIXTURE = Object.freeze({
  id: "native-p7-focus-obscured-v1",
  version: "1.0.0",
  failureCode: "NATIVE_FIXTURE_FOCUS_OBSCURED",
  failedPhaseId: "P8",
  responsiblePhaseId: "P7",
  defect: "A tall sticky header obscures the keyboard-focused trace control at a 320 CSS-pixel viewport.",
  repair: "Replace the tall sticky header with normal flow and add explicit scroll margin to focus targets.",
});

const FIXTURE_NOW = "2026-07-22T12:00:00.000Z";

const FIXTURE_INTENT = Object.freeze({
  topic: { value: "Euclid's algorithm", origin: "user", locked: true, confidence: 1 },
  learner: { value: "undergraduate computer-science students", origin: "user", locked: true, confidence: 1 },
  depth: { value: "mechanism-level", origin: "user", locked: true, confidence: 1 },
  duration: { value: "20 minutes", origin: "user", locked: true, confidence: 1 },
  scope: {
    value: { include: ["invariant", "execution trace"], exclude: ["extended number theory"] },
    origin: "user",
    locked: true,
    confidence: 1,
  },
});

const FIXTURE_DESIGNS = Object.freeze([
  {
    id: "proof-trace",
    name: "Proof-Trace Keyboard Lab",
    rationale: "Keeps the invariant beside a keyboard-driven execution trace.",
    recommended: true,
    visualDirection: {
      thesis: "Pair every algorithm step with the invariant it preserves.",
      layout: "linear proof and trace booklet",
      accessibility: "native controls, visible focus, non-color state cues",
    },
  },
  {
    id: "number-line",
    name: "Remainder Number Line",
    rationale: "Prioritizes spatial intuition for quotient and remainder.",
    recommended: false,
    visualDirection: {
      thesis: "Make each remainder visible as a shrinking interval.",
      layout: "wide diagram-led chapters",
      accessibility: "labeled SVG with text equivalents",
    },
  },
  {
    id: "worked-notebook",
    name: "Worked Algorithm Notebook",
    rationale: "Uses compact annotated examples for revision and reference.",
    recommended: false,
    visualDirection: {
      thesis: "Build a reusable mental checklist from worked examples.",
      layout: "dense editorial notebook",
      accessibility: "semantic tables and restrained motion",
    },
  },
]);

const DEFECTIVE_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Euclid proof trace</title>
<style>
body{font:16px system-ui;margin:0}header{position:sticky;top:0;height:176px;background:#fff;border-bottom:2px solid #222}main{max-width:44rem;margin:auto;padding:1rem}button:focus-visible{outline:3px solid #0a55cc}
</style>
</head>
<body><header><h1>Euclid proof trace</h1></header><main><button id="trace">Advance trace</button><output id="result">48, 18</output></main>
<script>document.querySelector('#trace').addEventListener('click',()=>{document.querySelector('#result').textContent='18, 12';});</script>
</body></html>`;

const REPAIRED_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Euclid proof trace</title>
<style>
body{font:16px system-ui;margin:0}header{position:static;background:#fff;border-bottom:2px solid #222;padding:1rem}main{max-width:44rem;margin:auto;padding:1rem}button{scroll-margin-top:1rem}button:focus-visible{outline:3px solid #0a55cc;outline-offset:3px}
</style>
</head>
<body><header><h1>Euclid proof trace</h1></header><main><button id="trace">Advance trace</button><output id="result">48, 18</output></main>
<script>document.querySelector('#trace').addEventListener('click',()=>{document.querySelector('#result').textContent='18, 12';});</script>
</body></html>`;

function fixtureArtifact(runId, phaseId, attempt, data = {}) {
  const phase = PHASE_BY_ID[phaseId];
  return {
    id: `${runId}:${phase.outputKind}:attempt-${attempt}`,
    kind: phase.outputKind,
    phaseId,
    data: clone(data),
    metadata: { fixtureId: NATIVE_FAILURE_FIXTURE.id, attempt },
  };
}

function productionArtifact(runId, attempt, repaired) {
  return {
    id: `${runId}:production:attempt-${attempt}`,
    kind: "production",
    phaseId: "P7",
    data: repaired ? REPAIRED_HTML : DEFECTIVE_HTML,
    metadata: {
      fixtureId: NATIVE_FAILURE_FIXTURE.id,
      attempt,
      selfContained: true,
      networkRequired: false,
      externalRuntimeResources: [],
      expectedNativeCheck: repaired ? "focus-visible-at-320" : "focus-obscured-at-320",
    },
    files: [{ path: "index.html", mimeType: "text/html" }],
  };
}

function passPhaseGates(inputState, phaseId, { now = FIXTURE_NOW, suffix = "pass" } = {}) {
  let state = inputState;
  const phase = PHASE_BY_ID[phaseId];
  const artifact = state.artifacts[state.artifactIndex[phase.outputKind]];
  for (const [index, gateId] of phase.gates.entries()) {
    const evidenceId = `${state.runId}:${phaseId}:attempt-${state.phases[phaseId].attempt}:${index}:${suffix}`;
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
        details: {
          fixtureId: NATIVE_FAILURE_FIXTURE.id,
          check: gateId,
          result: "deterministic fixture check passed",
        },
      },
      { now },
    );
    state = evaluatePhaseGate(state, { phaseId, gateId, evidenceIds: [evidenceId] }, { now });
  }
  return state;
}

function completeGenericPhase(inputState, phaseId, { now = FIXTURE_NOW } = {}) {
  let state = startPhase(inputState, phaseId, { now });
  const attempt = state.phases[phaseId].attempt;
  state = recordArtifact(
    state,
    fixtureArtifact(state.runId, phaseId, attempt, {
      fixtureId: NATIVE_FAILURE_FIXTURE.id,
      phaseId,
      outcome: "complete",
    }),
    { now },
  );
  state = passPhaseGates(state, phaseId, { now });
  return completePhase(state, phaseId, { now });
}

export function createNativeFailureFixture({
  threadId = "native-fixture-thread",
  parentRunId = "native-fixture-intake",
  runId = "native-fixture-execution",
  now = FIXTURE_NOW,
} = {}) {
  let interruptedState = createRunState({
    runId: parentRunId,
    threadId,
    mode: "plan_then_build",
    intent: FIXTURE_INTENT,
    now,
  });
  interruptedState = startPhase(interruptedState, "I0", { now });
  interruptedState = proposeDesignOptions(interruptedState, FIXTURE_DESIGNS, { now });
  interruptedState = requestInput(
    interruptedState,
    { type: "design_selection", prompt: "Choose one design system." },
    { now },
  );
  const interruptId = interruptedState.pendingDecision.id;
  const resume = [{
    interruptId,
    value: { selection: { method: "user-selected", selectedOptionId: "proof-trace" } },
  }];
  let state = resumeRunState(interruptedState, { runId, threadId, resume, now });
  state = recordArtifact(
    state,
    { id: `${runId}:intent:attempt-1`, kind: "intent", phaseId: "I0", data: compileManifest(state) },
    { now },
  );
  state = passPhaseGates(state, "I0", { now });
  state = completePhase(state, "I0", { now });
  for (const phaseId of ["P0", "P1", "P2", "P3", "P4", "P5", "P6"]) {
    state = completeGenericPhase(state, phaseId, { now });
  }

  state = startPhase(state, "P7", { now });
  state = recordArtifact(state, productionArtifact(runId, 1, false), { now });
  state = passPhaseGates(state, "P7", { now, suffix: "static-pass" });
  state = completePhase(state, "P7", { now });
  const defectiveArtifact = clone(state.artifacts[state.artifactIndex.production]);

  state = startPhase(state, "P8", { now });
  state = recordArtifact(
    state,
    fixtureArtifact(runId, "P8", 1, {
      fixtureId: NATIVE_FAILURE_FIXTURE.id,
      viewportWidth: 320,
      check: "keyboard-focus-visibility",
      observed: "trace control focus rectangle obscured by 176px sticky header",
      subjectArtifactId: defectiveArtifact.id,
      subjectArtifactHash: defectiveArtifact.hash,
    }),
    { now },
  );
  const verificationArtifact = state.artifacts[state.artifactIndex.verification];
  const failedEvidenceId = `${runId}:P8:attempt-1:focus-visible:fail`;
  state = recordEvidence(
    state,
    {
      id: failedEvidenceId,
      phaseId: "P8",
      gateId: "verification.critical_checks_executed",
      status: "fail",
      executed: true,
      critical: true,
      artifactId: verificationArtifact.id,
      artifactHash: verificationArtifact.hash,
      details: {
        fixtureId: NATIVE_FAILURE_FIXTURE.id,
        code: NATIVE_FAILURE_FIXTURE.failureCode,
        rootCause: {
          phaseId: "P7",
          artifactId: defectiveArtifact.id,
          artifactHash: defectiveArtifact.hash,
        },
      },
    },
    { now },
  );
  state = evaluatePhaseGate(
    state,
    {
      phaseId: "P8",
      gateId: "verification.critical_checks_executed",
      evidenceIds: [failedEvidenceId],
    },
    { now },
  );
  const unavailableEvidenceId = `${runId}:P8:attempt-1:unavailable-accounted:pass`;
  state = recordEvidence(
    state,
    {
      id: unavailableEvidenceId,
      phaseId: "P8",
      gateId: "verification.unavailable_marked_not_run",
      status: "pass",
      executed: true,
      critical: true,
      artifactId: verificationArtifact.id,
      artifactHash: verificationArtifact.hash,
      details: { fixtureId: NATIVE_FAILURE_FIXTURE.id, unavailableChecks: [] },
    },
    { now },
  );
  state = evaluatePhaseGate(
    state,
    {
      phaseId: "P8",
      gateId: "verification.unavailable_marked_not_run",
      evidenceIds: [unavailableEvidenceId],
    },
    { now },
  );
  state = failPhase(
    state,
    "P8",
    {
      code: NATIVE_FAILURE_FIXTURE.failureCode,
      message: NATIVE_FAILURE_FIXTURE.defect,
      rootCause: {
        phaseId: "P7",
        artifactId: defectiveArtifact.id,
        artifactHash: defectiveArtifact.hash,
      },
    },
    { now },
  );

  return {
    stage: "failed",
    state,
    interruptedState,
    interruptId,
    failedEvidenceId,
    defectiveArtifact,
    failedAttempt: clone(state.phases.P8.attempts[0]),
  };
}

export function repairNativeFailureFixture(failedFixture, { now = FIXTURE_NOW } = {}) {
  const fixture = failedFixture?.state ? failedFixture : { state: failedFixture };
  let state = fixture.state;
  const failure = state?.phases?.P8?.failure;
  if (failure?.code !== NATIVE_FAILURE_FIXTURE.failureCode) {
    throw new Error(`Expected ${NATIVE_FAILURE_FIXTURE.failureCode} before fixture repair.`);
  }
  const failedAttemptBeforeRepair = clone(state.phases.P8.attempts[0]);
  const failedEvidenceBeforeRepair = clone(state.evidence[fixture.failedEvidenceId]);

  state = reopenPhaseFromFailure(
    state,
    {
      failedPhaseId: "P8",
      responsiblePhaseId: "P7",
      reason: "native_fixture_p8_failure_rooted_in_p7",
    },
    { now },
  );
  state = startPhase(state, "P7", { now });
  state = recordArtifact(state, productionArtifact(state.runId, 2, true), { now });
  state = passPhaseGates(state, "P7", { now, suffix: "repair-pass" });
  state = completePhase(state, "P7", { now });
  const repairedArtifact = clone(state.artifacts[state.artifactIndex.production]);

  state = startPhase(state, "P8", { now });
  state = recordArtifact(
    state,
    fixtureArtifact(state.runId, "P8", 2, {
      fixtureId: NATIVE_FAILURE_FIXTURE.id,
      viewportWidth: 320,
      check: "keyboard-focus-visibility",
      observed: "trace control focus rectangle remains fully visible",
      subjectArtifactId: repairedArtifact.id,
      subjectArtifactHash: repairedArtifact.hash,
    }),
    { now },
  );
  state = passPhaseGates(state, "P8", { now, suffix: "regression-pass" });
  state = completePhase(state, "P8", { now });
  state = completeGenericPhase(state, "P9", { now });
  state = completeGenericPhase(state, "P10", { now });

  const decision = releaseDecision(state, { evaluatedAt: now });
  return {
    ...fixture,
    stage: "complete",
    state,
    failedAttemptBeforeRepair,
    failedEvidenceBeforeRepair,
    repairedArtifact,
    decision,
  };
}

export function runNativeFailureRepairFixture(options = {}) {
  return repairNativeFailureFixture(createNativeFailureFixture(options), { now: options.now ?? FIXTURE_NOW });
}

export function nativeFailureFixtureReport(result) {
  const state = result.state;
  const interruptedState = result.interruptedState;
  const failedEvidence = state.evidence[result.failedEvidenceId];
  const transport = projectCodexSkillUiJourney(interruptedState, state);
  return {
    schemaVersion: NATIVE_FAILURE_FIXTURE.version,
    fixtureId: NATIVE_FAILURE_FIXTURE.id,
    stage: result.stage,
    status: result.stage === "complete" && state.status === "completed" ? "pass" : "expected_failure",
    lineage: {
      threadId: state.threadId,
      interruptedRunId: interruptedState.runId,
      resumedRunId: state.runId,
      parentRunId: state.parentRunId,
      resume: clone(state.resume),
    },
    interrupt: {
      interruptId: result.interruptId,
      producerOutcome: interruptedState.terminalOutcome,
      producerExecutionStatus: interruptedState.executionStatus,
      terminalEvent: clone(interruptedState.events.at(-1)),
    },
    injectedFailure: {
      code: NATIVE_FAILURE_FIXTURE.failureCode,
      failedPhaseId: NATIVE_FAILURE_FIXTURE.failedPhaseId,
      responsiblePhaseId: NATIVE_FAILURE_FIXTURE.responsiblePhaseId,
      evidenceId: result.failedEvidenceId,
      evidenceStatus: failedEvidence.status,
      evidenceRetained: Boolean(failedEvidence),
      rootCauseArtifactId: result.defectiveArtifact.id,
      rootCauseArtifactHash: result.defectiveArtifact.hash,
    },
    attempts: {
      P7: clone(state.phases.P7.attempts),
      P8: clone(state.phases.P8.attempts),
      P9: clone(state.phases.P9.attempts),
      P10: clone(state.phases.P10.attempts),
    },
    reopenHistory: clone(state.phases.P7.reopenHistory),
    transport,
    final: {
      workflowStatus: state.status,
      executionStatus: state.executionStatus,
      terminalOutcome: state.terminalOutcome,
      releaseDecision: result.decision?.decision ?? null,
      productionArtifactId: state.artifactIndex.production,
      productionArtifactHash: state.artifacts[state.artifactIndex.production]?.hash ?? null,
      eventLog: validateEventLog(state),
    },
  };
}
