# P9: Adversarial Review And Repair

Layer: build

Purpose: attempt to falsify apparent completeness and repair the earliest underlying cause.

Consumes: current artifact, current P8 evidence, source/claim/objective/interaction ledgers.

Produces: `defect-log.json`, repaired artifacts, causal phase mapping, and affected regression results.

## Review Perspectives

Inspect as a novice learner, knowledgeable learner, skeptical domain expert, keyboard-only user, VoiceOver/screen-reader user when available, narrow-screen user, offline user, source maintainer, and evaluator asking whether interactions teach anything.

Challenge central explanations, counterexamples, hidden assumptions, benchmark interpretations, malformed/minimum/maximum input, repeated use, reset/recovery, refresh, internal navigation, diagram ambiguity, inconsistent terminology, assessment feedback, citation qualification, source injection, and decorative complexity.

Classify each finding as `blocker`, `major`, `minor`, or `nit`. Record requirement, evidence, impact, reproduction, earliest responsible phase, repair, and regression scope.

## Hard Gate

- Zero open blocker findings.
- Zero open major findings.
- Every repaired finding has current regression evidence.
- Remaining findings and residual risks are explicit and do not violate a hard gate.
- Review does not claim perspectives or assistive technologies that were not exercised.

Reopen the earliest responsible phase and invalidate downstream evidence. Do not waive or relabel a finding to release.

Evidence: defect reproductions, repair diffs/hashes, reviewer inspections, and affected test reruns.
