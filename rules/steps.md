# Steps

Every step the feature files under `rules/` use, written as
[Cucumber Expressions](https://github.com/cucumber/cucumber-expressions): `{string}` is quoted text, `{word}` one word,
`{}` the rest of the step. A host runs each example on an empty feed, with the example builder of `fixtures/builder/`.
The `n`th build of an example happens on 2026-10-0`n` at 00:00 UTC.

## When

| Step                                                          | What happens                                                                                                              |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `the example builder's release {string} is built as {string}` | the release folder of that name under `fixtures/builder/fixtures/` is built, its versions labelled with the second string |
| `the example builder yields {}`                               | a build whose builder yields the rows of the JSON array given, of the example source                                      |

## Then

| Step                                                                                              | What must hold                                                                                                   |
| ------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `each case of the vocabulary's tests/table-versions/cases.json has its name`                      | each case's series, the version it revises and its rows file give its name                                       |
| `{string} is at {string}`                                                                         | the series of that label's current version is the name given                                                     |
| `{string} holds the row {string}:`                                                                | the current version's rows hold the key's triples exactly as the Turtle beneath gives them                       |
| `the build is refused, saying {string}`                                                           | the build stopped as a refusal whose reason contains the text                                                    |
| `nothing was written`                                                                             | neither the feed nor a rows file exists                                                                          |
| `the last build made no version`                                                                  | every series' rows equalled its current version's                                                                |
| `the last build made these versions:`                                                             | each series in the table has a new version revising its version of that label, with those notes                  |
| `the last build's differences list these keys:`                                                   | each series' added, removed and changed keys, comma-separated                                                    |
| `each series has the versions {string} and {string}, and {string} is current`                     | each series has exactly the versions of those labels                                                             |
| `what the feed stated of each version {string} is unchanged`                                      | every triple about those versions and their rows files, after the first build, is there unchanged after the last |
| `the catalog was modified at {word}`                                                              | the catalog's `dct:modified`                                                                                     |
| `the feed conforms to its shapes`                                                                 | `shapes/feed.shapes.ttl` finds nothing                                                                           |
| `each version's rows file is named rows/<its SHA-256 in hex>.nq.gz, and its checksum is that hex` | for the last build's versions                                                                                    |
| `each rows file's gzip header has no time and the OS byte 255`                                    | bytes 4 to 7 are zero and byte 9 is 255                                                                          |
| `each rows file holds its version's rows in the graph named by the version, and nothing else`     | its quads, graph dropped, are the series' rows in `fixtures/builder/fixtures/expected/rows.trig`                 |
