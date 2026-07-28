import { clone, hashValue } from "./canonical.mjs";
import { WorkflowError, invariant } from "./errors.mjs";
import { PHASE_BY_ID, PHASE_EVENT_TYPES, PHASE_IDS } from "./phases.mjs";

export const CODEX_SKILL_UI_PROTOCOL = "codex-skill-ui/1";
export const CODEX_SKILL_UI_EVENT_TYPES = Object.freeze([
  "RUN_STARTED",
  "RUN_FINISHED",
  "RUN_ERROR",
  "STEP_STARTED",
  "STEP_FINISHED",
  "STATE_SNAPSHOT",
  "TOOL_CALL_START",
  "TOOL_CALL_ARGS",
  "TOOL_CALL_END",
  "TOOL_CALL_RESULT",
  "MESSAGES_SNAPSHOT",
]);

const MAX_EVENT_BYTES = 256 * 1024;
const SAFE_IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/;
const SECRET_KEY = /(?:password|passwd|secret|token|credential|private.?key|api.?key)/i;
const ABSOLUTE_PATH = /(?:^|[\s"'])(?:\/(?:Users|home|private|var|tmp)\/|[A-Za-z]:\\)/;
const UTC_MILLISECOND_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const BUILTIN_SOURCES = new Set(["orchestrator", "workflow-engine", "mcp-server", "widget"]);
const WORKFLOW_STATUSES = new Set([
  "draft",
  "active",
  "awaiting_user",
  "failed_gate",
  "blocked_external",
  "specified",
  "planned",
  "completed",
]);
const EXECUTION_STATUSES = new Set(["running", "interrupt", "repairing", "success", "cancelled", "failed"]);
const PHASE_STATUSES = new Set(["not_started", "active", "awaiting_user", "failed", "passed", "stale", "skipped"]);

function safeIdentifier(value, prefix = "id") {
  const text = String(value ?? "");
  if (SAFE_IDENTIFIER.test(text)) return text;
  return `${prefix}:redacted:${hashValue(text).slice(7, 19)}`;
}

function safeHash(value) {
  return typeof value === "string" && /^sha256:[a-f0-9]{64}$/.test(value) ? value : null;
}

function sanitizeValue(value, key = "") {
  if (SECRET_KEY.test(key)) return "[redacted]";
  if (typeof value === "string") {
    if (ABSOLUTE_PATH.test(value)) return "[redacted]";
    return value.length > 4096 ? `${value.slice(0, 4096)}…` : value;
  }
  if (Array.isArray(value)) return value.map((entry) => sanitizeValue(entry));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([entryKey, entryValue]) => [entryKey, sanitizeValue(entryValue, entryKey)]),
    );
  }
  return value;
}

function initialProjection(state) {
  const inheritedInterrupts = (state.resume ?? []).map(({ interruptId }) => {
    const source = (state.interrupts ?? []).find(({ id }) => id === interruptId);
    return {
      interruptId: safeIdentifier(interruptId, "interrupt"),
      type: safeIdentifier(source?.type ?? "decision", "decision-type"),
      phaseId: PHASE_BY_ID[source?.phaseId] ? source.phaseId : state.currentPhase,
      fields: (source?.fields ?? []).map((field) => safeIdentifier(field, "field")),
    };
  });
  const phaseInitialState = Object.fromEntries(PHASE_IDS.map((phaseId) => {
    const lifecycleEvents = state.events.filter(
      ({ type, payload }) => type.startsWith("phase.") && payload?.phaseId === phaseId,
    );
    if (lifecycleEvents.length === 0) {
      const inherited = state.phases?.[phaseId];
      return [phaseId, {
        status: inherited?.status ?? "not_started",
        attempt: inherited?.attempt ?? 0,
      }];
    }
    const first = lifecycleEvents[0];
    if (["phase.completed", "phase.failed"].includes(first.type)) {
      const inheritedAttempt = state.phases?.[phaseId]?.attempts?.[0]?.attempt ?? 1;
      return [phaseId, { status: "active", attempt: inheritedAttempt }];
    }
    if (first.type === "phase.invalidated") {
      return [phaseId, { status: "passed", attempt: state.phases?.[phaseId]?.attempt ?? 1 }];
    }
    return [phaseId, {
      status: first.payload?.attempt > 1 ? "stale" : "not_started",
      attempt: Math.max(0, (first.payload?.attempt ?? 1) - 1),
    }];
  }));
  return {
    revision: 0,
    workflowStatus: state.resume?.length ? "active" : "draft",
    executionStatus: "running",
    currentPhase: inheritedInterrupts[0]?.phaseId ?? "I0",
    phases: PHASE_IDS.map((phaseId) => ({
      id: phaseId,
      status: phaseInitialState[phaseId].status,
      attempt: phaseInitialState[phaseId].attempt,
    })),
    // A child starts only after RUN_STARTED.resume has resolved the complete
    // parent interrupt set. Keep the inherited phase for orientation, but do
    // not briefly republish those decisions as open in the first snapshot.
    openInterrupts: [],
    artifacts: [],
    evidence: [],
    defects: [],
    releaseGates: [],
  };
}

function phaseProjection(projection, phaseId) {
  return projection.phases.find(({ id }) => id === phaseId);
}

function artifactPhaseId(kind) {
  return Object.values(PHASE_BY_ID).find(({ outputKind }) => outputKind === kind)?.id ?? null;
}

function applyCanonicalEvent(projection, event) {
  const payload = event.payload ?? {};
  projection.revision = event.stateVersion;
  switch (event.type) {
    case "run.created":
      projection.executionStatus = "running";
      break;
    case "phase.started": {
      const phase = phaseProjection(projection, payload.phaseId);
      if (phase) {
        phase.status = "active";
        phase.attempt = payload.attempt;
        projection.currentPhase = payload.phaseId;
        projection.workflowStatus = "active";
        projection.executionStatus = payload.attempt > 1 ? "repairing" : "running";
      }
      break;
    }
    case "phase.completed": {
      const phase = phaseProjection(projection, payload.phaseId);
      if (phase) phase.status = "passed";
      projection.defects.forEach((defect) => {
        if (defect.phaseId === payload.phaseId && defect.status !== "resolved") {
          defect.status = "resolved";
          defect.resolvedAttempt = phase?.attempt ?? null;
        }
      });
      projection.executionStatus = "running";
      break;
    }
    case "phase.failed": {
      const phase = phaseProjection(projection, payload.phaseId);
      if (phase) phase.status = "failed";
      projection.workflowStatus = "failed_gate";
      projection.executionStatus = "failed";
      projection.defects.push({
        phaseId: payload.phaseId,
        code: safeIdentifier(payload.failure?.code ?? "PHASE_FAILED", "failure"),
        status: "open",
      });
      break;
    }
    case "phase.invalidated": {
      const phase = phaseProjection(projection, payload.phaseId);
      if (phase) phase.status = "stale";
      const phaseId = payload.phaseId;
      projection.artifacts.forEach((artifact) => {
        if (artifact.phaseId === phaseId) artifact.stale = true;
      });
      const staleIds = new Set(payload.staleEvidenceIds ?? []);
      projection.evidence.forEach((evidence) => {
        if (evidence.phaseId === phaseId || staleIds.has(evidence.id)) evidence.stale = true;
      });
      break;
    }
    case "phase.reopened": {
      projection.currentPhase = payload.responsiblePhaseId;
      projection.workflowStatus = "active";
      projection.executionStatus = "repairing";
      projection.defects.forEach((defect) => {
        if (defect.phaseId === payload.failedPhaseId && defect.status === "open") {
          defect.status = "repairing";
          defect.responsiblePhaseId = payload.responsiblePhaseId;
        }
      });
      break;
    }
    case "artifact.updated": {
      const id = safeIdentifier(payload.artifactId, "artifact");
      const record = {
        id,
        kind: safeIdentifier(payload.kind, "artifact-kind"),
        phaseId: artifactPhaseId(payload.kind),
        hash: safeHash(payload.hash),
        revision: payload.revision,
        stale: false,
      };
      const index = projection.artifacts.findIndex((artifact) => artifact.id === id);
      if (index >= 0) projection.artifacts[index] = record;
      else projection.artifacts.push(record);
      break;
    }
    case "verification.recorded": {
      const id = safeIdentifier(payload.evidenceId, "evidence");
      const record = {
        id,
        phaseId: payload.phaseId,
        gateId: safeIdentifier(payload.gateId, "gate"),
        status: payload.status,
        artifactId: payload.artifactId ? safeIdentifier(payload.artifactId, "artifact") : null,
        artifactHash: safeHash(payload.artifactHash),
        stale: false,
      };
      const index = projection.evidence.findIndex((entry) => entry.id === id);
      if (index >= 0) projection.evidence[index] = record;
      else projection.evidence.push(record);
      break;
    }
    case "gate.evaluated": {
      const key = `${payload.phaseId}:${payload.gateId}`;
      const record = {
        id: safeIdentifier(key, "gate"),
        phaseId: payload.phaseId,
        gateId: safeIdentifier(payload.gateId, "gate"),
        status: payload.status,
        evidenceIds: (payload.evidenceIds ?? []).map((id) => safeIdentifier(id, "evidence")),
      };
      const index = projection.releaseGates.findIndex(({ id }) => id === record.id);
      if (index >= 0) projection.releaseGates[index] = record;
      else projection.releaseGates.push(record);
      break;
    }
    case "input.requested":
      projection.workflowStatus = "awaiting_user";
      projection.executionStatus = "interrupt";
      projection.openInterrupts = [{
        interruptId: safeIdentifier(payload.decisionId, "interrupt"),
        type: safeIdentifier(payload.type, "decision-type"),
        phaseId: projection.currentPhase,
        fields: (payload.fields ?? []).map((field) => safeIdentifier(field, "field")),
      }];
      break;
    case "design.selected":
    case "run.updated":
      if (payload.resolvedDecisionId) {
        projection.openInterrupts = projection.openInterrupts.filter(
          ({ interruptId }) => interruptId !== safeIdentifier(payload.resolvedDecisionId, "interrupt"),
        );
        projection.workflowStatus = "active";
        projection.executionStatus = "running";
      }
      if (payload.section === "interrupts" && payload.interruptId) {
        projection.openInterrupts = projection.openInterrupts.filter(
          ({ interruptId }) => interruptId !== safeIdentifier(payload.interruptId, "interrupt"),
        );
      }
      break;
    case "run.specified":
      projection.workflowStatus = "specified";
      break;
    case "run.planned":
      projection.workflowStatus = "planned";
      break;
    case "run.completed":
      projection.workflowStatus = "completed";
      break;
    case "run.finished":
      projection.executionStatus = payload.outcome;
      break;
    default:
      break;
  }
  projection.artifacts.sort((left, right) => left.id.localeCompare(right.id));
  projection.evidence.sort((left, right) => left.id.localeCompare(right.id));
  projection.releaseGates.sort((left, right) => left.id.localeCompare(right.id));
}

function safeSnapshot(projection) {
  return clone(projection);
}

function messageSnapshot(projection, payload) {
  const type = payload.type ?? "decision";
  const question = type === "design_selection"
    ? "Choose one of the available design directions."
    : type === "intent"
      ? "Provide the requested learning-intent fields."
      : "Resolve the open workflow decision.";
  return {
    context: {
      workflowStatus: projection.workflowStatus,
      currentPhase: projection.currentPhase,
      decisionType: safeIdentifier(type, "decision-type"),
      fields: (payload.fields ?? []).map((field) => safeIdentifier(field, "field")),
    },
    question,
    allowedResponse: {
      type: "object",
      required: ["interruptId", "value"],
    },
    openInterruptIds: projection.openInterrupts.map(({ interruptId }) => interruptId),
  };
}

function transportEvent(state, type, seq, timestamp, payload, source) {
  const threadId = safeIdentifier(state.threadId ?? state.runId, "thread");
  const runId = safeIdentifier(state.runId, "run");
  const event = {
    protocol: CODEX_SKILL_UI_PROTOCOL,
    type,
    eventId: `ui:${threadId}:${runId}:${seq}`,
    threadId,
    runId,
    parentRunId: state.parentRunId ? safeIdentifier(state.parentRunId, "run") : null,
    seq,
    timestamp,
    source,
    payload: sanitizeValue(payload),
  };
  invariant(
    Buffer.byteLength(JSON.stringify(event), "utf8") <= MAX_EVENT_BYTES,
    "PAYLOAD_TOO_LARGE",
    `Projected ${type} event exceeds 256 KiB.`,
  );
  return event;
}

function plainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function validateSnapshot(payload, index, errors) {
  const requiredArrays = ["phases", "openInterrupts", "artifacts", "evidence", "defects", "releaseGates"];
  if (!Number.isInteger(payload?.revision) || payload.revision < 1) {
    errors.push(`event ${index} snapshot has invalid revision`);
  }
  if (!WORKFLOW_STATUSES.has(payload?.workflowStatus)) {
    errors.push(`event ${index} snapshot has invalid workflowStatus`);
  }
  if (!EXECUTION_STATUSES.has(payload?.executionStatus)) {
    errors.push(`event ${index} snapshot has invalid executionStatus`);
  }
  if (!PHASE_BY_ID[payload?.currentPhase]) errors.push(`event ${index} snapshot has invalid currentPhase`);
  for (const field of requiredArrays) {
    if (!Array.isArray(payload?.[field])) errors.push(`event ${index} snapshot is missing ${field}[]`);
  }
  for (const phase of payload?.phases ?? []) {
    if (!PHASE_BY_ID[phase?.id] || !PHASE_STATUSES.has(phase?.status) || !Number.isInteger(phase?.attempt)) {
      errors.push(`event ${index} snapshot contains an invalid phase`);
    }
  }
}

function validatePayload(event, index, errors) {
  const payload = event.payload;
  if (!plainObject(payload)) {
    errors.push(`event ${index} payload is not an object`);
    return;
  }
  switch (event.type) {
    case "RUN_STARTED":
      if (typeof payload.workflowVersion !== "string" || !payload.workflowVersion) {
        errors.push(`event ${index} RUN_STARTED is missing workflowVersion`);
      }
      if (!safeHash(payload.manifestDigest)) errors.push(`event ${index} RUN_STARTED has invalid manifestDigest`);
      if (typeof payload.requestedObjective !== "string" || !payload.requestedObjective) {
        errors.push(`event ${index} RUN_STARTED is missing requestedObjective`);
      }
      if (!Array.isArray(payload.resume)) {
        errors.push(`event ${index} RUN_STARTED payload is missing resume[]`);
      } else {
        for (const entry of payload.resume) {
          if (!plainObject(entry) || typeof entry.interruptId !== "string" || !Object.hasOwn(entry, "value")) {
            errors.push(`event ${index} RUN_STARTED contains an invalid resume entry`);
          }
        }
      }
      break;
    case "RUN_FINISHED":
      if (!["success", "interrupt", "cancelled"].includes(payload.outcome)) {
        errors.push(`event ${index} RUN_FINISHED has invalid outcome`);
      }
      if (!Number.isInteger(payload.finalRevision) || payload.finalRevision < 1) {
        errors.push(`event ${index} RUN_FINISHED has invalid finalRevision`);
      }
      if (!Array.isArray(payload.summaryEvidenceIds)) {
        errors.push(`event ${index} RUN_FINISHED is missing summaryEvidenceIds[]`);
      }
      if (payload.outcome === "success" && !["specified", "planned", "completed"].includes(payload.workflowStatus)) {
        errors.push(`event ${index} successful RUN_FINISHED is missing workflowStatus`);
      }
      break;
    case "RUN_ERROR":
      if (typeof payload.code !== "string" || typeof payload.message !== "string" ||
          typeof payload.retryable !== "boolean") {
        errors.push(`event ${index} RUN_ERROR has invalid safe error details`);
      }
      break;
    case "STEP_STARTED":
      if (!PHASE_BY_ID[payload.phaseId] || !Number.isInteger(payload.attempt) || payload.attempt < 1 ||
          !Array.isArray(payload.declaredOutputs) || !Array.isArray(payload.requiredGateIds)) {
        errors.push(`event ${index} STEP_STARTED has invalid phase details`);
      }
      break;
    case "STEP_FINISHED":
      if (!PHASE_BY_ID[payload.phaseId] || !Number.isInteger(payload.attempt) || payload.attempt < 1 ||
          !["passed", "failed", "partial"].includes(payload.outcome) ||
          !Array.isArray(payload.producedArtifactRefs) || !Array.isArray(payload.evidenceIds) ||
          !(payload.nextLegalPhase === null || PHASE_BY_ID[payload.nextLegalPhase])) {
        errors.push(`event ${index} STEP_FINISHED has invalid phase result`);
      }
      break;
    case "STATE_SNAPSHOT":
      validateSnapshot(payload, index, errors);
      break;
    case "MESSAGES_SNAPSHOT":
      if (!plainObject(payload.context) || typeof payload.question !== "string" || !payload.question ||
          !plainObject(payload.allowedResponse) || !Array.isArray(payload.openInterruptIds) ||
          payload.openInterruptIds.length < 1) {
        errors.push(`event ${index} MESSAGES_SNAPSHOT has invalid decision context`);
      }
      break;
    case "TOOL_CALL_START":
    case "TOOL_CALL_ARGS":
    case "TOOL_CALL_END":
    case "TOOL_CALL_RESULT":
      if (typeof payload.toolCallId !== "string" || !payload.toolCallId) {
        errors.push(`event ${index} tool event is missing toolCallId`);
      }
      break;
    default:
      break;
  }
}

function nextLegalPhase(phaseId) {
  const index = PHASE_IDS.indexOf(phaseId);
  return index >= 0 && index < PHASE_IDS.length - 1 ? PHASE_IDS[index + 1] : null;
}

export function validateCodexSkillUiSequence(events, { requireTerminal = true } = {}) {
  const errors = [];
  if (!Array.isArray(events) || events.length === 0) return { valid: false, errors: ["event sequence is empty"] };
  const first = events[0];
  const eventIds = new Set();
  let terminalIndex = -1;
  let snapshotRevision = 0;
  events.forEach((event, index) => {
    if (event.protocol !== CODEX_SKILL_UI_PROTOCOL) errors.push(`event ${index} has unsupported protocol`);
    if (!CODEX_SKILL_UI_EVENT_TYPES.includes(event.type)) errors.push(`event ${index} has unknown type ${event.type}`);
    if (event.seq !== index) errors.push(`event ${index} has seq ${event.seq}`);
    if (event.threadId !== first.threadId) errors.push(`event ${index} changes threadId`);
    if (event.runId !== first.runId) errors.push(`event ${index} changes runId`);
    if (event.parentRunId !== first.parentRunId) errors.push(`event ${index} changes parentRunId`);
    if (!UTC_MILLISECOND_TIMESTAMP.test(event.timestamp ?? "")) errors.push(`event ${index} has invalid timestamp`);
    if (!(BUILTIN_SOURCES.has(event.source) || /^verifier:[A-Za-z0-9._:-]+$/.test(event.source ?? ""))) {
      errors.push(`event ${index} has unregistered source`);
    }
    if (eventIds.has(event.eventId)) errors.push(`event ${index} duplicates eventId`);
    eventIds.add(event.eventId);
    if (Buffer.byteLength(JSON.stringify(event), "utf8") > MAX_EVENT_BYTES) errors.push(`event ${index} exceeds size limit`);
    if (["RUN_FINISHED", "RUN_ERROR"].includes(event.type)) {
      if (terminalIndex >= 0) errors.push(`event ${index} is a duplicate terminal event`);
      terminalIndex = index;
    } else if (terminalIndex >= 0) {
      errors.push(`event ${index} follows terminal event`);
    }
    if (event.type === "STATE_SNAPSHOT") {
      if (event.payload?.revision !== snapshotRevision + 1) {
        errors.push(`event ${index} snapshot revision is not gap-free`);
      }
      snapshotRevision = event.payload?.revision ?? snapshotRevision;
    }
    validatePayload(event, index, errors);
  });
  if (first.type !== "RUN_STARTED") errors.push("first event is not RUN_STARTED");
  if (!Array.isArray(first.payload?.resume)) errors.push("RUN_STARTED payload is missing resume[]");
  if (requireTerminal && terminalIndex < 0) errors.push("terminal event is missing");
  if (terminalIndex >= 0 && terminalIndex !== events.length - 1) errors.push("terminal event is not last");
  if (events[1]?.type !== "STATE_SNAPSHOT") errors.push("RUN_STARTED is not followed by STATE_SNAPSHOT");
  if (terminalIndex >= 0 && events[terminalIndex - 1]?.type !== "STATE_SNAPSHOT") {
    errors.push("terminal event is not preceded by STATE_SNAPSHOT");
  }
  return { valid: errors.length === 0, errors };
}

export function projectCodexSkillUiEvents(state, { source = "workflow-engine" } = {}) {
  invariant(state && typeof state === "object", "INVALID_RUN_STATE", "A run state is required.");
  invariant(Array.isArray(state.events), "INVALID_RUN_STATE", "Run events are required for projection.");
  const canonicalErrors = [];
  state.events.forEach((event, index) => {
    const expected = index + 1;
    if (event.seq !== expected || event.stateVersion !== expected) {
      canonicalErrors.push(`canonical event ${index} has a sequence gap`);
    }
    if (event.runId !== state.runId) canonicalErrors.push(`canonical event ${index} changes runId`);
    if (!PHASE_EVENT_TYPES.includes(event.type)) canonicalErrors.push(`canonical event ${index} has unknown type`);
  });
  if (state.events[0]?.type !== "run.created") canonicalErrors.push("canonical log does not start with run.created");
  if (state.eventCursor !== state.events.length || state.stateVersion !== state.events.length) {
    canonicalErrors.push("canonical state cursor does not match event count");
  }
  if (canonicalErrors.length > 0) {
    throw new WorkflowError("INVALID_SCHEMA", "Canonical event log cannot be projected.", {
      errors: canonicalErrors,
    });
  }
  const projection = initialProjection(state);
  const events = [];
  let terminalSeen = false;
  const emit = (type, timestamp, payload) => {
    invariant(!terminalSeen, "INVALID_TRANSITION", "No transport event may follow a terminal event.");
    events.push(transportEvent(state, type, events.length, timestamp, payload, source));
    if (["RUN_FINISHED", "RUN_ERROR"].includes(type)) terminalSeen = true;
  };

  for (const canonical of state.events) {
    invariant(!terminalSeen, "INVALID_TRANSITION", "Canonical events exist after run termination.");
    applyCanonicalEvent(projection, canonical);
    if (canonical.type === "run.created") {
      emit("RUN_STARTED", canonical.occurredAt, {
        workflowVersion: state.schemaVersion,
        manifestDigest: state.artifacts?.[state.artifactIndex?.intent]?.hash ?? hashValue({
          mode: state.mode,
          intentOrigins: Object.fromEntries(
            Object.entries(state.intent?.fields ?? {}).map(([field, entry]) => [field, entry.origin]),
          ),
        }),
        requestedObjective: "Build a verified interactive learning booklet.",
        resume: clone(state.resume ?? []),
      });
      emit("STATE_SNAPSHOT", canonical.occurredAt, safeSnapshot(projection));
    } else if (canonical.type === "phase.started") {
      const phase = PHASE_BY_ID[canonical.payload.phaseId];
      emit("STEP_STARTED", canonical.occurredAt, {
        phaseId: canonical.payload.phaseId,
        attempt: canonical.payload.attempt,
        declaredOutputs: phase ? [phase.outputKind] : [],
        requiredGateIds: phase?.gates ?? [],
      });
      emit("STATE_SNAPSHOT", canonical.occurredAt, safeSnapshot(projection));
    } else if (["phase.completed", "phase.failed"].includes(canonical.type)) {
      const phaseId = canonical.payload.phaseId;
      const phase = phaseProjection(projection, phaseId);
      emit("STEP_FINISHED", canonical.occurredAt, {
        phaseId,
        attempt: phase?.attempt ?? 0,
        outcome: canonical.type === "phase.completed" ? "passed" : "failed",
        producedArtifactRefs: projection.artifacts
          .filter((artifact) => artifact.phaseId === phaseId && !artifact.stale)
          .map(({ id, hash }) => ({ id, hash })),
        evidenceIds: projection.evidence.filter((entry) => entry.phaseId === phaseId).map(({ id }) => id),
        nextLegalPhase: canonical.type === "phase.completed" ? nextLegalPhase(phaseId) : phaseId,
      });
      emit("STATE_SNAPSHOT", canonical.occurredAt, safeSnapshot(projection));
    } else if (canonical.type === "input.requested") {
      emit("MESSAGES_SNAPSHOT", canonical.occurredAt, messageSnapshot(projection, canonical.payload));
      emit("STATE_SNAPSHOT", canonical.occurredAt, safeSnapshot(projection));
    } else if (canonical.type === "run.finished") {
      emit("STATE_SNAPSHOT", canonical.occurredAt, safeSnapshot(projection));
      emit("RUN_FINISHED", canonical.occurredAt, {
        outcome: canonical.payload.outcome,
        finalRevision: canonical.payload.finalRevision,
        summaryEvidenceIds: (canonical.payload.evidenceIds ?? []).map((id) => safeIdentifier(id, "evidence")),
        ...(canonical.payload.workflowStatus ? { workflowStatus: canonical.payload.workflowStatus } : {}),
      });
    } else {
      emit("STATE_SNAPSHOT", canonical.occurredAt, safeSnapshot(projection));
    }
  }

  const validation = validateCodexSkillUiSequence(events, { requireTerminal: Boolean(state.terminalOutcome) });
  if (!validation.valid) {
    throw new WorkflowError("INVALID_SCHEMA", "Projected codex-skill-ui/1 sequence is invalid.", {
      errors: validation.errors,
    });
  }
  return events;
}

export function projectCodexSkillUiJourney(interruptedParent, resumedChild) {
  invariant(
    interruptedParent?.terminalOutcome === "interrupt",
    "INVALID_TRANSITION",
    "The parent journey must end with an interrupt.",
  );
  invariant(
    resumedChild?.threadId === interruptedParent.threadId &&
      resumedChild?.parentRunId === interruptedParent.runId &&
      resumedChild?.runId !== interruptedParent.runId,
    "INVALID_TRANSITION",
    "The resumed run must be a new child on the same thread.",
  );
  const expectedInterruptIds = (interruptedParent.interrupts ?? [])
    .filter(({ status }) => status === "open")
    .map(({ id }) => id)
    .sort();
  const receivedInterruptIds = (resumedChild.resume ?? []).map(({ interruptId }) => interruptId).sort();
  invariant(
    JSON.stringify(expectedInterruptIds) === JSON.stringify(receivedInterruptIds),
    "INTERRUPT_SET_INCOMPLETE",
    "The child RUN_STARTED resume set does not cover every parent interrupt.",
  );
  const parentEvents = projectCodexSkillUiEvents(interruptedParent);
  const childEvents = projectCodexSkillUiEvents(resumedChild);
  return {
    protocol: CODEX_SKILL_UI_PROTOCOL,
    threadId: safeIdentifier(interruptedParent.threadId, "thread"),
    parentRunId: safeIdentifier(interruptedParent.runId, "run"),
    childRunId: safeIdentifier(resumedChild.runId, "run"),
    parentEvents,
    childEvents,
    validation: {
      parent: validateCodexSkillUiSequence(parentEvents),
      child: validateCodexSkillUiSequence(childEvents, { requireTerminal: Boolean(resumedChild.terminalOutcome) }),
    },
  };
}
