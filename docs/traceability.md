# MVP requirement and test traceability

Every row is release-blocking. Tags are stable even if a scenario moves between files. Automated evidence records the command, exit code, tool version, and result path; manual evidence records tester, environment, timestamp, checklist, and attachment. Only an executed `pass` satisfies a hard gate.

## Canonical Golden BDD suite

The Golden suite contains exactly these ten feature files; documentation must not invent aliases or refer to retired feature filenames:

1. `tests/features/intent-manifest.feature`
2. `tests/features/design-selection.feature`
3. `tests/features/phase-orchestration.feature`
4. `tests/features/evidence-gates.feature`
5. `tests/features/learning-traceability.feature`
6. `tests/features/artifact-contract.feature`
7. `tests/features/desktop-widget.feature`
8. `tests/features/release-readiness.feature`
9. `tests/features/security-and-source-trust.feature`
10. `tests/features/gpt56-sol-behavior.feature`

Requirements without a scenario in those files identify their actual unit, integration, repository-policy, or manual native-desktop target. A tag alone is not proof that a scenario exists or ran.

## Orchestrator skill

| ID | Test target | Minimum pass evidence |
|---|---|---|
| ORCH-001 | `tests/features/phase-orchestration.feature @ORCH-001` | Three mode journeys end as `specified`, `planned`, and `completed` with legal outputs only. |
| ORCH-002 | `scripts/validate-skill.mjs` plus manual context-load inspection | Context/load trace shows only router, current phase, and direct contracts. |
| ORCH-003 | `tests/features/phase-orchestration.feature @ORCH-003`; `tests/features/learning-traceability.feature @ORCH-003` | I0→P10 dependency fixture rejects an unmet gate with responsible layer. |
| ORCH-004 | `tests/features/evidence-gates.feature @ORCH-004` | Injected downstream failure reopens causal phase and invalidates affected evidence. |
| ORCH-005 | `tests/features/evidence-gates.feature @ORCH-005` | Unavailable check remains `not_run` and blocks its hard gate. |
| ORCH-006 | `tests/features/intent-manifest.feature @ORCH-006`; `tests/features/design-selection.feature @ORCH-006 @UI-002` | Intake reuses context and emits exactly three materially distinct design systems. |
| ORCH-007 | `tests/features/design-selection.feature @ORCH-007`; `tests/features/security-and-source-trust.feature @ORCH-007`; `tests/features/intent-manifest.feature @ENG-002` | Locked audience/exclusion/design survives resume and remediation. |
| ORCH-008 | Coverage gap: manual skill-only golden run required | Golden run completes with all MCP app tools unavailable. |
| ORCH-009 | `tests/features/gpt56-sol-behavior.feature @ORCH-009 @VER-007` | GPT-5.6 Sol eval report passes golden cases; no runtime model enforcement exists. |
| ORCH-010 | Partial unit coverage in `tests/unit/workflow-engine.test.mjs`; native same-task run required | Interrupt terminates a run; complete resolution resumes on same task/thread. |
| ORCH-011 | `tests/features/phase-orchestration.feature @ORCH-011` | Plan-only stops before code; explicit non-scope remains excluded. |
| ORCH-012 | Manual policy in `docs/architecture/apple-silicon-verification.md`; shared behavior in `tests/features/desktop-widget.feature @MAC-005` | Intel proves required explicit/implicit activation, repair, completion, and fallback against the exact candidate; Apple Silicon may independently prove advisory compatibility. |

## Workflow engine and contracts

| ID | Test target | Minimum pass evidence |
|---|---|---|
| ENG-001 | Coverage gap: atomic-write fault-injection test required | Fault-injected atomic write leaves one valid whole revision. |
| ENG-002 | `tests/features/intent-manifest.feature @ENG-002` | Provenance lock rejects silent overwrite and records authorized supersession. |
| ENG-003 | `tests/features/design-selection.feature @ENG-003`; `tests/features/phase-orchestration.feature @ENG-003`; `tests/features/desktop-widget.feature @ENG-003` | Identical retry is replayed once; conflicting command ID is rejected. |
| ENG-004 | `tests/unit/workflow-engine.test.mjs`; Golden BDD coverage gap | Valid local events map deterministically to valid dialect events; malformed fields fail stably. |
| ENG-005 | `tests/features/phase-orchestration.feature @ENG-005` | Restart replay is normalized-byte-equivalent; local and dialect sequences are gap-free. |
| ENG-006 | `tests/features/phase-orchestration.feature @ENG-006` plus `tests/unit/workflow-engine.test.mjs` | Transition property tests reject illegal edges and duplicate terminal events. |
| ENG-007 | `tests/unit/workflow-engine.test.mjs`; Golden BDD coverage gap | Retry keeps immutable prior attempts, defects, and failed evidence. |
| ENG-008 | Partial unit coverage in `tests/unit/workflow-engine.test.mjs`; complete-resume coverage gap | Partial/unknown resume fails; complete resume starts a child run. |
| ENG-009 | `tests/integration/mcp-server.test.mjs`; Golden BDD coverage gap | Cancel request remains pending until terminal engine acknowledgement. |
| ENG-010 | `tests/integration/mcp-server.test.mjs`; `tests/features/security-and-source-trust.feature @SEC-007 @SEC-010` | Projection fixtures exclude source bodies, secrets, absolute paths, and reasoning. |
| ENG-011 | `tests/features/evidence-gates.feature @ENG-011 @VER-003` | Artifact mutation marks dependent evidence stale. |
| ENG-012 | Coverage gap: complete stable-error fixture required | Error fixture covers every stable code without stack/secret leakage. |
| ENG-013 | `tests/features/intent-manifest.feature @ENG-013`; `tests/features/phase-orchestration.feature @ENG-013` | Exact I0 and P0–P10 manifest passes; undeclared executable phase fails. |
| ENG-014 | Manual policy in `docs/architecture/apple-silicon-verification.md` | Packaged engine persists, replays, resumes, retries, and reconciles on required Intel; Apple Silicon evidence is retained independently when available. |

## Desktop MCP widget

| ID | Test target | Minimum pass evidence |
|---|---|---|
| UI-001 | `tests/features/desktop-widget.feature @UI-001` | Snapshot renders ordered I0→P10 state, attempt, truth status, and next action. |
| UI-002 | `tests/features/design-selection.feature @UI-002`; `tests/features/desktop-widget.feature @UI-002` | DOM/visual test finds exactly three complete design cards and recommendation. |
| UI-003 | `tests/features/design-selection.feature @UI-003`; `tests/features/desktop-widget.feature @UI-003` | Direct/recommended/delegated/hybrid/revision decisions are bounded and idempotent; same-task resume resolves all interrupts. |
| UI-004 | `tests/features/desktop-widget.feature @UI-004` | Failure view shows provenance, causal phase, repair, history, and residual risk. |
| UI-005 | `tests/features/desktop-widget.feature @UI-005` | Duplicate/stale/remount cases converge on latest server snapshot. |
| UI-006 | `tests/integration/widget-contract.test.mjs`; `tests/features/security-and-source-trust.feature @SEC-010` | Static/runtime allowlist contains no direct local execution bridge. |
| UI-007 | `tests/integration/mcp-server.test.mjs`; Golden BDD coverage gap | Pending cancellation language persists until terminal acknowledgement. |
| UI-008 | `tests/features/desktop-widget.feature @UI-008 @MAC-005` plus manual accessibility evidence | Automated accessibility plus keyboard/VoiceOver/zoom/reduced-motion evidence passes. |
| UI-009 | `tests/integration/mcp-server.test.mjs`; host-confirmation evidence gap | Tool annotations and confirmations match real effects. |
| UI-010 | `tests/integration/mcp-server.test.mjs` plus manual Inspector/host diagnostic | MCP Inspector/host diagnostics prove MIME, URI, schemas, exact CSP, no subframes. |
| UI-011 | `tests/features/desktop-widget.feature @UI-011` | Degraded remote state is distinguished from artifact offline availability. |
| UI-012 | `tests/features/desktop-widget.feature @MAC-005` plus manual policy in `docs/architecture/apple-silicon-verification.md` | Inline native journey renders, decides, repairs, completes, reopens, and reconciles on required Intel; Apple Silicon is advisory. |
| UI-013 | Static contract in `tests/integration/widget-contract.test.mjs`; executed host-layout matrix required | Narrow, normal, and fullscreen host layouts have no page overflow/hidden focus. |
| UI-014 | Coverage gap: complete safe-error fixture required | Every error fixture has safe code, consequence, and recovery with no sensitive data. |

## Verification and release

| ID | Test target | Minimum pass evidence |
|---|---|---|
| VER-001 | `tests/features/artifact-contract.feature @VER-001` | Static audit detects external resources, requests, placeholders, dead targets, extra/oversize files. |
| VER-002 | `tests/features/artifact-contract.feature @VER-002`; browser execution evidence required | `file://` Chromium/Firefox/WebKit matrix has denied/zero network, clean console, working controls, and 320/768/1440 layouts. |
| VER-003 | `tests/features/evidence-gates.feature @VER-003 @ENG-011` | Evidence subject digest is current; mutation forces stale state. |
| VER-004 | `tests/features/evidence-gates.feature @VER-004`; `tests/features/release-readiness.feature @VER-004` | Release decision is deterministic and fails closed on every missing hard gate. |
| VER-005 | `tests/features/learning-traceability.feature @VER-005` | Claim and objective matrices resolve source/instruction/practice/assessment/test. |
| VER-006 | `tests/features/desktop-widget.feature @UI-008` plus manual accessibility evidence | Automated and manual accessibility records are both complete. |
| VER-007 | `tests/features/gpt56-sol-behavior.feature @VER-007 @ORCH-009` | Versioned GPT-5.6 Sol golden/adversarial/degraded eval report passes. |
| VER-008 | `tests/features/release-readiness.feature @VER-008`; `tests/features/evidence-gates.feature @ORCH-004` | Failure → causal phase → repair → affected regression evidence is preserved. |
| VER-009 | `tests/integration/release-verifier.test.mjs` plus manual policy in `docs/architecture/apple-silicon-verification.md` | All `MAC-*` checks pass for required Intel against the exact candidate; Apple Silicon remains an independent non-blocking advisory. |
| VER-010 | `tests/features/release-readiness.feature @VER-010` plus `scripts/verify-oss-release.mjs` | Evidence archive resolves attachments and reproduces artifact/plugin digests. |
| VER-011 | `tests/features/evidence-gates.feature @VER-011`; `tests/features/release-readiness.feature @VER-011` | Status schema rejects unsupported values and unjustified `not_applicable`. |
| VER-012 | `tests/features/security-and-source-trust.feature @SEC-002 @SEC-005` plus `scripts/verify-oss-release.mjs`; Golden BDD coverage gap | Secret, injection, dependency/license, CSP, and schema packaging scans pass. |

## Open-source distribution

| ID | Test target | Minimum pass evidence |
|---|---|---|
| OSS-001 | `scripts/repo-policy.mjs`, `scripts/validate-plugin.mjs`, `tests/integration/widget-contract.test.mjs` | Complete plugin bundle validates with no placeholder/missing/case-mismatched path. |
| OSS-002 | Coverage gap: manual clean skill-only run required | All three modes complete in clean skill-only environment. |
| OSS-003 | Per-architecture `MAC-003` checklist in `docs/architecture/apple-silicon-verification.md` | Clean-room install/enable/fresh-task/upgrade/disable/uninstall checklist passes. |
| OSS-004 | `scripts/verify-oss-release.mjs` and `NOTICE-AG-UI.md`; Golden BDD coverage gap | License inventory and AG-UI notice are present and compatible. |
| OSS-005 | `scripts/verify-oss-release.mjs`; two-build reproducibility evidence required | Two clean builds produce equivalent normalized manifests and content digests. |
| OSS-006 | `scripts/repo-policy.mjs`; `tests/features/security-and-source-trust.feature @SEC-007` | Script/hook audit proves reviewability, least privilege, and no install execution. |
| OSS-007 | `scripts/verify-oss-release.mjs`; Golden BDD coverage gap | Bundle privacy/secret scan has zero unresolved findings. |
| OSS-008 | `scripts/repo-policy.mjs`; Golden BDD coverage gap | SemVer/tag/changelog/migration/compatibility metadata agree. |
| OSS-009 | Documentation/repository-policy inspection; Golden BDD coverage gap | Deployment checklist requires stable HTTPS MCP endpoint, not app-ID-only submission. |
| OSS-010 | `scripts/repo-policy.mjs`; Golden BDD coverage gap | Required-document and link audits pass from repository root. |
| OSS-011 | `tests/features/gpt56-sol-behavior.feature @VER-007` plus repository scan | Scan finds no model pin/enforcement; eval target is documented separately. |
| OSS-012 | Release-verifier policy tests plus manual Intel gate in `docs/architecture/apple-silicon-verification.md` | Published candidate hash equals the native-tested Intel plugin hash; any Apple Silicon evidence binds to the same hash without blocking publication. |

## Security

| ID | Test target | Minimum pass evidence |
|---|---|---|
| SEC-001 | `tests/features/security-and-source-trust.feature @SEC-001` | Prompt-injection sources remain provenance-labeled data and cannot expand tool scope. |
| SEC-002 | `tests/features/security-and-source-trust.feature @SEC-002` | XSS/HTML/script fixtures render as inert text; no executable dynamic content path exists. |
| SEC-003 | `tests/integration/mcp-server.test.mjs`; authorization coverage gap | Unauthorized/invalid MCP operations fail server-side. |
| SEC-004 | `tests/integration/mcp-server.test.mjs`; Golden BDD coverage gap | Tool hints match effects; retries are idempotent or rejected safely. |
| SEC-005 | `tests/features/security-and-source-trust.feature @SEC-005`; `tests/integration/mcp-server.test.mjs` | CSP has exact required domains, no subframes, and no undeclared egress. |
| SEC-006 | `scripts/verify-oss-release.mjs`; Golden BDD coverage gap | Events/logs/fixtures/screenshots/bundle contain no seeded secrets or private content. |
| SEC-007 | `tests/features/security-and-source-trust.feature @SEC-007` plus `scripts/repo-policy.mjs` | Script/hook review and runtime spy show least privilege and no content-triggered execution. |
| SEC-008 | `scripts/verify-oss-release.mjs`; Golden BDD coverage gap | Checksums, dependency/license inventory, and completed secret scan are archived. |
| SEC-009 | `tests/features/security-and-source-trust.feature @SEC-009` | Evidence mutation/digest mismatch blocks release deterministically. |
| SEC-010 | `tests/features/security-and-source-trust.feature @SEC-010`; `tests/integration/widget-contract.test.mjs` | Widget bridge allowlist cannot invoke skill, shell, or filesystem directly. |

## Native macOS: Intel and Apple Silicon

Run the requirement set on `native-macos-intel` as a production requirement using `x86_64` host and process evidence. When Apple Silicon is available, run the same set for `native-macos-apple-silicon` using `arm64` host and process evidence with Rosetta inactive. Both reference the same candidate digest; neither run satisfies the other, and Apple Silicon status is non-blocking.

| ID | Test target | Minimum pass evidence |
|---|---|---|
| MAC-001 | Manual gate checklist in `docs/architecture/apple-silicon-verification.md` | Intel records `x86_64` host/process; Apple Silicon records `arm64` host/process and Rosetta inactive. |
| MAC-002 | Manual gate checklist in `docs/architecture/apple-silicon-verification.md` | Each gate populates macOS/hardware/desktop/plugin/model/timestamp and architecture fields. |
| MAC-003 | Manual gate checklist in `docs/architecture/apple-silicon-verification.md` | Exact candidate installs locally; explicit invocation and implicit matching work in separate fresh Codex tasks on each architecture. |
| MAC-004 | Manual gate checklist in `docs/architecture/apple-silicon-verification.md` | Each end-to-end run contains interrupt/resume and causal remediation before completion. |
| MAC-005 | `tests/features/desktop-widget.feature @MAC-005` plus manual gate checklist | Inline widget keyboard, VoiceOver smoke, failure, reconciliation, and evidence inspection pass on each architecture. |
| MAC-006 | Manual gate checklist in `docs/architecture/apple-silicon-verification.md` | Separate secret-safe manifests, screenshots, logs, checklists, tests, and matching candidate digests are archived. |

## Cross-phase workflow trace

| Phase | Required output | Primary verification tags |
|---|---|---|
| I0 intent/design | Authoritative manifest, conflict resolution, three-option gate, selected design | `@ORCH-001 @ORCH-006 @ORCH-007 @UI-002` |
| P0 charter | Scope, modes, constraints, assumptions, acceptance gates | `@ORCH-001 @ORCH-003 @ORCH-011` |
| P1 research | Source/claim ledgers, conflicts, uncertainties | `@VER-005 @SEC-001` |
| P2 learning architecture | Outcomes, prerequisites, misconceptions, objective matrix | `@VER-005` |
| P3 information architecture | Complete linear/nonlinear booklet blueprint | `@ORCH-003` |
| P4 interactions | Objective-mapped state/input/output/accessibility/test contracts | `@UI-002 @VER-006` |
| P5 visual system | Selected coherent design system and responsive/accessibility rules | `@ORCH-006 @UI-002 @UI-013` |
| P6 technical plan | One-file architecture and independently testable increments | `@ENG-013 @VER-001` |
| P7 production | Complete prose, examples, diagrams, interactions, assessments, citations | `@VER-005` |
| P8 integration | Static/runtime/accessibility/offline/regression evidence | `@VER-001 @VER-002 @VER-006` |
| P9 adversarial review | Findings, causal repairs, affected reruns | `@ORCH-004 @VER-008` |
| P10 release | Evidence archive, residual risks, deterministic decision | `@VER-004 @VER-009 @VER-010` |
