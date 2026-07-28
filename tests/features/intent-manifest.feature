@golden @intent
Feature: Authoritative and locked learning intent
  The workflow preserves explicit user intent and only asks for information that is
  truly missing or in unresolved conflict.

  Background:
    Given a new "plan_then_build" run

  @ORCH-006 @ENG-002
  Scenario: Explicit values survive defaults and inference
    Given the user locked the learner as "Python developers"
    And the user locked the excluded scope as "installation walkthrough"
    When a later phase proposes a default learner of "engineering leaders"
    And a source infers that installation should be included
    Then the learner remains "Python developers"
    And "installation walkthrough" remains excluded
    And the rejected proposals do not replace either locked value

  @ORCH-006
  Scenario: Known context is not asked again
    Given topic, learner, depth, duration, and scope are authoritative
    When the engine calculates required intent questions
    Then it returns no questions
    And requesting an intent interrupt creates no event

  @ENG-002
  Scenario: A conflicting inference is recorded without silent overwrite
    Given the user locked the duration as "35 minutes"
    When research infers a duration of "2 hours"
    Then duration remains "35 minutes"
    And a critical open conflict records the existing and incoming values
    And I0 cannot pass until the user resolves the conflict

  @ENG-002
  Scenario: The user can explicitly supersede their own locked value
    Given the user locked the duration as "35 minutes"
    When the user changes duration to "50 minutes"
    Then duration is "50 minutes"
    And its origin is "user"
    And it remains locked

  @ENG-013
  Scenario Outline: Required intent must be authoritative
    Given required field "<field>" exists only as an unlocked inference
    When I0 completion is attempted
    Then completion fails with "PHASE_GATE_BLOCKED"

    Examples:
      | field    |
      | topic    |
      | learner  |
      | depth    |
      | duration |
      | scope    |
