# MVP product requirements

The MVP comprises five independently testable products that ship together:

1. [Orchestrator skill](orchestrator-skill.md)
2. [Workflow engine and contracts](workflow-engine-contracts.md)
3. [Desktop MCP widget](desktop-mcp-widget.md)
4. [Verification and release](verification-release.md)
5. [OSS distribution](oss-distribution.md)

Requirement IDs are stable public contract identifiers. Tests use the matching Gherkin tag, such as `@ORCH-003`. Renumbering an existing requirement is prohibited; semantic changes require an ADR and test review.
