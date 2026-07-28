@golden @artifact
Feature: Portable single-file learning artifact
  The production output is one complete index.html that runs from local disk without
  runtime network access while retaining normal citation anchors.

  @VER-001
  Scenario: The golden StringZilla artifact is portable
    Given the StringZilla production artifact
    When static portability is validated
    Then exactly one file named "index.html" exists
    And it is self-contained
    And it needs no build step
    And it has no required external runtime resource

  @VER-001
  Scenario: A citation anchor is allowed
    Given index.html links to "https://github.com/ashvardanian/StringZilla#readme"
    And the link is a learner-activated citation anchor
    And no script, style, font, image, import, or fetch depends on that URL
    When static portability is validated
    Then the external citation does not fail portability

  @VER-001
  Scenario Outline: A required external resource fails portability
    Given index.html uses "<kind>" from "https://cdn.example.invalid/asset"
    When static portability is validated
    Then portability fails with "external_runtime_resources_present"

    Examples:
      | kind              |
      | script source     |
      | stylesheet        |
      | module import     |
      | web font          |
      | fetched lesson    |

  @VER-001
  Scenario: More than one required file fails portability
    Given production contains "index.html" and "lesson.js"
    When static portability is validated
    Then portability fails with "exactly_one_index_html_required"

  @VER-002
  Scenario: Network-disabled reload works
    Given the golden index.html was opened from "file://"
    And all network requests are denied
    When the page reloads
    Then initialization completes without an unexplained console error
    And every core control still works
    And no runtime request is attempted

  @VER-002
  Scenario Outline: The artifact works at required viewport widths
    Given the golden index.html is opened at <width> CSS pixels
    When the complete page is inspected
    Then no horizontal page scroll obscures content or focus
    And all controls remain reachable

    Examples:
      | width |
      | 320   |
      | 768   |
      | 1440  |
