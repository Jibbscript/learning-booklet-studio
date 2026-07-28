@golden @evidence
Feature: Evidence-bound hard gates
  Passing a hard gate requires executed passing evidence for the exact current
  artifact; gaps and stale digests fail closed.

  @ORCH-005 @VER-004 @VER-011
  Scenario Outline: Missing or incomplete evidence cannot pass
    Given a current P8 verification artifact
    And gate "verification.critical_checks_executed" has "<status>" evidence
    When that gate is evaluated
    Then its result is "fail"
    And P8 cannot complete

    Examples:
      | status  |
      | missing |
      | partial |
      | not_run |
      | fail    |

  @VER-011
  Scenario: A pass must describe an executed check
    Given a current artifact
    When pass evidence declares executed false
    Then evidence recording fails with "PASS_MUST_BE_EXECUTED"

  @VER-003 @ENG-011
  Scenario: Evidence for an old artifact hash is stale
    Given passing evidence binds to the current P7 artifact hash
    When the P7 artifact content changes
    Then that evidence is stale
    And every gate using it is stale
    And release fails until affected checks rerun against the new hash

  @ORCH-004 @ENG-011
  Scenario: An upstream edit stales every transitive downstream result
    Given P1 through P9 passed with current artifacts and evidence
    When the P1 research artifact changes
    Then P1 through P9 artifacts affected by that dependency are stale
    And P1 through P9 evidence affected by that dependency is stale
    And the earliest responsible phase is reopened
    And P10 cannot pass

  @VER-004
  Scenario: Release calculation is independent of evidence insertion order
    Given two states contain the same normalized evidence in different insertion orders
    When release decisions are calculated at the same time
    Then their normalized decisions are equal

  @VER-011
  Scenario: Only the declared evidence vocabulary is accepted
    When evidence status is "skipped_successfully"
    Then evidence recording fails with "INVALID_EVIDENCE_STATUS"
