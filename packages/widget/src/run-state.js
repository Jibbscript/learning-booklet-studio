import { PHASES } from "./demo-data.js";

const EMPTY_DESIGN = Object.freeze({
  options: [],
  selectedOptionId: null,
  selectedName: null,
  selectionMethod: null,
  finalVisualDirection: null,
  system: [],
});

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function projection(payload) {
  const envelope = asObject(payload);
  return asObject(envelope.run || envelope.snapshot || payload);
}

function phaseRecords(candidate) {
  const supplied = Array.isArray(candidate.phases)
    ? candidate.phases
    : Object.values(asObject(candidate.phases));
  const byId = new Map(supplied.filter((phase) => phase?.id).map((phase) => [phase.id, phase]));
  return PHASES.map((phase) => {
    const record = asObject(byId.get(phase.id));
    return {
      ...phase,
      ...record,
      status: record.status || "not_started",
      attempt: Number.isInteger(record.attempt) ? record.attempt : 0,
      gates: asArray(record.gates),
    };
  });
}

function designRecord(candidate) {
  const design = asObject(candidate.design);
  const selection = asObject(design.selection);
  const finalVisualDirection = design.finalVisualDirection || null;
  const system = Array.isArray(design.system)
    ? design.system
    : finalVisualDirection && typeof finalVisualDirection === "object"
      ? Object.entries(finalVisualDirection)
      : [];
  return {
    ...EMPTY_DESIGN,
    ...design,
    options: asArray(design.options),
    selectedOptionId: design.selectedOptionId ?? selection.selectedOptionId ?? null,
    selectedName: design.selectedName ?? null,
    selectionMethod: design.selectionMethod ?? selection.method ?? null,
    finalVisualDirection,
    system,
  };
}

/**
 * Normalize only fields actually present in a server projection. This deliberately
 * does not merge the demo run into live state: structural empty values stay empty.
 */
export function normalizeRun(payload) {
  const candidate = projection(payload);
  const topic = candidate.topic || candidate.intent?.topic?.value || null;
  const hasIdentity = typeof candidate.runId === "string" && candidate.runId.length > 0;
  const resume = asArray(candidate.resume)
    .filter((entry) => typeof entry?.interruptId === "string" && entry.interruptId.length > 0)
    .map(({ interruptId }) => ({ interruptId }));
  return {
    protocol: candidate.protocol || "codex-skill-ui/1",
    runId: hasIdentity ? candidate.runId : null,
    threadId: typeof candidate.threadId === "string" && candidate.threadId.length > 0
      ? candidate.threadId
      : null,
    parentRunId: typeof candidate.parentRunId === "string" && candidate.parentRunId.length > 0
      ? candidate.parentRunId
      : null,
    resume,
    openInterruptIds: asArray(candidate.openInterruptIds)
      .filter((interruptId) => typeof interruptId === "string" && interruptId.length > 0),
    topic: topic || "Run state unavailable",
    subtitle: candidate.subtitle || (hasIdentity ? "No learner summary was published for this run." : "Reconnect to load the authoritative workflow snapshot."),
    mode: candidate.mode || null,
    status: candidate.status || "unavailable",
    currentLayer: candidate.currentLayer || null,
    currentPhase: candidate.currentPhase || "I0",
    stateVersion: Number.isInteger(candidate.stateVersion) ? candidate.stateVersion : null,
    eventCursor: Number.isInteger(candidate.eventCursor) ? candidate.eventCursor : null,
    updatedAt: candidate.updatedAt || null,
    executionStatus: candidate.executionStatus || null,
    terminalOutcome: candidate.terminalOutcome || null,
    finishedAt: candidate.finishedAt || null,
    terminalReason: candidate.terminalReason || null,
    pendingDecision: candidate.pendingDecision || null,
    phases: phaseRecords(candidate),
    design: designRecord(candidate),
    currentWork: candidate.currentWork || null,
    activity: candidate.activity || null,
    journal: asArray(candidate.journal),
    artifacts: asArray(candidate.artifacts),
    evidence: asArray(candidate.evidence),
    evidenceSummary: asObject(candidate.evidenceSummary),
    repair: candidate.repair || null,
    release: candidate.release || null,
    nativeGates: asArray(candidate.nativeGates),
    residualRisks: asArray(candidate.residualRisks),
    limitations: asArray(candidate.limitations),
    openFindings: asArray(candidate.openFindings),
    offlineArtifact: candidate.offlineArtifact || null,
    orchestration: candidate.orchestration || null,
    recentEvents: asArray(candidate.recentEvents),
    isAuthoritative: Boolean(candidate.isAuthoritative ?? hasIdentity),
  };
}

export function isUsableSnapshot(run) {
  return Boolean(run?.runId && Number.isInteger(run.stateVersion));
}

function sortedUnique(values) {
  return [...new Set(values)].sort();
}

function sameStrings(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function isVerifiedChildTransition(current, incoming) {
  if (current.terminalOutcome !== "interrupt" || current.executionStatus !== "interrupt") return false;
  if (!current.threadId || incoming.threadId !== current.threadId) return false;
  if (incoming.parentRunId !== current.runId || incoming.runId === current.runId) return false;
  const expectedInterruptIds = sortedUnique(
    current.openInterruptIds.length > 0
      ? current.openInterruptIds
      : [current.pendingDecision?.id].filter(Boolean),
  );
  const receivedInterruptIds = incoming.resume.map(({ interruptId }) => interruptId);
  if (expectedInterruptIds.length === 0 || receivedInterruptIds.length !== new Set(receivedInterruptIds).size) {
    return false;
  }
  return sameStrings(sortedUnique(receivedInterruptIds), expectedInterruptIds);
}

/**
 * Resolve duplicate and out-of-order host deliveries without allowing an older
 * revision to overwrite the latest authoritative view.
 */
export function reconcileRunSnapshot(current, payload) {
  const incoming = normalizeRun(payload);
  if (!isUsableSnapshot(incoming)) {
    return { kind: "invalid", run: current, incomingVersion: incoming.stateVersion };
  }
  if (!isUsableSnapshot(current)) {
    return { kind: "applied", run: incoming, incomingVersion: incoming.stateVersion };
  }
  if (current.runId !== incoming.runId) {
    if (isVerifiedChildTransition(current, incoming)) {
      return {
        kind: "child_transition",
        run: incoming,
        parentRunId: current.runId,
        incomingRunId: incoming.runId,
        incomingVersion: incoming.stateVersion,
      };
    }
    return {
      kind: "different_run",
      run: current,
      incomingRunId: incoming.runId,
      incomingVersion: incoming.stateVersion,
    };
  }
  if (incoming.stateVersion < current.stateVersion) {
    return { kind: "stale", run: current, incomingVersion: incoming.stateVersion };
  }
  if (incoming.stateVersion === current.stateVersion) {
    return { kind: "duplicate", run: current, incomingVersion: incoming.stateVersion };
  }
  return { kind: "applied", run: incoming, incomingVersion: incoming.stateVersion };
}
