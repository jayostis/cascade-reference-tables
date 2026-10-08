# cascade-reference-tables — Agent Context

The project's reference tables: the contract a reference table builder and its host follow, the host, the
builders of the open sources, and the feed apps read. DRAFT; no compatibility is promised before a numbered v1.

## The contract is what a program can check

A requirement is held, in this order, by:

1. **A shape** (`shapes/`), whose `sh:message` says what is wrong when it fails.
2. **A rule with its examples** (`rules/*.feature`), run as a test.
3. **A schema** (`builder/interface.schema.json`).
4. **A fixture** (`fixtures/`, a builder's `fixtures/`): an input and the output it must give.
5. **Prose**, only for what none of the above can hold, and as short as it goes.

So:

- **No comment, `rdfs:comment` or `sh:description` that restates a name, a constraint or another file.**
  Rename instead.
- **No reasoning in files.** Why goes in the commit message.
- **Deleting prose is always in scope.**

## The rules

- **Standards, not inventions.** A source, a series and a version are DCAT, DCTERMS, PROV and SPDX. A new term goes
  in `vocab/tables.ttl`, and only where none of those has one.
- **Table kinds are cascade-vocabulary's**, pinned in `vocabulary.json`. Nothing here defines what a row means.
- **A builder knows its source and nothing else.** It never touches the network, a file it was not handed, or a
  pod. The host detects, downloads, checks, names and publishes.
- **A source's declaration is RDF** (`source.ttl`), checked by `shapes/source.shapes.ttl`. Its code is only the
  mapping from the release's lines to rows.
- **A build is deterministic:** the same release gives the same rows, by meaning. Conformance runs it twice.
- **A published version is never changed or removed.** A change is a new version that revises the current one.
- **Tests assert meaning, never bytes.** One test per behaviour, on the smallest input that shows it.
- **Nothing a version records names a host.** A series is a `urn:uuid:`, a version is named by its content, and
  the feed's address is configuration.

## Layout

`vocab/`, `shapes/`, `rules/` and `builder/` are the contract; `fixtures/` its examples; `host/` and `builders/`
the code; `feed/` what is published. A `CLAUDE.md` holds a rule for changing the directory it sits in, and only
that.

## Conventions

- Dependencies are pinned exactly.
- Conventional commits: `feat(host): ...`, `feat(cdc-cvx): ...`, `fix(shapes): ...`. A change to `vocab/`, `shapes/`,
  `rules/` or `builder/` changes what every builder and host must do; its message says why.
