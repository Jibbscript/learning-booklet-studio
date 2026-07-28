# P5: Visual System

Layer: planning

Purpose: operationalize the resolved I0 design direction into one coherent, accessible implementation system.

Consumes: final selected visual direction, information architecture, interaction contracts, content types, browser/print/accessibility constraints.

Produces: `visual-system.json` with layout map, navigation/progress model, design tokens, typography hierarchy, spacing/geometry, color roles, component inventory, code/diagram/evidence/assessment treatments, interaction states, responsive transformations, print rules, reduced-motion rules, and accessibility annotations.

## Work

1. Preserve the selected thesis and explicit user overrides.
2. Convert adjectives into implementable rules and tokens.
3. Define prose measure, section rhythm, orientation, sticky behavior, focus behavior, code overflow, diagram scaling, and error/success/feedback states.
4. Design narrow, medium, and wide layouts intentionally.
5. Ensure diagrams and states remain interpretable without color, hover, or animation.
6. Use system fonts and inline/local assets compatible with the one-file artifact.

Do not present three new alternatives. Reopen I0 only when the selection is missing or materially contradictory.

## Hard Gate

- The system is one coherent implementation direction.
- Every component has a learning or navigation purpose.
- Mobile is intentionally transformed, not merely compressed.
- Sticky elements cannot hide targets or focus.
- Typography, color, non-text contrast, focus, touch targets, and state cues meet applicable accessibility requirements.
- Print and reduced-motion behavior preserve instructional meaning.
- No rule requires a forbidden runtime dependency or asset.

Repair selection conflicts in I0, interaction conflicts in P4, and system defects in P5. Material changes invalidate P6–P10.

Evidence: token/component tables, structured layout map, contrast results where measurable, responsive rules, and accessibility inspection.
