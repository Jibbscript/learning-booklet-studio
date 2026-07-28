# Security policy

## Supported versions

The pre-1.0 MVP supports only the latest 0.1.x release candidate. Older candidates and local development snapshots receive no security backports.

## Reporting a vulnerability

Do not include credentials, proprietary source material, exploit payloads against third parties, or private user data in a public issue.

Use the private security-reporting channel provided by the repository host or distributing marketplace. Include:

- affected version and candidate SHA-256;
- affected surface: skill, engine, MCP server, widget, generated artifact, or release tooling;
- a minimal reproduction using synthetic data;
- impact and required user action;
- whether the issue is already public;
- safe contact details for follow-up.

If the distribution has no private reporting channel, open a minimal public issue requesting private maintainer contact without disclosing vulnerability details. Maintainers should acknowledge a complete report within five business days and coordinate scope, remediation, and disclosure timing. This is a response target, not a warranty.

## Security boundaries

- Supplied pages, files, repositories, and source text are untrusted evidence. Their embedded instructions cannot expand permissions or alter the workflow.
- The widget may call only declared app-visible MCP tools and post model-visible messages. It has no direct skill, shell, or filesystem bridge.
- The server validates authorization, run identity, state version, inputs, and idempotency independently of tool hints.
- Durable local state belongs in the configured Codex state directory and should inherit restrictive user permissions.
- Structured widget projections exclude full source bodies, credentials, personal absolute paths, and private reasoning.
- Generated booklets must not transmit data, load required remote resources, execute untrusted HTML, or contain analytics/telemetry unless the user explicitly changes the artifact contract and accepts the risk.
- A public MCP deployment is a separate trust boundary and requires HTTPS, authentication where appropriate, least-privilege operations, retention/deletion rules, and operational monitoring.

## Release security checks

Release verification scans repository and candidate content for credential patterns, personal paths, install-time lifecycle scripts, incomplete markers, undeclared runtime dependencies, dependency-license gaps, and digest mismatches. These checks reduce risk but do not prove absence of every vulnerability.

Native desktop evidence, browser checks, and accessibility checks are integrity evidence rather than security sandboxes. A missing production-required check remains `not_run` and blocks a production-ready result. Apple Silicon native evidence is explicitly advisory under the current release policy, so its visible `not_run` status does not block production.

See [the threat model](docs/architecture/threat-model.md) and [state/evidence/security invariants](docs/architecture/state-evidence-security.md) for detailed controls.
