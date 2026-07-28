import {
  PHASES,
  phaseGateSummary,
  releaseDecision,
} from "../workflow-engine/index.mjs";

const STATUS_COPY = {
  draft: "Draft intent",
  active: "Work in progress",
  awaiting_user: "Waiting for a decision",
  failed_gate: "Repair required",
  blocked_external: "External blocker recorded",
  specified: "Intent specified",
  planned: "Plan complete",
  completed: "Release complete",
};

const EVENT_COPY = {
  "run.created": "Run created",
  "run.updated": "Run record updated",
  "phase.started": "Phase attempt started",
  "phase.completed": "Phase passed",
  "phase.failed": "Phase failed",
  "phase.reopened": "Causal phase reopened",
  "phase.invalidated": "Phase reopened",
  "gate.evaluated": "Hard gate evaluated",
  "artifact.updated": "Artifact revision recorded",
  "input.requested": "User decision requested",
  "design.options.proposed": "Three design options published",
  "design.selected": "Design decision recorded",
  "verification.recorded": "Verification evidence recorded",
  "run.specified": "Intent gate completed",
  "run.planned": "Plan gate completed",
  "run.completed": "Release completed",
};

function redact(value, key = "") {
  if (/(secret|token|credential|authorization|sourcebody|rawprompt|chainofthought)/i.test(key)) {
    return "[redacted]";
  }
  if (String(key).toLowerCase() === "resume" && Array.isArray(value)) {
    return value.slice(0, 200).map((entry) => ({
      interruptId: redact(entry?.interruptId, "interruptId"),
    }));
  }
  if (typeof value === "string") {
    if (/^(?:\/Users\/|\/home\/|[A-Za-z]:\\)/.test(value)) return "[workspace-relative path redacted]";
    return value.length > 4_096 ? `${value.slice(0, 4_096)}…` : value;
  }
  if (Array.isArray(value)) return value.slice(0, 200).map((entry) => redact(entry, key));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([entryKey]) => !/(sourcebody|rawprompt|chainofthought)/i.test(entryKey))
        .map(([entryKey, entryValue]) => [entryKey, redact(entryValue, entryKey)]),
    );
  }
  return value;
}

function timeLabel(value) {
  if (typeof value !== "string") return "—";
  const match = value.match(/T(\d{2}):(\d{2})/);
  return match ? `${match[1]}:${match[2]}` : value;
}

function eventTone(event) {
  if (event.type === "phase.failed" || event.payload?.status === "fail") return "error";
  if (event.type === "phase.invalidated" || event.type === "phase.reopened") return "warning";
  if (event.type === "phase.completed" || event.type === "run.completed") return "success";
  return "info";
}

function artifactProjection(artifact) {
  return {
    id: artifact.id,
    kind: artifact.kind,
    phaseId: artifact.phaseId,
    hash: artifact.hash,
    revision: artifact.revision,
    stale: artifact.stale,
    staleReason: artifact.staleReason,
    locator: redact(artifact.locator),
    files: (artifact.files || []).map(({ path, mimeType }) => ({
      path: String(path || "").split(/[\\/]/).pop(),
      mimeType,
    })),
    metadata: redact(artifact.metadata || {}),
  };
}

function evidenceProjection(evidence) {
  return {
    id: evidence.id,
    phaseId: evidence.phaseId,
    gateId: evidence.gateId,
    status: evidence.status,
    executed: evidence.executed,
    critical: evidence.critical,
    stale: evidence.stale,
    staleReason: evidence.staleReason,
    artifactId: evidence.artifactId || null,
    artifactHash: evidence.artifactHash || null,
    recordedAt: evidence.recordedAt,
    details: redact(evidence.details ?? null, "details"),
    sourceRefs: redact(evidence.sourceRefs || [], "sourceRefs"),
  };
}

function findingProjection(finding) {
  return {
    id: finding.id,
    severity: finding.severity,
    status: finding.status,
    title: redact(finding.title || finding.summary || finding.id),
    phaseId: finding.phaseId || finding.earliestResponsiblePhase || null,
    resolution: redact(finding.resolution ?? null, "resolution"),
    recordedAt: finding.recordedAt,
    resolvedAt: finding.resolvedAt,
  };
}

function evidenceSummary(evidence) {
  return evidence.reduce((summary, entry) => {
    const key = entry.stale ? "stale" : entry.status;
    summary[key] = (summary[key] || 0) + 1;
    return summary;
  }, {});
}

function designName(state) {
  const selectedOptionId = state.design?.selection?.selectedOptionId;
  if (selectedOptionId) {
    return state.design.options.find((option) => option.id === selectedOptionId)?.name || selectedOptionId;
  }
  if (state.design?.selection?.method === "direct") return "Direct visual direction";
  if (state.design?.selection?.method === "user-hybridized") return "Synthesized hybrid direction";
  return null;
}

function currentWorkProjection(state, phases, artifacts) {
  const phase = phases.find(({ id }) => id === state.currentPhase);
  const phaseRecord = state.phases[state.currentPhase];
  const failedGates = (phase?.gates || []).filter(({ current }) => !current);
  const currentArtifacts = artifacts.filter(({ phaseId, stale }) => phaseId === state.currentPhase && !stale);
  const pending = state.pendingDecision;
  let title = `${state.currentPhase} · ${phase?.label || "Current phase"}`;
  let description = `Attempt ${phaseRecord?.attempt ?? 0}; server status ${phaseRecord?.status || "not_started"}.`;
  let nextAction = {
    kind: "continue",
    label: `Continue ${state.currentPhase}`,
    detail: failedGates.length > 0
      ? `${failedGates.length} hard gate${failedGates.length === 1 ? "" : "s"} still require current passing evidence.`
      : "Ask Codex to resume from the authoritative run state.",
  };

  if (pending) {
    title = "Decision required";
    description = pending.prompt || `The workflow is waiting for a ${pending.type || "user"} decision.`;
    nextAction = {
      kind: "decision",
      label: pending.type === "design_selection" ? "Choose a design system" : "Answer the open decision",
      detail: `Decision ${pending.id || "pending"} must be resolved before the phase can advance.`,
    };
  } else if (state.status === "failed_gate" || phaseRecord?.status === "failed") {
    title = `Repair required in ${state.currentPhase}`;
    description = phaseRecord?.failure?.message || "A failed phase or hard gate prevents advancement.";
    nextAction = {
      kind: "repair",
      label: "Inspect failed evidence and repair",
      detail: "Reopen the earliest responsible phase, record the repair, and rerun affected checks.",
    };
  } else if (state.status === "blocked_external") {
    title = "External blocker recorded";
    description = "The workflow cannot advance until the recorded external condition changes.";
    nextAction = {
      kind: "reconcile",
      label: "Reconcile blocker state",
      detail: "Refresh the authoritative snapshot after the external condition changes.",
    };
  } else if (state.status === "completed") {
    title = "Release completed";
    description = "The authoritative engine recorded a completed release state.";
    nextAction = { kind: "inspect", label: "Inspect release evidence", detail: "Review the bound release and native-host evidence." };
  }

  const locked = [
    state.mode ? `Mode: ${state.mode}` : null,
    designName(state) ? `Design: ${designName(state)}` : null,
  ].filter(Boolean);

  return {
    title,
    description,
    attempt: phaseRecord?.attempt ?? 0,
    nextAction,
    actions: [[nextAction.label, nextAction.detail]],
    locked,
    artifacts: currentArtifacts.map(({ id }) => id),
    constraints: [],
    assumption: null,
    failedGateCount: failedGates.length,
  };
}

function repairProjection(state, evidence, findings) {
  const failedGateEvents = (state.events || [])
    .filter((event) => event.type === "gate.evaluated" && event.payload?.status === "fail")
    .map((event) => {
      const currentPass = evidence.find(
        (entry) => entry.phaseId === event.payload.phaseId && entry.gateId === event.payload.gateId && entry.status === "pass" && !entry.stale,
      );
      const laterAttempt = (state.events || []).find(
        (candidate) => candidate.seq > event.seq && candidate.type === "phase.started" && candidate.payload?.phaseId === event.payload.phaseId,
      );
      return {
        id: event.id,
        occurredAt: event.occurredAt,
        phaseId: event.payload.phaseId,
        gateId: event.payload.gateId,
        reasons: redact(event.payload.reasons || []),
        failedEvidenceIds: event.payload.evidenceIds || [],
        failedArtifactHashes: (event.payload.evidenceIds || [])
          .map((id) => evidence.find((entry) => entry.id === id)?.artifactHash)
          .filter(Boolean),
        causalPhase: event.payload.earliestResponsiblePhase || event.payload.phaseId,
        repairAttempt: laterAttempt?.payload?.attempt ?? null,
        currentPass: currentPass
          ? { evidenceId: currentPass.id, artifactHash: currentPass.artifactHash, recordedAt: currentPass.recordedAt }
          : null,
      };
    });
  const phaseFailures = (state.events || [])
    .filter((event) => event.type === "phase.failed")
    .map((event) => ({
      id: event.id,
      occurredAt: event.occurredAt,
      phaseId: event.payload?.phaseId,
      code: redact(event.payload?.failure?.code || "PHASE_FAILED"),
      message: redact(event.payload?.failure?.message || "Phase failed."),
      causalPhase: redact(event.payload?.failure?.earliestResponsiblePhase || event.payload?.phaseId),
    }));
  const reopenedPhases = (state.events || [])
    .filter((event) => event.type === "phase.invalidated" || event.type === "phase.reopened")
    .map((event) => ({
      id: event.id,
      occurredAt: event.occurredAt,
      phaseId: event.payload?.responsiblePhaseId || event.payload?.phaseId,
      failedPhaseId: event.payload?.failedPhaseId || null,
      failureCode: redact(event.payload?.failureCode || null),
      reason: redact(event.payload?.reason || "upstream_changed"),
      sourceKind: event.payload?.sourceKind || null,
      staleEvidenceIds: event.payload?.staleEvidenceIds || [],
    }));
  return {
    failedGateAttempts: failedGateEvents,
    phaseFailures,
    reopenedPhases,
    resolvedFindings: findings.filter(({ status }) => status === "resolved"),
    hasHistory: failedGateEvents.length + phaseFailures.length + reopenedPhases.length > 0,
  };
}

function architectureForEvidence(entry) {
  const details = entry.details || {};
  const raw = String(
    details.architecture || details.environment?.architecture || details.host?.architecture || "",
  ).toLowerCase();
  const searchable = `${entry.id} ${entry.gateId} ${raw}`.toLowerCase();
  if (/x86_64|x64|intel/.test(searchable)) return "native-macos-intel";
  if (/arm64|aarch64|apple[-_ ]silicon/.test(searchable)) return "native-macos-apple-silicon";
  return null;
}

function nativeGateProjection(evidence) {
  return ["native-macos-intel", "native-macos-apple-silicon"].map((architecture) => {
    const records = evidence.filter((entry) => architectureForEvidence(entry) === architecture);
    return {
      architecture,
      status: records.length === 0 ? "missing" : "recorded",
      evidence: records,
      currentEvidenceCount: records.filter(({ stale }) => !stale).length,
      notRunCount: records.filter(({ status }) => status === "not_run").length,
      passCount: records.filter(({ status, stale }) => status === "pass" && !stale).length,
    };
  });
}

function offlineArtifactProjection(state, artifacts, evidence) {
  const productionId = state.artifactIndex?.production;
  const artifact = artifacts.find(({ id }) => id === productionId);
  if (!artifact) return { status: "missing", artifactId: null, artifactHash: null };
  const passes = evidence.filter(
    (entry) => entry.artifactId === artifact.id && entry.artifactHash === artifact.hash && entry.status === "pass" && !entry.stale,
  );
  return {
    status: artifact.stale ? "stale" : "recorded",
    artifactId: artifact.id,
    artifactHash: artifact.hash,
    selfContainedClaim: artifact.metadata?.selfContained ?? null,
    networkRequiredClaim: artifact.metadata?.networkRequired ?? null,
    externalRuntimeResources: artifact.metadata?.externalRuntimeResources ?? null,
    currentPassingEvidenceIds: passes.map(({ id }) => id),
  };
}

export function compactRun(state) {
  const topic = state.intent?.fields?.topic?.value || "Untitled learning booklet";
  const learner = state.intent?.fields?.learner?.value;
  const phases = PHASES.map((phase) => ({
    id: phase.id,
    label: phase.name,
    short: phase.name,
    status: state.phases[phase.id]?.status || "not_started",
    attempt: state.phases[phase.id]?.attempt ?? 0,
    gates: phaseGateSummary(state, phase.id),
  }));
  const artifacts = Object.values(state.artifacts || {}).map(artifactProjection);
  const evidence = Object.values(state.evidence || {}).map(evidenceProjection);
  const findings = Object.values(state.findings || {}).map(findingProjection);
  const release = redact(releaseDecision(state, { evaluatedAt: state.updatedAt }));
  const recentEvents = (state.events || []).slice(-24).map((event) => redact(event));
  const journal = recentEvents.slice(-12).reverse().map((event) => ({
    time: timeLabel(event.occurredAt),
    title: EVENT_COPY[event.type] || event.type,
    status: eventTone(event),
    actor: event.payload?.phaseId || "Workflow engine",
    detail: event.payload?.gateId
      ? `${event.payload.gateId}: ${event.payload.status || "recorded"}`
      : event.payload?.reason || `State revision ${event.stateVersion}`,
    badge: event.payload?.attempt ? `Attempt ${event.payload.attempt}` : event.type,
    id: event.id,
    tone: eventTone(event),
  }));

  return {
    protocol: "codex-skill-ui/1",
    isAuthoritative: true,
    runId: state.runId,
    threadId: redact(state.threadId),
    parentRunId: redact(state.parentRunId),
    resume: (state.resume || []).map(({ interruptId }) => ({
      interruptId: redact(interruptId, "interruptId"),
    })),
    openInterruptIds: (state.interrupts || [])
      .filter(({ status }) => status === "open")
      .map(({ id }) => redact(id, "interruptId")),
    topic,
    subtitle: learner ? `A verified learning booklet for ${redact(learner)}.` : STATUS_COPY[state.status],
    mode: state.mode,
    status: state.status,
    currentLayer: state.currentLayer,
    currentPhase: state.currentPhase,
    stateVersion: state.stateVersion,
    eventCursor: state.eventCursor,
    createdAt: state.createdAt,
    updatedAt: state.updatedAt,
    executionStatus: state.executionStatus,
    terminalOutcome: state.terminalOutcome,
    finishedAt: state.finishedAt,
    terminalReason: state.terminalReason,
    pendingDecision: redact(state.pendingDecision),
    phases,
    design: {
      selectedOptionId: state.design?.selection?.selectedOptionId,
      selectedName: designName(state),
      selectionMethod: state.design?.selection?.method,
      selection: redact(state.design?.selection),
      finalVisualDirection: redact(state.design?.finalVisualDirection),
      system: state.design?.finalVisualDirection && typeof state.design.finalVisualDirection === "object"
        ? Object.entries(redact(state.design.finalVisualDirection))
        : [],
      options: redact(state.design?.options || []),
    },
    currentWork: currentWorkProjection(state, phases, artifacts),
    artifacts,
    evidence,
    evidenceSummary: evidenceSummary(evidence),
    repair: repairProjection(state, evidence, findings),
    openFindings: findings.filter(({ status }) => status === "open"),
    residualRisks: redact(state.residualRisks || [], "residualRisks"),
    limitations: redact(state.limitations || [], "limitations"),
    release,
    nativeGates: nativeGateProjection(evidence),
    offlineArtifact: offlineArtifactProjection(state, artifacts, evidence),
    orchestration: {
      workflowStatus: state.status,
      degraded: state.status === "blocked_external",
      consequence: state.status === "blocked_external"
        ? "Workflow advancement is blocked; previously recorded artifact evidence remains separate."
        : null,
    },
    activity: {
      state: state.status,
      recent: journal.slice(0, 5).map((entry) => [entry.time, entry.title, entry.tone]),
    },
    journal,
    recentEvents,
  };
}

export function toolResult(state, message, meta = {}) {
  return {
    structuredContent: {
      protocol: "codex-skill-ui/1",
      run: compactRun(state),
    },
    content: [{ type: "text", text: message }],
    _meta: {
      stateVersion: state.stateVersion,
      eventCursor: state.eventCursor,
      ...meta,
    },
  };
}
