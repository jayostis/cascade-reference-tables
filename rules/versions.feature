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
