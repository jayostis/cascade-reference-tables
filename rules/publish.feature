Feature: Publishing the site
  The site is what Pages serves: `feed.ttl`, the rows files of each series' current version and of the version it
  revises, `checked.json` and a page saying the feed is a draft. Each deploy replaces the whole site. Rows files come
  from the releases, where each is kept for good.

  The example builder is `fixtures/builder/`. Its releases are built in turn, and each rows file the builds wrote is in
  the releases.

  Rule: H11. The site holds each series' current rows and the rows they revise, and no older ones

    Example: after three releases the names series' first version is in the releases only
      When the example builder's release "release" is built as "1"
      And the example builder's release "release-2" is built as "2"
      And the example builder's release "release-3" is built as "3"
      And the site is published
      Then the site holds the rows files of these versions of "Example vaccine names": "3", "2"
      And the site holds the rows files of these versions of "Example vaccine groups": "2", "1"

  Rule: H12. A rows file that is not what the feed says stops the publish, before anything is written

    Scenario Outline: the publish is stopped: <case>
      When the example builder's release "release" is built as "1"
      And the example builder's release "release-2" is built as "2"
      And <change>
      And the site is published
      Then the publish is stopped, saying "<reason>"
      And the site holds nothing

      Examples:
        | case                                     | change                                                      | reason                     |
        | its bytes do not match its checksum      | a byte of the rows file of "Example vaccine names" "2" is changed | a rows file's checksum is |
        | its rows are another version's           | the rows file of "Example vaccine names" "2" holds the rows of "Example vaccine groups" "2", and the feed its checksum | , not                      |
        | it is in no release                      | the rows file of "Example vaccine names" "1" is in no release | is in no release           |

  Rule: H13. checked.json keeps every source's last check

    Example: a check of one source keeps the other's
      Given the site's checks are:
        | source                                        | label   | at                   | found       |
        | urn:uuid:8e7239fe-4ffd-4658-9a0b-9c71aaa59e19 | Example | 2026-09-30T06:23:00Z | nothing new |
        | urn:uuid:17cec5a9-071a-4179-9403-5c1e3886fb7d | CDC CVX | 2026-09-30T06:23:00Z | nothing new |
      When the example builder's release "release" is built as "1"
      And the site is published
      Then the site's checks are:
        | source                                        | label                 | at                   | found       |
        | urn:uuid:8e7239fe-4ffd-4658-9a0b-9c71aaa59e19 | Example vaccine codes | 2026-10-01T00:00:00Z | new         |
        | urn:uuid:17cec5a9-071a-4179-9403-5c1e3886fb7d | CDC CVX               | 2026-09-30T06:23:00Z | nothing new |

  Rule: H14. A series whose table kind the vocabulary does not declare is retired: its rows are neither verified nor served, its page entry is gone, and a build leaves it out of its check; a series the source builds is never retired, and takes no new version while the feed's kind for it is undeclared or is not its source's

    A retired series nobody builds cannot stop a build from conforming. For a series the source builds, the build
    refuses a new version, writing nothing, unless the feed gives the series exactly the one table kind its source
    declares and the vocabulary declares it.

    Example: a series of a dropped kind stays in the feed, and a new version still conforms
      When the example builder's release "release" is built as "1"
      And the feed holds a series of a table kind the vocabulary dropped
      And the example builder's release "release-2" is built as "2"
      Then the last build made these versions:
        | series                      | revises | notes                         |
        | Example vaccine groups      | 1       | 1 added, 0 removed, 0 changed |
        | Example vaccine names       | 1       | 1 added, 1 removed, 1 changed |
        | Example vaccine code status | 1       | 1 added, 1 removed, 0 changed |

    Scenario Outline: a series the source builds takes no new version: <case>
      When the example builder's release "release" is built as "1"
      And the feed gives "Example vaccine names" the table kinds "<kinds>"
      And the example builder's release "release-2" is built as "2", the build being refused
      Then the build is refused, saying "<reason>"
      And the feed is as it was before the refused build

      Examples:
        | case                                | kinds                   | reason                                                             |
        | its kind is undeclared              | CodeNamez               | cascade#CodeNamez, which the vocabulary does not declare           |
        | an undeclared kind ahead of its own | Bogus, CodeNames        | cascade#Bogus, which the vocabulary does not declare               |
        | its kind is another declared one    | VaccineGroups           | cascade#VaccineGroups, not https://ns.cascadeprotocol.org/cascade#CodeNames |
        | it has a second declared kind       | CodeNames, RetiredCodes | cascade#RetiredCodes, not https://ns.cascadeprotocol.org/cascade#CodeNames |

    Example: a vocabulary without the kind of code status
      When the example builder's release "release" is built as "1"
      And the rows file of "Example vaccine code status" "1" is in no release
      And the site is published under a vocabulary that does not declare "RetiredCodes"
      Then the site holds the rows file of "Example vaccine names" "1"
      And the site holds no rows file of "Example vaccine code status"
      And the site's page lists "Example vaccine names"
      And the site's page does not list "Example vaccine code status"

  Rule: H15. The page names each table by its label, linking its rows file, its publisher and its licence, and says when it has no version; it links the hub and this repository

    Example: a table with a version, and one without
      When the example builder's release "release" is built as "1"
      And the feed gives "Example vaccine groups" no current version
      And the site is published
      Then the site's page links the hub and this repository
      And the site's page links the rows file of "Example vaccine names" "1"
      And the site's page gives the identity of "Example vaccine names" "1"
      And the site's page links the publisher and the licence of "Example vaccine names"
      And the site's page says "Example vaccine groups" has no built version
