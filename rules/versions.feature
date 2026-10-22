Feature: Versions
  A row's key is the subject of its triples: a mapping row's `record_id`, a names, status or term type row's code. Between two
  versions of a series, a key in one only is added or removed, and a key in both with other triples is changed
  (cascade-vocabulary#89).

  The example builder is `fixtures/builder/`. Its second release adds 140, renames 150, retires 03 and drops 57.

  Rule: H4. Rows equal to the current version's publish nothing

    Example: the same release built twice gives one version of each series
      When the example builder's release "release" is built as "1"
      And the example builder's release "release" is built as "1 again"
      Then the last build made no version

  Rule: H5. A new version revises its series' current one, and its notes count the rows added, removed and changed

    Example: the second release revises the first
      When the example builder's release "release" is built as "1"
      And the example builder's release "release-2" is built as "2"
      Then the last build made these versions:
        | series                      | revises | notes                         |
        | Example vaccine groups      | 1       | 1 added, 0 removed, 0 changed |
        | Example vaccine names       | 1       | 1 added, 1 removed, 1 changed |
        | Example vaccine code status | 1       | 1 added, 1 removed, 0 changed |
      And the last build's differences list these keys:
        | series                      | added                           | removed                        | changed                         |
        | Example vaccine names       | http://hl7.org/fhir/sid/cvx/140 | http://hl7.org/fhir/sid/cvx/57 | http://hl7.org/fhir/sid/cvx/150 |
        | Example vaccine code status | http://hl7.org/fhir/sid/cvx/03  | http://hl7.org/fhir/sid/cvx/57 |                                 |

    Example: a version built by a new builder version of a release already built is labelled to differ from the version it revises
      When the example builder's release "release" is built as "1"
      And the example builder at version "2" builds the release "release-2" as "1"
      Then each series has the versions "1" and "1 (builder 2)", and "1 (builder 2)" is current

  Rule: H23. A file the source marks not archived is named by the version and not kept in the release

    Example: a file kept by default is in the release
      When the example builder's release "release" is built as "1"
      Then the release keeps the input "codes.txt"

    Example: a file marked not archived is named by the version, and the release holds the rows alone
      Given the publisher has the months "2026-08"
      When the dated example source is built from the publisher on "2026-08-20"
      Then each version of the last build records "codes_2026-08.txt" among its inputs
      And the release keeps no input

  Rule: H33. A source under a licence whose policy archives none of its publisher's files keeps no input, however it is detected

    Example: a source whose licence's policy archives no publisher file keeps no input, by release API
      Given the publisher's release API marks "release" current as "2026-09-17"
      And the example source names the licence "https://loinc.org/license/"
      When the example source, detected by its release API, is built from the publisher
      Then the release keeps no input

    Example: a source whose licence's policy archives no publisher file keeps no input, by folder listing
      Given the publisher's folders list each file at "1/15/2026  9:25 AM"
      And the example source names the licence "https://loinc.org/license/"
      When the example source, detected by its folder listing, is built from the publisher on "2026-07-01"
      Then the release keeps no input

  Rule: H32. A version's notes begin with the credit its publisher asks for

    Example: the notes of a build begin with the source's credit, before any series
      When the example builder's release "release" is built as "1"
      Then the build's differences.md begins with the credit "Source: an example publisher"

  Rule: H24. A finding of the build is shown with the differences, and the build goes on

    Example: a finding is listed under Findings and the version is built
      When the example builder, finding "3 expressions are no key", builds the release "release" as "1"
      Then the last build made a version of each series
      And the build's differences.md lists the finding "3 expressions are no key"

  Rule: H25. A version states the genes its series declares, and a changed list is a new version

    Example: each version states the genes
      When the example builder's release "release" is built as "1", the series covering the genes "MLH1, MSH2"
      Then each version of the last build covers the genes "MLH1, MSH2"

    Example: the same rows with another list of genes is a new version
      When the example builder's release "release" is built as "1", the series covering the genes "MLH1"
      And the example builder's release "release" is built as "1 again", the series covering the genes "MLH1, MSH2"
      Then the last build made these versions:
        | series                      | revises | notes                         |
        | Example vaccine groups      | 1       | 0 added, 0 removed, 0 changed |
        | Example vaccine names       | 1       | 0 added, 0 removed, 0 changed |
        | Example vaccine code status | 1       | 0 added, 0 removed, 0 changed |
      And each version of the last build covers the genes "MLH1, MSH2"
