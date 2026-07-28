# ADR 0003: versioned `codex-skill-ui/1` event dialect

- Status: Accepted
- Date: 2026-07-22
- Owners: workflow engine, MCP server, and widget maintainers

## Context

AG-UI provides useful event, state, tool, and human-in-the-loop concepts, but the OpenAI MCP Apps bridge is the actual UI transport for this product. Calling the integration “AG-UI compatible” without implementing and testing that protocol would create a false interoperability claim. AG-UI is pre-1.0 and its public contracts can change.

## Decision

Define and publish a closed, versioned application dialect named `codex-skill-ui/1`. Its minimum event vocabulary is `RUN_STARTED`, `RUN_FINISHED`, `RUN_ERROR`, `STEP_STARTED`, `STEP_FINISHED`, `STATE_SNAPSHOT`, `TOOL_CALL_START`, `TOOL_CALL_ARGS`, `TOOL_CALL_END`, `TOOL_CALL_RESULT`, and `MESSAGES_SNAPSHOT`. Human decisions are terminal per run: `RUN_FINISHED` carries outcome `interrupt`; a child run on the same task resolves every open interrupt before continuing. The MCP Apps bridge transports commands and projections, but is not replaced by AG-UI SSE.

Pin `@ag-ui/core` `0.0.57` only where schemas/types are intentionally reused. State the inspiration and license attribution, and make no broader wire-compatibility claim.

## Consequences

- Commands/events can be schema-tested, replayed, and versioned independently of UI transport.
- Consumers must reject unknown major dialect versions and invalid terminal/resume sequences.
- `STATE_DELTA` is deferred; snapshots are the MVP reconciliation primitive.
- Any future AG-UI interoperability is a separate ADR and conformance project.

## Alternatives rejected

- **Claim native AG-UI transport:** rejected because MCP Apps bridge messages are the platform transport.
- **Ad hoc unversioned JSON:** rejected because replay and compatibility would be ambiguous.
- **Full AG-UI feature surface in MVP:** rejected as unnecessary pre-1.0 coupling.

## Requirement impact

`ENG-003`–`ENG-008`, `UI-003`, `UI-005`, `OSS-004`, and `OSS-008`.
