# Intel macOS native evidence workspace

This directory contains the evidence contract and operator checklist for the
`native-macos-intel` release gate. It is deliberately separate from generated
release archives. Native evidence may contain machine-specific observations and
must be reviewed for private data before sharing.

## Current host baseline

Read-only discovery on 2026-07-22 established the following facts:

- host: MacBook Pro `MacBookPro15,1`, Intel Core i7, 32 GB RAM;
- operating system: macOS 15.7.7, build 24G720;
- kernel and user-process architecture: `x86_64`;
- installed desktop bundle: `com.openai.codex`, ChatGPT 26.715.72028, build 5706;
- main executable: a thin `x86_64` Mach-O with `LSRequiresNativeExecution = true`;
- launch registration: the running application points at the inspected main
  executable;
- plugin state at initial capture: not installed from the local Intel test
  marketplace;
- native UI checks: not run at initial capture.

The machine and desktop application therefore qualify as a native Intel test
host. They do not, by themselves, prove plugin discovery, the inline MCP widget,
task continuity, accessibility, remediation, or artifact completion. The
The source repository's machine-readable `intel-host-baseline.json` records
that distinction. It is historical, machine-specific evidence and is
intentionally excluded from distributable release archives.

## Files

- `native-macos-evidence.schema.json`: strict manifest contract shared by the
  required Intel result and advisory Apple Silicon result.
- `intel-host-baseline.json` (source repository only): historical environment
  observations collected from this host; overall status remains `partial`.
  Packaged operators must create a fresh capture instead of looking for this
  file in the installed plugin.
- `intel-checklist.md`: the executable desktop journey and required attachment
  inventory.
- `capture-host.sh` and `process-architecture.c`: read-only host, bundle, and
  live-process capture. The helper queries the running PID through
  `proc_pidinfo(PROC_PIDARCHINFO)` instead of inferring its CPU type from the
  bundle. It prints a schema-valid partial manifest and does not alter Codex
  configuration.
- `prepare-marketplace.sh`: expands the exact release archive into a clean,
  git-ignored local marketplace. It does not install the plugin or modify Codex
  configuration.
- `run-keyboard-selection.sh` and `keyboard-select.applescript`: dynamically
  locate the running ChatGPT process, traverse from the current focus position
  using Tab, and activate a named control with Enter or Space. They never use a
  pointer event, coordinate, or `AXPress`.
- `capture-chatgpt-window.sh` and `front-window-id.c`: dynamically resolve the
  visible ChatGPT window and retain a timestamped native-window screenshot.
  The operator must grant and preflight Screen Recording permission.
- `validate-evidence.mjs`: validates the JSON contract, exact six-check set,
  terminal parent/child/restart identities, positive and changed MCP process
  IDs across restart, required semantic attachment groups and media kinds,
  safe relative regular files, attachment digests, check-to-attachment
  coverage, and automated private-data scans for both the manifest and textual
  attachments. Every screenshot or recording must also carry an attributable
  manual visual privacy review.

Capture and validate without writing into the release archive:

```sh
evidence/intel-macos-native/capture-host.sh \
  > test-results/native-macos-intel/host-capture.json
node evidence/intel-macos-native/validate-evidence.mjs \
  test-results/native-macos-intel/host-capture.json
```

After installing a packaged candidate, verify the installed copy—not only its
reported version—against the current release report:

```sh
node scripts/check-installed-candidate.mjs \
  --installed-root /path/to/installed/learning-booklet-studio \
  --release-report dist/release/release-report.json
```

For the final keyboard record, first place focus at a known native starting
point, then run the helper and redirect its timestamped output into the private
evidence bundle:

```sh
sh evidence/intel-macos-native/run-keyboard-selection.sh \
  "Use Proof-Trace Keyboard Lab" enter 80
```

## Pass boundary

An Intel manifest may be marked `pass` only after all six `MAC-*` checks pass,
the plugin digest matches the exact candidate archive, and every listed
attachment exists with a matching SHA-256 digest. Browser previews, source
inspection, mocked MCP hosts, and Apple Silicon evidence cannot substitute for
this Intel desktop run.

The completed artifact digest must match an attachment whose group is
`completed-artifact` and whose kind is `artifact`. Explicit discovery, implicit
discovery, and degraded recovery require native-window screenshots; keyboard
selection requires a log or recording; VoiceOver requires a dedicated
checklist or inspection log; and responsive layout requires visual evidence in
the `narrow`, `normal`, and `fullscreen` contexts.

The release verifier requires `native-macos-intel` and recognizes
`native-macos-apple-silicon` independently as a non-blocking advisory. When
both manifests are supplied, both must bind to the same candidate archive and
content digest. An Intel pass satisfies the production native gate; it does
not fabricate or substitute for Apple Silicon evidence.
