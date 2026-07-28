# Workflow engine

Dependency-free Node ESM reducer for the deterministic learning-booklet workflow.

```js
import {
  createRunState,
  resumeRunState,
  patchIntentManifest,
  proposeDesignOptions,
  selectDesign,
  startPhase,
  recordArtifact,
  recordEvidence,
  evaluatePhaseGate,
  completePhase,
  releaseDecision,
} from "./packages/workflow-engine/index.mjs";
```

Human decisions are terminal per execution run. `requestInput` appends
`run.finished` with `outcome: "interrupt"`; subsequent mutation of that parent
run fails with `RUN_TERMINAL`. Resume by creating a child run with the complete
interrupt set:

```js
const child = resumeRunState(interruptedParent, {
  runId: "run-child-002",
  threadId: interruptedParent.threadId,
  resume: [
    {
      interruptId: interruptedParent.pendingDecision.id,
      value: {
        selection: { method: "user-selected", selectedOptionId: "design-2" },
      },
    },
  ],
});
```

The child keeps `threadId`, sets `parentRunId`, uses a new `runId`, records the
complete `resume[]` on its first `run.created` event, and leaves the parent
unchanged. Missing, duplicate, or partial resolution sets fail closed.

Project canonical audit events into the public UI dialect through the packaged
adapter rather than publishing lowercase engine events directly:

```js
import {
  projectCodexSkillUiEvents,
  projectCodexSkillUiJourney,
  validateCodexSkillUiSequence,
} from "@learning-booklet-studio/workflow-engine/codex-skill-ui-adapter";

const parentEvents = projectCodexSkillUiEvents(interruptedParent);
const journey = projectCodexSkillUiJourney(interruptedParent, completedChild);
validateCodexSkillUiSequence(parentEvents);
```

Each transport run starts at `seq: 0`, ends in exactly one terminal event,
retains stable `threadId`, and uses a distinct child `runId` plus `parentRunId`
and complete `RUN_STARTED.payload.resume`. The adapter emits sanitized
materialized snapshots and decision messages, rejects canonical sequence gaps
and post-terminal events, and enforces the 256 KiB event limit.

Every state-changing API accepts the current state and returns a new state. Reusing an
`idempotencyKey` with the same input returns the current state unchanged; reusing it with
different input throws `WorkflowError` with code `IDEMPOTENCY_CONFLICT`.

Hosts can use the command envelope without coupling to individual reducer functions:

```js
const { state: nextState, events, result } = applyCommand(state, {
  type: "design.select",
  payload: {
    selection: { method: "user-selected", selectedOptionId: "memory-lab" },
  },
  idempotencyKey: "decision-123",
  expectedStateVersion: state.stateVersion,
});
```

`COMMAND_TYPES` is the canonical command vocabulary. Optimistic-version conflicts use
`STATE_VERSION_CONFLICT`; an identical idempotent retry is accepted even when its original
expected version is now old.

The engine does not execute tools, fetch sources, interpret source prose, or grant permissions.
`registerSource` stores source material as data so prompt-like content cannot mutate workflow
state. JSON Schemas are maintained separately in `contracts/`.

## Packaged native remediation fixture

The release candidate includes a deterministic public fixture that terminates an
intake run at a design interrupt, resumes on the same thread, injects a known P8
focus-visibility failure rooted in the P7 production artifact, causally reopens
P7, repairs it on attempt 2, and reruns P8 through P10:

```sh
node packages/workflow-engine/native-fixture-cli.mjs --stage failed
node packages/workflow-engine/native-fixture-cli.mjs --stage complete
```

Optional `--thread-id`, `--parent-run-id`, `--run-id`, and `--now` arguments use
`--name value` form. Add `--include-state true` when the full authoritative
state is required. The exported programmatic surface is
`createNativeFailureFixture`, `repairNativeFailureFixture`, and
`runNativeFailureRepairFixture` from `@learning-booklet-studio/workflow-engine/native-fixture`.
Its report includes `transport.parentEvents`, `transport.childEvents`, and
independent validation results for the interrupted-parent/resumed-child journey.

The skill-local persistent wrapper exposes the same child-run boundary:

```sh
node skills/build-learning-booklet/scripts/workflow-state.mjs resume \
  --workspace /path/to/workspace \
  --run /path/to/parent-run \
  --resume /path/to/resume.json \
  --run-id child-run-id
```

It writes a new child run root atomically and never overwrites the parent.
