# `codex-skill-ui/1` event dialect

## Status and intent

`codex-skill-ui/1` is the product-owned event and command dialect between the workflow engine, MCP projection service, and widget. It is **AG-UI-inspired**, not a claim of wire compatibility and not a replacement for the MCP Apps host bridge.

The MVP pins its AG-UI reference baseline to `@ag-ui/core` `0.0.57`. AG-UI is pre-1.0 and may drift; upgrading the reference version requires an ADR and contract regression run. Reference material: [events](https://docs.ag-ui.com/concepts/events), [state](https://docs.ag-ui.com/concepts/state), [interrupts](https://docs.ag-ui.com/concepts/interrupts), [tools](https://docs.ag-ui.com/concepts/tools), [architecture](https://docs.ag-ui.com/concepts/architecture), and [source schemas](https://github.com/ag-ui-protocol/ag-ui/tree/main/sdks/typescript/packages/core/src).

## Transport

Within ChatGPT, the widget receives dialect payloads inside MCP tool `structuredContent` delivered through the MCP Apps bridge. Widget commands use `tools/call`. The dialect MUST NOT be sent as unvalidated arbitrary `postMessage` traffic.

An optional standalone adapter MAY expose AG-UI-style SSE as a POSTed JSON run input followed by `data: <JSON>\n\n` frames. AG-UI does not define a standard reconnect cursor in the pinned baseline. `afterSeq` paging is a Learning Booklet Studio extension and MUST NOT be advertised as standard AG-UI resume behavior.

## Local audit-event adapter

The engine's canonical local audit log uses `contracts/workflow-event.schema.json` and lowercase domain events. It is not the public UI dialect. A deterministic projection adapter validates the local event, calculates the sanitized snapshot, and emits `codex-skill-ui/1` events with a separate per-transport-run sequence:

| Canonical local event | Required UI projection |
|---|---|
| `run.created` | `RUN_STARTED`, then `STATE_SNAPSHOT` |
| `phase.started` | `STEP_STARTED`, then `STATE_SNAPSHOT` |
| `phase.completed` or `phase.failed` | `STEP_FINISHED`, then `STATE_SNAPSHOT` |
| `input.requested` | `MESSAGES_SNAPSHOT`, then `STATE_SNAPSHOT` showing the open interrupt |
| `run.finished` | final `STATE_SNAPSHOT`, then terminal `RUN_FINISHED` with the canonical event's `outcome`; successful events include matching `workflowStatus` |
| `run.specified`, `run.planned`, or `run.completed` | refreshed `STATE_SNAPSHOT`; the following `run.finished(outcome=success)` owns the terminal UI event |
| `phase.invalidated`, `gate.evaluated`, `artifact.updated`, `design.*`, `verification.recorded`, or `run.updated` | refreshed `STATE_SNAPSHOT`; step/run events only when their declared lifecycle boundary is crossed |

Tool lifecycle events are produced around real tool execution and reference the causal canonical event/evidence; they are not fabricated from a completed state. Invalid local events, missing redaction, or a non-deterministic projection MUST stop publication.

The packaged implementation is
`packages/workflow-engine/codex-skill-ui-adapter.mjs`. Its public entry points are
`projectCodexSkillUiEvents`, `projectCodexSkillUiJourney`, and
`validateCodexSkillUiSequence`; its closed envelope is
`contracts/codex-skill-ui-event.schema.json`. The deterministic native fixture
retains both emitted run sequences and their validator results in its JSON report.

## Event envelope

Every event is a complete JSON object:

```json
{
  "protocol": "codex-skill-ui/1",
  "type": "STEP_FINISHED",
  "eventId": "evt_01J...",
  "threadId": "thread_01J...",
  "runId": "run_01J...",
  "parentRunId": null,
  "seq": 14,
  "timestamp": "2026-07-22T12:34:56.789Z",
  "source": "workflow-engine",
  "payload": {}
}
```

| Field | Rule |
|---|---|
| `protocol` | Exactly `codex-skill-ui/1` |
| `type` | One allowed event type below |
| `eventId` | Globally unique, immutable identifier |
| `threadId` | Stable across interrupted/resumed runs |
| `runId` | Stable for one uninterrupted execution attempt |
| `parentRunId` | Required on a resumed or repair run; otherwise `null` |
| `seq` | Zero-based, strictly increasing without gaps within one transport run; independent of the one-based canonical local audit cursor |
| `timestamp` | UTC RFC 3339 timestamp with milliseconds |
| `source` | `orchestrator`, `workflow-engine`, `mcp-server`, `widget`, or a registered verifier ID |
| `payload` | Type-specific object; unknown fields are rejected in strict validation |

Event size MUST NOT exceed 256 KiB. Artifact bodies, screenshots, source documents, chain-of-thought, credentials, and raw secrets MUST NOT appear in events.

## Required event types

### Run lifecycle

- `RUN_STARTED`: includes workflow version, manifest digest, requested objective, and inherited `resume[]` when applicable.
- `RUN_FINISHED`: includes `outcome` of `success`, `interrupt`, or `cancelled`, final revision, summary evidence IDs, and mode-specific `workflowStatus` (`specified`, `planned`, or `completed`) when outcome is `success`.
- `RUN_ERROR`: includes stable error code, safe message, retryability, and responsible step; no stack trace or secret-bearing payload.

### Step lifecycle

- `STEP_STARTED`: includes phase ID, attempt, declared outputs, and required gate IDs; evidence IDs do not exist until checks execute.
- `STEP_FINISHED`: includes phase ID, attempt, outcome `passed|failed|partial`, produced artifact references, evidence IDs, and next legal phase.

Exactly one terminal event (`RUN_FINISHED` or `RUN_ERROR`) MUST end every run.

### State

- `STATE_SNAPSHOT`: complete, sanitized materialized projection with `revision`, run status, phase list, open interrupts, artifact metadata, evidence summaries, defects, and release gates.

The engine MUST emit a snapshot after run start, every accepted command, each step terminal transition, and before the terminal run event. `STATE_DELTA` is deferred. If added later, it MUST use RFC 6902 JSON Patch and remain optional because consumers must always recover from a snapshot.

### Tool lifecycle

- `TOOL_CALL_START`: tool-call ID, safe tool name, owning phase, and declared mutability.
- `TOOL_CALL_ARGS`: one complete validated argument object in MVP; sensitive fields are redacted.
- `TOOL_CALL_END`: confirms argument transmission and dispatch.
- `TOOL_CALL_RESULT`: status, duration, safe summary, result/evidence references, and retryability.

Each `TOOL_CALL_START` MUST be followed in order by `TOOL_CALL_ARGS`, `TOOL_CALL_END`, and `TOOL_CALL_RESULT`, or by `RUN_ERROR` that references the open tool-call ID.

### Human-in-the-loop message boundary

- `MESSAGES_SNAPSHOT`: a complete, model-visible summary of the decision context, one concise user question, allowed response shape, and every currently open interrupt ID.

It contains final user-facing text only. Private reasoning and hidden model instructions are prohibited.

## Interrupt and resume contract

Human-in-the-loop is terminal per run:

1. Emit `MESSAGES_SNAPSHOT` with all open decisions.
2. Emit `STATE_SNAPSHOT` showing those interrupts.
3. Emit `RUN_FINISHED` with `outcome: "interrupt"`.
4. Start a new run on the same `threadId` after the user responds.
5. `RUN_STARTED.payload.resume` MUST provide one resolution for every open interrupt.

```json
{
  "resume": [
    {
      "interruptId": "int_design_choice",
      "value": { "selection": "design-2" }
    }
  ]
}
```

Partial resume is rejected with `INTERRUPT_SET_INCOMPLETE`. The engine does not maintain an indefinitely paused active run.
Unknown interrupt IDs fail with `INTERRUPT_NOT_OPEN`, mutation of the terminated
parent fails with `RUN_TERMINAL`, and changing the thread or reusing the parent
`runId` fails `INVALID_TRANSITION`. The child state's first `run.created` event
contains its exact inherited `resume[]`; deterministic projection maps that event
to `RUN_STARTED.payload.resume`.

The canonical engine entry point is:

```js
resumeRunState(parentState, {
  runId: "new-child-run-id",
  threadId: parentState.threadId,
  resume: [{ interruptId: "decision:4", value: { selection: {} } }]
})
```

Persistent skill execution uses `workflow-state.mjs resume`, which writes a new
child run root and leaves the terminal parent state file byte-for-byte unchanged.

## Command envelope

```json
{
  "protocol": "codex-skill-ui/1",
  "type": "SUBMIT_DECISION",
  "commandId": "cmd_01J...",
  "threadId": "thread_01J...",
  "runId": "run_01J...",
  "expectedRevision": 9,
  "timestamp": "2026-07-22T12:35:10.000Z",
  "payload": {}
}
```

Allowed MVP commands are `CREATE_WORKFLOW`, `START_RUN`, `SUBMIT_DECISION`, `REQUEST_RETRY`, `REQUEST_CANCEL`, `PUBLISH_SNAPSHOT`, and `GET_EVENTS`. The same `commandId` and identical body MUST return the original result. Reuse with a different body MUST fail `IDEMPOTENCY_CONFLICT`. A stale `expectedRevision` MUST fail `REVISION_CONFLICT` and return the current revision without applying the command.

## Snapshot minimum shape

```json
{
  "revision": 10,
  "workflowStatus": "active",
  "executionStatus": "running",
  "currentPhase": "P1",
  "phases": [],
  "openInterrupts": [],
  "artifacts": [],
  "evidence": [],
  "defects": [],
  "releaseGates": []
}
```

Consumers MUST render unknown future enum values as an “unsupported state” warning and preserve recovery controls. They MUST NOT infer success from a missing workflow or execution status.

## Error codes

The initial stable set is `INVALID_SCHEMA`, `UNSUPPORTED_PROTOCOL`, `INVALID_TRANSITION`, `SEQUENCE_GAP`, `REVISION_CONFLICT`, `IDEMPOTENCY_CONFLICT`, `INTERRUPT_NOT_OPEN`, `INTERRUPT_SET_INCOMPLETE`, `EVIDENCE_MISSING`, `EVIDENCE_STALE`, `ARTIFACT_DIGEST_MISMATCH`, `PAYLOAD_TOO_LARGE`, `UNAUTHORIZED`, and `INTERNAL_ERROR`.

## Conformance

A conforming producer passes schema fixtures for every event and command, replay determinism, duplicate delivery, revision conflict, sequence gap, interrupt/resume, redaction, event-size limit, and unknown-version rejection. A conforming widget can rebuild its visible state from the latest `STATE_SNAPSHOT` without replaying earlier UI-local state.
