# ADR 0005: Intel evidence is required and Apple Silicon evidence is advisory

- Status: Superseded in part by the 0.1.3 release-policy revision
- Date: 2026-07-22
- Owners: release maintainers

## Context

Unit tests, a standalone browser preview, and MCP Inspector cannot prove installation, skill discovery, inline iframe rendering, host permissions, task continuity, or real keyboard behavior in ChatGPT desktop Codex mode. Native Intel and Apple Silicon Macs remain distinct compatibility environments. A universal binary, Rosetta session, or result from only one architecture can conceal architecture-specific differences.

## Decision

Block release until the exact candidate bundle completes the documented golden journey in the native ChatGPT desktop app, Codex mode, on an Intel host and process running `x86_64`. Keep a separate `native-macos-apple-silicon` evidence result for an Apple Silicon host and process running `arm64` without Rosetta translation, but classify that result as a non-blocking compatibility advisory. Every supplied native manifest must independently satisfy `MAC-001` through `MAC-006`, including environment identity, fresh installation, explicit/implicit skill activation, interrupt/resume, repair, widget keyboard operation, reopen/reconciliation, artifact digest, and archived logs/checklists/screenshots.

Evidence for one architecture cannot satisfy the other. When both manifests exist, both must identify the same exact candidate archive digest. Missing or failed Apple Silicon evidence remains visible without blocking production.

Browser-only, mocked-host, another MCP host, source-inspection, Rosetta, cross-architecture substitution, or differently hashed bundle evidence cannot satisfy either gate.

## Consequences

- Automated coverage remains necessary but is not sufficient for release.
- A release candidate remains `partial` until the required Intel journey passes; Apple Silicon `not_run` or `fail` is retained as an advisory.
- Evidence collection must minimize secrets and bind to exact plugin/artifact digests.
- Apple Silicon uncertainty remains visible in the release report and compatibility documentation.

## Alternatives rejected

- **Browser/MCP Inspector only:** rejected because it omits host integration.
- **One generic macOS result:** rejected because a pass on one CPU architecture would conceal the separate compatibility state of the other.
- **Intel or Rosetta as Apple Silicon proof:** rejected because translated or cross-architecture execution does not prove native `arm64` host behavior.
- **Blocking every release on Apple Silicon:** superseded because the production process now requires Intel proof and treats Apple Silicon as an explicit non-blocking advisory.

## Requirement impact

`ORCH-012`, `ENG-014`, `UI-012`, `VER-009`, `OSS-012`, and `MAC-001`–`MAC-006`, with Intel production-required and Apple Silicon advisory.
