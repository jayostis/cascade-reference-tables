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
