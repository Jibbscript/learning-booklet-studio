# Learning Booklet Studio documentation

Status: implementation contract for the MVP OSS release.

These documents define the product, runtime, contracts, security posture, and release evidence for Learning Booklet Studio: an installable Codex plugin that turns a technical learning request into a verified, self-contained learning-booklet mini-app.

Normative terms follow RFC 2119 usage: **MUST**, **MUST NOT**, **SHOULD**, and **MAY** are requirements, not emphasis. Where these documents differ from code, schemas, or tests, the mismatch is a release-blocking defect until one authoritative contract is deliberately revised with an ADR.

## Document map

| Area | Document |
|---|---|
| System boundaries and topology | [System architecture](architecture/system-architecture.md) |
| One-to-one workflow/file mapping | [Workflow mapping](architecture/workflow-mapping.md) |
| Codex plugin and MCP Apps integration | [Runtime integration](architecture/runtime-mcp-apps.md) |
| AG-UI-style event dialect | [`codex-skill-ui/1`](architecture/codex-skill-ui-1.md) |
| Run state, evidence, and security invariants | [State, evidence, and security](architecture/state-evidence-security.md) |
| Adversarial security analysis | [Threat model](architecture/threat-model.md) |
| Required native macOS proof | [Intel and Apple Silicon verification](architecture/apple-silicon-verification.md) |
| Product requirements | [`docs/prd/`](prd/) |
| Cross-product requirement/test mapping | [Traceability](traceability.md) |
| Architectural decisions | [`docs/adr/`](adr/) |
| Official platform facts and bounded assumptions | [Source notes](sources.md) |

## MVP release gates

The release is not ready unless all of the following are true:

1. Every `ORCH-*`, `ENG-*`, `UI-*`, `VER-*`, `OSS-*`, `SEC-*`, and `MAC-*` requirement marked MVP has an automated or manual test mapped in [Traceability](traceability.md).
2. Every required BDD scenario passes; no required scenario is skipped.
3. Contract schemas reject malformed events, commands, manifests, and evidence.
4. No blocker or major defect remains open.
5. A real run in the native ChatGPT desktop application, in Codex mode, has satisfied `MAC-001` through `MAC-006` on Intel (`native-macos-intel`) against the exact candidate digest. A non-translated Apple Silicon (`native-macos-apple-silicon`) run is independently reportable as a compatibility advisory, never a production gate.
6. The plugin can be installed from a local marketplace, becomes available in a fresh task, invokes its skill, renders its MCP Apps widget, completes the workflow, and verifies a generated artifact.
7. The release bundle contains only redistributable code and assets, carries its license and notices, and exposes no credentials or private test data.

Browser-only, mocked-host, Rosetta, cross-architecture substitution, or source-inspection evidence cannot satisfy either native macOS evidence contract. An unexecuted Intel journey remains a production-blocking `not_run`; an unexecuted or failed Apple Silicon journey remains a visible, non-blocking advisory.
