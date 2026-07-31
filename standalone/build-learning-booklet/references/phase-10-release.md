# P10: Final Acceptance And Handoff

Layer: release

Purpose: calculate whether the requested outcome is releasable and provide an honest handoff.

Consumes: current manifest, all phase gates, current `index.html` hash, verification report, defect log, residual risks, limitations.

Produces: an engine-derived release decision report (optionally written as `release-manifest.json`), final reports, maintenance notes, and terminal run decision. Installation archive construction is separate from booklet release checks.

## Acceptance

Run `verify-release.mjs --run <run-root-or-run-state.json>`, optionally with `--report <release-manifest.json>`. The wrapper loads canonical state, submits `release.decide` through the workflow engine, validates the event log, and reports the engine's deterministic decision. It does not scan unrelated workspace files, create an archive, or calculate distribution checksums.

The engine decision is binary: `pass` or `fail`. Evidence within the decision may remain `partial` or `not_run`, but either blocks release. The decision must include the applicable run/mode decision data, current artifact hash, required gate results, open findings by severity, stale evidence, `not_run` checks, residual risks, limitations, evidence references, and terminal status. Treat fields absent from the current engine contract as a contract defect; do not synthesize them in prose and call the verifier complete.

Release only when:

- one complete current `index.html` exists;
- it opens without a build step and works offline;
- central claims are source-traceable;
- every objective maps to instruction, practice, and assessment;
- required interactions are meaningful and keyboard-operable;
- required responsive/accessibility/functional tests passed;
- citations/references are complete;
- no blocker or major finding remains;
- no stale evidence, required placeholder, dead control, or unexplained console error remains;
- every original acceptance criterion is satisfied.

## Hard Gate

- Release verifier returns a passing decision against current hashes.
- Required reports exist and agree on statuses.
- Known limitations and residual risks do not contradict a hard gate.
- The final handoff distinguishes executed, partial, unexecuted, and inapplicable checks.

If any gate fails, keep status `failed_gate`, identify the earliest responsible phase, repair, and rerun affected downstream checks. Do not emit `completed` manually.

## Handoff

Lead with the artifact and terminal decision. Summarize learner/topic scope, selected design, checks run, unavailable checks, repairs, limitations, residual risks, and maintenance notes. Provide links or paths only to artifacts that actually exist. Never call `specified` or `planned` a completed application.
