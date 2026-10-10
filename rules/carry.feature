Feature: Carrying rows forward
  A series declaring `tables:carriesForward true` keeps the rows of a code its new release no longer names. A code is
  named by a row the builder yielded from the release: a mapping row's source or target, a names, status or term
  type row's subject. A source declaring a `tables:historyLookup` asks the publisher for the history of each carried code not yet
  retired, and its builder's `history` maps the answers to rows of the source's code status series.

  A row is carried only while its code lies in the `void:uriSpace` of a code system the vocabulary registers; the
  rows of a code outside every space are withdrawn.

  The examples' source is `fixtures/carrying/`: the example builder's series, the groups and the names carrying
  forward, and a history lookup at `https://publisher.example/history/{code}`. The `release-carry` release drops 141,
  03 and 57 and takes 150 out of its group.

  Rule: H19. A carrying series keeps the rows of a code the release no longer names, not a row withdrawn between codes it names

    Example: codes that leave are carried, a withdrawn group is not, and only codes not yet retired are looked up
      Given the history answers:
        | code | status  | replaced by |
        | 141  | Retired | 150         |
        | 03   | Active  |             |
      When the carrying example's release "release" is built as "1"
      And the carrying example's release "release-carry" is built as "2"
      Then the last build made these versions:
        | series                      | revises | notes                         |
        | Example vaccine groups      | 1       | 0 added, 1 removed, 0 changed |
        | Example vaccine code status | 1       | 1 added, 0 removed, 0 changed |
      And "Example vaccine code status" holds the row "http://hl7.org/fhir/sid/cvx/141":
        """
        <http://hl7.org/fhir/sid/cvx/141> <http://www.w3.org/2002/07/owl#deprecated> true ;
          <http://purl.org/dc/terms/isReplacedBy> <http://hl7.org/fhir/sid/cvx/150> .
        """
      And the last build asked the history for "03, 141"
      And each version of the last build records "history.jsonl" among its inputs

    Example: a code that comes back is the release's again, and is not retired
      Given the history answers:
        | code | status  | replaced by |
        | 141  | Retired | 150         |
        | 03   | Active  |             |
      When the carrying example's release "release" is built as "1"
      And the carrying example's release "release-carry" is built as "2"
      And the carrying example's release "release" is built as "3"
      Then the last build made these versions:
        | series                      | revises | notes                         |
        | Example vaccine groups      | 2       | 1 added, 0 removed, 0 changed |
        | Example vaccine code status | 2       | 0 added, 1 removed, 0 changed |
      And the last build did not ask the history

  Rule: H21. A carried row whose code is in no registered code system's space is withdrawn, not carried

    Example: a code system's space moves, and every row of the old space is withdrawn and never looked up
      When the carrying example's release "release" is built as "1"
      And the vocabulary moves CVX's space to "https://codes.example/cvx/"
      And the carrying example's release "release" is built as "2"
      Then the last build made these versions:
        | series                      | revises | notes                         |
        | Example vaccine groups      | 1       | 4 added, 4 removed, 0 changed |
        | Example vaccine names       | 1       | 5 added, 5 removed, 0 changed |
        | Example vaccine code status | 1       | 1 added, 1 removed, 0 changed |
      And the last build did not ask the history

  Rule: H20. A history answer the builder does not map refuses the build

    Example: an unknown status
      Given the history answers:
        | code | status  | replaced by |
        | 141  | Unknown |             |
        | 03   | Active  |             |
      When the carrying example's release "release" is built as "1"
      And the carrying example's release "release-carry" is built as "2"
      Then the build is refused, saying "gives 141 the status \"Unknown\""
