@golden @widget
Feature: Codex desktop workflow widget
  The inline widget is a truthful inspect-and-decide surface whose actions reconcile
  through the server-owned workflow state.

  @UI-001
  Scenario: The widget renders the ordered workflow state
    Given a snapshot with an active P4 attempt and a pending design-independent action
    When the widget renders
    Then it shows I0 and P0 through P10 in order
    And it shows P4, its attempt, truthful status, and next action
    And it does not invent a progress percentage

  @UI-002
  Scenario: The design interrupt shows exactly three complete choices
    Given a snapshot with the unresolved StringZilla design options
    When the widget renders the decision panel
    Then 3 design cards are visible
    And each card exposes thesis, fit, system details, and tradeoff
    And one card is labeled as a nonbinding recommendation

  @UI-003 @ENG-003
  Scenario: The widget resumes without a duplicate decision
    Given "memory-lab" is focused in the design panel
    When the user activates selection twice before the response returns
    Then one idempotent selection command is accepted
    And one agent-mediated same-task resume is requested
    And the reconciled snapshot contains one resolved decision

  @UI-004
  Scenario: Failed and repaired evidence remains legible
    Given a repaired run retains a prior failed P8 attempt
    When evidence details are opened
    Then the failed check, current pass, artifact hashes, causal phase, and repair attempt are visible
    And "not_run" is never styled or announced as a pass

  @UI-005
  Scenario: Remount and duplicate delivery converge on the server snapshot
    Given the widget has revision 11
    When revision 10 and duplicate revision 11 events arrive
    And a revision 12 state snapshot arrives after remount
    Then the widget renders revision 12 exactly once
    And stale local state does not overwrite it

  @UI-008 @MAC-005
  Scenario: Native macOS Codex widget supports keyboard design selection
    Given the packaged plugin is enabled in the native macOS Codex desktop experience
    And the StringZilla design interrupt is visible inline
    When the user reaches every card using only the keyboard
    And selects "memory-lab" using its operable control
    Then visible focus is never lost or trapped
    And the selection reaches the server-owned run state
    And the resumed widget reflects the selected direction

  @UI-011
  Scenario: Orchestration degradation does not misstate artifact portability
    Given the remote MCP service is unavailable
    And a previously verified local index.html exists
    When the widget renders degraded state
    Then it says orchestration is unavailable
    And it separately reports the recorded offline artifact evidence
