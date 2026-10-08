# cascade-reference-tables

The project's reference tables, kept current from open publishers: the contract a table builder and its host
follow, the host, the builders of the open sources, and the feed apps read. The design and its steps are
[jayostis/cascade-vocabulary#60](https://github.com/jayostis/cascade-vocabulary/issues/60).

**DRAFT: no compatibility is promised before a numbered v1.**

| you are building         | start at                                                                               |
| ------------------------ | -------------------------------------------------------------------------------------- |
| a builder                | [`builder/`](builder/), with [`fixtures/builder/`](fixtures/builder/) as an example    |
| a host                   | [`shapes/`](shapes/) and [`rules/`](rules/)                                            |
| an app that reads tables | [`feed/`](feed/), with [`fixtures/feeds/valid/`](fixtures/feeds/valid/) as a test feed |

Table kinds and their rows are [cascade-vocabulary](https://github.com/jayostis/cascade-vocabulary)'s, at the commit
[`vocabulary.json`](vocabulary.json) pins.

## The host

On Node 22:

```sh
npm ci
npm test
npm run host -- test [<source>...]
npm run host -- check <source> [--checked <checked.json>]
npm run host -- build <source> [--release <folder> --label <text>] [--out build] [--feed feed/feed.ttl] [--releases <owner/repo>] [--checked <checked.json>]
npm run host -- publish --site <folder> [--releases <owner/repo>] [--rows <folder>]... [<checked.json>...]
```

A source is a folder under `builders/`, or a path. Without `--release`, `build` checks the publisher and builds what
it has when it is new, keeping its files in `<out>/release/`; `--checked` reads what the last check saw from a
`checked.json`. The host reads the vocabulary from
`$CASCADE_VOCABULARY`, else the sibling checkout `../cascade-vocabulary`, else the pinned commit, fetched into
`.cache/`.

## The feed

**https://jayostis.github.io/cascade-reference-tables/feed.ttl**, a DRAFT. Beside it, `checked.json` says when each
source was last checked, and `rows/` holds each series' current rows and the rows they revise. Every version's rows
and the publisher's input it was built from are kept in this repository's GitHub releases.

A version is published through review:

1. `watch.yml`, daily, checks each source. For a new release, it builds and runs the checks, creates the GitHub
   release, and opens a pull request from `watch/<source>` with the row differences.
2. Merging the pull request runs `publish.yml`, which deploys the site. Each rows file is checked against its
   checksum and its version's name first.
3. `keep-alive.yml`, on every push and pull request, enables `watch.yml` again, and warns of a source not checked
   in three days.

Apache-2.0. Each table states its own licence.
