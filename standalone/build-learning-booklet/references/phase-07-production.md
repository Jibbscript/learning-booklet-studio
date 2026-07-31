# P7: Content And Component Production

Layer: build

Purpose: implement the complete instructional artifact in independently testable increments.

Consumes: passed research, learning, information, interaction, visual, and technical plans.

Produces: one `index.html`, `production-inventory.json`, increment evidence, and updated claim/objective/interaction mappings.

## Work

1. Copy `assets/index.template.html` when useful; preserve its semantic/accessibility baseline and replace generic teaching content.
2. Build the semantic shell, navigation, tokens/layout, instructional sections, diagrams/code examples, representative interaction, remaining interactions, assessments/feedback, glossary/references, persistence/reset if authorized, and print/reduced-motion rules.
3. Test each increment before integration.
4. Keep technical claims within their supported context and citations.
5. Make code examples syntactically plausible, label their environment, explain correctness-critical lines, distinguish illustration from production guidance, and cover relevant edge cases.
6. Ensure feedback explains why answers are right or wrong and what model to use instead.

## Hard Gate

- `index.html` contains all required content and behavior.
- No required placeholder, dead control, pseudo-implementation, or “implement later” marker remains.
- Examples, diagrams, calculations, prose, and assessment answers agree.
- Every required interaction produces explained output and supports repeated use.
- Citations and qualifications remain attached to the relevant claims.
- Local increment checks pass with current evidence.

Repair factual/pedagogical/design defects in their earliest phase. Repair implementation defects in P7. Any changed output invalidates P8–P10 evidence.

Evidence: current file hash, inventory/traceability checks, syntax/static results, and executed increment tests.
