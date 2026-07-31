export const PHASE_STATUS = Object.freeze([
  "not_started",
  "active",
  "awaiting_user",
  "failed",
  "passed",
  "stale",
  "skipped",
]);

export const RUN_STATUS = Object.freeze([
  "draft",
  "active",
  "awaiting_user",
  "failed_gate",
  "blocked_external",
  "specified",
  "planned",
  "completed",
]);

export const EXECUTION_STATUS = Object.freeze([
  "running",
  "interrupt",
  "success",
  "cancelled",
  "failed",
]);

export const RUN_OUTCOMES = Object.freeze(["success", "interrupt", "cancelled"]);

export const RUN_MODES = Object.freeze(["manifest_only", "plan_only", "plan_then_build"]);

export const EVIDENCE_STATUS = Object.freeze([
  "pass",
  "fail",
  "partial",
  "not_run",
  "not_applicable",
]);

export const DESIGN_SELECTION_METHODS = Object.freeze([
  "user-selected",
  "user-hybridized",
  "recommended-default",
  "delegated",
  "direct",
]);

export const INTENT_ORIGINS = Object.freeze([
  "user",
  "researched",
  "inferred",
  "defaulted",
]);

export const REQUIRED_INTENT_FIELDS = Object.freeze([
  "topic",
  "learner",
  "depth",
  "duration",
  "scope",
]);

export const AUTHORITATIVE_INTENT_ORIGINS = Object.freeze(["user", "researched"]);

export const PHASES = Object.freeze([
  {
    id: "I0",
    order: 0,
    layer: "intent",
    name: "Intent and design",
    outputKind: "intent",
    gates: [
      "intent.required_fields_authoritative",
      "intent.no_critical_conflicts",
      "design.selection_valid",
    ],
  },
  {
    id: "P0",
    order: 1,
    layer: "planning",
    name: "Charter",
    outputKind: "charter",
    gates: ["charter.topic_learner_alignment", "charter.scope_feasible"],
  },
  {
    id: "P1",
    order: 2,
    layer: "planning",
    name: "Research",
    outputKind: "research",
    gates: ["research.claims_supported", "research.citations_checked"],
  },
  {
    id: "P2",
    order: 3,
    layer: "planning",
    name: "Learning architecture",
    outputKind: "learning",
    gates: ["learning.objective_traceability"],
  },
  {
    id: "P3",
    order: 4,
    layer: "planning",
    name: "Information architecture",
    outputKind: "ia",
    gates: ["ia.concept_homes", "ia.hierarchy_coherent"],
  },
  {
    id: "P4",
    order: 5,
    layer: "planning",
    name: "Interaction design",
    outputKind: "interactions",
    gates: ["interaction.objective_mapping", "interaction.state_accessibility_tests"],
  },
  {
    id: "P5",
    order: 6,
    layer: "planning",
    name: "Product design",
    outputKind: "visual",
    gates: [
      "visual.selected_direction_operationalized",
      "visual.accessible_responsive_coherent",
    ],
  },
  {
    id: "P6",
    order: 7,
    layer: "planning",
    name: "Technical architecture",
    outputKind: "technical-plan",
    gates: ["architecture.single_file_offline", "architecture.deterministic_init_keyboard"],
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
      "implementation.controls_work",
    ],
  },
  {
    id: "P8",
    order: 9,
    layer: "build",
    name: "Verification",
    outputKind: "verification",
    gates: [
      "verification.critical_checks_executed",
      "verification.unavailable_marked_not_run",
    ],
  },
  {
    id: "P9",
    order: 10,
    layer: "build",
    name: "Adversarial repair",
    outputKind: "adversarial",
    gates: ["adversarial.no_blocker_or_major", "adversarial.regressions_rerun"],
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
      "release.no_major_findings",
    ],
  },
]);

export const PHASE_IDS = Object.freeze(PHASES.map(({ id }) => id));
export const PHASE_BY_ID = Object.freeze(Object.fromEntries(PHASES.map((phase) => [phase.id, phase])));

export const ARTIFACT_KINDS = Object.freeze(PHASES.map(({ outputKind }) => outputKind));

export const ARTIFACT_DEPENDENCIES = Object.freeze(
  Object.fromEntries(
    PHASES.map((phase, index) => [
      phase.outputKind,
      index === 0 ? [] : [PHASES[index - 1].outputKind],
    ]),
  ),
);

export const PHASE_EVENT_TYPES = Object.freeze([
  "run.created",
  "run.finished",
  "run.updated",
  "phase.started",
  "phase.completed",
  "phase.failed",
  "phase.reopened",
  "phase.invalidated",
  "gate.evaluated",
  "artifact.updated",
  "input.requested",
  "design.options.proposed",
  "design.selected",
  "verification.recorded",
  "run.specified",
  "run.planned",
  "run.completed",
]);

export function getPhase(phaseId) {
  return PHASE_BY_ID[phaseId];
}

export function phaseIdsForMode(mode) {
  if (mode === "manifest_only") return ["I0"];
  if (mode === "plan_only") return PHASE_IDS.slice(0, PHASE_IDS.indexOf("P6") + 1);
  if (mode === "plan_then_build") return [...PHASE_IDS];
  return [];
}

export function downstreamArtifactKinds(kind, { includeSource = false } = {}) {
  const index = ARTIFACT_KINDS.indexOf(kind);
  if (index < 0) return [];
  return ARTIFACT_KINDS.slice(includeSource ? index : index + 1);
}

export function downstreamPhaseIds(phaseId, { includeSource = false } = {}) {
  const index = PHASE_IDS.indexOf(phaseId);
  if (index < 0) return [];
  return PHASE_IDS.slice(includeSource ? index : index + 1);
}
