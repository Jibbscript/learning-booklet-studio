@golden @design
Feature: Exactly three materially distinct design directions
  A required design gate presents a useful choice, records one resolution, and
  compiles only that final direction into downstream planning.

  Background:
    Given the authoritative StringZilla intent fixture
    And I0 is active

  @ORCH-006 @UI-002
  Scenario: Three distinct options include one recommendation
    When the StringZilla design options are proposed
    Then exactly 3 options are accepted
    And their identifiers, names, and visual directions are pairwise distinct
    And exactly 1 option is recommended
    And the recommendation remains nonbinding

  @ORCH-006 @UI-002
  Scenario Outline: Invalid option sets fail closed
    When design options have "<defect>"
    Then proposal fails with "INVALID_DESIGN_OPTIONS"
    And no design option event is appended

    Examples:
      | defect                         |
      | two options                    |
      | four options                   |
      | duplicate identifiers          |
      | duplicate visual directions    |
      | no recommendation              |
      | multiple recommendations       |

  @UI-003 @ENG-003
  Scenario: Selection is idempotent
    Given the three valid StringZilla options
    When option "memory-lab" is selected twice with command ID "choose-memory-lab"
    Then one design selected event exists
    And the state version advances only once
    And the final visual direction is "memory-lab"

  @ORCH-007
  Scenario: Rejected designs are not compiled
    Given the three valid StringZilla options
    When the user selects "memory-lab"
    Then the compiled manifest contains the final Memory Lab direction
    And it contains neither the option catalogue nor rejected option payloads

  @ORCH-007
  Scenario: A user hybrid must be concrete
    Given the three valid StringZilla options
    When the user hybridizes "memory-lab" and "benchmark-dossier" with a concrete direction
    Then both source option IDs are recorded
    And the concrete hybrid becomes the only downstream visual direction

  @ORCH-006
  Scenario: P5 operationalizes the selected direction without reopening ideation
    Given I0 passed with "memory-lab" selected
    When P5 begins
    Then another three-option proposal fails with "DESIGN_PHASE_CLOSED"
    And P5 must translate Memory Lab into concrete responsive and accessible rules
