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
npm run host -- build <source> --release <folder> --label <text> [--out build] [--feed feed/feed.ttl]
```

A source is a folder under `builders/`, or a path. The host reads the vocabulary from `$CASCADE_VOCABULARY`, else the
sibling checkout `../cascade-vocabulary`, else the pinned commit, fetched into `.cache/`.

Apache-2.0. Each table states its own licence.
