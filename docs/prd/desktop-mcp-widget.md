# PRD: desktop MCP widget

Status: MVP required.

## Problem

A long workflow is difficult to understand through transcript text alone. Users need an accessible, low-noise view of progress, design choices, evidence, failures, and repair while remaining inside their Codex task.

## Product thesis

The widget is an inspect-and-decide surface, not an autonomous local executor. It makes the workflow legible and delightful while preserving the host’s model, approval, and sandbox boundaries.

## Goals

- Inline phase timeline and current-state summary.
- Exactly three scannable design options during the required selection gate.
- Clear evidence, defect, repair, and release-gate inspection.
- Accessible keyboard-first operation and resilient state reconciliation.
- Native desktop verification in Codex mode on Intel, with Apple Silicon retained as a non-blocking compatibility advisory.

## Non-goals

- A persistent native sidebar, AppKit window, or replacement for ChatGPT desktop chrome.
- Direct invocation of a skill, local script, shell, or filesystem.
- A full code editor or browser automation surface.
- Decorative real-time animation or a fake progress percentage.
- Offline operation of the orchestration UI.

## Requirements

| ID | Normative requirement | Acceptance criterion | Test trace |
|---|---|---|---|
| UI-001 | The widget MUST render the latest run snapshot, ordered I0 then P0–P10 timeline, current layer/attempt, truthful status, and next user action. | Snapshot fixture renders correct order/status and never derives completion from percentage. | `tests/features/desktop-widget.feature @UI-001` |
| UI-002 | An unresolved visual gate MUST render exactly three complete, materially distinct design cards and one nonbinding recommendation. | DOM and visual assertions find three options with thesis, fit, system details, tradeoffs, and recommendation. | `tests/features/design-selection.feature @UI-002`; `tests/features/desktop-widget.feature @UI-002` |
| UI-003 | Direct design selection, recommended-default selection, delegated judgment, hybrid/revision instruction, or another interrupt answer MUST submit one idempotent decision and request agent-mediated resume on the same thread. | Double activation records one decision; hybrid/revision text is schema-bounded; follow-up references every open interrupt; resumed snapshot is reconciled. | `tests/features/design-selection.feature @UI-003`; `tests/features/desktop-widget.feature @UI-003` |
| UI-004 | The widget MUST expose evidence status/provenance, failed gate cause, reopened phase, repair attempt, and residual risk without presenting `not_run` as success. | Failure fixture shows causal phase and evidence details; repaired run retains prior failed attempt. | `tests/features/desktop-widget.feature @UI-004` |
| UI-005 | The widget MUST reconcile from `STATE_SNAPSHOT`, detect stale revisions, survive duplicate events, and recover after remount/reopen. | Reload and duplicate-delivery tests converge on the server snapshot and display a stale indicator during conflict. | `tests/features/desktop-widget.feature @UI-005` |
| UI-006 | No widget control or bridge call may directly invoke a local skill, script, shell, filesystem, or unrelated plugin tool. | Static allowlist and runtime spy show only declared app MCP tools plus `ui/message`/context calls. | `tests/integration/widget-contract.test.mjs`; `tests/features/security-and-source-trust.feature @SEC-010` |
| UI-007 | Cancellation MUST display `cancel_requested` until agent/engine terminal acknowledgement; language MUST not imply an immediate process kill. | Cancel fixture retains pending state and later reconciles to `cancelled`. | `tests/integration/mcp-server.test.mjs`; no Golden BDD scenario currently carries `@UI-007` |
| UI-008 | Every action MUST meet applicable WCAG 2.2 Level AA requirements, including keyboard operation, logical/visible/unobscured focus, usable names/instructions, non-color status cues, reduced motion, zoom support, and no trap. | Automated accessibility checks plus criterion-scoped manual keyboard/VoiceOver evidence pass. | `tests/features/desktop-widget.feature @UI-008 @MAC-005` plus per-architecture manual evidence |
| UI-009 | Consequential actions MUST expose accurate intent, show expected effect, and respect host confirmation/permission behavior. | Write-tool fixture produces the expected confirmation; read-only tool does not claim a write. | `tests/integration/mcp-server.test.mjs`; no Golden BDD scenario currently carries `@UI-009` |
| UI-010 | The widget MUST use versioned MCP UI resources, declared output schemas, exact CSP domains, and no subframes in MVP. | Inspector/host diagnostics show correct MIME, URI, schema, and no CSP violations. | `tests/integration/mcp-server.test.mjs`; native Inspector/host diagnostic remains manual |
| UI-011 | The widget MUST distinguish remote orchestration availability from the generated artifact’s offline capability. | Offline/degraded app state says orchestration unavailable while preserving access to local artifact evidence. | `tests/features/desktop-widget.feature @UI-011` |
| UI-012 | The complete widget journey MUST be executed in the native ChatGPT desktop app, Codex mode, on Intel (`x86_64`) against the exact candidate digest. The same non-translated Apple Silicon (`arm64`) journey is an independent non-blocking compatibility advisory. | Intel evidence proves inline render, decision, repair, completion, and reopen/reconcile for the production candidate; any Apple Silicon evidence is reported separately. | Shared behavior: `tests/features/desktop-widget.feature @MAC-005`; executed architecture policy: `docs/architecture/apple-silicon-verification.md` |
| UI-013 | The layout MUST work at narrow inline, normal inline, and host fullscreen sizes without horizontal page scroll or obscured focus. | Visual/interaction matrix passes at all three host layouts. | Static contract in `tests/integration/widget-contract.test.mjs`; executed host-layout matrix remains manual |
| UI-014 | The widget MUST present safe errors with stable code, plain-language consequence, retry/reconcile action, and no secret-bearing diagnostics. | Every error fixture is actionable and contains no stack trace, token, or absolute path. | Release-blocking coverage gap: no Golden BDD scenario currently carries `@UI-014` and no complete error fixture exists |

## Information architecture

1. Run identity, truthful status, and one primary next action.
2. Phase timeline with attempt and gate state.
3. Contextual decision panel when interrupted.
4. Evidence and artifacts, progressively disclosed.
5. Defects, repairs, residual risks, and release gates.

## Design-choice contract

Each of the exactly three cards exposes a distinctive name, thesis, learner/task fit, visual character, layout/navigation, typography, color roles, component language, code/diagram/evidence treatment, interaction/motion, responsive/print/accessibility behavior, implementation implications, strengths, and limitations. The primary scan view may summarize these fields, but every field remains available through an accessible disclosure.

The decision panel supports one option, the recommended option, delegated judgment, or a bounded hybrid/revision instruction. A hybrid is a request for the agent to synthesize one coherent system, never client-side concatenation. After resolution, the widget renders only the final authoritative direction plus its selection basis and user overrides; rejected options remain in audit history but not in the manifest value.

The primary surface uses restrained technical-editorial styling, native system typography, compact but breathable spacing, strong focus treatment, and semantic status tokens with text/icons in addition to color.

## MVP acceptance

All widget BDD, contract, accessibility, layout, Inspector, and required Intel native desktop checks pass. An implementation that works only as a standalone website is incomplete. Apple Silicon status remains an explicit compatibility advisory and does not block production.
