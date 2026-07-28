# ADR 0004: local event and evidence state is authoritative

- Status: Accepted
- Date: 2026-07-22
- Owners: workflow engine and verification maintainers

## Context

The workflow creates local source-derived content and must function without the app service. Transcript prose and widget-local state are neither durable nor sufficiently typed for release decisions. Remote replication of complete prompts, sources, paths, or evidence would expand privacy and security exposure.

## Decision

Persist one atomic, versioned local run manifest; an append-only accepted-event log; a replayable materialized projection; immutable prior attempts/defects; generated artifacts; and digest-bound evidence. The event log plus validated artifacts/evidence are authoritative. The app server receives only an allowlisted, redacted projection. Widget state is disposable and reconciles from `STATE_SNAPSHOT` after remount or revision conflict.

Only executed `pass` evidence satisfies a hard gate. Artifact changes invalidate dependent evidence. A downstream failure reopens the earliest responsible phase and retains historical attempts.

## Consequences

- Skill-only and app-assisted runs share the same release truth.
- Restart replay and digest invalidation become required tests.
- Remote UI can recover without retaining sensitive local content.
- Release archives must include normalized evidence and referenced attachments.
- Local state evolution requires schema migration and compatibility policy.

## Alternatives rejected

- **Transcript as state:** rejected because it is untyped, compactable, and non-atomic.
- **Widget-local state as truth:** rejected because widgets are message-scoped and remountable.
- **Remote database as truth:** rejected because it compromises offline operation and data minimization.

## Requirement impact

`ENG-001`, `ENG-005`, `ENG-007`, `ENG-010`, `ENG-011`, `UI-004`, `UI-005`, `VER-003`, `VER-010`, and `SEC-006`/`SEC-009`.
