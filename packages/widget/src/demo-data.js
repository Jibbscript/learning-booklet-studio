export const PHASES = [
  { id: "I0", short: "Intent", label: "Clarify intent" },
  { id: "P0", short: "Charter", label: "Scope charter" },
  { id: "P1", short: "Research", label: "Research" },
  { id: "P2", short: "Learning", label: "Learning design" },
  { id: "P3", short: "Structure", label: "Information architecture" },
  { id: "P4", short: "Interact", label: "Interactions" },
  { id: "P5", short: "Visual", label: "Visual system" },
  { id: "P6", short: "Blueprint", label: "Technical blueprint" },
  { id: "P7", short: "Build", label: "Implementation" },
  { id: "P8", short: "Verify", label: "Test and verify" },
  { id: "P9", short: "Repair", label: "Adversarial repair" },
  { id: "P10", short: "Release", label: "Release" },
];

export const demoRun = {
  protocol: "codex-skill-ui/1",
  runId: "run-stringzilla-demo",
  topic: "String Search: From Scalar to SIMD",
  subtitle: "A verified, offline learning booklet for undergraduate CS learners.",
  mode: "plan_then_build",
  status: "active",
  currentLayer: "technical_design",
  currentPhase: "P6",
  stateVersion: 18,
  updatedAt: "2026-07-22T14:02:00.000Z",
  phases: PHASES.map((phase) => ({
    ...phase,
    status:
      ["I0", "P0", "P1", "P2", "P3", "P4", "P5"].includes(phase.id)
        ? "passed"
        : phase.id === "P6"
          ? "active"
          : "not_started",
  })),
  design: {
    selectedOptionId: "design-3",
    selectedName: "Studio Path",
    selectionMethod: "user-selected",
    designThesis:
      "A calm, guided studio that turns a rigorous build into a legible sequence of decisions, evidence, and repair loops.",
    system: [
      ["Typography", "Apple system sans + monospace"],
      ["Layout", "Guided workspace with evidence rail"],
      ["Color", "Warm white, plum, green, ink"],
      ["Components", "Flat panels, quiet borders, clear state"],
      ["Code", "Annotated, overflow-safe blocks"],
      ["Diagrams", "Labeled technical figures"],
      ["Responsive", "Rail collapses before content"],
      ["Print", "Linear, ink-conscious booklet"],
      ["Motion", "Subtle and fully reducible"],
      ["Accessibility", "WCAG AA, keyboard first"],
    ],
  },
  currentWork: {
    title: "Ready for blueprint",
    description:
      "The approved visual direction is locked. The next agent pass converts it into a one-file implementation architecture and scoped build sequence.",
    actions: [
      ["Generate architecture blueprint", "Define semantic structure, state flow, and technical decisions."],
      ["Define component inventory", "Map every surface, interaction state, and accessibility behavior."],
      ["Produce implementation plan", "Order increments, tests, gates, and repair paths."],
    ],
    locked: [
      "Visual system: Studio Path",
      "Artifact: one offline index.html",
      "Accessibility: WCAG AA and keyboard operable",
      "Evidence: current hashes only",
    ],
    assumption:
      "Benchmark numbers remain source-reported unless independently reproduced.",
    artifacts: [
      "architecture.md",
      "component-inventory.md",
      "data-flow.md",
      "implementation-plan.md",
      "test-strategy.md",
    ],
    constraints: [
      "No runtime network dependencies",
      "No analytics or telemetry",
      "One portable learning artifact",
      "Tests never pass without evidence",
    ],
  },
  activity: {
    live: false,
    recent: [
      ["14:02", "Blueprint step queued", "info"],
      ["14:01", "Scope contract generated", "success"],
      ["14:00", "Design decision saved", "success"],
      ["13:58", "Research evidence captured", "success"],
      ["13:55", "Learning plan updated", "info"],
    ],
  },
  journal: [
    {
      time: "13:58",
      title: "Research evidence captured",
      status: "Complete",
      actor: "Research phase",
      detail: "Recorded authoritative mechanisms, benchmark caveats, and source conflicts.",
      badge: "8 sources",
      id: "RES-2026-0722-0007",
      tone: "green",
    },
    {
      time: "14:00",
      title: "Design decision recorded",
      status: "Approved",
      actor: "You",
      detail: "Selected Design 3 — Studio Path as the workflow visual system.",
      badge: "Design 3",
      id: "DEC-2026-0722-0012",
      tone: "plum",
    },
    {
      time: "14:01",
      title: "Contract generated",
      status: "Locked",
      actor: "Contract phase",
      detail: "Preserved user decisions, assumptions, and release gates with provenance.",
      badge: "1 assumption",
      id: "CON-2026-0722-0018",
      tone: "blue",
    },
    {
      time: "14:02",
      title: "Verification queued",
      status: "Queued",
      actor: "Verification phase",
      detail: "Prepared browser, accessibility, offline, and release-readiness checks.",
      badge: "24 checks",
      id: "VER-2026-0722-0021",
      tone: "indigo",
    },
  ],
};
