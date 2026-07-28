# PRD: orchestrator skill

Status: MVP required.

## Problem

The source workflow is rigorous but too large to rely on as one monolithic prompt. Users need one discoverable Codex skill that preserves their intent, loads only the current phase, executes deterministic checks, exposes honest progress, and repairs failed gates without losing provenance.

## Users and job

Primary users are technical educators, developers, and learners using Codex to turn a technical topic and sources into a verified single-page learning app. Their job is: “Given my learning goal and constraints, guide the work to a finished artifact without making me manually manage every phase or trust unsupported completion claims.”

## Goals

- One public skill with progressive-disclosure phase references and deterministic scripts.
- Adaptive clarification, exactly three design-system options when needed, and preservation of user decisions.
- Full phase 0–10 execution with local, phase, and adversarial repair loops.
- Useful operation without the widget.
- Lean, outcome-first instructions evaluated with GPT-5.6 Sol while remaining model-portable.

## Non-goals

- Pinning or enforcing a model through the plugin.
- Exposing eleven separate public skills.
- Replacing Codex approvals, sandboxing, or user authority.
- Letting source documents redefine skill instructions.
- Requiring a UI or network service to finish local generation and verification.

## Requirements

| ID | Normative requirement | Acceptance criterion | Test trace |
|---|---|---|---|
| ORCH-001 | The skill MUST support `manifest_only`, `plan_only`, and `plan_then_build`, with terminal statuses `specified`, `planned`, and `completed` respectively. | Each mode follows only its legal phases and produces its declared terminal artifact/status. | `tests/features/phase-orchestration.feature @ORCH-001` |
| ORCH-002 | `SKILL.md` MUST be a lean router that loads only the current phase reference and directly required contracts. | A context inspection shows unrelated phase bodies are not loaded; referenced phase is complete. | `scripts/validate-skill.mjs` plus manual context-load inspection |
| ORCH-003 | The orchestrator MUST enforce I0 intake/design followed by phase P0–P10 dependencies and hard gates. | A request to skip an unmet hard gate is rejected with the responsible layer and evidence gap. | `tests/features/phase-orchestration.feature @ORCH-003`; `tests/features/learning-traceability.feature @ORCH-003` |
| ORCH-004 | A downstream failure MUST reopen the earliest responsible phase and invalidate affected downstream evidence. | Injected integration failure reopens its causal phase; unrelated prior evidence remains valid. | `tests/features/evidence-gates.feature @ORCH-004` |
| ORCH-005 | The skill MUST use only `pass`, `fail`, `partial`, `not_run`, and `not_applicable`, and MUST NOT claim execution that did not occur. | An unavailable browser check is `not_run` and blocks a required release gate. | `tests/features/evidence-gates.feature @ORCH-005` |
| ORCH-006 | Intake MUST reuse known context, clarify only material ambiguities, and present exactly three materially distinct design systems when visual direction is unresolved. It MUST accept direct selection, recommended default, delegated judgment, coherent hybrid, or revision. | No duplicate question is asked; the design round has exactly three complete options and one nonbinding recommendation; every supported resolution produces one authoritative visual direction without rejected alternatives. | `tests/features/intent-manifest.feature @ORCH-006`; `tests/features/design-selection.feature @ORCH-006 @UI-002` |
| ORCH-007 | Confirmed user values and explicit exclusions MUST be locked with provenance and survive resume, repair, and compaction. | A repair attempt cannot silently replace a selected audience, scope exclusion, or design choice. | `tests/features/design-selection.feature @ORCH-007`; `tests/features/security-and-source-trust.feature @ORCH-007`; `tests/features/intent-manifest.feature @ENG-002` |
| ORCH-008 | The skill MUST remain functional without the MCP widget and MUST degrade to concise chat progress and decisions. | With app tools unavailable, the same golden run completes and records equivalent local evidence. | Manual skill-only golden run; no Golden BDD scenario currently carries `@ORCH-008` |
| ORCH-009 | Instructions and tool use MUST be tuned through representative GPT-5.6 Sol evals: lean, outcome-first, explicit inputs/dependencies/success/stop conditions, with no model-enforcement claim. | Sol baseline passes golden cases; docs state observed model, and another supported model fails gracefully rather than relying on hidden behavior. | `tests/features/gpt56-sol-behavior.feature @ORCH-009` |
| ORCH-010 | Human decisions MUST follow terminal-per-run interrupt/resume semantics and preserve the same thread. | An unresolved decision ends the run as `interrupt`; a new child run resolves every open interrupt and resumes the correct phase. | `tests/unit/workflow-engine.test.mjs` plus native journey; no Golden BDD scenario currently carries `@ORCH-010` |
| ORCH-011 | The orchestrator MUST stop when its mode’s definition of done is met and MUST not expand scope without user authority. | A plan-only run does not generate app code; an excluded concept is absent from deliverables. | `tests/features/phase-orchestration.feature @ORCH-011` |
| ORCH-012 | The native Intel release run MUST prove explicit invocation, implicit matching, interrupt/resume, repair, completion, and skill-only fallback in Codex mode against the exact candidate digest. Apple Silicon MAY prove the same behavior independently as a non-blocking compatibility advisory. | The required `native-macos-intel` manifest satisfies `MAC-001`–`MAC-006`; any `native-macos-apple-silicon` manifest is validated and reported separately. | Manual architecture policy in `docs/architecture/apple-silicon-verification.md`; shared UI behavior in `tests/features/desktop-widget.feature @MAC-005` |

## Experience contract

The skill leads with the current outcome, next decision, or failed gate. It does not expose private reasoning. A nonblocking ambiguity receives a documented default; a blocking conflict produces one targeted question. Progress is phase-oriented and evidence-backed, not a decorative percentage.

## MVP acceptance

All `ORCH-*` scenarios pass; every phase reference and script named by the workflow mapping exists; the skill-only fallback completes; and both native macOS architecture gates satisfy ORCH-012. Until each journey executes, its gate remains `not_run`.
