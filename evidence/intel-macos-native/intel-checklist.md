# Native Intel Codex desktop checklist

Gate: `native-macos-intel`

Candidate version: record during execution

Candidate archive SHA-256: record during execution

Content digest: record during execution

Tester and UTC interval: record during execution

## A. Candidate binding and clean installation

- [ ] Rebuild and package once; record the final archive SHA-256 and content digest.
- [ ] Run `prepare-marketplace.sh` against that archive.
- [ ] Remove any older `learning-booklet-studio` installation and its temporary
      marketplace registration.
- [ ] Register the generated marketplace and install
      `learning-booklet-studio@learning-booklet-native-intel`.
- [ ] Confirm `codex plugin list` reports the exact plugin version as installed
      and enabled.
- [ ] Run `scripts/check-installed-candidate.mjs` against the installed plugin
      root and confirm its complete `RELEASE-MANIFEST.json` and `SHA256SUMS`
      reproduce the release report's content digest.
- [ ] Start discovery in a fresh Codex task. Restart ChatGPT Desktop only when
      the host requests it or the fresh task does not expose the installed skill
      and MCP tools.
- [ ] Re-capture host, desktop version/build, process identity, and executable
      architecture after installation and after any restart.

## B. Fresh-task discovery

- [ ] In fresh Codex task A, invoke `$build-learning-booklet` explicitly.
- [ ] Confirm the one public skill is selected and its MCP tools are available.
- [ ] In fresh Codex task B, submit the plain golden technical-learning request
      without naming the skill.
- [ ] Confirm implicit matching and record the run ID.
- [ ] Capture screenshots that include desktop chrome, task context, run ID, and
      enough timestamp context to correlate with logs.

## C. In-place widget journey

- [ ] Confirm the widget renders inline in the native desktop task.
- [ ] Confirm I0 then P0 through P10 appear in order and status is truthful.
- [ ] Confirm the unresolved visual gate shows exactly three complete options and
      one nonbinding recommendation.
- [ ] Using only Tab, Shift-Tab, Space, and Enter, reach every design option,
      observe visible focus, and submit one selection.
- [ ] Confirm there is no keyboard trap and focus is not obscured.
- [ ] Confirm the server-owned run records exactly one decision and the same task
      resumes.
- [ ] Confirm the parent transport ends with exactly one
      `RUN_FINISHED(outcome=interrupt)` and the child begins with the same thread
      ID, a new run ID, the parent run ID, and a complete `resume[]`.

## D. Repair, degraded behavior, and reconciliation

- [ ] Trigger the documented deterministic failure fixture.
- [ ] Confirm the earliest responsible phase reopens and the failure is visible.
- [ ] Repair or retry; confirm failed evidence remains in history and new evidence
      replaces only the current attempt.
- [ ] Exercise a safe widget error or unavailable-orchestration state; confirm the
      consequence and retry/reconcile action are clear and no secret-bearing
      diagnostic appears.
- [ ] Record the MCP process ID, restart that exact plugin MCP process, and record
      the changed process ID.
- [ ] Reopen the same task; confirm the widget automatically reconciles the
      resumed child from the server snapshot rather than stale local state or a
      replayed decision.
- [ ] Confirm cancellation remains `cancel_requested` until terminal
      acknowledgement and never implies an immediate process kill.

## E. Accessibility and layout

- [ ] Complete the decision path with keyboard only.
- [ ] Complete a VoiceOver smoke test for reading order, control names,
      instructions, state announcement, and error recovery.
- [ ] Inspect narrow inline, normal inline, and host fullscreen layouts.
- [ ] Inspect text zoom and confirm no required content or focus is clipped.
- [ ] Enable reduced motion and confirm no required information depends on motion.
- [ ] Confirm status is never conveyed by color alone.

## F. Completion and evidence archive

- [ ] Finish the representative booklet run and open the generated `index.html`.
- [ ] Record the artifact SHA-256 and confirm it matches the workflow evidence.
- [ ] Inspect completion evidence, residual risks, the required Intel gate, and
      the Apple Silicon compatibility advisory in the widget.
- [ ] Export secret-safe logs and screenshots; remove private prompts, tokens,
      absolute personal paths, and unrelated task data.
- [ ] Hash every attachment and list only relative paths in the manifest.
- [ ] Run the automated privacy scan for every textual attachment and record an
      attributable manual visual privacy review for every screenshot/recording.
- [ ] Validate the completed manifest with
      `node evidence/intel-macos-native/validate-evidence.mjs path/to/evidence.json`.
- [ ] Confirm all `MAC-001` through `MAC-006` entries are executed and `pass`.
- [ ] Run the release verifier with the exact Intel manifest and confirm it
      requires `native-macos-intel` while reporting Apple Silicon independently
      as a non-blocking advisory.

## Required attachment set

- environment and running-process architecture capture;
- plugin list/install record bound to candidate digest;
- explicit-discovery screenshot;
- implicit-discovery screenshot;
- inline design gate and keyboard selection evidence;
- failure, reopened phase, repaired attempt, and retained history evidence;
- degraded/error and recovery evidence;
- reopen/reconciliation evidence;
- dedicated VoiceOver checklist or inspection log;
- responsive-layout screenshots or recordings for narrow, normal, and
  fullscreen contexts;
- completed artifact and SHA-256 record;
- native manifest validation result;
- final release verifier result.

The resumed and restarted observations must each record a positive MCP process
ID, and the restarted ID must differ from the resumed ID. The artifact SHA-256
must bind specifically to the `completed-artifact` attachment of kind
`artifact`, not to an unrelated log or screenshot with the same digest.
