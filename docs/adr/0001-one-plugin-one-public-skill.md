# ADR 0001: one plugin and one public orchestrator skill

- Status: Accepted
- Date: 2026-07-22
- Owners: skill and distribution maintainers

## Context

The source method contains intake, three-option design selection, phases P0–P10, nested verification loops, and release evidence. Publishing each phase as a separate discoverable skill would make users select implementation internals, duplicate state, and increase instruction collisions. A single monolithic `SKILL.md` would instead consume excessive context and weaken phase isolation.

## Decision

Ship one Codex plugin with exactly one public skill at `skills/build-learning-booklet/`. Keep `SKILL.md` as a lean router and load the complete reference for only the current phase plus directly required contracts. Deterministic scripts own compilation, state, audits, and release checks. The skill supports `manifest_only`, `plan_only`, and `plan_then_build` and remains fully useful without the app UI.

## Consequences

- Users invoke one stable capability and do not manage phase skills.
- Progressive disclosure reduces context while retaining the full method.
- References and scripts become versioned internal contracts and require traceability.
- Phase injection and missing references must fail closed.
- The widget can enhance inspection and decisions but cannot become a dependency.

## Alternatives rejected

- **Eleven public phase skills:** rejected because it exposes workflow machinery and fragments state.
- **One giant prompt/skill body:** rejected because unrelated instructions compete for context.
- **Widget-first product:** rejected because the core workflow must survive without an MCP service.

## Requirement impact

`ORCH-001`–`ORCH-003`, `ORCH-008`, `ENG-013`, `OSS-001`, and `OSS-002`.
