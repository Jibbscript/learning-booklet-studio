@golden @release
Feature: Deterministic release readiness
  Release is calculated from current hard-gate evidence and open findings, never from
  polish, a model assertion, or a widget projection.

  @VER-004
  Scenario: A complete current evidence set can pass
    Given I0 and P0 through P10 have current passing evidence for every hard gate
    And production is exactly one portable index.html
    And no blocker or major finding is open
    And all critical checks were executed
    When the release decision is calculated
    Then decision is "pass"
    And terminalStatus is "completed"
    And the decision identifies the released production artifact hash

  @VER-004
  Scenario: Missing hard-gate evidence blocks release
    Given every release condition except "release.portable_index" has current passing evidence
    When the release decision is calculated
    Then decision is "fail"
    And blocking reasons include "hard_gates_not_current"

  @VER-008
  Scenario: An open major finding blocks release
    Given all hard gates have current passing evidence
    And finding "finding-contrast" is open with severity "major"
    When the release decision is calculated
    Then decision is "fail"
    And openFindingsBySeverity.major is 1
    And blocking reasons include "blocker_or_major_findings_open"

  @VER-004 @VER-011
  Scenario: A critical unavailable check remains not run and blocks release
    Given required native evidence has status "not_run"
    When the release decision is calculated
    Then decision is "fail"
    And that check appears unchanged in notRunChecks
    And no projection may relabel it as a pass

  @VER-010
  Scenario: The release record preserves limitations and residual risks
    Given the run declares a benchmark comparability limitation
    And it declares a residual browser-variation risk
    When the release decision is calculated
    Then both statements are present without truncation
    And every cited evidence identifier resolves in the run

  @VER-004
  Scenario: A widget completion label cannot override the engine
    Given a remote projection says "completed"
    But a current hard gate is missing evidence
    When the engine calculates release readiness
    Then decision is "fail"
