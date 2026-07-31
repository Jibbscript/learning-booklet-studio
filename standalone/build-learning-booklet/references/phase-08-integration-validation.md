# P8: Integration And Regression Validation

Layer: build

Purpose: test the integrated artifact across content, learning, behavior, accessibility, responsive presentation, portability, privacy, and security.

Consumes: current `index.html`, all traceability artifacts, test plan, supported tools/browsers.

Produces: `verification-report.json`, evidence records, screenshots/traces where run, and repaired `index.html` revisions.

## Required Suites

- Content: claims/citations, terminology, diagrams, examples, qualifications.
- Learning: each objective taught/practiced/assessed, corrective feedback, synthesis, transfer.
- Function: controls, links, disclosures, inputs, quizzes, reset, repeated/invalid/edge input, refresh, progress, internal anchors, console.
- Accessibility: landmarks/headings/skip link, keyboard, order, visible/unobscured focus, labels/instructions, contrast/non-color cues, reduced motion, zoom, diagrams, status announcements, assistive-technology inspection.
- Responsive: approximately 320, 768, and 1440 CSS pixels; portrait/landscape when available; overflow, code, diagrams, touch targets, reading order.
- Portability: direct file open, network-blocked reload, no required requests, prompt rendering, responsive interactions, file size.
- Privacy/security: no telemetry, secrets, unintended transmission, unsafe injection, or undocumented persistence.

Use `audit-html.mjs` and `audit-browser.mjs` where supported. Record manual checks separately.

## Hard Gate

- Every critical requirement is `pass` with current evidence.
- Failures were repaired and affected suites rerun.
- `not_run` accurately describes unavailable checks and does not satisfy a hard gate.
- No unexplained console error, required network request, broken control, or stale evidence remains.

Repair the earliest causal phase, not only the visible symptom. Each changed `index.html` hash invalidates prior execution evidence.

Evidence: commands, browser traces, screenshots, manual inspection records, artifact hashes, and capability limitations.
