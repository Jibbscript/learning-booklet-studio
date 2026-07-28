# Studio Path design QA

Date: 2026-07-22

Surface: `packages/widget`

Approved reference: `docs/assets/studio-path-reference.png`

Implemented capture: `docs/assets/studio-path-implementation.jpg`

Comparison viewport: 1487 × 1058 CSS pixels

## Side-by-side judgment

The approved reference and the implemented widget were inspected together at the same viewport and selected-design state. The implementation preserves the reference system’s defining composition: plum navigation rail, horizontal gated journey, paired selected-direction and current-work panels, narrow activity rail, and full-width work journal. It also preserves the warm-white canvas, quiet gray borders, compact editorial hierarchy, semantic green/plum/blue state accents, restrained radii, and dense but readable evidence presentation.

The topic and preview content intentionally differ: the reference demonstrates a solar-system booklet, while the implementation uses the product’s StringZilla learning-booklet fixture. Navigation names and workflow labels were adapted to the authoritative I0/P0–P10 contract. Those changes retain the reference hierarchy and rhythm rather than constituting visual drift.

## Executed checks

| Check | Evidence | Result |
|---|---|---|
| Same-state reference comparison | Both 1487 × 1058 captures inspected together | pass |
| Major layout, spacing, radii, borders, and hierarchy | Reference and implementation captures | pass |
| Studio Path selected-state content | Browser DOM and screenshot | pass |
| Design-preview controls | Learning Foundry and Studio Path click paths changed the preview deterministically | pass |
| Console inspection | Zero warning/error entries in the in-app browser | pass |
| 320 CSS-pixel layout | `docs/assets/studio-path-mobile.jpg`; page `scrollWidth === clientWidth` | pass |
| 768 CSS-pixel layout | `docs/assets/studio-path-tablet.jpg`; page `scrollWidth === clientWidth` | pass |
| 1440 CSS-pixel layout | In-app browser capture; page `scrollWidth === clientWidth` | pass |
| Mobile phase access | All 12 native buttons retained inside a deliberate `overflow-x: auto` phase region | pass |
| Reduced motion, print, focus, and native keyboard journey | Covered by source contracts and separate executable/native evidence gates; not promoted to a visual-QA pass | not_run |

## Responsive judgment

At 320 pixels, the title and current status remain first, the activity and selected-system panels become a single readable column, the artwork yields to the authoritative system specification, and the primary navigation becomes a bottom rail. At 768 pixels, the workflow retains its left rail and splits activity and selected-system content without page overflow. At 1440 pixels, the reference’s three-column working composition and horizontal journal are preserved.

No blocking visual mismatch remains. Native keyboard, VoiceOver, task-reopen, and MCP-host reconciliation evidence remain governed by the architecture-specific release gates and are not inferred from these screenshots.

final result: passed
