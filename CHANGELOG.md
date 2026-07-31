# Changelog

All notable changes are documented here. The project uses Semantic Versioning. Contract migrations are called out explicitly.

## Unreleased

Enterprise stand-alone distribution:

- add a relocatable, self-encapsulated Agent Skill directory containing the complete learning-booklet prompt, references, schemas, workflow engine, scripts, configuration, and artifact template;
- exclude service, projection, and graphical integration code from the stand-alone runtime;
- bundle zero-dependency schema validation and add isolation tests proving a copied directory can create and read workflow state without repository-relative imports.

Migration notes: none. The existing plugin distribution and its single public skill remain unchanged.

## 0.1.3 — 2026-07-28

First OSS production-release policy and automation:

- add pinned GitHub Actions CI for Node 20 and Node 26, deterministic tests, browser/accessibility/offline checks, and same-host candidate reproducibility;
- add a manual production-promotion workflow that validates an annotated tag, consumes immutable draft-release evidence bundles, reruns every required gate, verifies checksums, emits build provenance, and publishes only a passing draft;
- retain exact-candidate native Intel macOS proof as a production requirement;
- reclassify Apple Silicon native evidence as a visible non-blocking compatibility advisory, preserving `not_run` or `fail` honestly without preventing production publication;
- add regression coverage proving that Apple Silicon evidence cannot block production and cannot substitute for required Intel evidence.

Migration notes: release-report consumers must treat `decision.advisories` as non-blocking findings and use each gate's `productionRequired` field when determining production blockers.

## 0.1.2 — 2026-07-23

Native completed-state rendering repair:

- render nested design-system values as deterministic readable text instead of passing objects directly to React;
- bound nested design-system formatting by depth, item count, and output length;
- add completed-P10 widget regressions through the production projection path at 320, 768, and 1440 CSS pixels;
- enlarge the selected-design carousel hit targets to the WCAG 2.2 minimum while retaining compact dot indicators;
- add a top-level safe error boundary with focused retry so future render defects expose a recovery path instead of a blank panel;
- enforce one version across the plugin manifest, packages, lockfile, MCP server, and widget host descriptor;
- verify the repaired widget against the actual representative completed-run projection with no console or page errors.

Migration notes: none. The `codex-skill-ui/1` projection contract and stable widget resource URI are unchanged.

## 0.1.1 — 2026-07-23

Native restart-integrity repair:

- preserve server-owned projection creation and accepted-child resume receipts when a newer canonical snapshot is published;
- reject attempts to introduce, alter, or rebind those receipts through `workflow_publish`;
- reject snapshots that change canonical run identity, permissions, or established event history;
- reject snapshot-based creation so unknown runs and deterministic child identifiers cannot be preempted;
- limit raw snapshots to same-revision reconciliation and require typed reducer commands for advancement;
- bind event identifiers, creation payloads, timestamps, resume sets, and terminal records to canonical state;
- reject noncanonical, backward, and future command timestamps and keep child creation at or after its parent;
- coordinate file and MCP histories with explicit creation/resume timestamps;
- atomically reserve accepted decisions across overlapping MCP processes and recover an identical decision after a mid-commit restart;
- validate accepted-child lineage and traverse multi-generation resume chains without cycles;
- add durable publish, race, crash-recovery, and restart regressions that prove exactly one decision child is accepted.

Migration notes: none. The `codex-skill-ui/1` projection contract is unchanged.

## 0.1.0 — 2026-07-22

Initial MVP release candidate:

- added one public `$build-learning-booklet` orchestrator skill;
- added the I0 and P0–P10 gated workflow, state/evidence contracts, and repair semantics;
- added a local MCP Apps workflow workspace and skill-only fallback;
- added the AG-UI-inspired, product-owned `codex-skill-ui/1` projection dialect;
- added Golden BDD fixtures and deterministic engine, contract, widget, and packaging tests;
- added a real built-widget browser E2E covering keyboard activation, responsive overflow, serious/critical accessibility findings, console health, and blocked external runtime requests;
- added deterministic candidate packaging and fail-closed release reporting;
- made the release verifier enforce the shared strict native-evidence schema and resolve check references and artifact digests to hashed attachments;
- documented and enforced separate native Intel and non-translated Apple Silicon ChatGPT Desktop release journeys for the same candidate digest.

Compatibility baseline:

- plugin: 0.1.x;
- MCP Apps client contract: 1.7.4;
- workflow projection: `codex-skill-ui/1`;
- AG-UI reference baseline: 0.0.57, with no wire-compatibility claim;
- Node.js: 20 or newer.

Migration notes: none; this is the first published contract baseline.
