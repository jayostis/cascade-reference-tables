Feature: Detection by announcement
  A source whose release only a signed-in person can download is detected by `tables:Announcement`: it names a public
  page (`tables:announcementPage`) and a name pattern (`tables:namePattern`) whose one group is a version. A check reads
  the page and downloads nothing. A version the page names that is newer than every version of the source's series in
  the feed is announced, to be built by hand from a folder, and the build of a check writes `announced.json` in place
  of a version.

  The examples' source is `fixtures/announcement/`: the example builder's series, announced on
  `https://publisher.example/downloads/`, whose files are named `codes_<version>.zip`.

  Rule: H27. A version newer than every version of the series is announced, and nothing is downloaded or built

    Example: a version no series has is announced, the newest of those the page names, and compared as numbers
      Given the publisher's downloads page names "codes_2.9.zip, codes_2.10.zip"
      When the announcement example source is checked
      Then the check finds the version "2.10" announced
      And the check downloaded nothing

    Example: the version a series has is nothing new
      Given the publisher's downloads page names "codes_2.9.zip"
      And the announcement example's release "release" is built as "2.9"
      When the announcement example source is checked
      Then the check finds nothing new

    Example: an older version on the page is no news
      Given the publisher's downloads page names "codes_2.9.zip, codes_2.10.zip"
      And the announcement example's release "release" is built as "2.10"
      When the announcement example source is checked
      Then the check finds nothing new

    Example: a newer version than the series has is announced
      Given the publisher's downloads page names "codes_2.9.zip, codes_2.10.zip"
      And the announcement example's release "release" is built as "2.9"
      When the announcement example source is checked
      Then the check finds the version "2.10" announced

    Example: a check that announces writes announced.json, with the command that builds it, and no version
      Given the publisher's downloads page names "codes_2.83.zip"
      When the announcement example source is built from the publisher
      Then the build announced the version "2.83", building it with "build announcement --release <folder> --label 2.83"
      And nothing was written

  Rule: H28. A page that cannot be read, or names no version, is a failed check, never nothing new

    Scenario Outline: the check fails: <case>
      Given the publisher's downloads page <page>
      When the announcement example source is checked
      Then the check fails, saying "<reason>"

      Examples:
        | case                        | page                              | reason                           |
        | a page that answers 403     | answers 403                       | answered 403                     |
        | a page without the pattern  | names "readme.txt, codes.zip"     | names no version by the pattern  |
        | an empty page               | names ""                          | names no version by the pattern  |
