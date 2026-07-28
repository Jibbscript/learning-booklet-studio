# ADR 0002: agent-mediated MCP Apps UI boundary

- Status: Accepted
- Date: 2026-07-22
- Owners: MCP server and widget maintainers

## Context

An MCP Apps widget is rendered in a sandboxed iframe and communicates through documented app tools and host bridge messages. It is not a native AppKit extension and does not receive an unrestricted local skill, shell, or filesystem API. Letting UI controls imply direct local execution would misrepresent the platform boundary and bypass approval, authorization, and provenance.

## Decision

Use the widget as an inspect-and-decide projection. It reads sanitized workflow state from declared MCP tools and submits idempotent decisions or requests. A consequential UI action asks the host/model to continue the same task through documented bridge behavior; the agent invokes the skill and local tools under normal Codex authority. The widget never calls a local skill, shell, script, or filesystem directly.

## Consequences

- Host permissions, model mediation, and Codex sandboxing remain authoritative.
- Remote MCP state is a disposable projection, not release truth.
- “Cancel” is a request until the engine acknowledges a terminal state.
- Local workflow execution remains possible when the widget/server is unavailable.
- App tool descriptions, annotations, schemas, and CSP must exactly match behavior.

## Alternatives rejected

- **Direct widget-to-shell bridge:** unsupported and unsafe.
- **Remote server as workflow authority:** rejected because it would upload unnecessary local state and make offline core work impossible.
- **Standalone web dashboard:** rejected because the required experience is inline in a Codex task.

## Requirement impact

`UI-003`, `UI-006`, `UI-009`–`UI-011`, `ENG-009`, `ENG-010`, `SEC-003`–`SEC-005`, and `SEC-010`.
