# Steps

Every step the feature files under `rules/` use, written as
[Cucumber Expressions](https://github.com/cucumber/cucumber-expressions): `{string}` is quoted text, `{word}` one word,
`{}` the rest of the step. A host runs each example on an empty feed, with the example builder of `fixtures/builder/`.
The `n`th build of an example happens on 2026-10-0`n` at 00:00 UTC.

## When

| Step                                                          | What happens                                                                                                                              |
| ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `the example builder's release {string} is built as {string}` | the release folder of that name under `fixtures/builder/fixtures/` is built, its versions labelled with the second string                 |
| `the example builder, given the release {string}, yields {}`  | a build of the release folder of that name, which need not exist, whose builder yields the rows of the JSON array given and opens no file |

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

## Detection

The publisher of a detection example answers a conditional GET as CDC does: 304 when `If-Modified-Since` is at or after
its `Last-Modified`, otherwise 200 with the file and its `Last-Modified`.

| Step                                                                                | What happens, or must hold                                                   |
| ----------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `the publisher serves {string}, last modified {string}`                             | the publisher serves the files of that release folder of the example builder |
| `the publisher serves {string}, last modified {string}, ignoring If-Modified-Since` | and answers 200 to every request                                             |
| `the example source is checked`                                                     | the example source is checked against the feed                               |
| `the example source, with a series added, is checked`                               | the same, its declaration holding one more series                            |
| `the example source is built from the publisher`                                    | the example source is checked, and what is new is built                      |
| `the check finds nothing new`                                                       |                                                                              |
| `the check finds a new release labelled {string}`                                   |                                                                              |
| `the publisher was last asked with no If-Modified-Since`                            |                                                                              |
| `the publisher was last asked with If-Modified-Since {string}`                      |                                                                              |

## Detection by release API

The examples' source is `fixtures/release-api/`: the example builder's series, detected by a release API at
`https://publisher.example/releases`. The API lists an older release not marked current, and the release a step marks
current, its file `<release folder>.zip`; that zip holds the folder's `codes.txt` as `release/codes.txt`.

| Step                                                                                       | What happens, or must hold                                          |
| ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------- |
| `the publisher's release API marks {string} current as {string}`                           | that release folder is current, its release version the second text |
| `the publisher's release API marks {string} current as {string}, its zip lacking {string}` | and its zip holds its file under another path                       |
| `the publisher's release API marks no release current`                                     | the API lists only the older release                                |
| `the example source, detected by its release API, is checked`                              | the source is checked against the feed                              |
| `the example source, detected by its release API, is built from the publisher`             | the source is checked, and what is new is built                     |
| `the check fails, saying {string}`                                                         | the check stopped as an error whose message contains the text       |

## Publishing

The releases of a publishing example are the rows files its builds wrote; the site is a folder of its own.

| Step                                                                                                | What happens, or must hold                                                                          |
| --------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `the site's checks are:`                                                                            | before a publish, the live site's `checked.json`; after it, what the published `checked.json` holds |
| `the site is published`                                                                             | the site is written from the feed, the releases and the checks, the last build's among them         |
| `a byte of the rows file of {string} {string} is changed`                                           | the rows file of that series' version of that label, in the releases, loses its checksum            |
| `the rows file of {string} {string} holds the rows of {string} {string}, and the feed its checksum` | that rows file is replaced by another version's, and the feed's checksum for it follows             |
| `the rows file of {string} {string} is in no release`                                               | it is removed from the releases                                                                     |
| `the site holds the rows files of these versions of {string}: {string}, {string}`                   | of the series' versions, exactly those labelled have their rows files on the site                   |
| `the publish is stopped, saying {string}`                                                           | the publish stopped with a reason containing the text                                               |
| `the site holds nothing`                                                                            | the site's folder was never written                                                                 |
