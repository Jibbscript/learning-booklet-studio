# PRD: open-source distribution

Status: MVP required.

## Problem

The project is useful only if a third party can inspect, install, run, verify, and modify it without private infrastructure or undocumented setup. Distribution must package a real Codex plugin, preserve a skill-only path, and separate local-development installation from public MCP deployment.

## Goals

- Ship a complete, reviewable plugin with one public orchestrator skill and an optional MCP-backed widget.
- Make local installation, clean-room verification, and removal reproducible.
- Publish licensing, attribution, checksums, support, and security guidance.
- Keep local workflow generation usable when the app service is unavailable.
- Distinguish a local marketplace bundle from the HTTPS MCP endpoint used for public submission.

## Non-goals

- Bundling credentials, proprietary source material, or private evidence.
- Running install-time lifecycle scripts.
- Claiming AppKit, native-extension, or offline-widget behavior.
- Requiring one model or private OpenAI feature flag.
- Promising wire compatibility with AG-UI beyond `codex-skill-ui/1`.

## Requirements

| ID | Normative requirement | Acceptance criterion | Test trace |
|---|---|---|---|
| OSS-001 | The release bundle MUST contain a valid `.codex-plugin/plugin.json`, one complete public skill, required references/scripts/assets, app/MCP descriptors, widget/server packages, documentation, license, notices, and no placeholder content. | Bundle schema and placeholder scans pass; every referenced path exists with portable casing. | `scripts/repo-policy.mjs`, `scripts/validate-plugin.mjs`, and `tests/integration/widget-contract.test.mjs` |
| OSS-002 | The public skill MUST complete all supported modes without the widget or MCP app, using concise chat decisions and local evidence. | A clean environment with app tools disabled completes the golden `manifest_only`, `plan_only`, and `plan_then_build` cases. | Release-blocking manual skill-only golden run; no Golden BDD scenario currently carries `@OSS-002` |
| OSS-003 | Documentation MUST provide reproducible local-marketplace installation, enablement, fresh-task discovery, upgrade, disable, and uninstall instructions for ChatGPT desktop Codex mode. | A clean-room tester follows only published instructions and invokes the skill in a fresh task. | Per-architecture `MAC-003` checklist in `docs/architecture/apple-silicon-verification.md` |
| OSS-004 | Source and bundled third-party material MUST use compatible OSI-approved licensing and include required attribution, including the AG-UI inspiration notice. | Dependency/license inventory has no unresolved incompatible or unknown item; notice scan passes. | `scripts/verify-oss-release.mjs` and `NOTICE-AG-UI.md`; no Golden BDD scenario currently carries `@OSS-004` |
| OSS-005 | Release packaging MUST be reproducible from a tagged commit and emit a normalized manifest plus SHA-256 checksums for the bundle and distributable artifacts. | Two clean builds at the same commit produce equivalent normalized manifests and matching content digests. | `scripts/verify-oss-release.mjs`; two-build reproducibility evidence remains required |
| OSS-006 | Plugin scripts and hooks MUST be source-reviewable, least-privilege, documented, and MUST NOT execute merely on install or because untrusted content requests it. | Manifest/hook audit finds no install lifecycle execution or undeclared command path. | `scripts/repo-policy.mjs`; `tests/features/security-and-source-trust.feature @SEC-007` |
| OSS-007 | Fixtures, docs, screenshots, logs, and release files MUST pass a secret/privacy scan and contain no personal absolute paths or private source bodies. | Seeded secret fixtures fail; the real bundle scan has zero unresolved findings. | `scripts/verify-oss-release.mjs`; no Golden BDD scenario currently carries `@OSS-007` |
| OSS-008 | Releases MUST use semantic versions, immutable tags, a changelog, migration notes for contract changes, and a compatibility statement for plugin, MCP UI, and `codex-skill-ui/1` versions. | Release metadata and docs agree; a breaking schema change without a major-version/migration entry fails. | `scripts/repo-policy.mjs`; no Golden BDD scenario currently carries `@OSS-008` |
| OSS-009 | Public deployment docs MUST require a stable HTTPS MCP endpoint and MUST distinguish submitting that endpoint from referencing an existing app ID; local development MAY use an HTTPS tunnel. | Deployment checklist rejects localhost/public app-ID-only submissions and records the production endpoint policy. | Documentation/repository-policy inspection; no Golden BDD scenario currently carries `@OSS-009` |
| OSS-010 | The repository MUST publish quickstart, architecture, contribution, support, security-reporting, privacy, accessibility, release-verification, and known-limitation documentation. | Link and required-section audits pass from the repository root. | `scripts/repo-policy.mjs`; no Golden BDD scenario currently carries `@OSS-010` |
| OSS-011 | No manifest, skill, app descriptor, or setup instruction may pin or claim to enforce GPT-5.6 Sol; evaluation docs MUST identify it only as the observed optimization target. | Repository scan finds no enforcement field/claim; eval report records model/date separately. | `tests/features/gpt56-sol-behavior.feature @VER-007` plus repository scan; no Golden BDD scenario currently carries `@OSS-011` |
| OSS-012 | The exact packaged bundle MUST pass `MAC-001` through `MAC-006` on native Intel before publication. Non-translated Apple Silicon evidence is an independent, non-blocking compatibility advisory and MUST NOT be used as a substitute for Intel evidence. | The required Intel manifest identifies the published candidate SHA-256 exactly; any supplied Apple Silicon manifest identifies the same SHA-256 and is reported separately. | Release-verifier policy tests and the executed Intel gate in `docs/architecture/apple-silicon-verification.md` |

## Distribution shapes

- **Skill-only:** local workflow, generation, validation, and evidence; no server dependency.
- **Development plugin:** local marketplace bundle plus MCP server reachable through a documented HTTPS development endpoint.
- **Public plugin:** published source/bundle and a production HTTPS MCP endpoint suitable for the platform submission process.

The generated `index.html` remains self-contained and offline-capable in every shape. The MCP widget does not become offline-capable merely because the artifact is.

## MVP acceptance

All `OSS-*` checks pass; a clean-room user installs and runs the candidate; the skill-only fallback succeeds; license/notice and secret scans are clean; checksums reproduce; the exact bundle has current native Intel evidence; and Apple Silicon compatibility status is disclosed without blocking publication.
