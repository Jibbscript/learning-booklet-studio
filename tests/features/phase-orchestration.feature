@golden @orchestration
Feature: Deterministic phase orchestration
  Only declared phases may run, hard gates control advancement, and each mode stops
  at its truthful terminal boundary.

  @ENG-013
  Scenario: The canonical phase sequence is fixed
    Given a new workflow run
    Then its phase IDs in order are:
      | phase |
      | I0    |
      | P0    |
      | P1    |
      | P2    |
      | P3    |
      | P4    |
      | P5    |
      | P6    |
      | P7    |
      | P8    |
      | P9    |
      | P10   |
    And starting phase "P11" fails with "UNKNOWN_PHASE"

  @ORCH-003 @ENG-006
  Scenario: A failed gate blocks phase advancement
    Given P1 is active with its current research artifact
    And gate "research.claims_supported" evaluated to fail
    When P1 completion is attempted
    Then completion fails with "PHASE_GATE_BLOCKED"
    And P2 cannot start
    And the run does not claim to be planned or completed

  @ENG-005
  Scenario: Events and state versions are monotonic and gap free
    Given accepted commands changed a run several times
    When the event log is validated
    Then every sequence is the preceding sequence plus 1
    And every event state version is monotonic and gap free
    And eventCursor and stateVersion equal the final event sequence

  @ORCH-001
  Scenario Outline: Each execution mode stops at its declared boundary
    Given a run in "<mode>" mode
    When every in-scope phase receives current passing evidence
    Then the run status is "<status>"
    And its terminal reason is "<reason>"
    And phase "<outside>" cannot start

    Examples:
      | mode            | status    | reason                 | outside |
      | manifest_only   | specified | manifest_only_complete | P0      |
      | plan_only       | planned   | plan_only_complete     | P7      |
      | plan_then_build | completed | release_passed         | P11     |

  @ORCH-011
  Scenario: Plan only emits no implementation and no pass claim
    Given a "plan_only" run passed I0 through P6
    Then the run ends as "planned"
    And no production artifact exists
    And no verification or release evidence exists
    And no event claims the run completed

  @ENG-003
  Scenario: Optimistic concurrency rejects an obsolete command
    Given the current state version is 8
    When a command expects state version 7
    Then it fails with "STATE_VERSION_CONFLICT"
    And the run state is unchanged

  @ENG-008 @ORCH-010 @MAC-004
  Scenario: A human decision terminates one run and resumes in a same-thread child
    Given the packaged native fixture has produced its design interrupt
    Then the producing run ends with outcome "interrupt"
    And its last event is terminal run.finished
    When the fixture applies the complete resume set
    Then the child keeps the same thread with a new run ID and parentRunId
    And RUN_STARTED input contains the complete resume set
    And an incomplete resume set fails with "INTERRUPT_SET_INCOMPLETE"

  @ENG-007 @ORCH-004 @MAC-004
  Scenario: A deterministic P8 failure causally reopens and repairs P7
    Given the packaged native fixture is stopped at its known P8 failure
    Then P8 attempt 1 and its failed evidence are retained
    And the failure identifies P7 attempt 1 as its artifact root cause
    When the packaged causal repair continues
    Then P7 runs attempt 2 with a different production artifact hash
    And P8 reruns and passes on attempt 2
    And P9 and P10 run after the repair
    And the immutable failed attempt and evidence remain inspectable
    And the repaired fixture ends completed with release pass
