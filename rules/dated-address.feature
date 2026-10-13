Feature: Detection by dated address
  A source detected by `tables:DatedUrl` names a file by its name (`dct:title`) and an address holding `{month}`
  (`tables:urlTemplate`), as `YYYY-MM`. A version's label is its month. The check asks for the file of the month after
  the newest version's; with no version, for the newest of the last three months. The source's other files are taken as
  they are.

  The publisher of the examples serves the example builder's `codes.txt` of one release folder for each month it has:
  its first month is `release`, its second `release-2`, its third `release-3`. The source's file is not archived, and
  its names series covers the gene MLH1.

  Rule: H22. A version is built from the newest month the publisher has, and the next check asks for the month after it

    Example: with no version, the newest of the last three months that has a file is new
      Given the publisher has the months "2026-07, 2026-08"
      When the dated example source is checked on "2026-10-12"
      Then the check finds a new release labelled "2026-08"
      And the check took "codes.txt"
      And the publisher was asked for "codes_2026-10.txt, codes_2026-09.txt, codes_2026-08.txt"

    Example: with no version and no file in the last three months, there is nothing new
      Given the publisher has the months "2026-05"
      When the dated example source is checked on "2026-10-12"
      Then the check finds nothing new

    Example: after a version, the month after its label is asked for, and is new when the publisher has it
      Given the publisher has the months "2026-08, 2026-09"
      And the dated example source is built from the publisher on "2026-08-20"
      When the dated example source is checked on "2026-10-12"
      Then the check finds a new release labelled "2026-09"
      And the publisher was last asked for "codes_2026-09.txt"

    Example: after a version, a month the publisher does not have yet is nothing new
      Given the publisher has the months "2026-08"
      And the dated example source is built from the publisher on "2026-08-20"
      When the dated example source is checked on "2026-10-12"
      Then the check finds nothing new
      And the publisher was last asked for "codes_2026-09.txt"

    Example: a builder with a new version rebuilds the month it built when the next month is not there
      Given the publisher has the months "2026-08"
      And the dated example source is built from the publisher on "2026-08-20"
      When the dated example source, with its builder at version "2", is checked on "2026-10-12"
      Then the check finds a new release labelled "2026-08"

    Example: a version names the file of its month by that file's name and address
      Given the publisher has the months "2026-08"
      When the dated example source is built from the publisher on "2026-08-20"
      Then each version of the last build records "codes_2026-08.txt" among its inputs
      And the input "codes_2026-08.txt" of the last build is cited at "https://publisher.example/archive/codes_2026-08.txt"
