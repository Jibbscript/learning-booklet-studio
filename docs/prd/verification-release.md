# PRD: verification and release

Status: MVP required.

## Problem

A polished learning booklet can still be factually wrong, pedagogically incomplete, inaccessible, network-dependent, or falsely reported as tested. Release needs a deterministic verifier that binds every claim of completion to current evidence and fails closed when required checks were not executed.

## Goals

- Verify content, pedagogy, behavior, accessibility, portability, privacy, and security.
- Preserve exact test status and evidence provenance; never translate `not_run` into success.
- Invalidate passes when their subject changes and reopen the earliest responsible phase.
- Produce a reproducible release decision and evidence archive.
- Require separately executed native Intel desktop evidence for the plugin release and retain Apple Silicon evidence as a non-blocking compatibility advisory.

## Non-goals

- Proving every browser/accessibility behavior through static source inspection.
- Treating a Lighthouse-style score, screenshot, or model review as sufficient acceptance.
- Publishing benchmark claims without workload and environment context.
- Requiring a particular model at runtime.
- Allowing a widget or remote projection to declare release readiness.

## Requirements

| ID | Normative requirement | Acceptance criterion | Test trace |
|---|---|---|---|
| VER-001 | Static verification MUST prove that the generated artifact is exactly one complete HTML file within its manifest size budget, with no build step, required external asset, runtime network dependency, telemetry, placeholder, or dead internal target. | Fixtures containing a CDN URL, network call, missing anchor, placeholder, oversize file, or secondary required file fail with a stable check ID. | `tests/features/artifact-contract.feature @VER-001` |
| VER-002 | Runtime verification MUST open the artifact directly from `file://`, deny network access, inspect console/request logs, exercise every control, and inspect approximately 320, 768, and 1440 CSS-pixel layouts across configured browser targets. Automated MVP coverage MUST include Chromium, Firefox, and WebKit engines; a branded-browser claim requires an actual run in that browser. | The golden matrix passes with zero unexplained console errors or runtime requests; injected defects fail the corresponding browser/viewport check; unexecuted branded targets remain `not_run`. | `tests/features/artifact-contract.feature @VER-002`; execution remains pending where browsers are unavailable |
| VER-003 | Every evidence record MUST bind to the SHA-256 digest of its subject and declared environment; a digest change MUST invalidate dependent passes. | Mutating one artifact byte marks affected evidence stale and blocks release until rerun. | `tests/features/evidence-gates.feature @VER-003 @ENG-011` |
| VER-004 | `verify-release.mjs` MUST submit engine command `release.decide` and use `releaseDecision` to calculate one deterministic result: `pass` only when every applicable hard gate passes; otherwise `fail` with exact blocking gaps. Evidence records may be `partial` or `not_run`, but the engine release decision is binary. | Reordering evidence does not change the normalized decision; missing required evidence never passes; wrapper and direct engine calls agree. | `tests/features/evidence-gates.feature @VER-004`; `tests/features/release-readiness.feature @VER-004` |
| VER-005 | Central technical claims and every learning objective MUST remain traceable to authoritative sources, instruction, practice, assessment, and a verification result. | An unsupported central claim or objective without practice/assessment blocks release and names its source phase. | `tests/features/learning-traceability.feature @VER-005` |
| VER-006 | Accessibility verification MUST assess applicable WCAG 2.2 Level AA criteria by combining automated checks with manual keyboard, focus, zoom, reduced-motion, diagram-alternative, and screen-reader inspection. | Automated pass without required manual evidence remains `partial`; all manual checklist items are attributable, dated, and criterion-scoped. | Shared keyboard scenario in `tests/features/desktop-widget.feature @UI-008`; complete accessibility evidence remains manual and architecture-specific |
| VER-007 | Representative golden, adversarial, and degraded cases MUST be evaluated with GPT-5.6 Sol and record the observed model label; release artifacts MUST NOT pin or claim to enforce that model. | The Sol matrix records inputs, expected outcomes, results, and regressions; runtime docs remain model-portable. | `tests/features/gpt56-sol-behavior.feature @VER-007 @ORCH-009` |
| VER-008 | A failed check MUST create a defect, identify the earliest responsible phase, invalidate dependent downstream evidence, and rerun the affected regression set after repair. | An injected assessment error reopens the content phase, retains failed evidence, and cannot pass from a local-only patch without downstream reruns. | `tests/features/release-readiness.feature @VER-008`; `tests/features/evidence-gates.feature @ORCH-004` |
| VER-009 | Release MUST require a real native ChatGPT desktop, Codex-mode run satisfying `MAC-001` through `MAC-006` on Intel against the exact candidate digest. Apple Silicon evidence MUST be validated independently when supplied, reported as advisory, and MUST NOT block production. | Browser-only, mock-host, another MCP host, cross-architecture substitution, digest mismatch, or incomplete Intel evidence yields `partial`/`fail`; missing Apple Silicon evidence remains `not_run` with a non-blocking advisory. | `tests/integration/release-verifier.test.mjs` plus executed Intel architecture gate in `docs/architecture/apple-silicon-verification.md` |
| VER-010 | The release decision MUST be accompanied by a separate normalized evidence bundle containing tool versions, executed commands/checklists, untruncated result paths, artifact/plugin digests, defect history, known limitations, and residual risks. Private host evidence MUST remain outside the distributable plugin archive. | Evidence-bundle validation resolves every attachment, reproduces all declared digests, binds to the exact release archive/content digest, and contains no absolute personal path or secret leakage. | `tests/features/release-readiness.feature @VER-010` plus `scripts/verify-oss-release.mjs` |
| VER-011 | Check statuses MUST be limited to `pass`, `fail`, `partial`, `not_run`, and `not_applicable`; only executed `pass` evidence may satisfy a hard gate. | Invalid status is schema-rejected; `not_applicable` without requirement-scoped rationale is rejected. | `tests/features/evidence-gates.feature @VER-011 @ORCH-005`; `tests/features/release-readiness.feature @VER-011` |
| VER-012 | Packaging verification MUST run secret, unsafe-content, dependency/license, CSP, schema, and artifact-injection checks before checksums are finalized. | Seeded credentials, executable untrusted HTML, undeclared domains, or incompatible licensing block packaging. | `tests/features/security-and-source-trust.feature @SEC-002 @SEC-005` plus `scripts/verify-oss-release.mjs`; no Golden BDD scenario currently carries `@VER-012` |

## Required verification layers

1. **Local increment:** focused schema, content, unit, and interaction tests before integration.
2. **Phase gate:** compare each deliverable with measurable exit criteria and retain evidence.
3. **Integrated regression:** content, pedagogy, functionality, accessibility, responsive layout, offline operation, privacy, and security.
4. **Adversarial completion:** falsify explanations, exercise edge/repeated inputs, inspect evidence claims, and repair causal phases.
5. **Native Intel gate:** execute the packaged plugin journey on native Intel and archive the proof.
6. **Native Apple Silicon advisory:** when the environment is available, execute the same candidate journey on non-translated Apple Silicon and archive separate proof without blocking production.

## MVP acceptance

All `VER-*` scenarios pass; required `SEC-*` evidence is current; `MAC-001`–`MAC-006` are current for `native-macos-intel`; no blocker or major defect remains; every supplied evidence archive validates against release digests; Apple Silicon status is reported as an advisory; and the deterministic decision is `pass`.
