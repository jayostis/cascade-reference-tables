# Contributing to cascade-reference-tables

Thank you for helping. This repository holds the project's reference tables: the contract a table builder and its host
follow, the host, the builders of the open sources, and the feed apps read. It is a draft; no compatibility is promised
before a numbered v1. [`README.md`](README.md) says where to start for a builder, a host or an app, and
[`CLAUDE.md`](CLAUDE.md) holds the rules a change here follows; read it before you change a shape, a rule or a builder.

Please follow the organisation's code of conduct and security policy. Report a security problem privately, as that
policy says, never in a public issue.

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

- **`check`**: type-check, lint, the tests, and the tests-read-as-a-specification check, as above.
- **`node-22`**: the tests on the oldest Node the package supports.
- **`release`**: packs the package, which is what another repository's pull request depends on.

[`CLAUDE.md`](CLAUDE.md) puts a requirement where a program can check it: a shape, then a rule with examples, then a
schema, then a fixture, and prose last. A change to `vocab/`, `shapes/`, `rules/` or `builder/` changes what every
builder and host must do, so its commit message says why.

## Commits and pull requests

Use conventional commits: `feat(host): ...`, `feat(cdc-cvx): ...`, `fix(shapes): ...`. Pin dependencies exactly. Do not
put a closing keyword (`closes`, `fixes`, `resolves`) before an issue the pull request does not finish: GitHub closes it
whatever the rest of the sentence says.

A published table version is never changed or removed: a correction is a new version that revises the current one. A
builder never touches the network or a file it was not handed; the host does.

## A change that spans two repositories

Nothing here pins another repository to a branch. A change to the table kinds is made in cascade-vocabulary first, and
this repository then moves the commit in [`vocabulary.json`](vocabulary.json). Say in the pull request description what
the change needs from the other repository, with its full URL.

## Licence

Apache-2.0. The feed carries only freely publishable code systems, each with its own attribution; the README says what
it cannot hold and why, so check it before adding a source.
