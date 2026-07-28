# Production release runbook

Production publishing is a manual promotion after CI passes. The promotion workflow is fail-closed for required gates: it publishes only an existing annotated tag whose package version matches the tag and whose exact archive passes the automated, model-evaluation, and Intel macOS evidence gates. Apple Silicon evidence is accepted and reported when supplied, but it is a non-blocking compatibility advisory.

## Prepare the evidence assets

Create three required gzip-compressed tar archives. An Apple Silicon archive may be supplied as an optional fourth asset. Each archive must place the named manifest at its root and retain every relative attachment referenced by that manifest.

| Asset | Root manifest |
|---|---|
| `learning-booklet-studio-<version>-automated-evidence.tar.gz` | `automated.json` |
| `learning-booklet-studio-<version>-sol-evidence.tar.gz` | `sol-eval.json` |
| `learning-booklet-studio-<version>-native-macos-intel-evidence.tar.gz` | `evidence.json` |
| `learning-booklet-studio-<version>-native-macos-apple-silicon-evidence.tar.gz` (optional advisory) | `evidence.json` |

Every supplied bundle must already pass its schema, digest, attachment, privacy-review, candidate-content, and candidate-archive checks locally. Apple Silicon evidence cannot substitute for the required Intel journey, and an absent Apple Silicon bundle remains visible as `not_run` without blocking production.

## Create the promotion target

1. Confirm `npm run check`, `npm run validate`, `npm test`, `npm run test:e2e`, and the fail-closed release verifier pass locally.
2. Create and push an annotated `v<version>` tag from the reviewed `main` commit.
3. Create a draft GitHub release for that existing tag using the matching file under `.github/release-notes/`.
4. Upload the three required evidence archives and, when available, the optional Apple Silicon archive to the draft release.
5. Dispatch the `Production release` workflow with the exact tag.

The workflow repeats repository, schema, unit, BDD, MCP, widget, browser, accessibility, offline, packaging, evidence, and checksum verification. It then creates a GitHub build-provenance attestation, uploads the distributable archive and machine-readable verification files, and changes the draft to the latest production release.

If any check is missing, stale, malformed, partial, or failed, the draft remains unpublished.
