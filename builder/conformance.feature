Feature: A builder conforms
  A host runs each example on one builder, with its source's folder: `source.ttl`, `builder.ttl`, the code, and its
  fixtures. `fixtures/release/` is a release of the source as the publisher wrote it, and `fixtures/expected/rows.trig`
  holds the rows that release gives, each series' rows in the graph named by the series.

  Example: its declarations conform to the shapes
    Then its declarations conform

  Example: its release gives the expected rows, each of a series its source declares and conforming to its kind's shape
    When it builds its fixture release
    Then it is not refused
    And each series' rows equal its expected rows

  Example: a build gives the same rows every time
    When it builds its fixture release
    And it builds its fixture release again
    Then both builds give the same rows
