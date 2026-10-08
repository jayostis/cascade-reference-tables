Feature: Detection by conditional GET
  A source detected by `tables:ConditionalGet` is checked by asking for each of its files with `If-Modified-Since` set
  to the `Last-Modified` the feed records for that file. A publisher may ignore the header and answer 200 with the same
  bytes; the file's checksum then tells it apart.

  The publisher of the examples serves the example builder's `codes.txt` from one of the release folders under
  `fixtures/builder/fixtures/`, as `Last-Modified` the time given.

  Rule: H8. With no version in the feed, what the publisher has is new

    Example: the first check finds a release, labelled by its Last-Modified date
      Given the publisher serves "release", last modified "Thu, 17 Sep 2026 21:01:41 GMT"
      When the example source is checked
      Then the check finds a new release labelled "2026-09-17"
      And the publisher was last asked with no If-Modified-Since

    Example: a series with no version is new, though no file changed
      Given the publisher serves "release", last modified "Thu, 17 Sep 2026 21:01:41 GMT"
      And the example source is built from the publisher
      When the example source, with a series added, is checked
      Then the check finds a new release labelled "2026-09-17"

    Example: an unparsable Last-Modified leaves the release unlabelled
      Given the publisher serves "release", last modified "not a date"
      When the example source is checked
      Then the check finds a new release labelled "unlabelled"

  Rule: H9. Files not modified, or the bytes already held, are nothing new

    Example: the publisher answers 304
      Given the publisher serves "release", last modified "Thu, 17 Sep 2026 21:01:41 GMT"
      And the example source is built from the publisher
      When the example source is checked
      Then the check finds nothing new
      And the publisher was last asked with If-Modified-Since "Thu, 17 Sep 2026 21:01:41 GMT"

    Example: the publisher ignores If-Modified-Since and answers 200 with the bytes held
      Given the publisher serves "release", last modified "Thu, 17 Sep 2026 21:01:41 GMT"
      And the example source is built from the publisher
      And the publisher serves "release", last modified "Fri, 18 Sep 2026 08:00:00 GMT", ignoring If-Modified-Since
      When the example source is checked
      Then the check finds nothing new

    Example: with no Last-Modified, the bytes any current version holds are nothing new
      Given the publisher serves "release-2", last modified "not a date"
      And the example source is built from the publisher
      And the publisher serves "release-3", last modified "not a date"
      And the example source is built from the publisher
      When the example source is checked
      Then the check finds nothing new

  Rule: H10. A changed file is new, and its build writes a version of only the series whose rows changed

    Example: a release changing only a name gives a new version of the names series alone
      Given the publisher serves "release-2", last modified "Thu, 17 Sep 2026 21:01:41 GMT"
      And the example source is built from the publisher
      And the publisher serves "release-3", last modified "Thu, 01 Oct 2026 12:00:00 GMT"
      When the example source is built from the publisher
      Then the last build made these versions:
        | series                | revises    | notes                         |
        | Example vaccine names | 2026-09-17 | 0 added, 0 removed, 1 changed |
