# Contributing to cascade-reference-tables

Thank you for helping. This repository holds the project's reference tables: the contract a table builder and its host
follow, the host, the builders of the open sources, and the feed apps read. It is a draft; no compatibility is promised
before a numbered v1. [`README.md`](README.md) says where to start for a builder, a host or an app, and
[`CLAUDE.md`](CLAUDE.md) holds the rules a change here follows; read it before you change a shape, a rule or a builder.

Report a security problem privately, by email to contact@cascadeprotocol.org, never in a public issue.

## Set up

You need Node.js 22 or newer and git.

```sh
git clone git@github.com:<you>/cascade-reference-tables.git
cd cascade-reference-tables
npm ci
```

`npm ci` also compiles the TypeScript. Table kinds come from [cascade-vocabulary](https://github.com/jayostis/cascade-vocabulary)
at the commit [`vocabulary.json`](vocabulary.json) pins. The host reads it from `$CASCADE_VOCABULARY`, else from a
checkout beside this repository named `cascade-vocabulary` (which is what CI does), else fetches the pinned commit into
`.cache/`. Clone it beside this repository to work offline.

## Run the checks

These are the commands CI runs.

```sh
npm run typecheck
npm run lint
npm test
```

`npm run format` fixes what the formatting check in `npm run lint` finds. While you work, run one test file, for example
`npm run build && node --test dist/host/test/feed.test.js`.

CI also checks that the tests read as a specification: each test's group is a heading listed in
[`host/test/spec.json`](host/test/spec.json), word for word. That check runs in CI, not in the test command, so a new or
renamed group needs its heading added there by hand. CI runs the tests on Node 24 and again on Node 22.

## What a pull request must pass

CI runs on every pull request, and a red check is a reason not to merge.

- **`check`**: type-check, lint, the tests, and the tests-read-as-a-specification check, as in "Run the checks".
- **`node-22`**: the tests on the oldest Node the package supports.
- **`pack`**: packs the package, which is what another repository's pull request depends on. (`release` is in the same
  workflow but runs only off pull requests.)

[`CLAUDE.md`](CLAUDE.md) holds the order a requirement is put in, so that a program can check it, and what a change to
`vocab/`, `shapes/`, `rules/` or `builder/` must say in its commit message.

## Commits and pull requests

Use conventional commits: `feat(host): ...`, `feat(cdc-cvx): ...`, `fix(shapes): ...`. Do not put a closing keyword
(`closes`, `fixes`, `resolves`) before an issue the pull request does not finish: GitHub closes it whatever the rest of
the sentence says. The contract rules (what a published version, a builder and a dependency may and may not do) are in
[`CLAUDE.md`](CLAUDE.md).

## A change that spans two repositories

This repository pins another to a commit, in [`vocabulary.json`](vocabulary.json), and to no branch. A change to the table kinds is made in cascade-vocabulary first, and
this repository then moves the commit in [`vocabulary.json`](vocabulary.json). Say in the pull request description what
the change needs from the other repository, with its full URL.

## Licence

Apache-2.0. The feed carries only freely publishable code systems, each with its own attribution; the README says what
it cannot hold and why, so check it before adding a source.
