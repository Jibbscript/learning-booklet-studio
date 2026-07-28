# Native macOS desktop verification: Intel and Apple Silicon

## Release rule

Production readiness requires executed evidence from the native ChatGPT desktop application in **Codex mode** on the Intel architecture class:

1. `native-macos-intel`: a native Intel Mac host and ChatGPT process running as `x86_64`.

The workflow also accepts `native-macos-apple-silicon` evidence from an Apple Silicon Mac host and ChatGPT process running as `arm64` without Rosetta translation. That architecture result is an independent non-blocking compatibility advisory. When present, it binds to the same exact candidate archive digest. Browser emulation, a web-only ChatGPT run, source inspection, unit tests, another MCP host, a cross-architecture binary inspection, Rosetta execution, or a screenshot without environment identity does not satisfy either architecture's evidence contract.

Until an architecture journey is actually executed, its status is `not_run`. Do not infer a pass from the host CPU, application bundle metadata, or results collected for the other architecture. Intel `not_run` blocks production; Apple Silicon `not_run` is reported as an advisory and does not block production.

## Shared journey requirements

Apply `MAC-001` through `MAC-006` separately to every supplied architecture evidence bundle:

- `MAC-001`: Record host and running ChatGPT process architectures. For Intel, both must be `x86_64`. For Apple Silicon, both must be `arm64` and the process must not be translated under Rosetta.
- `MAC-002`: Record macOS version/build, Mac hardware family, ChatGPT desktop version/build, plugin version/digest, effective model label when the host exposes it, test timestamp, and architecture gate ID.
- `MAC-003`: Install the exact candidate through the documented local-plugin path, enable it, and prove explicit skill invocation plus implicit matching and app-tool availability in fresh Codex tasks.
- `MAC-004`: Complete one representative end-to-end learning-booklet run, including at least one interrupt/resume decision and one remediation loop.
- `MAC-005`: Render and operate the MCP Apps widget in place, including keyboard-only decision submission, state reconciliation, failure display, and completion-evidence inspection.
- `MAC-006`: Archive the architecture-specific evidence manifest, screenshots, relevant logs, generated artifact digest, test results, and tester checklist without secrets.

## Environment capture

Capture command output to evidence files; do not rely on memory:

```sh
uname -m
sw_vers
sysctl -in sysctl.proc_translated 2>/dev/null || true
```

For `native-macos-intel`, `uname -m` and the running ChatGPT process kind must resolve to `x86_64`. For `native-macos-apple-silicon`, `uname -m` and the process kind must resolve to `arm64`; `sysctl.proc_translated` must be `0` or unsupported because translation is not active. A universal application binary alone does not prove the running process architecture.

Capture the ChatGPT process architecture through an operating-system process inspection or Activity Monitor “Kind” view and retain a screenshot. Record the application version from the ChatGPT About or settings surface. Record plugin version and SHA-256 from the installed candidate bundle, not merely the authoring directory.

The bundled read-only capture performs the live process query directly:

```sh
evidence/intel-macos-native/capture-host.sh > host-capture.json
```

Before opening fresh tasks, bind the extracted or cached installed plugin to the
release report with `scripts/check-installed-candidate.mjs`. A matching SemVer
or marketplace listing alone is insufficient.

## Golden native journey

Run this journey on Intel for each production candidate. Run it independently on Apple Silicon when that advisory environment is available:

1. Record the architecture gate ID, host/process identity, candidate version, and candidate SHA-256.
2. Remove or disable a prior local install, then restart ChatGPT desktop.
3. Open Codex, install Learning Booklet Studio through the documented local-plugin path, and start a fresh task.
4. In one fresh task, invoke the skill explicitly and verify its app/MCP tools are available.
5. In a second fresh task, use the unadorned golden technical-learning request and verify implicit skill matching; confirm a run ID appears.
6. Resolve the design-system interrupt through the widget using only the
   keyboard. Retain the terminal parent `RUN_FINISHED(outcome=interrupt)` and
   the child `RUN_STARTED` with the same thread ID, a new run ID, the parent run
   ID, and a complete `resume[]` set.
7. Cause or use a deterministic test fixture that fails one phase gate; verify the earliest responsible phase reopens.
8. Repair/retry and confirm affected evidence is replaced while prior failed evidence remains in history.
9. Complete generation and open the artifact.
10. Verify widget completion, evidence, residual risk, and release-gate state.
11. Restart the MCP host, record the changed process ID, reopen the same task,
    and verify the widget automatically reconciles the resumed child from a
    server snapshot rather than claiming stale local state or replaying the
    decision.
12. Confirm that the installed candidate digest matches the candidate under release; when Apple Silicon evidence is also collected, confirm both bundles bind to that same candidate.

## UI inspection matrix

| Check | Required evidence |
|---|---|
| Inline render in Codex conversation | Screenshot with desktop chrome, task context, run ID, architecture gate ID, and timestamp correlation |
| Keyboard operation | Checklist covering Tab/Shift-Tab, activation, focus visibility, no trap, and decision completion |
| VoiceOver smoke test | Reading order, control names, state/status announcement, and error recovery inspection note |
| Zoom and resizing | Screenshots or recording at narrow inline width, normal inline width, and fullscreen |
| Reduced motion | System setting captured; no required information depends on animation |
| Failure/degraded mode | Widget shows safe error, stale state, retry/reconcile path, and does not claim completion |
| Permission behavior | Evidence that write/consequential actions receive the expected host confirmation |
| Console/runtime health | Host/widget diagnostic record with no unexplained error |

## Evidence manifest contract

Use the strict shared schema at
[`evidence/intel-macos-native/native-macos-evidence.schema.json`](../../evidence/intel-macos-native/native-macos-evidence.schema.json).
Do not maintain a second, informal JSON shape in this document. The schema is
authoritative for both `native-macos-intel` and
`native-macos-apple-silicon`, including architecture-specific constraints,
candidate archive and content digests, the exact six `MAC-*` checks, and hashed
relative attachments.

The source repository contains a schema-valid `partial` Intel host baseline
captured before the native journey. That machine-specific historical record is
intentionally excluded from release archives, so installed-plugin operators
must generate a fresh record for the exact candidate rather than following a
packaged link or promoting the old baseline. Validate every completed manifest
with:

```sh
node evidence/intel-macos-native/validate-evidence.mjs path/to/evidence.json
```

A `pass` record must populate every schema-required identity field, bind
`plugin.archiveSha256` and `plugin.contentDigest` to the evaluated package,
include exactly one executed `pass` for each `MAC-001` through `MAC-006`, and
list every retained attachment by safe relative path and SHA-256. Any missing
check, digest mismatch, translated process, or architecture mismatch leaves the
architecture result `partial` or `fail`, never `pass`. Only the Intel result is
production-required; Apple Silicon remains advisory.

Passing evidence also requires distinct explicit and implicit fresh-task
identities; terminal parent, resumed child, and restarted observations with
coherent lineage; positive MCP process IDs for both resumed and restarted
observations with an actual PID change; one attachment from every
schema-defined evidence group; a completed-artifact attachment of kind
`artifact` whose digest equals `artifactSha256`; an automated private-data scan
for the manifest and textual attachments; and an attributable manual visual
privacy review for every screenshot or recording. Typed native UI evidence is
mandatory: explicit, implicit, and degraded views are screenshots, keyboard
selection is a log or recording, VoiceOver is a dedicated checklist or log,
and responsive layout has narrow, normal, and fullscreen visual captures.
