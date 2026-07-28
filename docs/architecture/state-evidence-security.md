# State, evidence, and security model

## Sources of truth

| State | Authority | Persistence | Widget treatment |
|---|---|---|---|
| Workflow manifest | Local run directory | Whole run and release archive | Read-only projection |
| Execution event log | Local append-only `events.ndjson` | Whole run and release archive | Sanitized replicated projection |
| Materialized run state | Deterministic replay of local events | Rebuildable cache | Reconciled through `STATE_SNAPSHOT` |
| Generated artifacts | Local workspace files | User-controlled | Metadata and approved previews only |
| Verification evidence | Local evidence manifest and referenced files | Release archive | Status, summary, provenance, digest |
| MCP projection | App server | Disposable/rebuildable | Primary UI read source, never release truth |
| View preferences | Widget instance | Message lifetime | Ephemeral only |

The transcript and model prose are not authoritative state. The app backend receives sanitized projections, not unrestricted workspace contents.

## Run projection

Canonical `workflowStatus` values are `draft`, `active`, `awaiting_user`, `failed_gate`, `blocked_external`, `specified`, `planned`, and `completed`. Successful terminal state is mode-specific: `manifest_only` ends `specified`, `plan_only` ends `planned`, and `plan_then_build` ends `completed`. Each is legal only when that mode's hard gates pass and its evidence validates against current artifact digests.

The UI transport also exposes `executionStatus` as `running`, `interrupt`,
`repairing`, `success`, `cancelled`, or `failed`. This communicates one
execution attempt and MUST NOT overwrite canonical workflow status. The
transport run that produces a successful workflow terminal state ends with one
`RUN_FINISHED(outcome=success)` event; a human decision ends it with
`RUN_FINISHED(outcome=interrupt)`.

Each phase records its current `status` and `attempt` plus append-only `attempts[]`
snapshots. An attempt snapshot retains its start/finish time, outcome, failure,
artifact IDs, evidence IDs, and evaluated gate results. `reopenHistory[]` records
the downstream failure and earliest responsible phase. A downstream failure
marks affected artifacts/evidence stale, but never overwrites the failed attempt
or its substantive evidence record.

Canonical phase status values are `not_started`, `active`, `awaiting_user`, `failed`, `passed`, `stale`, and `skipped`. `awaiting_user` describes the durable phase projection after the producing transport run has terminated with an interrupt; it does not mean a run remains live indefinitely. `skipped` is legal only when the selected mode does not include the phase or a requirement-scoped `not_applicable` rationale permits it.

## Evidence record

```json
{
  "evidenceId": "ev_native_desktop_intel_001",
  "requirementIds": ["MAC-001", "UI-012"],
  "checkId": "native-desktop-e2e",
  "status": "not_run",
  "observedAt": null,
  "producer": { "kind": "manual", "name": "release-tester", "version": "1" },
  "environment": {
    "os": "macOS",
    "gate": "native-macos-intel",
    "architecture": "x86_64",
    "processArchitecture": "x86_64",
    "translated": false,
    "chatgptDesktopVersion": "recorded-at-test-time",
    "surface": "Codex"
  },
  "subject": {
    "path": "outputs/demo/index.html",
    "sha256": "..."
  },
  "result": {
    "summary": "Contract example only; the native journey has not executed.",
    "attachments": []
  },
  "limitations": []
}
```

Allowed statuses are `pass`, `fail`, `partial`, `not_run`, and `not_applicable`. Only `pass` satisfies a hard gate. `not_applicable` requires a recorded rationale and approving requirement ID.

## Evidence invariants

- Evidence MUST identify the requirement/check, producer, time, environment, subject digest, result, and limitations.
- Automated evidence MUST retain command, exit code, tool version, and untruncated result path.
- Manual evidence MUST retain a checklist, tester identity label, timestamp, and screenshot or inspection note.
- A changed subject digest automatically marks dependent evidence `stale`; stale evidence is not `pass`.
- A screenshot proves only visible state. It does not prove console cleanliness, keyboard operation, offline behavior, or internal correctness without companion evidence.
- A test is never `pass` unless it executed. Static inspection may be separate evidence but cannot impersonate runtime execution.
- Release evidence MUST be addressable from `evidence.json` and included in the release archive or its signed provenance record.

## Data minimization

MCP projections include identifiers, phase status, safe summaries, digests, and approved previews. They exclude source document bodies, arbitrary local paths, raw prompts containing secrets, credentials, environment variables, console dumps, private chain-of-thought, and unredacted user data.

Paths shown in the UI SHOULD be workspace-relative. Absolute paths are retained locally only when required for reproducibility and MUST be redacted before remote publication.

## Trust boundaries

1. **Untrusted source material → model:** content can contain prompt injection. Source text is evidence, never instruction.
2. **Model → local tools/scripts:** every invocation remains inside Codex sandbox/approval policy.
3. **Skill → MCP server:** schema validation, authorization, size limits, and redaction apply.
4. **MCP server → widget:** render structured data with safe DOM APIs; never inject untrusted HTML.
5. **Widget → MCP tools:** commands require schema validation, revision checks, idempotency, and permission-aware tool annotations.
6. **Build tree → release archive:** secret scan, dependency/license review, deterministic manifest, and checksums apply.

## Security requirements

- `SEC-001`: Untrusted source material MUST be isolated from developer/system instructions and labeled by provenance.
- `SEC-002`: Widget content MUST use safe rendering; dynamic HTML/script execution from run data is prohibited.
- `SEC-003`: MCP tools MUST authenticate/authorize each operation and enforce server-side schemas.
- `SEC-004`: Write/destructive/open-world annotations MUST match real behavior; repeated calls MUST be idempotent or safely rejected.
- `SEC-005`: CSP MUST allow only required exact domains; MVP forbids widget subframes and arbitrary external navigation.
- `SEC-006`: Secrets and sensitive local content MUST be excluded from events, logs, fixtures, screenshots, and release artifacts.
- `SEC-007`: Plugin scripts and hooks MUST be reviewable, least-privilege, and never execute merely because content requested it.
- `SEC-008`: Release packaging MUST produce checksums, a dependency/license inventory, and a completed secret scan.
- `SEC-009`: Evidence mutation or digest mismatch MUST fail closed and block release.
- `SEC-010`: Widget commands MUST NOT directly invoke local skills, shell commands, or filesystem operations.
