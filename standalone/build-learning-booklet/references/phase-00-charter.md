# P0: Project Charter

Layer: planning

Purpose: turn the resolved manifest into a bounded, testable project charter.

Consumes: passed I0 manifest, design resolution, source availability, artifact constraints.

Produces: `charter.json` containing topic boundary, learner, prerequisites, depth, duration, measurable outcomes, scope/non-scope, assumptions, ambiguities, risks, acceptance criteria, and execution mode.

## Work

1. Normalize terminology without changing locked user meaning.
2. Bound the topic to what fits the duration and one-page artifact.
3. Separate required scope, optional scope, and non-scope.
4. Record assumptions with provenance, confidence, impact, and reversal condition.
5. Convert artifact, accessibility, evidence, privacy, and portability constraints into testable acceptance criteria.
6. Identify risks that could invalidate research, learning design, interactions, or offline delivery.

## Hard Gate

- Every material input is supplied, inferred, defaulted, or explicitly unresolved-noncritical.
- Topic, learner, depth, duration, and outcomes form a coherent project.
- Scope can fit a single learning booklet or the accepted tradeoff is recorded.
- Requirements do not contradict the one-file/offline contract.
- Acceptance criteria have stable IDs and measurable outcomes.

Stop as `awaiting_user` only if the remaining conflict changes correctness or feasibility. Repair intent defects in I0; otherwise repair P0 and invalidate P1–P10.

Evidence: schema report, manifest hash, acceptance-criteria inspection, and any recorded user resolution.
