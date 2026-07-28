# Contracts

Draft 2020-12 JSON Schemas for the deterministic workflow state, locked intent fields,
design resolution, command envelope, artifacts, evidence, gate results, event log, and
release decision. `automated-test-evidence.schema.json` defines the external, exact-candidate
test record consumed by the release verifier; every passing check and command resolves to a
retained, digest-verified result beneath the evidence bundle.

`codex-skill-ui-event.schema.json` closes the public transport envelope for the
`codex-skill-ui/1` projection. Type-specific lifecycle, snapshot, interrupt,
ordering, redaction, and 256 KiB invariants are enforced by the packaged
workflow-engine adapter.

`run-state.schema.json` separates stable `threadId` from per-attempt `runId`,
records `parentRunId` and complete `resume[]` on child runs, and carries an
execution terminal outcome independent of workflow status. Phase `attempts[]`
retain failed evidence/gate snapshots across causal reopen and repair.

`intent-state.schema.json` permits fields to be absent during intake. The separately
addressable `intent-manifest.schema.json` requires every canonical intent field for a locked,
compiled manifest; the engine additionally enforces authoritative provenance at I0.

The engine intentionally has no schema-validator dependency. Hosts may validate at their
boundary with any standards-compliant JSON Schema implementation. Runtime invariants that
depend on the current state—such as artifact-hash freshness and transitive invalidation—are
enforced by `packages/workflow-engine` rather than by static schemas alone.
