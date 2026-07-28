# P6: Technical Architecture And Plan

Layer: planning

Purpose: define an implementation-ready one-file architecture and expose high-risk assumptions before building.

Consumes: all passed planning artifacts, artifact contract, browser/accessibility targets.

Produces: `technical-plan.json` containing semantic document structure, IDs/anchors, CSS architecture/tokens/breakpoints/print/reduced-motion, JavaScript initialization/state/events/rendering, interaction/assessment/citation data models, optional persistence schema, error recovery, security boundaries, test hooks, implementation increments, verification plan, and release gates.

## Architecture Rules

- Prefer native landmarks, headings, buttons, forms, disclosures, CSS custom properties, deterministic initialization, explicit state transitions, event delegation, and `textContent` for untrusted strings.
- Use inline SVG for accessible diagrams when suitable. Provide equivalent text or fallback for informative graphics.
- Avoid `eval`, `new Function`, inline event attributes, unsafe untrusted HTML insertion, positive `tabindex`, mouse-only behavior, hidden networking, unnecessary persistence, and silent error swallowing.
- If persistence adds learner value, version the schema and define reset/recovery.

## Increment Contract

For every build increment define objective, exact tasks, inputs, dependencies, output, local checks, exit criteria, expected evidence, likely failures, and repair path. Build a representative high-risk interaction early.

## Hard Gate

- Architecture satisfies the exact one-file/offline contract.
- Initialization and state transitions are deterministic.
- Every interaction has a keyboard and recovery path.
- No behavior depends on unavailable infrastructure.
- Implementation order tests high-risk assumptions early.
- Every requirement and objective maps to an implementation location and verification method.

In `plan_only`, finish the implementation-ready plan and planned downstream phase contracts, set status `planned`, and stop without creating or claiming `index.html`.

Repair upstream design defects at their source; repair architecture defects in P6. Material changes invalidate P7–P10.

Evidence: architecture/schema inspection, requirement traceability, dependency audit, and increment test plan.
