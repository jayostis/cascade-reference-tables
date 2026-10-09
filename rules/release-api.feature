Feature: Detection by release API
  A source detected by `tables:ReleaseApi` names the publisher's list of releases (`tables:releaseApi`) and each file
  it reads by its path in a release's zip. The list is a JSON array; the one release marked `current` gives its
  `fileName`, its `releaseVersion` and its `downloadUrl`. The zip is the release's one input, archived and checksummed;
  the host opens the files the source names from it.

  The examples' source is the example builder's, detected by a release API, its one file `release/codes.txt` in a zip
  of a release folder under `fixtures/builder/fixtures/`.

  Rule: H14. The release marked current is checked, and is new until a version records its file

    Example: the first check finds the current release, labelled by its release version
      Given the publisher's release API marks "release" current as "2026-09-17"
      When the example source, detected by its release API, is checked
      Then the check finds a new release labelled "2026-09-17"

    Example: a release a version was built from is nothing new
      Given the publisher's release API marks "release" current as "2026-09-17"
      And the example source, detected by its release API, is built from the publisher
      When the example source, detected by its release API, is checked
      Then the check finds nothing new

    Example: a newer current release is built as a version revising the last
      Given the publisher's release API marks "release-2" current as "2026-09-17"
      And the example source, detected by its release API, is built from the publisher
      And the publisher's release API marks "release-3" current as "2026-10-01"
      When the example source, detected by its release API, is built from the publisher
      Then the last build made these versions:
        | series                | revises    | notes                         |
        | Example vaccine names | 2026-09-17 | 0 added, 0 removed, 1 changed |

  Rule: H15. A list with no one current release is an error, and a zip lacking a file the source names is refused

    Example: a list marking no release current is an error
      Given the publisher's release API marks no release current
      When the example source, detected by its release API, is checked
      Then the check fails, saying "lists 0 current releases"

    Example: a zip lacking the file the source names is refused
      Given the publisher's release API marks "release" current as "2026-09-17", its zip lacking "release/codes.txt"
      When the example source, detected by its release API, is built from the publisher
      Then the build is refused, saying "the release's zip has no release/codes.txt"
      And nothing was written
