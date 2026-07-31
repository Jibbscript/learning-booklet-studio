# Learning Booklet Studio

Learning Booklet Studio is an open-source Codex plugin for turning a technical topic, paper, repository, or URL into a verified single-page interactive learning booklet. It combines one public skill, a deterministic phase engine, and an optional MCP Apps workspace. The skill remains usable when the graphical workspace is unavailable.

This repository is an MVP release candidate. Source, contract, and browser checks can run on any supported development host. Production release requires the exact packaged candidate to pass the native Intel ChatGPT Desktop gate described below. Apple Silicon evidence is tracked independently as a non-blocking compatibility advisory.

## What it provides

- `$build-learning-booklet`, a single public skill with `manifest_only`, `plan_only`, and `plan_then_build` modes.
- An I0 intent/design gate followed by phases P0–P10 for research, pedagogy, product design, implementation, verification, repair, and release.
- Exactly three topic-specific visual-system choices when design intent is unresolved.
- A self-contained MCP Apps widget for reviewing progress, decisions, evidence, and repair state in place.
- A skill-only fallback that uses local run state and concise chat decisions.
- A one-file `index.html` artifact contract: no required build step, backend, runtime network request, external font, analytics, or telemetry unless the user explicitly changes the contract.
- Honest verification statuses: `pass`, `fail`, `partial`, `not_run`, and `not_applicable`.

## Architecture at a glance

```text
User request
    │
    ▼
$build-learning-booklet ──► workflow engine ──► local run/evidence store
    │                              │
    │                              ├──► phase artifacts and index.html
    │                              └──► sanitized codex-skill-ui/1 projection
    │
    └──► Codex host ◄──► local MCP server ◄──► MCP Apps widget
```

The widget is an inspect-and-decide surface. It cannot invoke a skill, shell, or filesystem directly; it uses app-visible MCP tools and model-visible follow-up messages. Durable state stays in the engine/server, not in React. `codex-skill-ui/1` is inspired by AG-UI concepts but is not an AG-UI compatibility claim. See [the architecture index](docs/README.md) and [the AG-UI notice](NOTICE-AG-UI.md).

The approved Studio Path reference, implementation captures, and same-viewport comparison are recorded in [design-qa.md](design-qa.md).

## Quickstart for contributors

Prerequisites:

- Node.js 20 or newer
- npm with lockfile support
- Python 3 only if you independently run Codex's upstream plugin/skill validators
- ChatGPT Desktop with Codex mode for the final native journey

From the repository root:

```sh
npm ci
npm run build
npm run check
npm run validate
npm test
npm run test:e2e
```

Useful focused commands:

```sh
npm run test:unit
npm run test:bdd
npm run test:mcp
npm run test:widget
npm run test:e2e
npm run package:release
```

`npm run test:e2e` runs the built widget in headless Chromium with keyboard, responsive-layout, serious/critical accessibility, console, and offline-network guards. `npm run package:release` builds a deterministic candidate archive and evidence report under `dist/release/`. It exits unsuccessfully until every production-required gate—including current native Intel evidence for the exact archive SHA-256—passes. Apple Silicon evidence is validated when supplied and remains visible as `not_run` or `fail` otherwise, but it does not block production. Evidence from one architecture never substitutes for the other.

For an authoring-host packaging check that preserves the partial result but returns success to the shell, use `npm run test:release:partial`. This option does not make the release ready.

## Local Codex installation

The most predictable development shape is a local marketplace entry whose source is this plugin directory.

1. Build and test the repository with the quickstart commands.
2. Put the complete directory at the marketplace-relative path `plugins/learning-booklet-studio`.
3. Add this entry to that marketplace's `plugins` array without replacing unrelated entries:

```json
{
  "name": "learning-booklet-studio",
  "source": {
    "source": "local",
    "path": "./plugins/learning-booklet-studio"
  },
  "policy": {
    "installation": "AVAILABLE",
    "authentication": "ON_INSTALL"
  },
  "category": "Productivity"
}
```

4. For the default personal marketplace, use its existing name and install with:

```sh
codex plugin add learning-booklet-studio@personal
```

5. Restart ChatGPT Desktop if requested by the host, open a **new** Codex task, and invoke `$build-learning-booklet` explicitly. Then test a second fresh task with a plain technical-learning request to verify implicit discovery.

The default personal marketplace is discovered at the platform's standard personal marketplace location. A non-default repo/team marketplace must first be configured with `codex plugin marketplace add` and installed using that marketplace's actual name. Current platform instructions are linked in [the runtime integration guide](docs/architecture/runtime-mcp-apps.md).

### Upgrade, disable, and remove

- Upgrade: replace the marketplace source with the new, checksum-verified candidate; ensure its SemVer changed; run `codex plugin remove learning-booklet-studio@<marketplace-name>`; then reinstall with `codex plugin add learning-booklet-studio@<marketplace-name>` and test in a fresh task.
- Disable: use the plugin toggle in the ChatGPT Desktop Codex plugin settings when available, then start a fresh task to confirm the skill and tools are absent.
- Remove: run `codex plugin remove learning-booklet-studio@<marketplace-name>` (or pass `--marketplace <marketplace-name>`), remove its marketplace entry/source only if no other installation uses it, restart the desktop app, and verify absence in a fresh task.

Never overwrite an existing marketplace file wholesale. Preserve other entries and the marketplace's configured name.

## Enterprise stand-alone skill

Organizations that permit plain Agent Skill directories but prohibit plugin or graphical integrations can install the self-encapsulated edition from [`standalone/build-learning-booklet`](standalone/build-learning-booklet). It bundles the prompt, host metadata, phase guidance, schemas, zero-dependency workflow engine, validators, audits, and HTML template beneath one relocatable directory. See [`standalone/README.md`](standalone/README.md) for installation and verification.

## Skill-only use

The graphical workspace is optional. With MCP app tools unavailable, invoke `$build-learning-booklet` and provide a topic, source, or learning goal. The skill records equivalent local state, presents material decisions in chat, and performs the same phase gates. The three terminal modes are:

| Mode | Terminal result |
|---|---|
| `manifest_only` | A compiled, authoritative learning-task manifest; status `specified` |
| `plan_only` | An implementation-ready research/design/build plan; status `planned` |
| `plan_then_build` | A generated and verified one-file booklet; status `completed` only after applicable hard gates pass |

## Local MCP development and public deployment

The checked-in `.mcp.json` launches the built stdio server for local plugin development. Build it with `npm run build`. The generated widget is self-contained, but the orchestration service is not an offline product merely because the final learning artifact is offline-capable.

For an MCP-backed developer-mode app, expose the server through a reachable HTTPS development endpoint and follow the current Apps SDK connection flow. A public submission requires a stable production HTTPS MCP endpoint with TLS, operational ownership, privacy terms, and monitoring. A localhost address, tunnel used as a production endpoint, or existing developer app ID is not a public deployment. See [runtime and MCP Apps integration](docs/architecture/runtime-mcp-apps.md).

## Verification and release

Repository policy, plugin/skill structure, source privacy, direct dependency licensing, and widget packaging are checked locally. The release packager emits:

- a deterministic `.tar.gz` candidate;
- a normalized file manifest with SHA-256 digests;
- `SHA256SUMS` for distributable artifacts;
- a machine-readable release report listing passed, failed, partial, and unexecuted gates.

Production readiness additionally requires a real ChatGPT Desktop Codex-mode run on a native Intel `x86_64` process for the exact candidate. A non-translated Apple Silicon `arm64` run is an independent compatibility advisory and is reported honestly when unavailable. Browser tests, Rosetta, a mocked MCP host, source inspection, cross-architecture substitution, or screenshots without environment identity do not satisfy either architecture's evidence contract. The policy is defined in [Native Intel and Apple Silicon desktop verification](docs/architecture/apple-silicon-verification.md).

The verifier accepts external evidence without copying private logs into the plugin archive:

```sh
node scripts/verify-oss-release.mjs \
  --test-evidence test-results/release/automated.json \
  --eval-evidence test-results/release/sol-eval.json \
  --native-intel-evidence test-results/release/native-intel/evidence.json \
  --native-apple-silicon-evidence test-results/release/native-apple-silicon/evidence.json
```

Run an initial partial package to obtain `contentDigest` and the candidate archive SHA-256. Automated and model-evaluation evidence must bind to `contentDigest`; native evidence must bind to the exact archive SHA-256. Automated evidence follows `contracts/automated-test-evidence.schema.json`: it records the environment, observed time, executed checks, and command results, and every result path must resolve to a retained, digest-matching attachment inside the evidence bundle. The checks cover repository policy, schemas/unit tests, BDD, MCP, widget, browser runtime, accessibility, offline/network behavior, and secret/license scans. Model evidence records the observed GPT-5.6 Sol label plus passing golden, adversarial, and degraded cases. Native attachments use relative paths and their own SHA-256 digests. Any stale, missing, partial, malformed, path-leaking, or digest-mismatched record blocks a `pass` decision.

## Compatibility

| Surface | MVP compatibility |
|---|---|
| Plugin bundle | `learning-booklet-studio` 0.1.x |
| Node.js | 20 or newer |
| MCP Apps | `@modelcontextprotocol/ext-apps` 1.7.4 contract baseline |
| Workflow projection | `codex-skill-ui/1` |
| AG-UI reference | `@ag-ui/core` 0.0.57, inspiration only |
| Native desktop host | Intel `x86_64` exact-candidate journey required; non-translated Apple Silicon `arm64` tracked as a non-blocking compatibility advisory |
| Generated artifact | Current stable Chromium, Firefox, Safari, and Edge targets; actual runs must be recorded per release |
| Model behavior | Evaluated against GPT-5.6 Sol where evidence is available; the plugin does not pin or enforce a model |

Breaking contract or projection changes require a major version and migration notes. Patch/minor changes must preserve the compatibility statement or update it explicitly.

## Privacy and security

The local MVP sends no product analytics or telemetry. Local workflow state is stored under the Codex state directory and may contain user-provided topics, source metadata, and generated evidence; users are responsible for their workspace and backup policy. The widget receives a sanitized projection rather than full source bodies, secrets, or private reasoning. The generated `index.html` is audited for unintended runtime requests and unsafe dynamic insertion.

A remotely deployed MCP service has a separate operator-controlled privacy boundary and must publish its own retention, access, logging, and deletion policy before public use. Do not place credentials or proprietary source bodies in fixtures, screenshots, release archives, or issue reports. See [SECURITY.md](SECURITY.md) and the [threat model](docs/architecture/threat-model.md).

## Accessibility

The widget and generated artifact target applicable WCAG 2.2 Level AA requirements, keyboard operation, visible focus, non-color status cues, reduced motion, text zoom, narrow layouts, and accessible diagrams. Automated checks are necessary but insufficient: release evidence also requires manual keyboard, focus, zoom, reduced-motion, diagram-alternative, and screen-reader inspection. Accessibility issues are defects; report them through the support or security path as appropriate.

## Known limitations

- Native Intel and Apple Silicon ChatGPT Desktop evidence is manual, architecture-specific, and candidate-digest-specific; only Intel is production-required under the current release policy.
- The MCP workspace is message-scoped web content, not a persistent native sidebar or AppKit extension.
- Public hosting, authentication, privacy policy publication, and marketplace submission are operator work, not performed by this repository.
- Browser-engine automation does not prove behavior in a branded browser unless that browser was actually run.
- GPT-5.6 Sol tuning is an evaluation target, not a runtime guarantee.
- The MVP's local stdio MCP configuration is for development; public deployment needs HTTPS.

## Contributing, support, and license

Read [CONTRIBUTING.md](CONTRIBUTING.md) before proposing changes. For ordinary defects, use the issue tracker or support channel attached to the copy of the repository you received, including a minimal reproduction and non-sensitive test output. For vulnerabilities, follow [SECURITY.md](SECURITY.md) and avoid public disclosure until a private channel is established.

Learning Booklet Studio is licensed under the [MIT License](LICENSE). Third-party attribution and the bounded AG-UI relationship are documented in [NOTICE-AG-UI.md](NOTICE-AG-UI.md). Project changes are recorded in [CHANGELOG.md](CHANGELOG.md).
