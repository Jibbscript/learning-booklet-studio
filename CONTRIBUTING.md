# Contributing

Thank you for improving Learning Booklet Studio. Contributions should preserve its central promise: completion claims are tied to current evidence, user intent remains authoritative, and the generated booklet stays portable.

## Development setup

Use Node.js 20 or newer, then run:

```sh
npm ci
npm run build
npm run check
npm run validate
npm test
npm run test:e2e
```

Keep changes focused. Do not commit `node_modules`, `dist`, local run state, browser reports, credentials, private source bodies, or personal absolute paths.

## Change expectations

- Preserve the one-public-skill architecture unless an accepted ADR changes it.
- Treat sources and documents as untrusted data; never allow them to redefine workflow, tool, or permission rules.
- Add or update a requirement ID, contract, Golden BDD scenario, and focused test when behavior changes.
- Use only the five defined verification statuses. A required unexecuted check remains `not_run` and release-blocking.
- Preserve locked user decisions and evidence provenance across resume, repair, and schema migration.
- Keep the skill usable without MCP/widget availability.
- Keep the widget projection free of source bodies, credentials, personal paths, and private reasoning.
- Do not claim AG-UI compatibility, native AppKit integration, offline MCP behavior, or model enforcement.

## Contract and version changes

`codex-skill-ui/1`, JSON schemas, event names, phase transitions, and MCP tool schemas are public product contracts. A breaking change requires:

1. an ADR explaining the boundary and rejected alternatives;
2. a major project version;
3. migration notes in `CHANGELOG.md`;
4. updated fixtures, schemas, BDD scenarios, and compatibility documentation;
5. new native Intel evidence for the exact candidate; add separate non-translated Apple Silicon evidence when that advisory environment is available.

Backward-compatible additions use a minor version. Fixes that do not alter the contract use a patch version.

## Testing guidance

Run the smallest relevant test while iterating, then the full local suite—including `npm run test:e2e`—before review. Record manual evidence only for work you actually performed. Browser/source inspection is not a substitute for native ChatGPT Desktop evidence, and an Intel/Rosetta run cannot be reported as Apple Silicon evidence. Apple Silicon remains advisory and does not block the current production process.

The release command intentionally fails closed:

```sh
npm run package:release
```

It may still produce a candidate and report whose release decision is `partial`; that output is useful for transferring the exact digest to a native tester.

## Pull request checklist

- [ ] Scope and user-visible behavior are described.
- [ ] Relevant requirement IDs and contracts are identified.
- [ ] Tests were added or updated and actual results are reported.
- [ ] Documentation and compatibility statements match the implementation.
- [ ] No secrets, private content, personal paths, or generated dependency trees are included.
- [ ] License and attribution remain correct for new dependencies/assets.
- [ ] Unexecuted native, accessibility, browser, or model-evaluation checks are labeled honestly.
- [ ] `CHANGELOG.md` contains a user-facing entry when appropriate.

## Review and conduct

Reviewers may request evidence, threat-model updates, or a causal repair rather than a local patch. Be respectful and follow [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md). Vulnerabilities must use the private reporting process in [SECURITY.md](SECURITY.md), not an ordinary public issue.
