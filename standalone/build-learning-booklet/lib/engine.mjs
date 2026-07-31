import {
  ARTIFACT_DEPENDENCIES,
  ARTIFACT_KINDS,
  AUTHORITATIVE_INTENT_ORIGINS,
  DESIGN_SELECTION_METHODS,
  EVIDENCE_STATUS,
  EXECUTION_STATUS,
  INTENT_ORIGINS,
  PHASE_BY_ID,
  PHASE_EVENT_TYPES,
  PHASE_IDS,
  PHASE_STATUS,
  PHASES,
  REQUIRED_INTENT_FIELDS,
  RUN_MODES,
  RUN_OUTCOMES,
  downstreamArtifactKinds,
  downstreamPhaseIds,
  phaseIdsForMode,
} from "./phases.mjs";
import { clone, hashValue, sameValue, stableStringify } from "./canonical.mjs";
import { WorkflowError, invariant } from "./errors.mjs";

const SCHEMA_VERSION = "1.0.0";
const FINDING_SEVERITIES = ["blocker", "major", "minor", "nit"];
const FINDING_STATUS = ["open", "resolved"];
const CANONICAL_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

function isCanonicalTimestamp(value) {
  return typeof value === "string" &&
    CANONICAL_TIMESTAMP.test(value) &&
    !Number.isNaN(Date.parse(value)) &&
    new Date(value).toISOString() === value;
}

function timestamp(now) {
  const value = typeof now === "function"
    ? now()
    : typeof now === "string"
      ? now
      : now instanceof Date
        ? now.toISOString()
        : new Date().toISOString();
  invariant(
    isCanonicalTimestamp(value),
    "INVALID_TIMESTAMP",
    "Workflow timestamps must use canonical UTC ISO-8601 form with millisecond precision.",
  );
  return value;
}

function assertRunState(state) {
  invariant(state && typeof state === "object", "INVALID_RUN_STATE", "A run state is required.");
  invariant(state.schemaVersion === SCHEMA_VERSION, "UNSUPPORTED_SCHEMA", "Unsupported run schema.", {
    expected: SCHEMA_VERSION,
    actual: state.schemaVersion,
  });
  if (state.executionStatus !== undefined) {
    invariant(
      EXECUTION_STATUS.includes(state.executionStatus),
      "INVALID_EXECUTION_STATUS",
      `Invalid execution status: ${state.executionStatus}`,
    );
  }
}

function assertRunMutable(state) {
  invariant(
    !state.terminalOutcome,
    "RUN_TERMINAL",
    `Run ${state.runId} already ended with outcome ${state.terminalOutcome}. Start a child run to continue.`,
    { runId: state.runId, terminalOutcome: state.terminalOutcome },
  );
}

function appendEvent(draft, type, payload, { now, idempotencyKey } = {}) {
  invariant(PHASE_EVENT_TYPES.includes(type), "UNKNOWN_EVENT_TYPE", `Unknown workflow event: ${type}`);
  const occurredAt = timestamp(now);
  const previousOccurredAt = draft.events.at(-1)?.occurredAt;
  invariant(
    !previousOccurredAt || occurredAt >= previousOccurredAt,
    "INVALID_TIMESTAMP_ORDER",
    "Workflow event timestamps cannot move backward.",
    { previousOccurredAt, occurredAt },
  );
  const seq = draft.eventCursor + 1;
  const stateVersion = draft.stateVersion + 1;
  draft.eventCursor = seq;
  draft.stateVersion = stateVersion;
  draft.events.push({
    id: `${draft.runId}:${seq}`,
    seq,
    stateVersion,
    type,
    runId: draft.runId,
    occurredAt,
    ...(idempotencyKey ? { idempotencyKey } : {}),
    payload: clone(payload ?? {}),
  });
}

function idempotencyFingerprint(value) {
  return hashValue(value);
}

function checkIdempotency(state, idempotencyKey, input) {
  if (!idempotencyKey) return false;
  const existing = state.idempotency[idempotencyKey];
  if (!existing) return false;
  const fingerprint = idempotencyFingerprint(input);
  invariant(
    existing.fingerprint === fingerprint,
    "IDEMPOTENCY_CONFLICT",
    `Idempotency key ${idempotencyKey} was already used with different input.`,
    { idempotencyKey },
  );
  return true;
}

function rememberIdempotency(draft, idempotencyKey, input) {
  if (!idempotencyKey) return;
  draft.idempotency[idempotencyKey] = {
    fingerprint: idempotencyFingerprint(input),
    stateVersion: draft.stateVersion,
  };
}

function normalizeIntentField(value, defaults) {
  const supplied = value && typeof value === "object" && Object.hasOwn(value, "value") ? value : { value };
  const origin = supplied.origin ?? defaults.origin;
  invariant(INTENT_ORIGINS.includes(origin), "INVALID_INTENT_ORIGIN", `Invalid intent origin: ${origin}`);
  return {
    value: clone(supplied.value),
    origin,
    locked: supplied.locked ?? origin === "user",
    confidence: supplied.confidence ?? defaults.confidence,
    updatedAt: supplied.updatedAt ?? defaults.updatedAt,
    evidenceRefs: clone(supplied.evidenceRefs ?? defaults.evidenceRefs ?? []),
  };
}

function sameIntentField(left, right) {
  if (!left || !right) return false;
  const withoutTimestamp = ({ updatedAt: _updatedAt, ...entry }) => entry;
  return sameValue(withoutTimestamp(left), withoutTimestamp(right));
}

function phaseRecord(phase) {
  return {
    id: phase.id,
    name: phase.name,
    layer: phase.layer,
    status: "not_started",
    attempt: 0,
    startedAt: null,
    completedAt: null,
    failedAt: null,
    failure: null,
    gateResults: {},
    outputArtifactId: null,
    attempts: [],
    reopenHistory: [],
  };
}

function activeAttemptRecord(phase) {
  if (!Array.isArray(phase.attempts)) return null;
  return [...phase.attempts].reverse().find(
    (attempt) => attempt.attempt === phase.attempt && attempt.status === "active",
  ) ?? null;
}

function appendAttemptReference(phase, key, value) {
  const attempt = activeAttemptRecord(phase);
  if (!attempt) return;
  if (!Array.isArray(attempt[key])) attempt[key] = [];
  if (!attempt[key].includes(value)) attempt[key].push(value);
}

function finishRun(draft, outcome, { now, workflowStatus = null, evidenceIds = [] } = {}) {
  invariant(RUN_OUTCOMES.includes(outcome), "INVALID_RUN_OUTCOME", `Invalid run outcome: ${outcome}`);
  invariant(!draft.terminalOutcome, "RUN_TERMINAL", `Run ${draft.runId} already has a terminal outcome.`);
  const at = timestamp(now);
  draft.executionStatus = outcome;
  draft.terminalOutcome = outcome;
  draft.finishedAt = at;
  appendEvent(
    draft,
    "run.finished",
    {
      outcome,
      finalRevision: draft.stateVersion + 1,
      evidenceIds: [...new Set(evidenceIds)].sort(),
      ...(workflowStatus ? { workflowStatus } : {}),
    },
    { now: at },
  );
}

export function createRunState({
  runId,
  threadId = runId,
  mode = "plan_then_build",
  intent = {},
  designRequired = true,
  permissions = {},
  residualRisks = [],
  limitations = [],
  now,
} = {}) {
  invariant(typeof runId === "string" && runId.trim(), "RUN_ID_REQUIRED", "runId is required.");
  invariant(typeof threadId === "string" && threadId.trim(), "THREAD_ID_REQUIRED", "threadId is required.");
  invariant(RUN_MODES.includes(mode), "INVALID_RUN_MODE", `Invalid run mode: ${mode}`);
  const createdAt = timestamp(now);
  const parentRunId = null;
  const resume = [];
  const intentFields = Object.fromEntries(
    Object.entries(intent).map(([key, value]) => [
      key,
      normalizeIntentField(value, {
        origin: value?.origin ?? "user",
        confidence: value?.confidence ?? 1,
        updatedAt: createdAt,
        evidenceRefs: value?.evidenceRefs ?? [],
      }),
    ]),
  );
  const state = {
    schemaVersion: SCHEMA_VERSION,
    runId,
    threadId,
    parentRunId,
    resume: clone(resume),
    mode,
    status: "draft",
    currentLayer: "intent",
    currentPhase: "I0",
    stateVersion: 0,
    eventCursor: 0,
    terminalReason: null,
    executionStatus: "running",
    terminalOutcome: null,
    finishedAt: null,
    createdAt,
    updatedAt: createdAt,
    phases: Object.fromEntries(PHASES.map((phase) => [phase.id, phaseRecord(phase)])),
    intent: {
      fields: intentFields,
      conflicts: [],
    },
    design: {
      requiresOptions: Boolean(designRequired),
      options: [],
      recommendationId: null,
      selection: null,
      finalVisualDirection: null,
      rejectedOptionIds: [],
    },
    pendingDecision: null,
    interrupts: [],
    artifacts: {},
    artifactIndex: {},
    evidence: {},
    gateResults: {},
    findings: {},
    sources: {},
    residualRisks: clone(residualRisks),
    limitations: clone(limitations),
    permissions: clone(permissions),
    events: [],
    idempotency: {},
  };
  appendEvent(
    state,
    "run.created",
    {
      mode,
      schemaVersion: SCHEMA_VERSION,
      threadId,
      parentRunId,
      resume: clone(resume),
    },
    { now: createdAt },
  );
  state.updatedAt = createdAt;
  return state;
}

function openCriticalConflicts(state) {
  return state.intent.conflicts.filter(
    (conflict) => conflict.severity === "critical" && conflict.status === "open",
  );
}

function requiredIntentEntry(state, field) {
  const direct = state.intent.fields[field];
  if (direct || field !== "mandatoryConcepts") return direct;
  const scope = state.intent.fields.scope;
  if (!scope?.value || typeof scope.value !== "object" || Array.isArray(scope.value)) return undefined;
  const value = scope.value.include ?? scope.value.mandatory;
  return value === undefined ? undefined : { ...scope, value };
}

function intentValueIsMissing(value) {
  return value === undefined || value === null || value === "" || (Array.isArray(value) && value.length === 0);
}

export function getMissingIntentFields(state) {
  assertRunState(state);
  return REQUIRED_INTENT_FIELDS.filter((field) => {
    const entry = requiredIntentEntry(state, field);
    return !entry || intentValueIsMissing(entry.value);
  });
}

export function getUnauthoritativeIntentFields(state) {
  assertRunState(state);
  return REQUIRED_INTENT_FIELDS.filter((field) => {
    const entry = requiredIntentEntry(state, field);
    return (
      !entry ||
      !entry.locked ||
      !AUTHORITATIVE_INTENT_ORIGINS.includes(entry.origin) ||
      intentValueIsMissing(entry.value)
    );
  });
}

export function requiredIntentQuestions(state) {
  assertRunState(state);
  const fields = new Set(getMissingIntentFields(state));
  for (const conflict of openCriticalConflicts(state)) fields.add(conflict.field);
  return [...fields].sort();
}

function conflictId(field, existing, incoming) {
  return `conflict:${field}:${hashValue({ existing, incoming }).slice(7, 19)}`;
}

function resolvePendingDecision(draft, type, isResolved) {
  const pending = draft.pendingDecision;
  if (!pending || pending.type !== type || !isResolved) return null;
  draft.pendingDecision = null;
  draft.status = pending.resumeStatus ?? "active";
  if (draft.currentPhase && draft.phases[draft.currentPhase].status === "awaiting_user") {
    draft.phases[draft.currentPhase].status = pending.resumePhaseStatus ?? "active";
  }
  return pending.id;
}

function markEvidenceStale(draft, predicate, reason) {
  const staleIds = [];
  for (const evidence of Object.values(draft.evidence)) {
    if (!evidence.stale && predicate(evidence)) {
      evidence.stale = true;
      evidence.staleReason = reason;
      staleIds.push(evidence.id);
    }
  }
  for (const result of Object.values(draft.gateResults)) {
    if (result.evidenceIds.some((id) => staleIds.includes(id))) {
      result.stale = true;
      result.staleReason = reason;
    }
  }
  return staleIds;
}

function markDependentStateStale(
  draft,
  { kind, phaseId, includeSource = false, reason, now, excludeActiveSource = true },
) {
  const sourcePhaseId = phaseId ?? PHASES.find((phase) => phase.outputKind === kind)?.id;
  const affectedKinds = downstreamArtifactKinds(kind, { includeSource });
  const affectedPhases = downstreamPhaseIds(sourcePhaseId, { includeSource });
  const affectedArtifactIds = [];
  for (const artifact of Object.values(draft.artifacts)) {
    if (affectedKinds.includes(artifact.kind) && !artifact.stale) {
      artifact.stale = true;
      artifact.staleReason = reason;
      affectedArtifactIds.push(artifact.id);
    }
  }
  const staleEvidenceIds = markEvidenceStale(
    draft,
    (evidence) =>
      affectedArtifactIds.includes(evidence.artifactId) || affectedKinds.includes(evidence.artifactKind),
    reason,
  );
  const invalidatedPhaseIds = [];
  for (const id of affectedPhases) {
    const phase = draft.phases[id];
    if (!phase) continue;
    if (excludeActiveSource && id === sourcePhaseId && phase.status === "active") continue;
    if (["passed", "failed", "active", "awaiting_user"].includes(phase.status)) {
      phase.status = "stale";
      phase.completedAt = null;
      invalidatedPhaseIds.push(id);
      appendEvent(
        draft,
        "phase.invalidated",
        { phaseId: id, reason, sourceKind: kind, staleEvidenceIds },
        { now },
      );
    }
  }
  if (invalidatedPhaseIds.length > 0 && ["specified", "planned", "completed"].includes(draft.status)) {
    draft.status = "active";
    draft.terminalReason = null;
  }
  return { affectedArtifactIds, staleEvidenceIds, invalidatedPhaseIds };
}

export function patchIntentManifest(
  state,
  patch,
  { origin = "inferred", confidence = 0.5, evidenceRefs = [], now, idempotencyKey } = {},
) {
  assertRunState(state);
  invariant(patch && typeof patch === "object" && !Array.isArray(patch), "INVALID_INTENT_PATCH", "Intent patch must be an object.");
  const operationInput = { operation: "intent.patch", patch, origin, confidence, evidenceRefs };
  if (checkIdempotency(state, idempotencyKey, operationInput)) return state;
  assertRunMutable(state);
  const at = timestamp(now);
  const draft = clone(state);
  const updatedFields = [];
  const skippedFields = [];
  const createdConflicts = [];

  for (const [field, rawIncoming] of Object.entries(patch)) {
    const incoming = normalizeIntentField(rawIncoming, {
      origin,
      confidence,
      updatedAt: at,
      evidenceRefs,
    });
    const existing = draft.intent.fields[field];
    if (existing && existing.locked && !sameValue(existing.value, incoming.value)) {
      if (incoming.origin === "user") {
        incoming.locked = true;
      } else {
        skippedFields.push({ field, reason: "locked_explicit_value" });
        if (incoming.origin !== "defaulted") {
          const id = conflictId(field, existing.value, incoming.value);
          if (!draft.intent.conflicts.some((conflict) => conflict.id === id)) {
            const conflict = {
              id,
              field,
              existing: clone(existing),
              incoming: clone(incoming),
              severity: "critical",
              status: "open",
              createdAt: at,
              resolvedAt: null,
            };
            draft.intent.conflicts.push(conflict);
            createdConflicts.push(id);
          }
        }
        continue;
      }
    }
    if (
      existing &&
      incoming.origin === "defaulted" &&
      existing.origin !== "defaulted" &&
      existing.value !== undefined &&
      existing.value !== null
    ) {
      skippedFields.push({ field, reason: "default_cannot_overwrite_confirmed" });
      continue;
    }
    if (existing && sameIntentField(existing, incoming)) continue;
    if (incoming.origin === "user") {
      incoming.locked = true;
      for (const conflict of draft.intent.conflicts) {
        if (conflict.field === field && conflict.status === "open") {
          conflict.status = "resolved";
          conflict.resolvedAt = at;
        }
      }
    }
    draft.intent.fields[field] = incoming;
    updatedFields.push(field);
  }

  if (updatedFields.length === 0 && createdConflicts.length === 0) return state;
  const requestedFields = draft.pendingDecision?.type === "intent" ? draft.pendingDecision.fields : [];
  const decisionResolved =
    requestedFields.length > 0 &&
    requestedFields.every((field) => {
      const entry = draft.intent.fields[field];
      const present = entry && entry.value !== undefined && entry.value !== null && entry.value !== "";
      const conflicted = openCriticalConflicts(draft).some((conflict) => conflict.field === field);
      return present && !conflicted;
    });
  const resolvedDecisionId = resolvePendingDecision(draft, "intent", decisionResolved);
  appendEvent(
    draft,
    "run.updated",
    {
      section: "intent",
      updatedFields,
      skippedFields,
      createdConflicts,
      ...(resolvedDecisionId ? { resolvedDecisionId } : {}),
    },
    { now: at, idempotencyKey },
  );
  const currentIntentId = draft.artifactIndex.intent;
  if (currentIntentId && (updatedFields.length > 0 || createdConflicts.length > 0)) {
    const currentIntent = draft.artifacts[currentIntentId];
    const invalidationReason =
      updatedFields.length > 0 ? "intent_manifest_changed" : "intent_conflict_opened";
    currentIntent.stale = true;
    currentIntent.staleReason = invalidationReason;
    markEvidenceStale(
      draft,
      (entry) => entry.artifactId === currentIntentId || downstreamArtifactKinds("intent").includes(entry.artifactKind),
      invalidationReason,
    );
    markDependentStateStale(draft, {
      kind: "intent",
      phaseId: "I0",
      includeSource: true,
      reason: invalidationReason,
      now: at,
    });
  }
  draft.updatedAt = at;
  rememberIdempotency(draft, idempotencyKey, operationInput);
  return draft;
}

function normalizeDesignOption(option) {
  return {
    id: typeof option?.id === "string" ? option.id.trim() : "",
    name: typeof option?.name === "string" ? option.name.trim() : "",
    rationale: typeof option?.rationale === "string" ? option.rationale.trim() : "",
    recommended: option?.recommended === true,
    visualDirection: clone(option?.visualDirection),
  };
}

function visualDistinctnessKey(option) {
  if (option.visualDirection && typeof option.visualDirection === "object") {
    return stableStringify(option.visualDirection).toLowerCase();
  }
  if (typeof option.visualDirection === "string") return option.visualDirection.trim().toLowerCase();
  return `${option.name}|${option.rationale}`.toLowerCase();
}

export function validateDesignOptions(options) {
  const errors = [];
  if (!Array.isArray(options) || options.length !== 3) {
    errors.push({ code: "DESIGN_OPTION_COUNT", message: "Exactly three design options are required." });
    return { valid: false, errors, normalized: Array.isArray(options) ? options.map(normalizeDesignOption) : [] };
  }
  const normalized = options.map(normalizeDesignOption);
  normalized.forEach((option, index) => {
    if (!option.id) errors.push({ code: "DESIGN_ID_REQUIRED", index });
    if (!option.name) errors.push({ code: "DESIGN_NAME_REQUIRED", index });
    if (!option.rationale) errors.push({ code: "DESIGN_RATIONALE_REQUIRED", index });
    if (
      option.visualDirection === undefined ||
      option.visualDirection === null ||
      option.visualDirection === ""
    ) {
      errors.push({ code: "DESIGN_DIRECTION_REQUIRED", index });
    }
  });
  if (new Set(normalized.map(({ id }) => id)).size !== 3) {
    errors.push({ code: "DESIGN_IDS_NOT_DISTINCT" });
  }
  if (new Set(normalized.map(({ name }) => name.toLowerCase())).size !== 3) {
    errors.push({ code: "DESIGN_NAMES_NOT_DISTINCT" });
  }
  if (new Set(normalized.map(visualDistinctnessKey)).size !== 3) {
    errors.push({ code: "DESIGN_DIRECTIONS_NOT_DISTINCT" });
  }
  if (normalized.filter(({ recommended }) => recommended).length !== 1) {
    errors.push({ code: "DESIGN_RECOMMENDATION_COUNT", message: "Exactly one option must be recommended." });
  }
  return { valid: errors.length === 0, errors, normalized };
}

export function proposeDesignOptions(state, options, { now, idempotencyKey } = {}) {
  assertRunState(state);
  const operationInput = { operation: "design.propose", options };
  if (checkIdempotency(state, idempotencyKey, operationInput)) return state;
  assertRunMutable(state);
  invariant(state.phases.I0.status !== "passed", "DESIGN_PHASE_CLOSED", "Design options can only be proposed during I0.");
  const validation = validateDesignOptions(options);
  invariant(validation.valid, "INVALID_DESIGN_OPTIONS", "Design options failed validation.", {
    errors: validation.errors,
  });
  if (sameValue(state.design.options, validation.normalized)) return state;
  const at = timestamp(now);
  const draft = clone(state);
  const replacingSelection = Boolean(draft.design.selection);
  draft.design.options = validation.normalized;
  draft.design.recommendationId = validation.normalized.find(({ recommended }) => recommended).id;
  if (replacingSelection) {
    draft.design.selection = null;
    draft.design.finalVisualDirection = null;
    draft.design.rejectedOptionIds = [];
    markDependentStateStale(draft, {
      kind: "intent",
      phaseId: "I0",
      includeSource: true,
      reason: "design_options_changed",
      now: at,
    });
  }
  appendEvent(
    draft,
    "design.options.proposed",
    {
      optionIds: validation.normalized.map(({ id }) => id),
      recommendationId: draft.design.recommendationId,
    },
    { now: at, idempotencyKey },
  );
  draft.updatedAt = at;
  rememberIdempotency(draft, idempotencyKey, operationInput);
  return draft;
}

function resolveDesignSelection(design, selection) {
  invariant(
    DESIGN_SELECTION_METHODS.includes(selection?.method),
    "INVALID_SELECTION_METHOD",
    `Invalid design selection method: ${selection?.method}`,
  );
  const method = selection.method;
  if (method === "direct") {
    invariant(
      selection.finalVisualDirection && typeof selection.finalVisualDirection === "object",
      "DIRECT_DIRECTION_REQUIRED",
      "Direct selection requires finalVisualDirection.",
    );
    return {
      method,
      selectedOptionId: null,
      sourceOptionIds: [],
      finalVisualDirection: clone(selection.finalVisualDirection),
      rejectedOptionIds: design.options.map(({ id }) => id),
    };
  }
  const validation = validateDesignOptions(design.options);
  invariant(validation.valid, "VALID_DESIGN_OPTIONS_REQUIRED", "A valid set of three options is required before selection.", {
    errors: validation.errors,
  });
  if (method === "user-hybridized") {
    const sourceOptionIds = [...new Set(selection.sourceOptionIds ?? [])];
    invariant(sourceOptionIds.length >= 2, "HYBRID_SOURCES_REQUIRED", "A hybrid must use at least two options.");
    invariant(
      sourceOptionIds.every((id) => design.options.some((option) => option.id === id)),
      "UNKNOWN_HYBRID_SOURCE",
      "A hybrid references an unknown design option.",
    );
    invariant(
      selection.finalVisualDirection && typeof selection.finalVisualDirection === "object",
      "HYBRID_DIRECTION_REQUIRED",
      "A hybrid requires a concrete finalVisualDirection.",
    );
    return {
      method,
      selectedOptionId: null,
      sourceOptionIds,
      finalVisualDirection: clone(selection.finalVisualDirection),
      rejectedOptionIds: design.options
        .map(({ id }) => id)
        .filter((id) => !sourceOptionIds.includes(id)),
    };
  }
  const selectedOptionId =
    selection.selectedOptionId ??
    (method === "recommended-default" || method === "delegated" ? design.recommendationId : null);
  const selected = design.options.find((option) => option.id === selectedOptionId);
  invariant(selected, "UNKNOWN_DESIGN_OPTION", `Unknown selected design option: ${selectedOptionId}`);
  return {
    method,
    selectedOptionId,
    sourceOptionIds: [selectedOptionId],
    finalVisualDirection: clone(selected.visualDirection),
    rejectedOptionIds: design.options.map(({ id }) => id).filter((id) => id !== selectedOptionId),
  };
}

export function selectDesign(
  state,
  selection,
  { now, selectedBy = "user", idempotencyKey = selection?.idempotencyKey } = {},
) {
  assertRunState(state);
  const operationInput = { operation: "design.select", selection, selectedBy };
  if (checkIdempotency(state, idempotencyKey, operationInput)) return state;
  assertRunMutable(state);
  invariant(state.phases.I0.status !== "passed", "DESIGN_PHASE_CLOSED", "Design selection can only change during I0 rework.");
  const resolved = resolveDesignSelection(state.design, selection);
  const comparableCurrent = state.design.selection
    ? {
        method: state.design.selection.method,
        selectedOptionId: state.design.selection.selectedOptionId,
        sourceOptionIds: state.design.selection.sourceOptionIds,
        finalVisualDirection: state.design.finalVisualDirection,
        rejectedOptionIds: state.design.rejectedOptionIds,
      }
    : null;
  if (sameValue(comparableCurrent, resolved)) return state;
  const at = timestamp(now);
  const draft = clone(state);
  const wasSelected = Boolean(draft.design.selection);
  draft.design.selection = {
    method: resolved.method,
    selectedOptionId: resolved.selectedOptionId,
    sourceOptionIds: resolved.sourceOptionIds,
    selectedBy,
    selectedAt: at,
  };
  draft.design.finalVisualDirection = resolved.finalVisualDirection;
  draft.design.rejectedOptionIds = resolved.rejectedOptionIds;
  const resolvedDecisionId = resolvePendingDecision(draft, "design_selection", true);
  if (wasSelected || draft.artifactIndex.intent) {
    markDependentStateStale(draft, {
      kind: "intent",
      phaseId: "I0",
      includeSource: true,
      reason: "design_selection_changed",
      now: at,
    });
  }
  appendEvent(
    draft,
    "design.selected",
    {
      method: resolved.method,
      selectedOptionId: resolved.selectedOptionId,
      sourceOptionIds: resolved.sourceOptionIds,
      rejectedOptionIds: resolved.rejectedOptionIds,
      ...(resolvedDecisionId ? { resolvedDecisionId } : {}),
    },
    { now: at, idempotencyKey },
  );
  draft.updatedAt = at;
  rememberIdempotency(draft, idempotencyKey, operationInput);
  return draft;
}

export function compileManifest(state) {
  assertRunState(state);
  const fields = clone(state.intent.fields);
  return {
    schemaVersion: state.schemaVersion,
    runId: state.runId,
    mode: state.mode,
    intent: fields,
    design: state.design.selection
      ? {
          selection: clone(state.design.selection),
          finalVisualDirection: clone(state.design.finalVisualDirection),
        }
      : null,
  };
}

export function requestInput(
  state,
  { type = "intent", fields, prompt, responseSchema } = {},
  { now, idempotencyKey } = {},
) {
  assertRunState(state);
  const requestedFields = type === "intent" ? fields ?? requiredIntentQuestions(state) : fields ?? [];
  if (type === "intent" && requestedFields.length === 0) return state;
  const operationInput = { operation: "input.request", type, fields: requestedFields, prompt, responseSchema };
  if (checkIdempotency(state, idempotencyKey, operationInput)) return state;
  assertRunMutable(state);
  invariant(!state.pendingDecision, "PENDING_DECISION", "Resolve the current decision before requesting another one.");
  const at = timestamp(now);
  const draft = clone(state);
  draft.pendingDecision = {
    id: `decision:${draft.eventCursor + 1}`,
    type,
    fields: clone(requestedFields),
    prompt: prompt ?? null,
    responseSchema: clone(responseSchema ?? null),
    requestedAt: at,
    resumeStatus: draft.status,
    resumePhaseStatus: draft.currentPhase ? draft.phases[draft.currentPhase].status : null,
  };
  if (!Array.isArray(draft.interrupts)) draft.interrupts = [];
  draft.interrupts.push({
    id: draft.pendingDecision.id,
    type,
    fields: clone(requestedFields),
    phaseId: draft.currentPhase,
    status: "open",
    openedAt: at,
    resolvedAt: null,
    resolvedRunId: null,
  });
  draft.status = "awaiting_user";
  if (draft.currentPhase && draft.phases[draft.currentPhase].status === "active") {
    draft.phases[draft.currentPhase].status = "awaiting_user";
  }
  appendEvent(
    draft,
    "input.requested",
    { decisionId: draft.pendingDecision.id, type, fields: requestedFields },
    { now: at, idempotencyKey },
  );
  finishRun(draft, "interrupt", { now: at });
  draft.updatedAt = at;
  rememberIdempotency(draft, idempotencyKey, operationInput);
  return draft;
}

function openInterruptIds(state) {
  const ids = (state.interrupts ?? [])
    .filter(({ status }) => status === "open")
    .map(({ id }) => id);
  if (ids.length === 0 && state.pendingDecision?.id) ids.push(state.pendingDecision.id);
  return [...new Set(ids)].sort();
}

function normalizeResumeEntries(resume) {
  invariant(Array.isArray(resume), "INVALID_RESUME", "resume must be an array.");
  return resume.map((entry, index) => {
    invariant(entry && typeof entry === "object", "INVALID_RESUME", `resume[${index}] must be an object.`);
    invariant(
      typeof entry.interruptId === "string" && entry.interruptId,
      "INVALID_RESUME",
      `resume[${index}].interruptId is required.`,
    );
    invariant(Object.hasOwn(entry, "value"), "INVALID_RESUME", `resume[${index}].value is required.`);
    return { interruptId: entry.interruptId, value: clone(entry.value) };
  });
}

function recordInterruptResolution(state, interruptId, value, at) {
  const draft = clone(state);
  const interrupt = (draft.interrupts ?? []).find(({ id }) => id === interruptId);
  if (interrupt) {
    interrupt.status = "resolved";
    interrupt.resolvedAt = at;
    interrupt.resolvedRunId = draft.runId;
    interrupt.resolution = clone(value);
  }
  appendEvent(
    draft,
    "run.updated",
    { section: "interrupts", interruptId, status: "resolved", parentRunId: draft.parentRunId },
    { now: at },
  );
  draft.updatedAt = at;
  return draft;
}

export function resumeRunState(parentState, { runId, threadId, resume, now } = {}) {
  assertRunState(parentState);
  invariant(
    parentState.terminalOutcome === "interrupt" && parentState.pendingDecision,
    "INVALID_TRANSITION",
    "Only a run terminated by an open interrupt can be resumed.",
    { runId: parentState.runId, terminalOutcome: parentState.terminalOutcome },
  );
  invariant(typeof runId === "string" && runId.trim(), "RUN_ID_REQUIRED", "A new child runId is required.");
  invariant(runId !== parentState.runId, "INVALID_TRANSITION", "A resumed run must use a new runId.");
  const inheritedThreadId = parentState.threadId ?? parentState.runId;
  invariant(
    threadId === undefined || threadId === inheritedThreadId,
    "INVALID_TRANSITION",
    "A resumed run must remain on the parent thread.",
    { expectedThreadId: inheritedThreadId, actualThreadId: threadId },
  );
  const normalizedResume = normalizeResumeEntries(resume);
  const expectedIds = openInterruptIds(parentState);
  const receivedIds = normalizedResume.map(({ interruptId }) => interruptId);
  const uniqueReceivedIds = [...new Set(receivedIds)].sort();
  const unknownId = uniqueReceivedIds.find((id) => !expectedIds.includes(id));
  invariant(!unknownId, "INTERRUPT_NOT_OPEN", `Interrupt ${unknownId} is not open.`, { interruptId: unknownId });
  invariant(
    uniqueReceivedIds.length === receivedIds.length && sameValue(uniqueReceivedIds, expectedIds),
    "INTERRUPT_SET_INCOMPLETE",
    "A resumed run must resolve every open interrupt exactly once.",
    { expectedInterruptIds: expectedIds, receivedInterruptIds: receivedIds },
  );

  const at = timestamp(now);
  invariant(
    at >= parentState.updatedAt,
    "INVALID_TIMESTAMP_ORDER",
    "A resumed run cannot begin before its parent was last updated.",
    { parentUpdatedAt: parentState.updatedAt, childCreatedAt: at },
  );
  let child = clone(parentState);
  child.runId = runId;
  child.threadId = inheritedThreadId;
  child.parentRunId = parentState.runId;
  child.resume = clone(normalizedResume);
  child.executionStatus = "running";
  child.terminalOutcome = null;
  child.finishedAt = null;
  child.terminalReason = null;
  child.createdAt = at;
  child.updatedAt = at;
  child.stateVersion = 0;
  child.eventCursor = 0;
  child.events = [];
  child.idempotency = {};
  appendEvent(
    child,
    "run.created",
    {
      mode: child.mode,
      schemaVersion: child.schemaVersion,
      threadId: child.threadId,
      parentRunId: child.parentRunId,
      resume: clone(normalizedResume),
    },
    { now: at },
  );

  for (const entry of normalizedResume) {
    const pending = child.pendingDecision;
    invariant(
      pending?.id === entry.interruptId,
      "INTERRUPT_NOT_OPEN",
      `Interrupt ${entry.interruptId} is not the current decision.`,
    );
    if (pending.type === "intent") {
      const patch = entry.value?.patch ?? entry.value;
      invariant(
        patch && typeof patch === "object" && !Array.isArray(patch),
        "INVALID_RESUME",
        "An intent resume value must contain an intent patch object.",
      );
      child = patchIntentManifest(child, patch, {
        origin: "user",
        confidence: 1,
        now: at,
        idempotencyKey: `resume:${entry.interruptId}`,
      });
    } else if (pending.type === "design_selection") {
      const selection = entry.value?.selection ?? entry.value;
      child = selectDesign(child, selection, {
        selectedBy: "user",
        now: at,
        idempotencyKey: `resume:${entry.interruptId}`,
      });
    } else {
      const draft = clone(child);
      resolvePendingDecision(draft, pending.type, true);
      appendEvent(
        draft,
        "run.updated",
        { section: "decision", resolvedDecisionId: pending.id },
        { now: at, idempotencyKey: `resume:${entry.interruptId}` },
      );
      child = draft;
    }
    invariant(
      child.pendingDecision?.id !== entry.interruptId,
      "INTERRUPT_SET_INCOMPLETE",
      `Resume value did not resolve interrupt ${entry.interruptId}.`,
    );
    child = recordInterruptResolution(child, entry.interruptId, entry.value, at);
  }
  invariant(!child.pendingDecision, "INTERRUPT_SET_INCOMPLETE", "The resumed run still has an open decision.");
  return child;
}

function modeAllowsPhase(mode, phaseId) {
  return phaseIdsForMode(mode).includes(phaseId);
}

export function startPhase(state, phaseId, { now, idempotencyKey } = {}) {
  assertRunState(state);
  const phaseDefinition = PHASE_BY_ID[phaseId];
  invariant(phaseDefinition, "UNKNOWN_PHASE", `Unknown phase: ${phaseId}`);
  invariant(modeAllowsPhase(state.mode, phaseId), "PHASE_OUTSIDE_MODE", `${phaseId} is outside mode ${state.mode}.`);
  const operationInput = { operation: "phase.start", phaseId };
  if (checkIdempotency(state, idempotencyKey, operationInput)) return state;
  assertRunMutable(state);
  if (state.phases[phaseId].status === "active") return state;
  invariant(!state.pendingDecision, "PENDING_DECISION", "A pending user decision must be resolved first.");
  const activePhase = PHASE_IDS.find((id) => ["active", "awaiting_user"].includes(state.phases[id].status));
  invariant(!activePhase, "PHASE_ALREADY_ACTIVE", `${activePhase} is already active.`);
  for (const previousId of PHASE_IDS.slice(0, phaseDefinition.order)) {
    if (!modeAllowsPhase(state.mode, previousId)) continue;
    invariant(
      state.phases[previousId].status === "passed",
      "UPSTREAM_PHASE_INCOMPLETE",
      `${phaseId} cannot start until ${previousId} passes.`,
      { phaseId, previousId, status: state.phases[previousId].status },
    );
  }
  const at = timestamp(now);
  const draft = clone(state);
  const phase = draft.phases[phaseId];
  phase.status = "active";
  phase.attempt += 1;
  phase.startedAt = at;
  phase.completedAt = null;
  phase.failedAt = null;
  phase.failure = null;
  if (!Array.isArray(phase.attempts)) phase.attempts = [];
  phase.attempts.push({
    attempt: phase.attempt,
    status: "active",
    startedAt: at,
    finishedAt: null,
    failure: null,
    artifactIds: [],
    evidenceIds: [],
    gateResults: [],
  });
  draft.status = "active";
  draft.currentPhase = phaseId;
  draft.currentLayer = phaseDefinition.layer;
  if (state.mode === "plan_then_build") draft.terminalReason = null;
  appendEvent(draft, "phase.started", { phaseId, attempt: phase.attempt }, { now: at, idempotencyKey });
  draft.updatedAt = at;
  rememberIdempotency(draft, idempotencyKey, operationInput);
  return draft;
}

function currentArtifactForKind(state, kind) {
  const id = state.artifactIndex[kind];
  return id ? state.artifacts[id] : null;
}

function inferArtifactDependencies(state, kind) {
  return (ARTIFACT_DEPENDENCIES[kind] ?? []).map((dependencyKind) => {
    const artifact = currentArtifactForKind(state, dependencyKind);
    invariant(
      artifact && !artifact.stale,
      "CURRENT_UPSTREAM_ARTIFACT_REQUIRED",
      `A current ${dependencyKind} artifact is required before ${kind}.`,
      { kind, dependencyKind },
    );
    return artifact.id;
  });
}

export function recordArtifact(state, artifact, { now, idempotencyKey } = {}) {
  assertRunState(state);
  invariant(artifact && typeof artifact === "object", "INVALID_ARTIFACT", "Artifact is required.");
  invariant(typeof artifact.id === "string" && artifact.id, "ARTIFACT_ID_REQUIRED", "Artifact id is required.");
  invariant(ARTIFACT_KINDS.includes(artifact.kind), "INVALID_ARTIFACT_KIND", `Invalid artifact kind: ${artifact.kind}`);
  const phaseDefinition = PHASES.find(({ outputKind }) => outputKind === artifact.kind);
  const phaseId = artifact.phaseId ?? phaseDefinition.id;
  invariant(phaseId === phaseDefinition.id, "ARTIFACT_PHASE_MISMATCH", `${artifact.kind} belongs to ${phaseDefinition.id}.`);
  invariant(
    ["active", "passed", "stale", "failed"].includes(state.phases[phaseId].status),
    "ARTIFACT_PHASE_NOT_ACTIVE",
    `${phaseId} must have started before its artifact is recorded.`,
  );
  const payload = Object.hasOwn(artifact, "data")
    ? artifact.data
    : Object.hasOwn(artifact, "content")
      ? artifact.content
      : artifact.metadata ?? {};
  const requiredDependencies = inferArtifactDependencies(state, artifact.kind);
  const dependencies = [...(artifact.dependencies ?? requiredDependencies)].sort();
  const normalizedFiles = clone(artifact.files ?? []).sort((left, right) =>
    `${left.path}\u0000${left.mimeType}`.localeCompare(`${right.path}\u0000${right.mimeType}`),
  );
  invariant(
    sameValue([...dependencies].sort(), [...requiredDependencies].sort()),
    "ARTIFACT_DEPENDENCY_MISMATCH",
    `${artifact.kind} must depend on every current declared upstream artifact and no others.`,
    { requiredDependencies, actualDependencies: dependencies },
  );
  const computedHash = hashValue({
    kind: artifact.kind,
    payload,
    metadata: artifact.metadata ?? {},
    files: normalizedFiles,
    dependencies,
  });
  invariant(
    !artifact.hash || artifact.hash === computedHash,
    "ARTIFACT_HASH_MISMATCH",
    "Provided artifact hash does not match its payload.",
    { expected: computedHash, actual: artifact.hash },
  );
  const operationInput = {
    operation: "artifact.record",
    artifact: { ...artifact, dependencies, files: normalizedFiles, hash: computedHash },
  };
  if (checkIdempotency(state, idempotencyKey, operationInput)) return state;
  assertRunMutable(state);
  const existing = state.artifacts[artifact.id];
  if (
    existing &&
    existing.hash === computedHash &&
    sameValue(existing.metadata, artifact.metadata ?? {}) &&
    sameValue(existing.files, normalizedFiles) &&
    !existing.stale
  ) {
    return state;
  }
  const at = timestamp(now);
  const draft = clone(state);
  const previousCurrentId = draft.artifactIndex[artifact.kind];
  const previousCurrent = previousCurrentId ? draft.artifacts[previousCurrentId] : null;
  const changedCurrent = Boolean(
    previousCurrent && (previousCurrent.hash !== computedHash || previousCurrent.id !== artifact.id),
  );
  if (previousCurrent && previousCurrent.id !== artifact.id) {
    previousCurrent.stale = true;
    previousCurrent.staleReason = "superseded";
  }
  if (changedCurrent) {
    markEvidenceStale(
      draft,
      (entry) =>
        entry.artifactId === previousCurrent.id ||
        downstreamArtifactKinds(artifact.kind).includes(entry.artifactKind),
      `${artifact.kind}_artifact_hash_changed`,
    );
    markDependentStateStale(draft, {
      kind: artifact.kind,
      phaseId,
      includeSource: true,
      reason: `${artifact.kind}_artifact_hash_changed`,
      now: at,
    });
  }
  for (const dependencyId of dependencies) {
    const dependency = draft.artifacts[dependencyId];
    invariant(dependency && !dependency.stale, "INVALID_ARTIFACT_DEPENDENCY", `Artifact dependency ${dependencyId} is not current.`);
  }
  const record = {
    id: artifact.id,
    kind: artifact.kind,
    phaseId,
    hash: computedHash,
    revision: (existing?.revision ?? 0) + 1,
    dependencies: clone(dependencies),
    data: clone(payload),
    metadata: clone(artifact.metadata ?? {}),
    files: normalizedFiles,
    stale: false,
    staleReason: null,
    createdAt: existing?.createdAt ?? at,
    updatedAt: at,
  };
  draft.artifacts[artifact.id] = record;
  draft.artifactIndex[artifact.kind] = artifact.id;
  draft.phases[phaseId].outputArtifactId = artifact.id;
  appendAttemptReference(draft.phases[phaseId], "artifactIds", artifact.id);
  appendEvent(
    draft,
    "artifact.updated",
    {
      artifactId: artifact.id,
      kind: artifact.kind,
      hash: computedHash,
      revision: record.revision,
      changedCurrent,
    },
    { now: at, idempotencyKey },
  );
  draft.updatedAt = at;
  rememberIdempotency(draft, idempotencyKey, operationInput);
  return draft;
}

export function isEvidenceFresh(state, evidenceOrId) {
  assertRunState(state);
  const evidence = typeof evidenceOrId === "string" ? state.evidence[evidenceOrId] : evidenceOrId;
  if (!evidence || evidence.stale) return false;
  if (evidence.status !== "pass") return true;
  const artifact = state.artifacts[evidence.artifactId];
  return Boolean(
    artifact &&
      !artifact.stale &&
      artifact.hash === evidence.artifactHash &&
      artifact.kind === evidence.artifactKind,
  );
}

export function recordEvidence(state, evidence, { now, idempotencyKey } = {}) {
  assertRunState(state);
  invariant(evidence && typeof evidence === "object", "INVALID_EVIDENCE", "Evidence is required.");
  invariant(typeof evidence.id === "string" && evidence.id, "EVIDENCE_ID_REQUIRED", "Evidence id is required.");
  invariant(EVIDENCE_STATUS.includes(evidence.status), "INVALID_EVIDENCE_STATUS", `Invalid evidence status: ${evidence.status}`);
  const phase = PHASE_BY_ID[evidence.phaseId];
  invariant(phase, "UNKNOWN_PHASE", `Unknown evidence phase: ${evidence.phaseId}`);
  invariant(phase.gates.includes(evidence.gateId), "UNKNOWN_GATE", `${evidence.gateId} is not a gate for ${evidence.phaseId}.`);
  if (evidence.status === "pass") {
    invariant(evidence.executed !== false, "PASS_MUST_BE_EXECUTED", "Passing evidence must represent an executed check.");
    invariant(evidence.artifactId && evidence.artifactHash, "PASS_REQUIRES_ARTIFACT_HASH", "Passing evidence must identify a current artifact hash.");
    const artifact = state.artifacts[evidence.artifactId];
    invariant(artifact && !artifact.stale, "PASS_REQUIRES_CURRENT_ARTIFACT", "Passing evidence references a missing or stale artifact.");
    invariant(
      artifact.kind === phase.outputKind,
      "EVIDENCE_ARTIFACT_SCOPE_MISMATCH",
      `Passing evidence for ${evidence.phaseId} must reference its ${phase.outputKind} artifact.`,
      { phaseId: evidence.phaseId, expectedKind: phase.outputKind, actualKind: artifact.kind },
    );
    invariant(
      artifact.hash === evidence.artifactHash,
      "EVIDENCE_HASH_NOT_CURRENT",
      "Evidence hash does not match the current artifact hash.",
      { currentHash: artifact.hash, evidenceHash: evidence.artifactHash },
    );
  }
  if (evidence.status === "not_run") {
    invariant(evidence.executed !== true, "NOT_RUN_CANNOT_BE_EXECUTED", "A not_run check cannot claim execution.");
  }
  const operationInput = { operation: "evidence.record", evidence };
  if (checkIdempotency(state, idempotencyKey, operationInput)) return state;
  assertRunMutable(state);
  const existing = state.evidence[evidence.id];
  if (existing) {
    const comparable = { ...existing };
    delete comparable.recordedAt;
    delete comparable.stale;
    delete comparable.staleReason;
    const requested = {
      ...clone(evidence),
      executed: evidence.executed ?? evidence.status !== "not_run",
      critical: evidence.critical ?? true,
      artifactKind: evidence.artifactId ? state.artifacts[evidence.artifactId]?.kind ?? null : null,
    };
    if (sameValue(comparable, requested)) return state;
    throw new WorkflowError("EVIDENCE_ID_CONFLICT", `Evidence id ${evidence.id} already exists with different content.`);
  }
  const at = timestamp(now);
  const draft = clone(state);
  const artifact = evidence.artifactId ? draft.artifacts[evidence.artifactId] : null;
  draft.evidence[evidence.id] = {
    ...clone(evidence),
    executed: evidence.executed ?? evidence.status !== "not_run",
    critical: evidence.critical ?? true,
    artifactKind: artifact?.kind ?? null,
    stale: false,
    staleReason: null,
    recordedAt: at,
  };
  appendAttemptReference(draft.phases[evidence.phaseId], "evidenceIds", evidence.id);
  appendEvent(
    draft,
    "verification.recorded",
    {
      evidenceId: evidence.id,
      phaseId: evidence.phaseId,
      gateId: evidence.gateId,
      status: evidence.status,
      artifactId: evidence.artifactId ?? null,
      artifactHash: evidence.artifactHash ?? null,
    },
    { now: at, idempotencyKey },
  );
  draft.updatedAt = at;
  rememberIdempotency(draft, idempotencyKey, operationInput);
  return draft;
}

function computeGateResult(state, phaseId, gateId, evidenceIds) {
  const reasons = [];
  if (!Array.isArray(evidenceIds) || evidenceIds.length === 0) reasons.push("missing_evidence");
  const normalizedEvidenceIds = [...new Set(evidenceIds ?? [])].sort();
  const evidence = normalizedEvidenceIds.map((id) => state.evidence[id]).filter(Boolean);
  if (evidence.length !== normalizedEvidenceIds.length) reasons.push("unknown_evidence");
  for (const entry of evidence) {
    if (entry.phaseId !== phaseId || entry.gateId !== gateId) reasons.push(`evidence_scope_mismatch:${entry.id}`);
    if (!isEvidenceFresh(state, entry)) reasons.push(`stale_evidence:${entry.id}`);
    if (entry.status !== "pass") reasons.push(`${entry.status}:${entry.id}`);
  }
  if (!evidence.some((entry) => entry.status === "pass")) reasons.push("no_passing_evidence");
  return {
    status: reasons.length === 0 ? "pass" : "fail",
    reasons: [...new Set(reasons)].sort(),
    evidenceIds: normalizedEvidenceIds,
    artifactHashes: [...new Set(evidence.map(({ artifactHash }) => artifactHash).filter(Boolean))].sort(),
  };
}

export function evaluatePhaseGate(
  state,
  { phaseId, gateId, evidenceIds },
  { now, idempotencyKey } = {},
) {
  assertRunState(state);
  const phaseDefinition = PHASE_BY_ID[phaseId];
  invariant(phaseDefinition, "UNKNOWN_PHASE", `Unknown phase: ${phaseId}`);
  invariant(phaseDefinition.gates.includes(gateId), "UNKNOWN_GATE", `${gateId} is not a hard gate for ${phaseId}.`);
  const operationInput = { operation: "gate.evaluate", phaseId, gateId, evidenceIds };
  if (checkIdempotency(state, idempotencyKey, operationInput)) return state;
  assertRunMutable(state);
  const at = timestamp(now);
  const draft = clone(state);
  const computed = computeGateResult(draft, phaseId, gateId, evidenceIds);
  const resultId = `${phaseId}:${gateId}:${draft.eventCursor + 1}`;
  const result = {
    id: resultId,
    phaseId,
    gateId,
    hard: true,
    ...computed,
    stale: false,
    staleReason: null,
    evaluatedAt: at,
  };
  draft.gateResults[`${phaseId}:${gateId}`] = result;
  draft.phases[phaseId].gateResults[gateId] = resultId;
  const attempt = activeAttemptRecord(draft.phases[phaseId]);
  if (attempt) attempt.gateResults.push(clone(result));
  appendEvent(
    draft,
    "gate.evaluated",
    {
      resultId,
      phaseId,
      gateId,
      status: result.status,
      reasons: result.reasons,
      evidenceIds: result.evidenceIds,
    },
    { now: at, idempotencyKey },
  );
  if (result.status === "fail") draft.status = "failed_gate";
  draft.updatedAt = at;
  rememberIdempotency(draft, idempotencyKey, operationInput);
  return draft;
}

export function gateResultIsCurrent(state, phaseId, gateId) {
  assertRunState(state);
  const result = state.gateResults[`${phaseId}:${gateId}`];
  if (!result || result.status !== "pass" || result.stale) return false;
  return result.evidenceIds.length > 0 && result.evidenceIds.every((id) => isEvidenceFresh(state, id));
}

export function phaseGateSummary(state, phaseId) {
  assertRunState(state);
  const phase = PHASE_BY_ID[phaseId];
  invariant(phase, "UNKNOWN_PHASE", `Unknown phase: ${phaseId}`);
  return phase.gates.map((gateId) => ({
    gateId,
    current: gateResultIsCurrent(state, phaseId, gateId),
    result: clone(state.gateResults[`${phaseId}:${gateId}`] ?? null),
  }));
}

function validatePhasePreconditions(state, phaseId) {
  const reasons = [];
  if (phaseId === "I0") {
    const unauthoritative = getUnauthoritativeIntentFields(state);
    if (unauthoritative.length > 0) reasons.push(`unauthoritative_intent:${unauthoritative.join(",")}`);
    if (openCriticalConflicts(state).length > 0) reasons.push("open_critical_intent_conflicts");
    if (!state.design.selection || !state.design.finalVisualDirection) reasons.push("design_not_selected");
    if (state.design.requiresOptions && !validateDesignOptions(state.design.options).valid) {
      reasons.push("invalid_design_options");
    }
  }
  if (phaseId === "P5" && !state.design.finalVisualDirection) {
    reasons.push("selected_visual_direction_missing");
  }
  const phase = PHASE_BY_ID[phaseId];
  const artifact = currentArtifactForKind(state, phase.outputKind);
  if (!artifact || artifact.stale) reasons.push(`current_${phase.outputKind}_artifact_missing`);
  return reasons;
}

export function failPhase(state, phaseId, failure, { now, idempotencyKey } = {}) {
  assertRunState(state);
  invariant(PHASE_BY_ID[phaseId], "UNKNOWN_PHASE", `Unknown phase: ${phaseId}`);
  const operationInput = { operation: "phase.fail", phaseId, failure };
  if (checkIdempotency(state, idempotencyKey, operationInput)) return state;
  assertRunMutable(state);
  const at = timestamp(now);
  const draft = clone(state);
  const phase = draft.phases[phaseId];
  invariant(["active", "awaiting_user"].includes(phase.status), "PHASE_NOT_ACTIVE", `${phaseId} is not active.`);
  phase.status = "failed";
  phase.failedAt = at;
  phase.failure = clone(failure ?? { code: "UNKNOWN", message: "Phase failed." });
  const failedAttempt = activeAttemptRecord(phase);
  if (failedAttempt) {
    failedAttempt.status = "failed";
    failedAttempt.finishedAt = at;
    failedAttempt.failure = clone(phase.failure);
  }
  draft.status = "failed_gate";
  appendEvent(draft, "phase.failed", { phaseId, failure: phase.failure }, { now: at, idempotencyKey });
  draft.updatedAt = at;
  rememberIdempotency(draft, idempotencyKey, operationInput);
  return draft;
}

export function reopenPhaseFromFailure(
  state,
  {
    failedPhaseId,
    responsiblePhaseId,
    reason = "downstream_failure",
  } = {},
  { now, idempotencyKey } = {},
) {
  assertRunState(state);
  const failedDefinition = PHASE_BY_ID[failedPhaseId];
  const responsibleDefinition = PHASE_BY_ID[responsiblePhaseId];
  invariant(failedDefinition, "UNKNOWN_PHASE", `Unknown failed phase: ${failedPhaseId}`);
  invariant(responsibleDefinition, "UNKNOWN_PHASE", `Unknown responsible phase: ${responsiblePhaseId}`);
  invariant(
    responsibleDefinition.order <= failedDefinition.order,
    "INVALID_REOPEN_CAUSE",
    "A failure cannot reopen a phase downstream of the failed phase.",
    { failedPhaseId, responsiblePhaseId },
  );
  const failure = state.phases[failedPhaseId].failure;
  const operationInput = {
    operation: "phase.reopen",
    failedPhaseId,
    responsiblePhaseId,
    reason,
    failureCode: failure?.code ?? null,
  };
  if (checkIdempotency(state, idempotencyKey, operationInput)) return state;
  invariant(
    state.phases[failedPhaseId].status === "failed" && failure,
    "INVALID_REOPEN_CAUSE",
    `${failedPhaseId} must retain a failed attempt before causal reopening.`,
  );
  invariant(
    !failure.rootCause?.phaseId || failure.rootCause.phaseId === responsiblePhaseId,
    "INVALID_REOPEN_CAUSE",
    "The requested responsible phase does not match the recorded root cause.",
    { recordedPhaseId: failure.rootCause?.phaseId, responsiblePhaseId },
  );
  assertRunMutable(state);
  const at = timestamp(now);
  const draft = clone(state);
  const affected = markDependentStateStale(draft, {
    kind: responsibleDefinition.outputKind,
    phaseId: responsiblePhaseId,
    includeSource: true,
    reason,
    now: at,
    excludeActiveSource: false,
  });
  const responsible = draft.phases[responsiblePhaseId];
  if (!Array.isArray(responsible.reopenHistory)) responsible.reopenHistory = [];
  responsible.reopenHistory.push({
    failedPhaseId,
    responsiblePhaseId,
    failureCode: failure.code ?? null,
    reason,
    reopenedAt: at,
    priorAttempt: responsible.attempt,
  });
  draft.status = "active";
  draft.currentPhase = responsiblePhaseId;
  draft.currentLayer = responsibleDefinition.layer;
  draft.terminalReason = null;
  appendEvent(
    draft,
    "phase.reopened",
    {
      failedPhaseId,
      responsiblePhaseId,
      failureCode: failure.code ?? null,
      reason,
      invalidatedPhaseIds: affected.invalidatedPhaseIds,
      staleEvidenceIds: affected.staleEvidenceIds,
    },
    { now: at, idempotencyKey },
  );
  draft.updatedAt = at;
  rememberIdempotency(draft, idempotencyKey, operationInput);
  return draft;
}

export function completePhase(state, phaseId, { now, idempotencyKey } = {}) {
  assertRunState(state);
  const phaseDefinition = PHASE_BY_ID[phaseId];
  invariant(phaseDefinition, "UNKNOWN_PHASE", `Unknown phase: ${phaseId}`);
  const operationInput = { operation: "phase.complete", phaseId };
  if (checkIdempotency(state, idempotencyKey, operationInput)) return state;
  if (state.phases[phaseId].status === "passed") return state;
  assertRunMutable(state);
  invariant(state.phases[phaseId].status === "active", "PHASE_NOT_ACTIVE", `${phaseId} must be active before completion.`);
  const preconditionFailures = validatePhasePreconditions(state, phaseId);
  const gateFailures = phaseDefinition.gates.filter((gateId) => !gateResultIsCurrent(state, phaseId, gateId));
  invariant(
    preconditionFailures.length === 0 && gateFailures.length === 0,
    "PHASE_GATE_BLOCKED",
    `${phaseId} cannot pass until every hard gate has current passing evidence.`,
    { preconditionFailures, gateFailures },
  );
  if (phaseId === "P10") {
    const decision = releaseDecision(state, { evaluatedAt: timestamp(now) });
    invariant(decision.decision === "pass", "RELEASE_BLOCKED", "Release readiness failed.", { decision });
  }
  const at = timestamp(now);
  const draft = clone(state);
  draft.phases[phaseId].status = "passed";
  draft.phases[phaseId].completedAt = at;
  const completedAttempt = activeAttemptRecord(draft.phases[phaseId]);
  if (completedAttempt) {
    completedAttempt.status = "passed";
    completedAttempt.finishedAt = at;
  }
  draft.status = "active";
  appendEvent(draft, "phase.completed", { phaseId }, { now: at, idempotencyKey });

  if (phaseId === "I0") {
    draft.status = "specified";
    appendEvent(draft, "run.specified", { phaseId }, { now: at, idempotencyKey });
    if (draft.mode === "manifest_only") {
      draft.terminalReason = "manifest_only_complete";
      finishRun(draft, "success", {
        now: at,
        workflowStatus: "specified",
        evidenceIds: Object.keys(draft.evidence),
      });
    }
  } else if (phaseId === "P6") {
    draft.status = "planned";
    appendEvent(draft, "run.planned", { phaseId }, { now: at, idempotencyKey });
    if (draft.mode === "plan_only") {
      draft.terminalReason = "plan_only_complete";
      finishRun(draft, "success", {
        now: at,
        workflowStatus: "planned",
        evidenceIds: Object.keys(draft.evidence),
      });
    }
  } else if (phaseId === "P10") {
    draft.status = "completed";
    draft.terminalReason = "release_passed";
    appendEvent(draft, "run.completed", { phaseId }, { now: at, idempotencyKey });
    finishRun(draft, "success", {
      now: at,
      workflowStatus: "completed",
      evidenceIds: Object.keys(draft.evidence),
    });
  }
  draft.updatedAt = at;
  rememberIdempotency(draft, idempotencyKey, operationInput);
  return draft;
}

export function invalidateDownstream(
  state,
  { artifactId, kind, phaseId, includeSource = false, reason = "upstream_changed" } = {},
  { now, idempotencyKey } = {},
) {
  assertRunState(state);
  const artifact = artifactId ? state.artifacts[artifactId] : null;
  const resolvedKind = kind ?? artifact?.kind ?? PHASE_BY_ID[phaseId]?.outputKind;
  const resolvedPhaseId = phaseId ?? artifact?.phaseId ?? PHASES.find((entry) => entry.outputKind === resolvedKind)?.id;
  invariant(ARTIFACT_KINDS.includes(resolvedKind), "INVALID_INVALIDATION_SOURCE", "A valid artifact source is required.");
  const operationInput = {
    operation: "workflow.invalidate",
    artifactId,
    kind: resolvedKind,
    phaseId: resolvedPhaseId,
    includeSource,
    reason,
  };
  if (checkIdempotency(state, idempotencyKey, operationInput)) return state;
  assertRunMutable(state);
  const at = timestamp(now);
  const draft = clone(state);
  const affected = markDependentStateStale(draft, {
    kind: resolvedKind,
    phaseId: resolvedPhaseId,
    includeSource,
    reason,
    now: at,
    excludeActiveSource: false,
  });
  if (
    affected.affectedArtifactIds.length === 0 &&
    affected.staleEvidenceIds.length === 0 &&
    affected.invalidatedPhaseIds.length === 0
  ) {
    return state;
  }
  draft.updatedAt = at;
  rememberIdempotency(draft, idempotencyKey, operationInput);
  return draft;
}

export function registerSource(state, source, { now, idempotencyKey } = {}) {
  assertRunState(state);
  invariant(source && typeof source === "object", "INVALID_SOURCE", "Source is required.");
  invariant(typeof source.id === "string" && source.id, "SOURCE_ID_REQUIRED", "Source id is required.");
  const operationInput = { operation: "source.register", source };
  if (checkIdempotency(state, idempotencyKey, operationInput)) return state;
  assertRunMutable(state);
  const existing = state.sources[source.id];
  if (existing && sameValue(existing.data, source)) return state;
  const at = timestamp(now);
  const draft = clone(state);
  draft.sources[source.id] = {
    id: source.id,
    trust: source.trust === "trusted" ? "trusted" : "untrusted",
    data: clone(source),
    registeredAt: existing?.registeredAt ?? at,
    updatedAt: at,
  };
  appendEvent(
    draft,
    "run.updated",
    { section: "sources", sourceId: source.id, trust: draft.sources[source.id].trust },
    { now: at, idempotencyKey },
  );
  draft.updatedAt = at;
  rememberIdempotency(draft, idempotencyKey, operationInput);
  return draft;
}

export function recordFinding(state, finding, { now, idempotencyKey } = {}) {
  assertRunState(state);
  invariant(finding && typeof finding === "object", "INVALID_FINDING", "Finding is required.");
  invariant(typeof finding.id === "string" && finding.id, "FINDING_ID_REQUIRED", "Finding id is required.");
  invariant(FINDING_SEVERITIES.includes(finding.severity), "INVALID_FINDING_SEVERITY", `Invalid severity: ${finding.severity}`);
  const operationInput = { operation: "finding.record", finding };
  if (checkIdempotency(state, idempotencyKey, operationInput)) return state;
  assertRunMutable(state);
  const existing = state.findings[finding.id];
  if (existing && sameValue({ ...existing, recordedAt: undefined }, { ...finding, status: finding.status ?? "open", recordedAt: undefined })) {
    return state;
  }
  invariant(!existing, "FINDING_ID_CONFLICT", `Finding ${finding.id} already exists.`);
  const at = timestamp(now);
  const draft = clone(state);
  draft.findings[finding.id] = {
    ...clone(finding),
    status: finding.status ?? "open",
    recordedAt: at,
    resolvedAt: finding.status === "resolved" ? at : null,
  };
  invariant(FINDING_STATUS.includes(draft.findings[finding.id].status), "INVALID_FINDING_STATUS", "Invalid finding status.");
  appendEvent(
    draft,
    "run.updated",
    { section: "findings", findingId: finding.id, severity: finding.severity, status: draft.findings[finding.id].status },
    { now: at, idempotencyKey },
  );
  draft.updatedAt = at;
  rememberIdempotency(draft, idempotencyKey, operationInput);
  return draft;
}

export function resolveFinding(state, findingId, { resolution, now, idempotencyKey } = {}) {
  assertRunState(state);
  const finding = state.findings[findingId];
  invariant(finding, "UNKNOWN_FINDING", `Unknown finding: ${findingId}`);
  const operationInput = { operation: "finding.resolve", findingId, resolution };
  if (checkIdempotency(state, idempotencyKey, operationInput)) return state;
  assertRunMutable(state);
  if (finding.status === "resolved" && sameValue(finding.resolution, resolution ?? null)) return state;
  const at = timestamp(now);
  const draft = clone(state);
  draft.findings[findingId].status = "resolved";
  draft.findings[findingId].resolution = clone(resolution ?? null);
  draft.findings[findingId].resolvedAt = at;
  appendEvent(
    draft,
    "run.updated",
    { section: "findings", findingId, status: "resolved" },
    { now: at, idempotencyKey },
  );
  draft.updatedAt = at;
  rememberIdempotency(draft, idempotencyKey, operationInput);
  return draft;
}

export function validatePortableArtifact(stateOrArtifact) {
  const artifact = stateOrArtifact?.schemaVersion
    ? currentArtifactForKind(stateOrArtifact, "production")
    : stateOrArtifact;
  const reasons = [];
  if (!artifact || artifact.stale) reasons.push("current_production_artifact_missing");
  const files = artifact?.files ?? [];
  const indexFiles = files.filter(({ path }) => String(path).replaceAll("\\", "/").split("/").pop() === "index.html");
  const html = artifact?.data ?? artifact?.content;
  if (files.length !== 1 || indexFiles.length !== 1) reasons.push("exactly_one_index_html_required");
  if (typeof html !== "string" || !/<html(?:\s|>)/i.test(html) || !/<\/html>/i.test(html)) {
    reasons.push("index_content_missing");
  }
  if (artifact?.metadata?.selfContained !== true) reasons.push("index_not_self_contained");
  if (artifact?.metadata?.networkRequired !== false) reasons.push("network_required");
  if (
    !Array.isArray(artifact?.metadata?.externalRuntimeResources) ||
    artifact.metadata.externalRuntimeResources.length > 0
  ) {
    reasons.push("external_runtime_resources_present");
  }
  if (typeof html === "string") {
    const resourceAttribute = /<(?:script|img|iframe|audio|video|source|embed|object|link)\b[^>]*(?:src|href|poster|data)\s*=\s*["'](?!data:|blob:|#)[^"']+["']/i;
    const runnableNetworkApi = /\b(?:fetch\s*\(|XMLHttpRequest\b|WebSocket\s*\(|EventSource\s*\(|sendBeacon\s*\(|importScripts\s*\()/;
    const scriptRuntimeReference = /\b(?:import\s*\(|new\s+(?:Worker|SharedWorker)\s*\()\s*["'](?!data:|blob:)[^"']+["']/;
    const runnableBodies = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)]
      .filter((match) => !/\btype\s*=\s*["'](?:application\/(?:json|ld\+json)|importmap|speculationrules)["']/i.test(match[1]))
      .map((match) => match[2]);
    const styleBodies = [
      ...[...html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)].map((match) => match[1]),
      ...[...html.matchAll(/\sstyle\s*=\s*["']([^"']*)["']/gi)].map((match) => match[1]),
    ];
    const hasCssRuntimeReference = styleBodies.some((body) =>
      [...body.matchAll(/(?:@import\s+(?:url\(\s*)?|url\(\s*)["']?([^)"'\s;]+)/gi)].some(
        (match) => !/^(?:data:|blob:|#)/i.test(match[1]),
      ),
    );
    if (
      resourceAttribute.test(html) ||
      hasCssRuntimeReference ||
      runnableBodies.some((body) => scriptRuntimeReference.test(body))
    ) {
      reasons.push("external_runtime_resources_present");
    }
    if (runnableBodies.some((body) => runnableNetworkApi.test(body))) reasons.push("network_required");
  }
  const normalizedReasons = [...new Set(reasons)];
  return {
    valid: normalizedReasons.length === 0,
    reasons: normalizedReasons,
    artifactId: artifact?.id ?? null,
    artifactHash: artifact?.hash ?? null,
  };
}

function countOpenFindings(state) {
  const counts = Object.fromEntries(FINDING_SEVERITIES.map((severity) => [severity, 0]));
  for (const finding of Object.values(state.findings)) {
    if (finding.status === "open") counts[finding.severity] += 1;
  }
  return counts;
}

export function releaseDecision(state, { evaluatedAt } = {}) {
  assertRunState(state);
  const requiredGateResults = [];
  for (const phaseId of phaseIdsForMode(state.mode)) {
    for (const gateId of PHASE_BY_ID[phaseId].gates) {
      const result = state.gateResults[`${phaseId}:${gateId}`] ?? null;
      requiredGateResults.push({
        phaseId,
        gateId,
        status: result?.status ?? "missing",
        current: gateResultIsCurrent(state, phaseId, gateId),
        evidenceIds: clone(result?.evidenceIds ?? []),
        reasons: clone(result?.reasons ?? ["missing_evidence"]),
      });
    }
  }
  const staleEvidenceIds = Object.values(state.evidence)
    .filter((entry) => !isEvidenceFresh(state, entry))
    .map(({ id }) => id)
    .sort();
  const notRunChecks = Object.values(state.evidence)
    .filter(({ status }) => status === "not_run")
    .map(({ id, critical, phaseId, gateId }) => ({ id, critical, phaseId, gateId }))
    .sort((left, right) => left.id.localeCompare(right.id));
  const openFindingsBySeverity = countOpenFindings(state);
  const portable = validatePortableArtifact(state);
  const requiredPhaseIds = phaseIdsForMode(state.mode);
  const incompletePhases = requiredPhaseIds
    .filter((id) => id !== "P10")
    .filter((id) => state.phases[id].status !== "passed");
  const blockingReasons = [];
  if (state.mode !== "plan_then_build") blockingReasons.push("release_requires_plan_then_build_mode");
  if (requiredGateResults.some(({ current }) => !current)) blockingReasons.push("hard_gates_not_current");
  if (incompletePhases.length > 0) blockingReasons.push(`incomplete_phases:${incompletePhases.join(",")}`);
  if (!portable.valid) blockingReasons.push(...portable.reasons);
  if (openFindingsBySeverity.blocker > 0 || openFindingsBySeverity.major > 0) {
    blockingReasons.push("blocker_or_major_findings_open");
  }
  if (notRunChecks.some(({ critical }) => critical !== false)) blockingReasons.push("critical_checks_not_run");
  const evidenceRefs = [...new Set(requiredGateResults.flatMap(({ evidenceIds }) => evidenceIds))].sort();
  return {
    decision: blockingReasons.length === 0 ? "pass" : "fail",
    runId: state.runId,
    artifactHash: portable.artifactHash,
    evaluatedAt: evaluatedAt ?? timestamp(),
    requiredGateResults,
    openFindingsBySeverity,
    staleEvidenceIds,
    notRunChecks,
    residualRisks: clone(state.residualRisks),
    limitations: clone(state.limitations),
    evidenceRefs,
    terminalStatus: blockingReasons.length === 0 ? "completed" : "failed_gate",
    blockingReasons: [...new Set(blockingReasons)],
  };
}

export const COMMAND_TYPES = Object.freeze([
  "intent.patch",
  "design.propose",
  "design.select",
  "input.request",
  "phase.start",
  "phase.fail",
  "phase.reopen",
  "phase.complete",
  "artifact.record",
  "evidence.record",
  "gate.evaluate",
  "workflow.invalidate",
  "source.register",
  "finding.record",
  "finding.resolve",
  "release.decide",
]);

export function applyCommand(state, command, options = {}) {
  assertRunState(state);
  invariant(command && typeof command === "object", "INVALID_COMMAND", "Command is required.");
  const payload = command.payload ?? command;
  const retryKey = command.idempotencyKey ?? payload.idempotencyKey ?? options.idempotencyKey;
  if (command.expectedStateVersion !== undefined && !state.idempotency[retryKey]) {
    invariant(
      Number.isInteger(command.expectedStateVersion) && command.expectedStateVersion === state.stateVersion,
      "STATE_VERSION_CONFLICT",
      `Expected state version ${command.expectedStateVersion}; current version is ${state.stateVersion}.`,
      { expectedStateVersion: command.expectedStateVersion, currentStateVersion: state.stateVersion },
    );
  }
  const commandOptions = {
    ...options,
    ...(payload.meta ?? {}),
    idempotencyKey: retryKey,
  };
  let nextState;
  let result;
  switch (command.type) {
    case "intent.patch":
      nextState = patchIntentManifest(state, payload.patch, {
        ...commandOptions,
        origin: payload.origin ?? commandOptions.origin,
        confidence: payload.confidence ?? commandOptions.confidence,
        evidenceRefs: payload.evidenceRefs ?? commandOptions.evidenceRefs,
      });
      break;
    case "design.propose":
      nextState = proposeDesignOptions(state, payload.options, commandOptions);
      break;
    case "design.select":
      nextState = selectDesign(state, payload.selection, {
        ...commandOptions,
        selectedBy: payload.selectedBy ?? commandOptions.selectedBy,
      });
      result = clone(nextState.design.selection);
      break;
    case "input.request":
      nextState = requestInput(state, payload.request, commandOptions);
      result = clone(nextState.pendingDecision);
      break;
    case "phase.start":
      nextState = startPhase(state, payload.phaseId, commandOptions);
      break;
    case "phase.fail":
      nextState = failPhase(state, payload.phaseId, payload.failure, commandOptions);
      break;
    case "phase.reopen":
      nextState = reopenPhaseFromFailure(state, payload.reopen, commandOptions);
      break;
    case "phase.complete":
      nextState = completePhase(state, payload.phaseId, commandOptions);
      break;
    case "artifact.record":
      nextState = recordArtifact(state, payload.artifact, commandOptions);
      result = clone(nextState.artifacts[payload.artifact?.id] ?? null);
      break;
    case "evidence.record":
      nextState = recordEvidence(state, payload.evidence, commandOptions);
      result = clone(nextState.evidence[payload.evidence?.id] ?? null);
      break;
    case "gate.evaluate":
      nextState = evaluatePhaseGate(state, payload.gate, commandOptions);
      result = clone(
        nextState.gateResults[`${payload.gate?.phaseId}:${payload.gate?.gateId}`] ?? null,
      );
      break;
    case "workflow.invalidate":
      nextState = invalidateDownstream(state, payload.source, commandOptions);
      break;
    case "source.register":
      nextState = registerSource(state, payload.source, commandOptions);
      result = clone(nextState.sources[payload.source?.id] ?? null);
      break;
    case "finding.record":
      nextState = recordFinding(state, payload.finding, commandOptions);
      result = clone(nextState.findings[payload.finding?.id] ?? null);
      break;
    case "finding.resolve":
      nextState = resolveFinding(state, payload.findingId, {
        ...commandOptions,
        resolution: payload.resolution,
      });
      result = clone(nextState.findings[payload.findingId] ?? null);
      break;
    case "release.decide":
      nextState = state;
      result = releaseDecision(state, { evaluatedAt: payload.evaluatedAt ?? commandOptions.now });
      break;
    default:
      throw new WorkflowError("UNKNOWN_COMMAND", `Unknown workflow command: ${command.type}`);
  }
  const events = nextState.events.slice(state.events.length).map(clone);
  return {
    state: nextState,
    events,
    ...(result === undefined ? {} : { result }),
  };
}

export function validateEventLog(state) {
  assertRunState(state);
  const errors = [];
  if (!Array.isArray(state.resume)) {
    errors.push("resume must be an array");
  } else {
    const resumeIds = [];
    state.resume.forEach((entry, index) => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
        errors.push(`resume[${index}] must be an object`);
        return;
      }
      if (typeof entry.interruptId !== "string" || !entry.interruptId.trim()) {
        errors.push(`resume[${index}].interruptId is required`);
      } else {
        resumeIds.push(entry.interruptId);
      }
      if (!Object.hasOwn(entry, "value")) errors.push(`resume[${index}].value is required`);
    });
    if (new Set(resumeIds).size !== resumeIds.length) {
      errors.push("resume interruptIds must be unique");
    }
  }
  if (!Array.isArray(state.events) || state.events.length === 0) {
    errors.push("event log must contain an initial run.created event");
    return { valid: false, errors };
  }
  state.events.forEach((event, index) => {
    const expected = index + 1;
    if (event.seq !== expected) errors.push(`event ${event.id} has seq ${event.seq}; expected ${expected}`);
    if (event.stateVersion !== expected) {
      errors.push(`event ${event.id} has stateVersion ${event.stateVersion}; expected ${expected}`);
    }
    if (event.id !== `${state.runId}:${expected}`) {
      errors.push(`event ${event.id} has an invalid canonical id; expected ${state.runId}:${expected}`);
    }
    if (event.runId !== state.runId) {
      errors.push(`event ${event.id} has runId ${event.runId}; expected ${state.runId}`);
    }
    if (!isCanonicalTimestamp(event.occurredAt)) {
      errors.push(`event ${event.id} has an invalid occurredAt timestamp`);
    }
    if (index > 0 && event.occurredAt < state.events[index - 1].occurredAt) {
      errors.push(`event ${event.id} occurred before the preceding event`);
    }
    if (!PHASE_EVENT_TYPES.includes(event.type)) errors.push(`event ${event.id} has unknown type ${event.type}`);
  });
  const first = state.events[0];
  if (first.type !== "run.created") errors.push("event log does not start with run.created");
  if (state.events.slice(1).some(({ type }) => type === "run.created")) {
    errors.push("event log contains more than one run.created event");
  }
  if (first.occurredAt !== state.createdAt) errors.push("createdAt does not match the run.created event");
  for (const field of ["schemaVersion", "mode", "threadId", "parentRunId", "resume"]) {
    if (!sameValue(first.payload?.[field], state[field])) {
      errors.push(`run.created payload ${field} does not match canonical state`);
    }
  }
  if (state.eventCursor !== state.events.length) errors.push("eventCursor does not match event count");
  if (state.stateVersion !== state.events.length) errors.push("stateVersion does not match event count");
  const finishedEvents = state.events.filter(({ type }) => type === "run.finished");
  if (state.terminalOutcome) {
    const finished = finishedEvents[0];
    if (finishedEvents.length !== 1 || state.events.at(-1)?.type !== "run.finished") {
      errors.push("terminal run must end with exactly one run.finished event");
    }
    if (finished?.payload?.outcome !== state.terminalOutcome) {
      errors.push("run.finished outcome does not match terminalOutcome");
    }
    if (finished?.payload?.finalRevision !== state.stateVersion) {
      errors.push("run.finished finalRevision does not match stateVersion");
    }
    if (state.executionStatus !== state.terminalOutcome) {
      errors.push("executionStatus does not match terminalOutcome");
    }
    if (finished?.occurredAt !== state.finishedAt) {
      errors.push("finishedAt does not match the run.finished event");
    }
    if (state.terminalOutcome === "interrupt") {
      if (state.status !== "awaiting_user" || !state.pendingDecision) {
        errors.push("interrupted run must remain awaiting_user with a pending decision");
      }
    }
    if (state.terminalOutcome === "success") {
      const expectedStatus = {
        manifest_only: "specified",
        plan_only: "planned",
        plan_then_build: "completed",
      }[state.mode];
      if (state.status !== expectedStatus || finished?.payload?.workflowStatus !== expectedStatus) {
        errors.push("successful run status does not match its mode and run.finished workflowStatus");
      }
      if (state.pendingDecision) errors.push("successful run cannot retain a pending decision");
    }
  } else {
    if (finishedEvents.length > 0) errors.push("nonterminal run contains a run.finished event");
    if (state.finishedAt !== null) errors.push("nonterminal run has a finishedAt timestamp");
    if (state.executionStatus !== "running") errors.push("nonterminal run must have running executionStatus");
    if (state.status === "completed") errors.push("nonterminal run cannot claim completed status");
  }
  if (state.updatedAt !== state.events.at(-1)?.occurredAt) {
    errors.push("updatedAt does not match the final event timestamp");
  }
  return { valid: errors.length === 0, errors };
}

export { SCHEMA_VERSION };
