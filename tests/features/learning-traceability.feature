@golden @learning
Feature: Claim and objective traceability
  Central claims remain qualified and sourced, while every learning objective maps
  through instruction, practice, assessment, and an executed verification check.

  Background:
    Given the StringZilla source and traceability fixtures

  @VER-005
  Scenario: A complete objective trace passes
    When objective "obj-2" is inspected
    Then it maps to instruction "reasoning/benchmark-boundaries"
    And practice "lab-benchmark-lens"
    And assessment "check-benchmark-claim"
    And test "test-objective-2"

  @VER-005
  Scenario Outline: An incomplete objective trace blocks learning architecture
    Given objective "obj-1" lacks its "<link>" link
    When P2 gate "learning.objective_traceability" is evaluated
    Then the gate fails
    And the failure identifies objective "obj-1" and missing "<link>"

    Examples:
      | link        |
      | instruction |
      | practice    |
      | assessment  |
      | test        |

  @VER-005
  Scenario: Unsupported central claim blocks research
    Given a central claim has no authoritative source or explicit qualification
    When P1 gate "research.claims_supported" is evaluated
    Then the gate fails
    And P2 cannot start

  @VER-005
  Scenario: Benchmark language stays inside its evidence boundary
    Given the source reports a result for selected operations and workloads
    When research synthesizes the benchmark claim
    Then it records workload and environment limitations
    And it does not produce a universal speed claim

  @ORCH-003
  Scenario: Each concept has one canonical home
    Given the information architecture places benchmark interpretation in two canonical sections
    When P3 gate "ia.concept_homes" is evaluated
    Then the gate fails with the duplicate concept identifier
