#!/usr/bin/env node

// packages/mcp-server/server.mjs
import { createHash as createHash2, randomUUID } from "node:crypto";
import { existsSync as existsSync2, readFileSync as readFileSync2 } from "node:fs";
import path2 from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  registerAppResource,
  registerAppTool,
  RESOURCE_MIME_TYPE
} from "@modelcontextprotocol/ext-apps/server";
import { z } from "zod";

// packages/workflow-engine/canonical.mjs
import { createHash } from "node:crypto";
function normalize(value) {
  if (value === null || typeof value !== "object") return value;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(normalize);
  return Object.fromEntries(
    Object.keys(value).sort().map((key) => [key, normalize(value[key])])
  );
}
function stableStringify(value) {
  return JSON.stringify(normalize(value));
}
function hashValue(value) {
  const input = typeof value === "string" || Buffer.isBuffer(value) ? value : stableStringify(value);
  return `sha256:${createHash("sha256").update(input).digest("hex")}`;
}
function sameValue(a, b) {
  return stableStringify(a) === stableStringify(b);
}
function clone(value) {
  return structuredClone(value);
}

// packages/workflow-engine/phases.mjs
var PHASE_STATUS = Object.freeze([
  "not_started",
  "active",
  "awaiting_user",
  "failed",
  "passed",
  "stale",
  "skipped"
]);
var RUN_STATUS = Object.freeze([
  "draft",
  "active",
  "awaiting_user",
  "failed_gate",
  "blocked_external",
  "specified",
  "planned",
  "completed"
]);
var RUN_MODES = Object.freeze(["manifest_only", "plan_only", "plan_then_build"]);
var EVIDENCE_STATUS = Object.freeze([
  "pass",
  "fail",
  "partial",
  "not_run",
  "not_applicable"
]);
var DESIGN_SELECTION_METHODS = Object.freeze([
  "user-selected",
  "user-hybridized",
  "recommended-default",
  "delegated",
  "direct"
]);
var INTENT_ORIGINS = Object.freeze([
  "user",
  "researched",
  "inferred",
  "defaulted"
]);
var REQUIRED_INTENT_FIELDS = Object.freeze([
  "topic",
  "learner",
  "depth",
  "duration",
  "scope"
]);
var AUTHORITATIVE_INTENT_ORIGINS = Object.freeze(["user", "researched"]);
var PHASES = Object.freeze([
  {
    id: "I0",
    order: 0,
    layer: "intent",
    name: "Intent and design",
    outputKind: "intent",
    gates: [
      "intent.required_fields_authoritative",
      "intent.no_critical_conflicts",
      "design.selection_valid"
    ]
  },
  {
    id: "P0",
    order: 1,
    layer: "planning",
    name: "Charter",
    outputKind: "charter",
    gates: ["charter.topic_learner_alignment", "charter.scope_feasible"]
  },
  {
    id: "P1",
    order: 2,
    layer: "planning",
    name: "Research",
    outputKind: "research",
    gates: ["research.claims_supported", "research.citations_checked"]
  },
  {
    id: "P2",
    order: 3,
    layer: "planning",
    name: "Learning architecture",
    outputKind: "learning",
    gates: ["learning.objective_traceability"]
  },
  {
    id: "P3",
    order: 4,
    layer: "planning",
    name: "Information architecture",
    outputKind: "ia",
    gates: ["ia.concept_homes", "ia.hierarchy_coherent"]
  },
  {
    id: "P4",
    order: 5,
    layer: "planning",
    name: "Interaction design",
    outputKind: "interactions",
    gates: ["interaction.objective_mapping", "interaction.state_accessibility_tests"]
  },
  {
    id: "P5",
    order: 6,
    layer: "planning",
    name: "Product design",
    outputKind: "visual",
    gates: [
      "visual.selected_direction_operationalized",
      "visual.accessible_responsive_coherent"
    ]
  },
  {
    id: "P6",
    order: 7,
    layer: "planning",
    name: "Technical architecture",
    outputKind: "technical-plan",
    gates: ["architecture.single_file_offline", "architecture.deterministic_init_keyboard"]
  },
  {
    id: "P7",
    order: 8,
    layer: "build",
    name: "Implementation",
    outputKind: "production",
    gates: [
      "implementation.no_placeholders",
      "implementation.content_visual_feedback_consistency",
      "implementation.controls_work"
    ]
  },
  {
    id: "P8",
    order: 9,
    layer: "build",
    name: "Verification",
    outputKind: "verification",
    gates: [
      "verification.critical_checks_executed",
      "verification.unavailable_marked_not_run"
    ]
  },
  {
    id: "P9",
    order: 10,
    layer: "build",
    name: "Adversarial repair",
    outputKind: "adversarial",
    gates: ["adversarial.no_blocker_or_major", "adversarial.regressions_rerun"]
  },
  {
    id: "P10",
    order: 11,
    layer: "release",
    name: "Release",
    outputKind: "release",
    gates: [
      "release.all_hard_gates_current",
      "release.portable_index",
      "release.no_major_findings"
    ]
  }
]);
var PHASE_IDS = Object.freeze(PHASES.map(({ id }) => id));
var PHASE_BY_ID = Object.freeze(Object.fromEntries(PHASES.map((phase) => [phase.id, phase])));
var ARTIFACT_KINDS = Object.freeze(PHASES.map(({ outputKind }) => outputKind));
var ARTIFACT_DEPENDENCIES = Object.freeze(
  Object.fromEntries(
    PHASES.map((phase, index) => [
      phase.outputKind,
      index === 0 ? [] : [PHASES[index - 1].outputKind]
    ])
  )
);
var PHASE_EVENT_TYPES = Object.freeze([
  "run.created",
  "run.updated",
  "phase.started",
  "phase.completed",
  "phase.failed",
  "phase.invalidated",
  "gate.evaluated",
  "artifact.updated",
  "input.requested",
  "design.options.proposed",
  "design.selected",
  "verification.recorded",
  "run.specified",
  "run.planned",
  "run.completed"
]);
function phaseIdsForMode(mode) {
  if (mode === "manifest_only") return ["I0"];
  if (mode === "plan_only") return PHASE_IDS.slice(0, PHASE_IDS.indexOf("P6") + 1);
  if (mode === "plan_then_build") return [...PHASE_IDS];
  return [];
}
function downstreamArtifactKinds(kind, { includeSource = false } = {}) {
  const index = ARTIFACT_KINDS.indexOf(kind);
  if (index < 0) return [];
  return ARTIFACT_KINDS.slice(includeSource ? index : index + 1);
}
function downstreamPhaseIds(phaseId, { includeSource = false } = {}) {
  const index = PHASE_IDS.indexOf(phaseId);
  if (index < 0) return [];
  return PHASE_IDS.slice(includeSource ? index : index + 1);
}

// packages/workflow-engine/errors.mjs
var WorkflowError = class extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "WorkflowError";
    this.code = code;
    this.details = details;
  }
};
function invariant(condition, code, message, details = {}) {
  if (!condition) throw new WorkflowError(code, message, details);
}

// packages/workflow-engine/engine.mjs
var SCHEMA_VERSION = "1.0.0";
var FINDING_SEVERITIES = ["blocker", "major", "minor", "nit"];
var FINDING_STATUS = ["open", "resolved"];
function timestamp(now) {
  if (typeof now === "function") return now();
  if (typeof now === "string") return now;
  if (now instanceof Date) return now.toISOString();
  return (/* @__PURE__ */ new Date()).toISOString();
}
function assertRunState(state) {
  invariant(state && typeof state === "object", "INVALID_RUN_STATE", "A run state is required.");
  invariant(state.schemaVersion === SCHEMA_VERSION, "UNSUPPORTED_SCHEMA", "Unsupported run schema.", {
    expected: SCHEMA_VERSION,
    actual: state.schemaVersion
  });
}
function appendEvent(draft, type, payload, { now, idempotencyKey } = {}) {
  invariant(PHASE_EVENT_TYPES.includes(type), "UNKNOWN_EVENT_TYPE", `Unknown workflow event: ${type}`);
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
    occurredAt: timestamp(now),
    ...idempotencyKey ? { idempotencyKey } : {},
    payload: clone(payload ?? {})
  });
}
function idempotencyFingerprint(value) {
  return hashValue(value);
}
function checkIdempotency(state, idempotencyKey, input) {
  if (!idempotencyKey) return false;
  const existing = state.idempotency[idempotencyKey];
  if (!existing) return false;
  const fingerprint2 = idempotencyFingerprint(input);
  invariant(
    existing.fingerprint === fingerprint2,
    "IDEMPOTENCY_CONFLICT",
    `Idempotency key ${idempotencyKey} was already used with different input.`,
    { idempotencyKey }
  );
  return true;
}
function rememberIdempotency(draft, idempotencyKey, input) {
  if (!idempotencyKey) return;
  draft.idempotency[idempotencyKey] = {
    fingerprint: idempotencyFingerprint(input),
    stateVersion: draft.stateVersion
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
    evidenceRefs: clone(supplied.evidenceRefs ?? defaults.evidenceRefs ?? [])
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
    outputArtifactId: null
  };
}
function createRunState({
  runId,
  mode = "plan_then_build",
  intent = {},
  designRequired = true,
  permissions = {},
  residualRisks = [],
  limitations = [],
  now
} = {}) {
  invariant(typeof runId === "string" && runId.trim(), "RUN_ID_REQUIRED", "runId is required.");
  invariant(RUN_MODES.includes(mode), "INVALID_RUN_MODE", `Invalid run mode: ${mode}`);
  const createdAt = timestamp(now);
  const intentFields = Object.fromEntries(
    Object.entries(intent).map(([key, value]) => [
      key,
      normalizeIntentField(value, {
        origin: value?.origin ?? "user",
        confidence: value?.confidence ?? 1,
        updatedAt: createdAt,
        evidenceRefs: value?.evidenceRefs ?? []
      })
    ])
  );
  const state = {
    schemaVersion: SCHEMA_VERSION,
    runId,
    mode,
    status: "draft",
    currentLayer: "intent",
    currentPhase: "I0",
    stateVersion: 0,
    eventCursor: 0,
    terminalReason: null,
    createdAt,
    updatedAt: createdAt,
    phases: Object.fromEntries(PHASES.map((phase) => [phase.id, phaseRecord(phase)])),
    intent: {
      fields: intentFields,
      conflicts: []
    },
    design: {
      requiresOptions: Boolean(designRequired),
      options: [],
      recommendationId: null,
      selection: null,
      finalVisualDirection: null,
      rejectedOptionIds: []
    },
    pendingDecision: null,
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
    idempotency: {}
  };
  appendEvent(state, "run.created", { mode, schemaVersion: SCHEMA_VERSION }, { now: createdAt });
  state.updatedAt = createdAt;
  return state;
}
function openCriticalConflicts(state) {
  return state.intent.conflicts.filter(
    (conflict) => conflict.severity === "critical" && conflict.status === "open"
  );
}
function getMissingIntentFields(state) {
  assertRunState(state);
  return REQUIRED_INTENT_FIELDS.filter((field) => {
    const entry = state.intent.fields[field];
    return !entry || entry.value === void 0 || entry.value === null || entry.value === "";
  });
}
function getUnauthoritativeIntentFields(state) {
  assertRunState(state);
  return REQUIRED_INTENT_FIELDS.filter((field) => {
    const entry = state.intent.fields[field];
    return !entry || !entry.locked || !AUTHORITATIVE_INTENT_ORIGINS.includes(entry.origin) || entry.value === void 0 || entry.value === null || entry.value === "";
  });
}
function requiredIntentQuestions(state) {
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
function markDependentStateStale(draft, { kind, phaseId, includeSource = false, reason, now, excludeActiveSource = true }) {
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
    (evidence) => affectedArtifactIds.includes(evidence.artifactId) || affectedKinds.includes(evidence.artifactKind),
    reason
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
        { now }
      );
    }
  }
  if (invalidatedPhaseIds.length > 0 && ["specified", "planned", "completed"].includes(draft.status)) {
    draft.status = "active";
    draft.terminalReason = null;
  }
  return { affectedArtifactIds, staleEvidenceIds, invalidatedPhaseIds };
}
function patchIntentManifest(state, patch, { origin = "inferred", confidence = 0.5, evidenceRefs = [], now, idempotencyKey } = {}) {
  assertRunState(state);
  invariant(patch && typeof patch === "object" && !Array.isArray(patch), "INVALID_INTENT_PATCH", "Intent patch must be an object.");
  const operationInput = { operation: "intent.patch", patch, origin, confidence, evidenceRefs };
  if (checkIdempotency(state, idempotencyKey, operationInput)) return state;
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
      evidenceRefs
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
              resolvedAt: null
            };
            draft.intent.conflicts.push(conflict);
            createdConflicts.push(id);
          }
        }
        continue;
      }
    }
    if (existing && incoming.origin === "defaulted" && existing.origin !== "defaulted" && existing.value !== void 0 && existing.value !== null) {
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
  const decisionResolved = requestedFields.length > 0 && requestedFields.every((field) => {
    const entry = draft.intent.fields[field];
    const present = entry && entry.value !== void 0 && entry.value !== null && entry.value !== "";
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
      ...resolvedDecisionId ? { resolvedDecisionId } : {}
    },
    { now: at, idempotencyKey }
  );
  const currentIntentId = draft.artifactIndex.intent;
  if (currentIntentId && (updatedFields.length > 0 || createdConflicts.length > 0)) {
    const currentIntent = draft.artifacts[currentIntentId];
    const invalidationReason = updatedFields.length > 0 ? "intent_manifest_changed" : "intent_conflict_opened";
    currentIntent.stale = true;
    currentIntent.staleReason = invalidationReason;
    markEvidenceStale(
      draft,
      (entry) => entry.artifactId === currentIntentId || downstreamArtifactKinds("intent").includes(entry.artifactKind),
      invalidationReason
    );
    markDependentStateStale(draft, {
      kind: "intent",
      phaseId: "I0",
      includeSource: true,
      reason: invalidationReason,
      now: at
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
    visualDirection: clone(option?.visualDirection)
  };
}
function visualDistinctnessKey(option) {
  if (option.visualDirection && typeof option.visualDirection === "object") {
    return stableStringify(option.visualDirection).toLowerCase();
  }
  if (typeof option.visualDirection === "string") return option.visualDirection.trim().toLowerCase();
  return `${option.name}|${option.rationale}`.toLowerCase();
}
function validateDesignOptions(options) {
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
    if (option.visualDirection === void 0 || option.visualDirection === null || option.visualDirection === "") {
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
function proposeDesignOptions(state, options, { now, idempotencyKey } = {}) {
  assertRunState(state);
  const operationInput = { operation: "design.propose", options };
  if (checkIdempotency(state, idempotencyKey, operationInput)) return state;
  invariant(state.phases.I0.status !== "passed", "DESIGN_PHASE_CLOSED", "Design options can only be proposed during I0.");
  const validation = validateDesignOptions(options);
  invariant(validation.valid, "INVALID_DESIGN_OPTIONS", "Design options failed validation.", {
    errors: validation.errors
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
      now: at
    });
  }
  appendEvent(
    draft,
    "design.options.proposed",
    {
      optionIds: validation.normalized.map(({ id }) => id),
      recommendationId: draft.design.recommendationId
    },
    { now: at, idempotencyKey }
  );
  draft.updatedAt = at;
  rememberIdempotency(draft, idempotencyKey, operationInput);
  return draft;
}
function resolveDesignSelection(design, selection) {
  invariant(
    DESIGN_SELECTION_METHODS.includes(selection?.method),
    "INVALID_SELECTION_METHOD",
    `Invalid design selection method: ${selection?.method}`
  );
  const method = selection.method;
  if (method === "direct") {
    invariant(
      selection.finalVisualDirection && typeof selection.finalVisualDirection === "object",
      "DIRECT_DIRECTION_REQUIRED",
      "Direct selection requires finalVisualDirection."
    );
    return {
      method,
      selectedOptionId: null,
      sourceOptionIds: [],
      finalVisualDirection: clone(selection.finalVisualDirection),
      rejectedOptionIds: design.options.map(({ id }) => id)
    };
  }
  const validation = validateDesignOptions(design.options);
  invariant(validation.valid, "VALID_DESIGN_OPTIONS_REQUIRED", "A valid set of three options is required before selection.", {
    errors: validation.errors
  });
  if (method === "user-hybridized") {
    const sourceOptionIds = [...new Set(selection.sourceOptionIds ?? [])];
    invariant(sourceOptionIds.length >= 2, "HYBRID_SOURCES_REQUIRED", "A hybrid must use at least two options.");
    invariant(
      sourceOptionIds.every((id) => design.options.some((option) => option.id === id)),
      "UNKNOWN_HYBRID_SOURCE",
      "A hybrid references an unknown design option."
    );
    invariant(
      selection.finalVisualDirection && typeof selection.finalVisualDirection === "object",
      "HYBRID_DIRECTION_REQUIRED",
      "A hybrid requires a concrete finalVisualDirection."
    );
    return {
      method,
      selectedOptionId: null,
      sourceOptionIds,
      finalVisualDirection: clone(selection.finalVisualDirection),
      rejectedOptionIds: design.options.map(({ id }) => id).filter((id) => !sourceOptionIds.includes(id))
    };
  }
  const selectedOptionId = selection.selectedOptionId ?? (method === "recommended-default" || method === "delegated" ? design.recommendationId : null);
  const selected = design.options.find((option) => option.id === selectedOptionId);
  invariant(selected, "UNKNOWN_DESIGN_OPTION", `Unknown selected design option: ${selectedOptionId}`);
  return {
    method,
    selectedOptionId,
    sourceOptionIds: [selectedOptionId],
    finalVisualDirection: clone(selected.visualDirection),
    rejectedOptionIds: design.options.map(({ id }) => id).filter((id) => id !== selectedOptionId)
  };
}
function selectDesign(state, selection, { now, selectedBy = "user", idempotencyKey = selection?.idempotencyKey } = {}) {
  assertRunState(state);
  const operationInput = { operation: "design.select", selection, selectedBy };
  if (checkIdempotency(state, idempotencyKey, operationInput)) return state;
  invariant(state.phases.I0.status !== "passed", "DESIGN_PHASE_CLOSED", "Design selection can only change during I0 rework.");
  const resolved = resolveDesignSelection(state.design, selection);
  const comparableCurrent = state.design.selection ? {
    method: state.design.selection.method,
    selectedOptionId: state.design.selection.selectedOptionId,
    sourceOptionIds: state.design.selection.sourceOptionIds,
    finalVisualDirection: state.design.finalVisualDirection,
    rejectedOptionIds: state.design.rejectedOptionIds
  } : null;
  if (sameValue(comparableCurrent, resolved)) return state;
  const at = timestamp(now);
  const draft = clone(state);
  const wasSelected = Boolean(draft.design.selection);
  draft.design.selection = {
    method: resolved.method,
    selectedOptionId: resolved.selectedOptionId,
    sourceOptionIds: resolved.sourceOptionIds,
    selectedBy,
    selectedAt: at
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
      now: at
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
      ...resolvedDecisionId ? { resolvedDecisionId } : {}
    },
    { now: at, idempotencyKey }
  );
  draft.updatedAt = at;
  rememberIdempotency(draft, idempotencyKey, operationInput);
  return draft;
}
function requestInput(state, { type = "intent", fields, prompt, responseSchema } = {}, { now, idempotencyKey } = {}) {
  assertRunState(state);
  const requestedFields = type === "intent" ? fields ?? requiredIntentQuestions(state) : fields ?? [];
  if (type === "intent" && requestedFields.length === 0) return state;
  const operationInput = { operation: "input.request", type, fields: requestedFields, prompt, responseSchema };
  if (checkIdempotency(state, idempotencyKey, operationInput)) return state;
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
    resumePhaseStatus: draft.currentPhase ? draft.phases[draft.currentPhase].status : null
  };
  draft.status = "awaiting_user";
  if (draft.currentPhase && draft.phases[draft.currentPhase].status === "active") {
    draft.phases[draft.currentPhase].status = "awaiting_user";
  }
  appendEvent(
    draft,
    "input.requested",
    { decisionId: draft.pendingDecision.id, type, fields: requestedFields },
    { now: at, idempotencyKey }
  );
  draft.updatedAt = at;
  rememberIdempotency(draft, idempotencyKey, operationInput);
  return draft;
}
function modeAllowsPhase(mode, phaseId) {
  return phaseIdsForMode(mode).includes(phaseId);
}
function startPhase(state, phaseId, { now, idempotencyKey } = {}) {
  assertRunState(state);
  const phaseDefinition = PHASE_BY_ID[phaseId];
  invariant(phaseDefinition, "UNKNOWN_PHASE", `Unknown phase: ${phaseId}`);
  invariant(modeAllowsPhase(state.mode, phaseId), "PHASE_OUTSIDE_MODE", `${phaseId} is outside mode ${state.mode}.`);
  const operationInput = { operation: "phase.start", phaseId };
  if (checkIdempotency(state, idempotencyKey, operationInput)) return state;
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
      { phaseId, previousId, status: state.phases[previousId].status }
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
      { kind, dependencyKind }
    );
    return artifact.id;
  });
}
function recordArtifact(state, artifact, { now, idempotencyKey } = {}) {
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
    `${phaseId} must have started before its artifact is recorded.`
  );
  const payload = Object.hasOwn(artifact, "data") ? artifact.data : Object.hasOwn(artifact, "content") ? artifact.content : artifact.metadata ?? {};
  const requiredDependencies = inferArtifactDependencies(state, artifact.kind);
  const dependencies = [...artifact.dependencies ?? requiredDependencies].sort();
  const normalizedFiles = clone(artifact.files ?? []).sort(
    (left, right) => `${left.path}\0${left.mimeType}`.localeCompare(`${right.path}\0${right.mimeType}`)
  );
  invariant(
    sameValue([...dependencies].sort(), [...requiredDependencies].sort()),
    "ARTIFACT_DEPENDENCY_MISMATCH",
    `${artifact.kind} must depend on every current declared upstream artifact and no others.`,
    { requiredDependencies, actualDependencies: dependencies }
  );
  const computedHash = hashValue({
    kind: artifact.kind,
    payload,
    metadata: artifact.metadata ?? {},
    files: normalizedFiles,
    dependencies
  });
  invariant(
    !artifact.hash || artifact.hash === computedHash,
    "ARTIFACT_HASH_MISMATCH",
    "Provided artifact hash does not match its payload.",
    { expected: computedHash, actual: artifact.hash }
  );
  const operationInput = {
    operation: "artifact.record",
    artifact: { ...artifact, dependencies, files: normalizedFiles, hash: computedHash }
  };
  if (checkIdempotency(state, idempotencyKey, operationInput)) return state;
  const existing = state.artifacts[artifact.id];
  if (existing && existing.hash === computedHash && sameValue(existing.metadata, artifact.metadata ?? {}) && sameValue(existing.files, normalizedFiles) && !existing.stale) {
    return state;
  }
  const at = timestamp(now);
  const draft = clone(state);
  const previousCurrentId = draft.artifactIndex[artifact.kind];
  const previousCurrent = previousCurrentId ? draft.artifacts[previousCurrentId] : null;
  const changedCurrent = Boolean(
    previousCurrent && (previousCurrent.hash !== computedHash || previousCurrent.id !== artifact.id)
  );
  if (previousCurrent && previousCurrent.id !== artifact.id) {
    previousCurrent.stale = true;
    previousCurrent.staleReason = "superseded";
  }
  if (changedCurrent) {
    markEvidenceStale(
      draft,
      (entry) => entry.artifactId === previousCurrent.id || downstreamArtifactKinds(artifact.kind).includes(entry.artifactKind),
      `${artifact.kind}_artifact_hash_changed`
    );
    markDependentStateStale(draft, {
      kind: artifact.kind,
      phaseId,
      includeSource: true,
      reason: `${artifact.kind}_artifact_hash_changed`,
      now: at
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
    updatedAt: at
  };
  draft.artifacts[artifact.id] = record;
  draft.artifactIndex[artifact.kind] = artifact.id;
  draft.phases[phaseId].outputArtifactId = artifact.id;
  appendEvent(
    draft,
    "artifact.updated",
    {
      artifactId: artifact.id,
      kind: artifact.kind,
      hash: computedHash,
      revision: record.revision,
      changedCurrent
    },
    { now: at, idempotencyKey }
  );
  draft.updatedAt = at;
  rememberIdempotency(draft, idempotencyKey, operationInput);
  return draft;
}
function isEvidenceFresh(state, evidenceOrId) {
  assertRunState(state);
  const evidence = typeof evidenceOrId === "string" ? state.evidence[evidenceOrId] : evidenceOrId;
  if (!evidence || evidence.stale) return false;
  if (evidence.status !== "pass") return true;
  const artifact = state.artifacts[evidence.artifactId];
  return Boolean(
    artifact && !artifact.stale && artifact.hash === evidence.artifactHash && artifact.kind === evidence.artifactKind
  );
}
function recordEvidence(state, evidence, { now, idempotencyKey } = {}) {
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
    const artifact2 = state.artifacts[evidence.artifactId];
    invariant(artifact2 && !artifact2.stale, "PASS_REQUIRES_CURRENT_ARTIFACT", "Passing evidence references a missing or stale artifact.");
    invariant(
      artifact2.kind === phase.outputKind,
      "EVIDENCE_ARTIFACT_SCOPE_MISMATCH",
      `Passing evidence for ${evidence.phaseId} must reference its ${phase.outputKind} artifact.`,
      { phaseId: evidence.phaseId, expectedKind: phase.outputKind, actualKind: artifact2.kind }
    );
    invariant(
      artifact2.hash === evidence.artifactHash,
      "EVIDENCE_HASH_NOT_CURRENT",
      "Evidence hash does not match the current artifact hash.",
      { currentHash: artifact2.hash, evidenceHash: evidence.artifactHash }
    );
  }
  if (evidence.status === "not_run") {
    invariant(evidence.executed !== true, "NOT_RUN_CANNOT_BE_EXECUTED", "A not_run check cannot claim execution.");
  }
  const operationInput = { operation: "evidence.record", evidence };
  if (checkIdempotency(state, idempotencyKey, operationInput)) return state;
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
      artifactKind: evidence.artifactId ? state.artifacts[evidence.artifactId]?.kind ?? null : null
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
    recordedAt: at
  };
  appendEvent(
    draft,
    "verification.recorded",
    {
      evidenceId: evidence.id,
      phaseId: evidence.phaseId,
      gateId: evidence.gateId,
      status: evidence.status,
      artifactId: evidence.artifactId ?? null,
      artifactHash: evidence.artifactHash ?? null
    },
    { now: at, idempotencyKey }
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
    artifactHashes: [...new Set(evidence.map(({ artifactHash }) => artifactHash).filter(Boolean))].sort()
  };
}
function evaluatePhaseGate(state, { phaseId, gateId, evidenceIds }, { now, idempotencyKey } = {}) {
  assertRunState(state);
  const phaseDefinition = PHASE_BY_ID[phaseId];
  invariant(phaseDefinition, "UNKNOWN_PHASE", `Unknown phase: ${phaseId}`);
  invariant(phaseDefinition.gates.includes(gateId), "UNKNOWN_GATE", `${gateId} is not a hard gate for ${phaseId}.`);
  const operationInput = { operation: "gate.evaluate", phaseId, gateId, evidenceIds };
  if (checkIdempotency(state, idempotencyKey, operationInput)) return state;
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
    evaluatedAt: at
  };
  draft.gateResults[`${phaseId}:${gateId}`] = result;
  draft.phases[phaseId].gateResults[gateId] = resultId;
  appendEvent(
    draft,
    "gate.evaluated",
    {
      resultId,
      phaseId,
      gateId,
      status: result.status,
      reasons: result.reasons,
      evidenceIds: result.evidenceIds
    },
    { now: at, idempotencyKey }
  );
  if (result.status === "fail") draft.status = "failed_gate";
  draft.updatedAt = at;
  rememberIdempotency(draft, idempotencyKey, operationInput);
  return draft;
}
function gateResultIsCurrent(state, phaseId, gateId) {
  assertRunState(state);
  const result = state.gateResults[`${phaseId}:${gateId}`];
  if (!result || result.status !== "pass" || result.stale) return false;
  return result.evidenceIds.length > 0 && result.evidenceIds.every((id) => isEvidenceFresh(state, id));
}
function phaseGateSummary(state, phaseId) {
  assertRunState(state);
  const phase = PHASE_BY_ID[phaseId];
  invariant(phase, "UNKNOWN_PHASE", `Unknown phase: ${phaseId}`);
  return phase.gates.map((gateId) => ({
    gateId,
    current: gateResultIsCurrent(state, phaseId, gateId),
    result: clone(state.gateResults[`${phaseId}:${gateId}`] ?? null)
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
function failPhase(state, phaseId, failure, { now, idempotencyKey } = {}) {
  assertRunState(state);
  invariant(PHASE_BY_ID[phaseId], "UNKNOWN_PHASE", `Unknown phase: ${phaseId}`);
  const operationInput = { operation: "phase.fail", phaseId, failure };
  if (checkIdempotency(state, idempotencyKey, operationInput)) return state;
  const at = timestamp(now);
  const draft = clone(state);
  const phase = draft.phases[phaseId];
  invariant(["active", "awaiting_user"].includes(phase.status), "PHASE_NOT_ACTIVE", `${phaseId} is not active.`);
  phase.status = "failed";
  phase.failedAt = at;
  phase.failure = clone(failure ?? { code: "UNKNOWN", message: "Phase failed." });
  draft.status = "failed_gate";
  appendEvent(draft, "phase.failed", { phaseId, failure: phase.failure }, { now: at, idempotencyKey });
  draft.updatedAt = at;
  rememberIdempotency(draft, idempotencyKey, operationInput);
  return draft;
}
function completePhase(state, phaseId, { now, idempotencyKey } = {}) {
  assertRunState(state);
  const phaseDefinition = PHASE_BY_ID[phaseId];
  invariant(phaseDefinition, "UNKNOWN_PHASE", `Unknown phase: ${phaseId}`);
  const operationInput = { operation: "phase.complete", phaseId };
  if (checkIdempotency(state, idempotencyKey, operationInput)) return state;
  if (state.phases[phaseId].status === "passed") return state;
  invariant(state.phases[phaseId].status === "active", "PHASE_NOT_ACTIVE", `${phaseId} must be active before completion.`);
  const preconditionFailures = validatePhasePreconditions(state, phaseId);
  const gateFailures = phaseDefinition.gates.filter((gateId) => !gateResultIsCurrent(state, phaseId, gateId));
  invariant(
    preconditionFailures.length === 0 && gateFailures.length === 0,
    "PHASE_GATE_BLOCKED",
    `${phaseId} cannot pass until every hard gate has current passing evidence.`,
    { preconditionFailures, gateFailures }
  );
  if (phaseId === "P10") {
    const decision = releaseDecision(state, { evaluatedAt: timestamp(now) });
    invariant(decision.decision === "pass", "RELEASE_BLOCKED", "Release readiness failed.", { decision });
  }
  const at = timestamp(now);
  const draft = clone(state);
  draft.phases[phaseId].status = "passed";
  draft.phases[phaseId].completedAt = at;
  draft.status = "active";
  appendEvent(draft, "phase.completed", { phaseId }, { now: at, idempotencyKey });
  if (phaseId === "I0") {
    draft.status = "specified";
    appendEvent(draft, "run.specified", { phaseId }, { now: at, idempotencyKey });
    if (draft.mode === "manifest_only") draft.terminalReason = "manifest_only_complete";
  } else if (phaseId === "P6") {
    draft.status = "planned";
    appendEvent(draft, "run.planned", { phaseId }, { now: at, idempotencyKey });
    if (draft.mode === "plan_only") draft.terminalReason = "plan_only_complete";
  } else if (phaseId === "P10") {
    draft.status = "completed";
    draft.terminalReason = "release_passed";
    appendEvent(draft, "run.completed", { phaseId }, { now: at, idempotencyKey });
  }
  draft.updatedAt = at;
  rememberIdempotency(draft, idempotencyKey, operationInput);
  return draft;
}
function invalidateDownstream(state, { artifactId, kind, phaseId, includeSource = false, reason = "upstream_changed" } = {}, { now, idempotencyKey } = {}) {
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
    reason
  };
  if (checkIdempotency(state, idempotencyKey, operationInput)) return state;
  const at = timestamp(now);
  const draft = clone(state);
  const affected = markDependentStateStale(draft, {
    kind: resolvedKind,
    phaseId: resolvedPhaseId,
    includeSource,
    reason,
    now: at,
    excludeActiveSource: false
  });
  if (affected.affectedArtifactIds.length === 0 && affected.staleEvidenceIds.length === 0 && affected.invalidatedPhaseIds.length === 0) {
    return state;
  }
  draft.updatedAt = at;
  rememberIdempotency(draft, idempotencyKey, operationInput);
  return draft;
}
function registerSource(state, source, { now, idempotencyKey } = {}) {
  assertRunState(state);
  invariant(source && typeof source === "object", "INVALID_SOURCE", "Source is required.");
  invariant(typeof source.id === "string" && source.id, "SOURCE_ID_REQUIRED", "Source id is required.");
  const operationInput = { operation: "source.register", source };
  if (checkIdempotency(state, idempotencyKey, operationInput)) return state;
  const existing = state.sources[source.id];
  if (existing && sameValue(existing.data, source)) return state;
  const at = timestamp(now);
  const draft = clone(state);
  draft.sources[source.id] = {
    id: source.id,
    trust: source.trust === "trusted" ? "trusted" : "untrusted",
    data: clone(source),
    registeredAt: existing?.registeredAt ?? at,
    updatedAt: at
  };
  appendEvent(
    draft,
    "run.updated",
    { section: "sources", sourceId: source.id, trust: draft.sources[source.id].trust },
    { now: at, idempotencyKey }
  );
  draft.updatedAt = at;
  rememberIdempotency(draft, idempotencyKey, operationInput);
  return draft;
}
function recordFinding(state, finding, { now, idempotencyKey } = {}) {
  assertRunState(state);
  invariant(finding && typeof finding === "object", "INVALID_FINDING", "Finding is required.");
  invariant(typeof finding.id === "string" && finding.id, "FINDING_ID_REQUIRED", "Finding id is required.");
  invariant(FINDING_SEVERITIES.includes(finding.severity), "INVALID_FINDING_SEVERITY", `Invalid severity: ${finding.severity}`);
  const operationInput = { operation: "finding.record", finding };
  if (checkIdempotency(state, idempotencyKey, operationInput)) return state;
  const existing = state.findings[finding.id];
  if (existing && sameValue({ ...existing, recordedAt: void 0 }, { ...finding, status: finding.status ?? "open", recordedAt: void 0 })) {
    return state;
  }
  invariant(!existing, "FINDING_ID_CONFLICT", `Finding ${finding.id} already exists.`);
  const at = timestamp(now);
  const draft = clone(state);
  draft.findings[finding.id] = {
    ...clone(finding),
    status: finding.status ?? "open",
    recordedAt: at,
    resolvedAt: finding.status === "resolved" ? at : null
  };
  invariant(FINDING_STATUS.includes(draft.findings[finding.id].status), "INVALID_FINDING_STATUS", "Invalid finding status.");
  appendEvent(
    draft,
    "run.updated",
    { section: "findings", findingId: finding.id, severity: finding.severity, status: draft.findings[finding.id].status },
    { now: at, idempotencyKey }
  );
  draft.updatedAt = at;
  rememberIdempotency(draft, idempotencyKey, operationInput);
  return draft;
}
function resolveFinding(state, findingId, { resolution, now, idempotencyKey } = {}) {
  assertRunState(state);
  const finding = state.findings[findingId];
  invariant(finding, "UNKNOWN_FINDING", `Unknown finding: ${findingId}`);
  const operationInput = { operation: "finding.resolve", findingId, resolution };
  if (checkIdempotency(state, idempotencyKey, operationInput)) return state;
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
    { now: at, idempotencyKey }
  );
  draft.updatedAt = at;
  rememberIdempotency(draft, idempotencyKey, operationInput);
  return draft;
}
function validatePortableArtifact(stateOrArtifact) {
  const artifact = stateOrArtifact?.schemaVersion ? currentArtifactForKind(stateOrArtifact, "production") : stateOrArtifact;
  const reasons = [];
  if (!artifact || artifact.stale) reasons.push("current_production_artifact_missing");
  const files = artifact?.files ?? [];
  const indexFiles = files.filter(({ path: path3 }) => String(path3).replaceAll("\\", "/").split("/").pop() === "index.html");
  const html = artifact?.data ?? artifact?.content;
  if (files.length !== 1 || indexFiles.length !== 1) reasons.push("exactly_one_index_html_required");
  if (typeof html !== "string" || !/<html(?:\s|>)/i.test(html) || !/<\/html>/i.test(html)) {
    reasons.push("index_content_missing");
  }
  if (artifact?.metadata?.selfContained !== true) reasons.push("index_not_self_contained");
  if (artifact?.metadata?.networkRequired !== false) reasons.push("network_required");
  if (!Array.isArray(artifact?.metadata?.externalRuntimeResources) || artifact.metadata.externalRuntimeResources.length > 0) {
    reasons.push("external_runtime_resources_present");
  }
  if (typeof html === "string") {
    const resourceAttribute = /<(?:script|img|iframe|audio|video|source|embed|object|link)\b[^>]*(?:src|href|poster|data)\s*=\s*["'](?!data:|blob:|#)[^"']+["']/i;
    const runnableNetworkApi = /\b(?:fetch\s*\(|XMLHttpRequest\b|WebSocket\s*\(|EventSource\s*\(|sendBeacon\s*\(|importScripts\s*\()/;
    const scriptRuntimeReference = /\b(?:import\s*\(|new\s+(?:Worker|SharedWorker)\s*\()\s*["'](?!data:|blob:)[^"']+["']/;
    const runnableBodies = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)].filter((match) => !/\btype\s*=\s*["'](?:application\/(?:json|ld\+json)|importmap|speculationrules)["']/i.test(match[1])).map((match) => match[2]);
    const styleBodies = [
      ...[...html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)].map((match) => match[1]),
      ...[...html.matchAll(/\sstyle\s*=\s*["']([^"']*)["']/gi)].map((match) => match[1])
    ];
    const hasCssRuntimeReference = styleBodies.some(
      (body) => [...body.matchAll(/(?:@import\s+(?:url\(\s*)?|url\(\s*)["']?([^)"'\s;]+)/gi)].some(
        (match) => !/^(?:data:|blob:|#)/i.test(match[1])
      )
    );
    if (resourceAttribute.test(html) || hasCssRuntimeReference || runnableBodies.some((body) => scriptRuntimeReference.test(body))) {
      reasons.push("external_runtime_resources_present");
    }
    if (runnableBodies.some((body) => runnableNetworkApi.test(body))) reasons.push("network_required");
  }
  const normalizedReasons = [...new Set(reasons)];
  return {
    valid: normalizedReasons.length === 0,
    reasons: normalizedReasons,
    artifactId: artifact?.id ?? null,
    artifactHash: artifact?.hash ?? null
  };
}
function countOpenFindings(state) {
  const counts = Object.fromEntries(FINDING_SEVERITIES.map((severity) => [severity, 0]));
  for (const finding of Object.values(state.findings)) {
    if (finding.status === "open") counts[finding.severity] += 1;
  }
  return counts;
}
function releaseDecision(state, { evaluatedAt } = {}) {
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
        reasons: clone(result?.reasons ?? ["missing_evidence"])
      });
    }
  }
  const staleEvidenceIds = Object.values(state.evidence).filter((entry) => !isEvidenceFresh(state, entry)).map(({ id }) => id).sort();
  const notRunChecks = Object.values(state.evidence).filter(({ status }) => status === "not_run").map(({ id, critical, phaseId, gateId }) => ({ id, critical, phaseId, gateId })).sort((left, right) => left.id.localeCompare(right.id));
  const openFindingsBySeverity = countOpenFindings(state);
  const portable = validatePortableArtifact(state);
  const requiredPhaseIds = phaseIdsForMode(state.mode);
  const incompletePhases = requiredPhaseIds.filter((id) => id !== "P10").filter((id) => state.phases[id].status !== "passed");
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
    blockingReasons: [...new Set(blockingReasons)]
  };
}
var COMMAND_TYPES = Object.freeze([
  "intent.patch",
  "design.propose",
  "design.select",
  "input.request",
  "phase.start",
  "phase.fail",
  "phase.complete",
  "artifact.record",
  "evidence.record",
  "gate.evaluate",
  "workflow.invalidate",
  "source.register",
  "finding.record",
  "finding.resolve",
  "release.decide"
]);
function applyCommand(state, command, options = {}) {
  assertRunState(state);
  invariant(command && typeof command === "object", "INVALID_COMMAND", "Command is required.");
  const payload = command.payload ?? command;
  const retryKey = command.idempotencyKey ?? payload.idempotencyKey ?? options.idempotencyKey;
  if (command.expectedStateVersion !== void 0 && !state.idempotency[retryKey]) {
    invariant(
      Number.isInteger(command.expectedStateVersion) && command.expectedStateVersion === state.stateVersion,
      "STATE_VERSION_CONFLICT",
      `Expected state version ${command.expectedStateVersion}; current version is ${state.stateVersion}.`,
      { expectedStateVersion: command.expectedStateVersion, currentStateVersion: state.stateVersion }
    );
  }
  const commandOptions = {
    ...options,
    ...payload.meta ?? {},
    idempotencyKey: retryKey
  };
  let nextState;
  let result;
  switch (command.type) {
    case "intent.patch":
      nextState = patchIntentManifest(state, payload.patch, {
        ...commandOptions,
        origin: payload.origin ?? commandOptions.origin,
        confidence: payload.confidence ?? commandOptions.confidence,
        evidenceRefs: payload.evidenceRefs ?? commandOptions.evidenceRefs
      });
      break;
    case "design.propose":
      nextState = proposeDesignOptions(state, payload.options, commandOptions);
      break;
    case "design.select":
      nextState = selectDesign(state, payload.selection, {
        ...commandOptions,
        selectedBy: payload.selectedBy ?? commandOptions.selectedBy
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
        nextState.gateResults[`${payload.gate?.phaseId}:${payload.gate?.gateId}`] ?? null
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
        resolution: payload.resolution
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
    ...result === void 0 ? {} : { result }
  };
}
function validateEventLog(state) {
  assertRunState(state);
  const errors = [];
  state.events.forEach((event, index) => {
    const expected = index + 1;
    if (event.seq !== expected) errors.push(`event ${event.id} has seq ${event.seq}; expected ${expected}`);
    if (event.stateVersion !== expected) {
      errors.push(`event ${event.id} has stateVersion ${event.stateVersion}; expected ${expected}`);
    }
    if (!PHASE_EVENT_TYPES.includes(event.type)) errors.push(`event ${event.id} has unknown type ${event.type}`);
  });
  if (state.eventCursor !== state.events.length) errors.push("eventCursor does not match event count");
  if (state.stateVersion !== state.events.length) errors.push("stateVersion does not match event count");
  return { valid: errors.length === 0, errors };
}

// packages/mcp-server/presentation.mjs
var STATUS_COPY = {
  draft: "Draft intent",
  active: "Work in progress",
  awaiting_user: "Waiting for a decision",
  failed_gate: "Repair required",
  blocked_external: "External blocker",
  specified: "Intent specified",
  planned: "Plan complete",
  completed: "Release complete"
};
function compactRun(state) {
  const topic = state.intent?.fields?.topic?.value || "Untitled learning booklet";
  const learner = state.intent?.fields?.learner?.value;
  const designName = state.design?.selection?.selectedOptionId ? state.design.options.find((option) => option.id === state.design.selection.selectedOptionId)?.name : state.design?.selection?.method === "direct" ? "Direct visual direction" : null;
  return {
    protocol: "codex-skill-ui/1",
    runId: state.runId,
    topic,
    subtitle: learner ? `A verified learning booklet for ${learner}.` : STATUS_COPY[state.status],
    mode: state.mode,
    status: state.status,
    currentLayer: state.currentLayer,
    currentPhase: state.currentPhase,
    stateVersion: state.stateVersion,
    updatedAt: state.updatedAt,
    terminalReason: state.terminalReason,
    pendingDecision: state.pendingDecision,
    phases: PHASES.map((phase) => ({
      id: phase.id,
      label: phase.name,
      short: phase.name,
      status: state.phases[phase.id]?.status || "not_started",
      gates: phaseGateSummary(state, phase.id)
    })),
    design: {
      selectedOptionId: state.design?.selection?.selectedOptionId,
      selectedName: designName,
      selectionMethod: state.design?.selection?.method,
      finalVisualDirection: state.design?.finalVisualDirection,
      options: state.design?.options || []
    },
    artifacts: Object.values(state.artifacts || {}).map((artifact) => ({
      id: artifact.id,
      kind: artifact.kind,
      phaseId: artifact.phaseId,
      hash: artifact.hash,
      stale: artifact.stale,
      locator: artifact.locator
    })),
    evidenceSummary: Object.values(state.evidence || {}).reduce(
      (summary, evidence) => {
        const key = evidence.stale ? "stale" : evidence.status;
        summary[key] = (summary[key] || 0) + 1;
        return summary;
      },
      {}
    ),
    openFindings: Object.values(state.findings || {}).filter((finding) => finding.status === "open"),
    recentEvents: (state.events || []).slice(-12)
  };
}
function toolResult(state, message, meta = {}) {
  return {
    structuredContent: {
      protocol: "codex-skill-ui/1",
      run: compactRun(state)
    },
    content: [{ type: "text", text: message }],
    _meta: {
      stateVersion: state.stateVersion,
      eventCursor: state.eventCursor,
      ...meta
    }
  };
}

// packages/mcp-server/store.mjs
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  writeFileSync
} from "node:fs";
import os from "node:os";
import path from "node:path";
var SAFE_RUN_ID = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/;
function defaultStateDirectory() {
  if (process.env.LEARNING_BOOKLET_STATE_DIR) {
    return path.resolve(process.env.LEARNING_BOOKLET_STATE_DIR);
  }
  const codexRoot = process.env.CODEX_HOME ? path.resolve(process.env.CODEX_HOME) : path.join(os.homedir(), ".codex");
  return path.join(codexRoot, "state", "plugins", "learning-booklet-studio");
}
function assertRunId(runId) {
  if (!SAFE_RUN_ID.test(runId || "")) {
    throw new Error("runId must contain only letters, numbers, dots, underscores, and hyphens.");
  }
}
function createFileStore({ stateDir = defaultStateDirectory() } = {}) {
  const runsDir = path.join(stateDir, "runs");
  mkdirSync(runsDir, { recursive: true });
  function pathsFor(runId) {
    assertRunId(runId);
    const runDir = path.join(runsDir, runId);
    return {
      runDir,
      snapshot: path.join(runDir, "run-state.json"),
      events: path.join(runDir, "events.ndjson")
    };
  }
  function load(runId) {
    const files = pathsFor(runId);
    if (!existsSync(files.snapshot)) return null;
    return JSON.parse(readFileSync(files.snapshot, "utf8"));
  }
  function save(state) {
    const files = pathsFor(state.runId);
    mkdirSync(files.runDir, { recursive: true });
    const previous = existsSync(files.snapshot) ? JSON.parse(readFileSync(files.snapshot, "utf8")) : null;
    const previousCursor = previous?.eventCursor ?? 0;
    const newEvents = (state.events || []).filter((event) => event.seq > previousCursor);
    if (newEvents.length > 0) {
      appendFileSync(files.events, `${newEvents.map((event) => JSON.stringify(event)).join("\n")}
`, "utf8");
    }
    const temp = `${files.snapshot}.tmp-${process.pid}`;
    writeFileSync(temp, `${JSON.stringify(state, null, 2)}
`, "utf8");
    renameSync(temp, files.snapshot);
    return state;
  }
  function list() {
    return readdirSync(runsDir, { withFileTypes: true }).filter((entry) => entry.isDirectory() && SAFE_RUN_ID.test(entry.name)).map((entry) => load(entry.name)).filter(Boolean).sort((left, right) => String(right.updatedAt).localeCompare(String(left.updatedAt)));
  }
  function mutate(runId, mutation) {
    const current = load(runId);
    if (!current) throw new Error(`Unknown run: ${runId}`);
    const result = mutation(current);
    save(result.state);
    return result;
  }
  return { stateDir, load, save, list, mutate };
}

// packages/mcp-server/server.mjs
var PROTOCOL = "codex-skill-ui/1";
var WIDGET_URI = "ui://learning-booklet-studio/workflow-v1.html";
var MAX_PUBLISH_BYTES = 1024 * 1024;
var MAX_EVENT_PAGE = 200;
var runOutputSchema = z.object({
  protocol: z.literal(PROTOCOL),
  run: z.record(z.string(), z.unknown())
});
var eventOutputSchema = z.object({
  protocol: z.literal(PROTOCOL),
  run: z.record(z.string(), z.unknown()),
  events: z.array(z.record(z.string(), z.unknown())),
  nextSeq: z.number().int().nonnegative(),
  hasMore: z.boolean()
});
function fingerprint(value) {
  return createHash2("sha256").update(stableStringify(value)).digest("hex");
}
function generatedRunId(commandId) {
  const seed = commandId || randomUUID();
  return `run-${fingerprint(seed).slice(0, 16)}`;
}
function requireRun(store, runId) {
  const state = runId ? store.load(runId) : store.list()[0];
  if (!state) throw new Error(runId ? `Unknown run: ${runId}` : "No workflow run exists yet.");
  return state;
}
function byteLength(value) {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}
function safeProjectionValue(value, key = "") {
  const normalized = String(key).toLowerCase();
  if (/(secret|token|credential|authorization|sourcebody|rawprompt|chainofthought)/.test(normalized)) {
    return "[redacted]";
  }
  if (typeof value === "string") {
    if (/^(?:\/Users\/|\/home\/|[A-Za-z]:\\)/.test(value)) return "[workspace-relative path redacted]";
    return value.length > 4096 ? `${value.slice(0, 4096)}\u2026` : value;
  }
  if (Array.isArray(value)) return value.slice(0, 200).map((entry) => safeProjectionValue(entry, key));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).filter(([entryKey]) => !/(sourcebody|rawprompt|chainofthought)/i.test(entryKey)).map(([entryKey, entryValue]) => [entryKey, safeProjectionValue(entryValue, entryKey)])
    );
  }
  return value;
}
function readWidgetHtml() {
  const here = path2.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path2.resolve(here, "../widget/widget.html"),
    path2.resolve(here, "../widget/dist/mcp/widget.html")
  ];
  const widgetPath = candidates.find((candidate) => existsSync2(candidate));
  if (!widgetPath) {
    throw new Error("The MCP widget has not been built. Run npm run build:widget first.");
  }
  return readFileSync2(widgetPath, "utf8");
}
function uiMeta(visibility) {
  return {
    ui: {
      resourceUri: WIDGET_URI,
      visibility
    }
  };
}
function annotations({ readOnly = false, destructive = false, idempotent = true } = {}) {
  return {
    readOnlyHint: readOnly,
    destructiveHint: destructive,
    idempotentHint: idempotent,
    openWorldHint: false
  };
}
function successWithRun(state, message, meta) {
  return toolResult(state, message, meta);
}
function createProjection(store, args) {
  const commandId = args.commandId || randomUUID();
  const runId = args.runId || generatedRunId(commandId);
  const creationInput = {
    mode: args.mode,
    intent: args.intent || {},
    designRequired: args.designRequired
  };
  const creationFingerprint = fingerprint(creationInput);
  const existing = store.load(runId);
  if (existing) {
    const recorded = existing.permissions?.projectionCreate;
    if (recorded?.commandId !== commandId || recorded?.fingerprint !== creationFingerprint) {
      throw new Error(`Run ${runId} already exists with a different creation command.`);
    }
    return existing;
  }
  const state = createRunState({
    runId,
    mode: args.mode,
    intent: args.intent || {},
    designRequired: args.designRequired,
    permissions: {
      projectionCreate: { commandId, fingerprint: creationFingerprint }
    }
  });
  store.save(state);
  return state;
}
function publishSnapshot(store, runId, snapshot) {
  if (byteLength(snapshot) > MAX_PUBLISH_BYTES) {
    throw new Error(`Published snapshot exceeds the ${MAX_PUBLISH_BYTES}-byte limit.`);
  }
  if (snapshot?.runId !== runId) throw new Error("Published snapshot runId does not match the target run.");
  const logValidation = validateEventLog(snapshot);
  if (!logValidation.valid) throw new Error(`Published snapshot has an invalid event log: ${logValidation.errors.join("; ")}`);
  const current = store.load(runId);
  if (current && snapshot.stateVersion < current.stateVersion) {
    throw new Error(`Published snapshot is stale: revision ${snapshot.stateVersion} < ${current.stateVersion}.`);
  }
  if (current && snapshot.stateVersion === current.stateVersion) {
    if (fingerprint(snapshot) !== fingerprint(current)) {
      throw new Error("Published snapshot conflicts with the current revision.");
    }
    return current;
  }
  store.save(snapshot);
  return snapshot;
}
function applyStoredCommand(store, runId, command) {
  const current = requireRun(store, runId);
  const result = applyCommand(current, command);
  store.save(result.state);
  return result;
}
function registerWorkflowSurface(server, { store = createFileStore() } = {}) {
  registerAppResource(
    server,
    "Learning Booklet Studio workflow",
    WIDGET_URI,
    {
      description: "In-place, inspect-and-decide workflow for a verified interactive learning booklet.",
      _meta: {
        ui: {
          csp: {
            connectDomains: [],
            resourceDomains: [],
            frameDomains: []
          },
          prefersBorder: false
        }
      }
    },
    async () => ({
      contents: [
        {
          uri: WIDGET_URI,
          mimeType: RESOURCE_MIME_TYPE,
          text: readWidgetHtml(),
          _meta: {
            ui: {
              csp: {
                connectDomains: [],
                resourceDomains: [],
                frameDomains: []
              },
              prefersBorder: false
            },
            "openai/widgetDescription": "A guided Studio Path view of learning-booklet intent, phases, design decisions, evidence, and repair state."
          }
        }
      ]
    })
  );
  registerAppTool(
    server,
    "workflow_create",
    {
      title: "Create learning-booklet workflow",
      description: "Create an idempotent local workflow projection. This records state only; it does not invoke a skill or begin execution.",
      inputSchema: z.object({
        commandId: z.string().min(1).max(128),
        runId: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/).optional(),
        mode: z.enum(["manifest_only", "plan_only", "plan_then_build"]).default("plan_then_build"),
        intent: z.record(z.string(), z.unknown()).default({}),
        designRequired: z.boolean().default(true)
      }).strict(),
      outputSchema: runOutputSchema,
      annotations: annotations(),
      _meta: uiMeta(["model", "app"])
    },
    async (args) => {
      const state = createProjection(store, args);
      return successWithRun(
        state,
        `Created workflow ${state.runId}. Use the build-learning-booklet skill to execute it; this tool created state only.`,
        { launchMessage: `Resume $build-learning-booklet for run ${state.runId}.` }
      );
    }
  );
  registerAppTool(
    server,
    "workflow_publish",
    {
      title: "Publish workflow projection",
      description: "Publish a validated canonical snapshot or apply one typed engine command, then return a sanitized projection for the widget.",
      inputSchema: z.object({
        runId: z.string().min(1).max(128),
        snapshot: z.record(z.string(), z.unknown()).optional(),
        command: z.object({
          type: z.string().min(1),
          payload: z.record(z.string(), z.unknown()).optional(),
          expectedStateVersion: z.number().int().nonnegative().optional(),
          idempotencyKey: z.string().min(1).max(160).optional()
        }).strict().optional()
      }).strict().superRefine((value, context) => {
        if (Boolean(value.snapshot) === Boolean(value.command)) {
          context.addIssue({ code: "custom", message: "Provide exactly one of snapshot or command." });
        }
      }),
      outputSchema: runOutputSchema,
      annotations: annotations(),
      _meta: uiMeta(["model"])
    },
    async ({ runId, snapshot, command }) => {
      const state = snapshot ? publishSnapshot(store, runId, snapshot) : applyStoredCommand(store, runId, command).state;
      return successWithRun(state, `Published workflow ${runId} at state version ${state.stateVersion}.`);
    }
  );
  registerAppTool(
    server,
    "workflow_get",
    {
      title: "Get learning-booklet workflow",
      description: "Read the latest sanitized workflow projection without changing state.",
      inputSchema: z.object({ runId: z.string().min(1).max(128).optional() }).strict(),
      outputSchema: runOutputSchema,
      annotations: annotations({ readOnly: true }),
      _meta: uiMeta(["model", "app"])
    },
    async ({ runId }) => {
      const state = requireRun(store, runId);
      return successWithRun(state, `Workflow ${state.runId} is at state version ${state.stateVersion}.`);
    }
  );
  registerAppTool(
    server,
    "workflow_events",
    {
      title: "Get workflow events",
      description: "Read a bounded page of sanitized workflow events after a cursor without changing state.",
      inputSchema: z.object({
        runId: z.string().min(1).max(128),
        afterSeq: z.number().int().nonnegative().default(0),
        limit: z.number().int().min(1).max(MAX_EVENT_PAGE).default(50)
      }).strict(),
      outputSchema: eventOutputSchema,
      annotations: annotations({ readOnly: true }),
      _meta: uiMeta(["app"])
    },
    async ({ runId, afterSeq, limit }) => {
      const state = requireRun(store, runId);
      const all = state.events.filter((event) => event.seq > afterSeq);
      const page = all.slice(0, limit).map((event) => safeProjectionValue(event));
      const nextSeq = page.at(-1)?.seq ?? afterSeq;
      return {
        structuredContent: {
          protocol: PROTOCOL,
          run: compactRun(state),
          events: page,
          nextSeq,
          hasMore: all.length > page.length
        },
        content: [{ type: "text", text: `Returned ${page.length} workflow events after sequence ${afterSeq}.` }],
        _meta: { stateVersion: state.stateVersion, eventCursor: state.eventCursor }
      };
    }
  );
  registerAppTool(
    server,
    "workflow_submit_decision",
    {
      title: "Submit workflow decision",
      description: "Record one idempotent answer to an open workflow decision. This does not invoke the skill; the widget must separately request agent-mediated continuation.",
      inputSchema: z.object({
        runId: z.string().min(1).max(128),
        commandId: z.string().min(1).max(160),
        expectedStateVersion: z.number().int().nonnegative(),
        command: z.object({
          type: z.enum(["intent.patch", "design.select"]),
          payload: z.record(z.string(), z.unknown())
        }).strict()
      }).strict(),
      outputSchema: runOutputSchema,
      annotations: annotations(),
      _meta: uiMeta(["app"])
    },
    async ({ runId, commandId, expectedStateVersion, command }) => {
      const result = applyStoredCommand(store, runId, {
        ...command,
        expectedStateVersion,
        idempotencyKey: commandId
      });
      return successWithRun(
        result.state,
        `Recorded the decision for workflow ${runId}. Ask Codex to resume the build-learning-booklet skill from authoritative state.`,
        { decisionAccepted: true }
      );
    }
  );
  registerAppTool(
    server,
    "workflow_render",
    {
      title: "Render learning-booklet workflow",
      description: "Attach the in-place Studio Path widget for a workflow and return a concise sanitized state summary.",
      inputSchema: z.object({ runId: z.string().min(1).max(128).optional() }).strict(),
      outputSchema: runOutputSchema,
      annotations: annotations({ readOnly: true }),
      _meta: uiMeta(["model"])
    },
    async ({ runId }) => {
      const state = requireRun(store, runId);
      return successWithRun(
        state,
        `Rendered workflow ${state.runId}: ${state.status}, current phase ${state.currentPhase}, state version ${state.stateVersion}.`
      );
    }
  );
  registerAppTool(
    server,
    "workflow_cancel_request",
    {
      title: "Request workflow cancellation",
      description: "Record cancellation intent only. It does not kill a local process or mark the workflow cancelled without later engine acknowledgement.",
      inputSchema: z.object({
        runId: z.string().min(1).max(128),
        commandId: z.string().min(1).max(160),
        expectedStateVersion: z.number().int().nonnegative(),
        reason: z.string().max(1e3).optional()
      }).strict(),
      outputSchema: runOutputSchema,
      annotations: annotations({ destructive: true }),
      _meta: uiMeta(["app"])
    },
    async ({ runId, commandId, expectedStateVersion, reason }) => {
      const result = applyStoredCommand(store, runId, {
        type: "input.request",
        expectedStateVersion,
        idempotencyKey: commandId,
        payload: {
          request: {
            type: "cancel_request",
            fields: [],
            prompt: reason || "User requested workflow cancellation; await agent acknowledgement."
          }
        }
      });
      return successWithRun(
        result.state,
        `Cancellation was requested for ${runId}; no claim is made that local execution has stopped.`,
        { cancelRequested: true }
      );
    }
  );
  return { server, store };
}
function createWorkflowServer({ store } = {}) {
  const server = new McpServer(
    { name: "learning-booklet-studio", version: "0.1.0" },
    {
      instructions: "Use workflow tools as a projection boundary. The build-learning-booklet skill and local engine remain authoritative; the widget never invokes them directly."
    }
  );
  registerWorkflowSurface(server, { store: store || createFileStore() });
  return server;
}
async function main() {
  const server = createWorkflowServer();
  await server.connect(new StdioServerTransport());
  console.error("Learning Booklet Studio MCP server is running on stdio.");
}
var directEntry = process.argv[1] ? pathToFileURL(path2.resolve(process.argv[1])).href : "";
if (import.meta.url === directEntry) {
  main().catch((error) => {
    console.error(`Learning Booklet Studio MCP server failed: ${error.message}`);
    process.exitCode = 1;
  });
}
export {
  PROTOCOL,
  WIDGET_URI,
  createWorkflowServer,
  main,
  registerWorkflowSurface
};
