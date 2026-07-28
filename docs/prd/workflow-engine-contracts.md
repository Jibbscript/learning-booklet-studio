# PRD: workflow engine and contracts

Status: MVP required.

## Problem

Model prose cannot safely serve as a workflow database or release decision. The product needs a deterministic engine that accepts typed commands, writes an append-only run history, materializes state, validates evidence, and rejects illegal or stale updates.

## Goals

- Versioned, atomic, replayable local state.
- Strict `codex-skill-ui/1` commands/events and stable failure codes.
- Phase dependencies, remediation, evidence invalidation, and interrupt/resume.
- Safe replication of sanitized progress to the MCP app.

## Non-goals

- A distributed workflow scheduler.
- Arbitrary user-authored executable phases.
- Storing private chain-of-thought.
- Treating the MCP projection or widget state as release truth.
- Guaranteeing compatibility with all future AG-UI versions.

## Requirements

| ID | Normative requirement | Acceptance criterion | Test trace |
|---|---|---|---|
| ENG-001 | The engine MUST atomically persist a versioned manifest, append-only events, projection, evidence, and defects under one run ID. | Simulated write interruption leaves either the prior valid revision or the complete next revision, never mixed state. | Release-blocking coverage gap: no Golden BDD scenario or current unit test fault-injects an atomic write |
| ENG-002 | Confirmed/defaulted/inferred values MUST carry provenance and lock state; locked user values require an explicit superseding decision. | A conflicting phase update fails with `PROVENANCE_LOCKED`; an authorized override records both values. | `tests/features/intent-manifest.feature @ENG-002` |
| ENG-003 | Every command MUST be idempotent by `commandId`; conflicting reuse MUST fail. | Identical retry returns original result once; changed body returns `IDEMPOTENCY_CONFLICT`. | `tests/features/design-selection.feature @ENG-003`; `tests/features/phase-orchestration.feature @ENG-003`; `tests/features/desktop-widget.feature @ENG-003` |
| ENG-004 | Canonical local events MUST validate against `workflow-event.schema.json`; public projection events and commands MUST validate strictly against `codex-skill-ui/1`, including version, enums, unknown fields, size, and redaction. | Malformed fixtures fail with stable codes; valid local events map deterministically to valid dialect events. | `tests/unit/workflow-engine.test.mjs`; no Golden BDD scenario currently carries `@ENG-004` |
| ENG-005 | Materialized state MUST equal replay of accepted local events; local cursors and per-transport dialect `seq`/revision values MUST each be monotonic and gap-free. | Replay after restart produces a byte-equivalent normalized projection; a gap in either layer is rejected. | `tests/features/phase-orchestration.feature @ENG-005` |
| ENG-006 | Only declared run/phase transitions are legal; every run ends in exactly one terminal event. | Transition matrix property tests reject illegal edges and duplicate terminal events. | `tests/features/phase-orchestration.feature @ENG-006` plus `tests/unit/workflow-engine.test.mjs` |
| ENG-007 | Phase retries and downstream reopenings MUST retain prior attempts, defects, and failed evidence. | Retry increments attempt and preserves immutable prior history. | `tests/unit/workflow-engine.test.mjs`; no Golden BDD scenario currently carries `@ENG-007` |
| ENG-008 | Interrupts MUST be terminal per run; a resume run MUST resolve every open interrupt on the same thread. | Partial or unknown resume fails; complete resume starts a child run at the responsible phase. | Partial unit coverage in `tests/unit/workflow-engine.test.mjs`; no Golden BDD scenario currently carries `@ENG-008` |
| ENG-009 | Cancellation MUST distinguish `cancel_requested` from confirmed `cancelled` and MUST not claim a local process stopped until terminal evidence exists. | UI request alone leaves `cancel_requested`; engine acknowledgement produces terminal cancellation. | `tests/integration/mcp-server.test.mjs`; no Golden BDD scenario currently carries `@ENG-009` |
| ENG-010 | Remote projections MUST be allowlisted and sanitized; source bodies, secrets, absolute paths, and chain-of-thought are prohibited. | Redaction fixtures and payload inspection show only approved fields. | `tests/integration/mcp-server.test.mjs` and `tests/features/security-and-source-trust.feature @SEC-007 @SEC-010` |
| ENG-011 | Evidence MUST bind to requirement/check, producer, environment, and artifact digest; changed digests MUST invalidate dependent evidence. | Mutation after pass changes gate to stale/fail until check reruns. | `tests/features/evidence-gates.feature @ENG-011 @VER-003` |
| ENG-012 | Stable error codes and safe messages MUST cover schema, transition, sequence, revision, idempotency, interrupt, evidence, digest, size, authorization, and internal failures. | Golden error fixture asserts code and confirms no stack trace/secret leakage. | Release-blocking coverage gap: no Golden BDD scenario currently carries `@ENG-012` and no complete error fixture exists |
| ENG-013 | The engine MUST support the exact layer IDs in the workflow mapping and reject undeclared phase injection. | I0 and P0–P10 validate in dependency order; an added executable phase is rejected. | `tests/features/intent-manifest.feature @ENG-013`; `tests/features/phase-orchestration.feature @ENG-013` |
| ENG-014 | Native Intel execution MUST prove persistence, restart replay, interrupt/resume, retry, and projection reconciliation against the exact packaged engine candidate. Apple Silicon MAY prove the same behavior independently as a non-blocking compatibility advisory. | The required Intel bundle includes command logs, digests, and matching post-restart projection; any Apple Silicon bundle is validated separately and cannot substitute for Intel. | Manual architecture policy in `docs/architecture/apple-silicon-verification.md` |

## Performance and limits

- A command without external verification SHOULD complete within 250 ms at p95 on the required native Intel release-test architecture and on Apple Silicon when advisory evidence is collected.
- An event is at most 256 KiB; pages are at most 200 events and 1 MiB encoded.
- State replay for a 10,000-event fixture SHOULD complete within two seconds on the release machine.
- Payload limit failures are deterministic and never truncate into valid-looking state.

## MVP acceptance

All schema fixtures, transition/property tests, replay tests, BDD scenarios, and required native Intel packaged-engine checks pass. Apple Silicon results are retained as non-blocking compatibility advisories. No release path may bypass the engine’s production-required gate calculation.
