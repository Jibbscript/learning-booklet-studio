# I0: Intent And Design Selection

Layer: intent

Purpose: compile an authoritative learning-task manifest and one coherent final visual direction without beginning the lesson, plan, or application.

Consumes:

- Initial request and available conversation context.
- Supplied sources and visual references.
- Existing manifest and selection events, if any.

Produces:

- `intent.manifest.json` with provenance and locks.
- `design-options.json` when design clarification is required.
- `intent.manifest.txt` from `compile-manifest.mjs`.

## Recover Before Asking

Extract topic, domain, learner, motivation, prerequisites, measurable outcomes, depth, duration, mandatory/optional/excluded concepts, technical scope, sources, evidence standard, interactions, assessment, artifact constraints, accessibility, tone, execution mode, and visual requirements. Do not ask the user to repeat known information or summarize an inspectable source.

Classify each field as `confirmed`, `researched`, `inferred`, `defaulted`, `conflicted`, `unresolved-critical`, or `unresolved-noncritical`. Ask five to eight high-information questions in the first round only when needed; ask no more than five in later rounds. Include a recommended default for each question.

## Defaults

Unless context makes them unsuitable, use an undergraduate CS learner, mechanism-level and implementation-aware depth, 45–60 minutes, measurable explain/trace/compare/apply/transfer outcomes, primary-source verification, three to five substantive interactions, formative feedback plus a transfer challenge, WCAG AA applicable requirements, current stable major browsers, one offline file, no runtime dependencies, and `plan_then_build` when build tools exist.

Defaults remain overridable and use `origin: defaulted`, `locked: false`.

## Design Options

Present exactly three complete options only after learner, outcomes, depth, duration, mandatory concepts, interactions, assessment, artifact constraints, and accessibility are authoritative or defaulted.

Each option must specify thesis, fit, layout/navigation, typography, color roles, component language, code, diagrams, evidence displays, assessments, motion, responsive/print behavior, accessibility, implementation implications, strengths, and limitations. Normalize dimensions so pairwise distinctness can be checked. Every pair must differ materially across at least five dimensions.

Recommend exactly one option using learner level, cognitive load, content type, interactions, duration, accessibility, and feasibility. Accept:

- one option;
- a coherent hybrid with named elements;
- the recommended option;
- delegated judgment;
- a complete directly supplied visual direction.

Do not generate alternatives for a complete directly supplied direction unless requested or needed to resolve a material conflict. Do not include rejected options in the compiled manifest.

## Contradictions

Detect scope/duration mismatch, prerequisite/depth mismatch, implementation outcomes with code excluded, recall-only assessment for application outcomes, mandatory/excluded overlap, missing version/workload context, offline/dependency conflict, inaccessible interaction behavior, and incompatible hybrid rules. Preserve the higher-level user intent and request only the smallest material resolution.

## Hard Gate

- No `unresolved-critical` or `conflicted` field remains.
- Required manifest fields have authoritative values.
- Outcomes, content, interactions, and assessment align.
- Scope fits duration or the accepted tradeoff is recorded.
- Exactly three valid options exist when alternatives were required.
- A design is selected, hybridized, directly supplied, or validly delegated.
- Final visual direction is implementable and contains no unresolved placeholder.
- Manifest compilation succeeds.

Stop as `awaiting_user` when a critical conflict or required design selection remains. In `manifest_only`, transition to `specified` after the gate passes and do not start P0.
