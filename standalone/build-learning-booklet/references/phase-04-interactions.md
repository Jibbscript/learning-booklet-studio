# P4: Interaction Specification

Layer: planning

Purpose: specify a small set of interactions that cause learning rather than decorate the page.

Consumes: learning architecture, information architecture, topic mechanisms, artifact/accessibility constraints.

Produces: `interactions.json` containing interaction inventory, objective mappings, learner tasks, states, inputs/outputs, calculations, transitions, feedback, reset/repeat behavior, accessibility, responsive behavior, errors, edge cases, and tests.

## Interaction Contract

For every interaction define:

- stable ID, mapped objective, concept, and why interaction is better than static prose;
- initial state, controls, valid/invalid inputs, transformations, outputs, and state transitions;
- learner instruction and explanatory/corrective feedback;
- prediction, manipulation, observation, explanation, comparison, and generalization steps where useful;
- reset, retry, refresh, and repeated-use behavior;
- keyboard path, focus behavior, accessible name/instructions, status announcements, non-color cues, reduced motion, narrow-screen behavior, and any canvas fallback;
- unit, integration, edge, and completion tests.

Do not count clicking as learning evidence. Prefer three to five substantive interactions over many shallow controls.

## Hard Gate

- Every interaction maps to at least one objective and learner action.
- Every state and transition is defined.
- Reset, repeat, invalid input, error, and edge behavior are defined.
- Every required action has a keyboard path and visible/non-color feedback.
- Each interaction has testable educational completion criteria.
- No decorative or redundant interaction remains.

Repair objective defects in P2, placement defects in P3, and behavior defects in P4. Material changes invalidate P5–P10.

Evidence: interaction/objective matrix, state completeness, keyboard-path inspection, edge-case inventory, and test case review.
