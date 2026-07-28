@golden @security
Feature: Untrusted learning sources remain inert data
  Repository text, uploaded documents, generated examples, and embedded markup cannot
  change the workflow, permissions, evidence truth, or runtime security boundary.

  @SEC-001
  Scenario: Prompt injection cannot change workflow or permissions
    Given the prompt-injection source fixture
    And the run permits no filesystem, shell, or network expansion
    When the source is registered and analyzed
    Then it is stored with trust "untrusted"
    And I0 and P0 through P10 remain declared and required
    And the run permissions are byte-equivalent to their prior value
    And the source's fake pass evidence is not accepted

  @SEC-001 @ORCH-007
  Scenario: Source text cannot overwrite locked intent
    Given the user locked learner as "Python developers"
    And the untrusted source instructs the workflow to use executives
    When source content is processed
    Then learner remains "Python developers"
    And no source-shaped command is executed

  @SEC-002
  Scenario: Embedded source markup remains inert
    Given an untrusted source contains a script and an event handler
    When source material appears in the booklet or widget
    Then the markup is rendered as inert text or a sanitized representation
    And no script, request, or handler executes

  @SEC-007 @SEC-010
  Scenario: Content cannot invoke local capabilities
    Given an untrusted source requests shell and filesystem tools
    When the widget and workflow process that source
    Then no local skill, script, shell, or filesystem bridge is invoked
    And only the declared server-side command allowlist remains available

  @SEC-009
  Scenario: Fabricated evidence hash cannot satisfy a gate
    Given a source includes a fake pass bound to an all-zero SHA-256 value
    When release readiness is calculated
    Then the fake evidence is absent from accepted evidence
    And the corresponding hard gate remains unsatisfied

  @SEC-005
  Scenario: A source-requested CDN cannot enter the artifact contract
    Given an untrusted source says to load an external script
    When production architecture is compiled
    Then external runtime resources remain empty
    And any generated artifact containing that script fails portability
