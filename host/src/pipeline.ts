import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import {
  type Build,
  Refusal,
  type Release,
  type ReleaseFile,
} from "./builder.js";
import { readRowsFile, rowsFile } from "./distribution.js";
import { Feed, type Input } from "./feed.js";
import { documentName, sha256, versionName } from "./names.js";
import { delimited, fixedWidth, jsonLines } from "./readers.js";
import { keyed, RowSchema, SeriesRows, toRdf } from "./rows.js";
import { Shapes } from "./shapes.js";
import { folderStore, type RowsStore } from "./stores.js";
import type { Source } from "./source.js";
import { resolveVocabulary, Vocabulary } from "./vocabulary.js";

/** What every build reads: the vocabulary, its shapes, this repository's shapes and the row schema. */
export interface Contract {
  readonly root: string;
  readonly vocabulary: Vocabulary;
  readonly rowShapes: Shapes;
  readonly declarationShapes: Shapes;
  readonly feedShapes: Shapes;
  readonly schema: RowSchema;
  /** Where the vocabulary was read from. */
  readonly said: string;
}

export async function readContract(root: string): Promise<Contract> {
  const resolved = await resolveVocabulary(root);
  const vocabulary = await Vocabulary.read(resolved.folder);
  const shapes = (file: string): string => join(root, "shapes", file);
  return {
    root,
    vocabulary,
    rowShapes: new Shapes(vocabulary.shapes),
    declarationShapes: await Shapes.read(
      shapes("source.shapes.ttl"),
      shapes("builder.shapes.ttl"),
    ),
    feedShapes: await Shapes.read(shapes("feed.shapes.ttl")),
    schema: new RowSchema(join(root, "builder", "interface.schema.json")),
    said: resolved.said,
  };
}

function releaseOf(
  contract: Contract,
  source: Source,
  folder: string,
): Release {
  return {
    file(name: string): ReleaseFile {
      if (!source.files.has(name))
        throw new Error(`${source.label} declares no file ${name}`);
      const path = join(folder, name);
      if (!existsSync(path)) throw new Refusal(`the release has no ${name}`);
      return {
        name,
        delimited: (delimiter) => delimited(path, delimiter),
        fixedWidth: (columns) => fixedWidth(path, columns),
        json: () => jsonLines(path),
      };
    },
    codeIri: (system, code) => contract.vocabulary.codeIri(system, code),
  };
}

/** What the shapes say of a source's `source.ttl` and `builder.ttl`, read with the vocabulary's terms. */
export function declarationViolations(
  contract: Contract,
  source: Source,
): Promise<string[]> {
  return contract.declarationShapes.violations([
    ...source.declarations,
    ...contract.vocabulary.terms.quads,
  ]);
}

/** The builder's rows of each series its source declares, every one checked; a `Refusal` names what is wrong. */
export async function rowsOf(
  contract: Contract,
  source: Source,
  build: Build,
  release: string,
): Promise<Map<string, SeriesRows>> {
  const declared = await declarationViolations(contract, source);
  if (declared.length > 0)
    throw new Refusal(
      `${source.folder}'s declarations do not conform:\n${declared.join("\n")}`,
    );
  const series = new Map(
    source.series.map((s) => [s.iri, new SeriesRows(s.iri)]),
  );
  for await (const yielded of build(releaseOf(contract, source, release))) {
    const row = contract.schema.check(yielded);
    const into = series.get(row.series);
    if (into === undefined)
      throw new Refusal(
        `${row.series} is not a series ${source.label} declares`,
      );
    into.add(toRdf(row));
  }
  for (const description of source.series) {
    const rows = series.get(description.iri)!;
    const kind = contract.vocabulary.kind(description.kind);
    const found = await contract.rowShapes.violationsOf(
      rows.triples(),
      rows.rows.keys(),
      kind.rowShape,
    );
    if (found.length > 0)
      throw new Refusal(
        `rows of ${description.label} do not conform:\n${found.join("\n")}`,
      );
  }
  return series;
}

/** Keys in one version only, added or removed; in both with other triples, changed. */
export interface Differences {
  readonly added: readonly string[];
  readonly removed: readonly string[];
  readonly changed: readonly string[];
}

export function differences(
  before: ReadonlyMap<string, string>,
  after: ReadonlyMap<string, string>,
): Differences {
  return {
    added: [...after.keys()].filter((key) => !before.has(key)).sort(),
    removed: [...before.keys()].filter((key) => !after.has(key)).sort(),
    changed: [...after]
      .filter(([key, rows]) => before.has(key) && before.get(key) !== rows)
      .map(([key]) => key)
      .sort(),
  };
}

export function notes({ added, removed, changed }: Differences): string {
  return `${added.length} added, ${removed.length} removed, ${changed.length} changed`;
}

/** What a build did for one series. */
export interface Outcome {
  readonly series: string;
  readonly label: string;
  /** The new version's name; absent when its rows equal the current version's. */
  readonly version?: string;
  readonly previous?: string;
  readonly differences: Differences;
}

export interface BuildOptions {
  readonly source: Source;
  readonly build: Build;
  readonly release: string;
  readonly label: string;
  readonly feed: string;
  readonly out: string;
  /** Where the current versions' rows files are looked for after `out` and the feed's folder: the releases. */
  readonly rows?: RowsStore;
  readonly now: string;
  /** Each release file's `Last-Modified`, by name, where the publisher gave one. */
  readonly modified?: ReadonlyMap<string, string>;
}

async function rowsAtHand(
  file: string,
  checksum: string,
  stores: readonly RowsStore[],
) {
  for (const store of stores) {
    const bytes = await store.get(file);
    if (bytes !== undefined) return readRowsFile(bytes, checksum);
  }
  throw new Error(`${file} is not at hand`);
}

/** Writes `<out>/checked.json`: when the source was checked, and whether it gave a new version. */
export async function writeChecked(
  out: string,
  source: Source,
  at: string,
  found: "new" | "nothing new",
): Promise<void> {
  await mkdir(out, { recursive: true });
  const checked = {
    checked: { [source.iri]: { label: source.label, at, found } },
  };
  await writeFile(
    join(out, "checked.json"),
    `${JSON.stringify(checked, null, 2)}\n`,
  );
}

/**
 * Builds the release: a new version of each series whose rows differ from its current version's, written into the
 * feed with its rows file under `<out>/rows/`, and the row differences into `<out>/differences.md`.
 */
export async function build(
  contract: Contract,
  options: BuildOptions,
): Promise<Outcome[]> {
  const { source } = options;
  const series = await rowsOf(contract, source, options.build, options.release);
  const feed = await Feed.readOrEmpty(options.feed);
  const folders = [
    folderStore([options.out, dirname(options.feed)]),
    ...(options.rows === undefined ? [] : [options.rows]),
  ];
  const inputs: Input[] = [];
  const inputFiles: { file: string; bytes: Buffer }[] = [];
  for (const title of [...source.files.keys()].sort()) {
    const path = join(options.release, title);
    if (!existsSync(path)) throw new Refusal(`the release has no ${title}`);
    const bytes = await readFile(path);
    const modified = options.modified?.get(title);
    inputFiles.push({
      file: `inputs/${sha256(bytes).toString("hex")}-${title}`,
      bytes,
    });
    inputs.push({
      name: documentName(bytes),
      title,
      checksum: sha256(bytes).toString("hex"),
      ...(modified === undefined ? {} : { modified }),
    });
  }
  const outcomes: Outcome[] = [];
  const files: { file: string; bytes: Buffer }[] = [];
  for (const description of source.series) {
    const rows = series.get(description.iri)!;
    const previous = feed.current(description.iri);
    const held = previous === undefined ? undefined : feed.rowsOf(previous);
    const before =
      held === undefined
        ? new Map<string, string>()
        : keyed(await rowsAtHand(held.file, held.checksum, folders));
    const after = rows.byKey();
    const found = differences(before, after);
    const same =
      previous !== undefined &&
      found.added.length + found.removed.length + found.changed.length === 0;
    if (same) {
      outcomes.push({
        series: description.iri,
        label: description.label,
        previous,
        differences: found,
      });
      continue;
    }
    const version = await versionName(
      description.iri,
      previous,
      rows.triples(),
    );
    const file = await rowsFile(version, rows.triples());
    files.push(file);
    feed.add(
      {
        series: description,
        iri: version,
        label: options.label,
        previous,
        notes: notes(found),
        issued: options.now,
        inputs,
        builder: source.builder,
        rowsFile: file.file,
        checksum: file.checksum,
        mapping: rows.form === "mapping",
      },
      options.now,
    );
    outcomes.push({
      series: description.iri,
      label: description.label,
      version,
      ...(previous === undefined ? {} : { previous }),
      differences: found,
    });
  }
  if (outcomes.some((o) => o.version !== undefined)) {
    const violations = await contract.feedShapes.violations(feed.triples);
    if (violations.length > 0)
      throw new Error(`the feed would not conform:\n${violations.join("\n")}`);
    const archived = [...files, ...inputFiles];
    for (const { file, bytes } of archived) {
      await mkdir(dirname(join(options.out, file)), { recursive: true });
      await writeFile(join(options.out, file), bytes);
    }
    await mkdir(dirname(options.feed), { recursive: true });
    await feed.write(options.feed);
    const inputsSum = sha256(inputs.map((i) => i.checksum).join("\n"));
    const release = {
      tag: `${basename(source.folder)}-${inputsSum.toString("hex").slice(0, 12)}`,
      title: `${source.label} ${options.label}`,
      files: archived.map(({ file }) => file),
    };
    await writeFile(
      join(options.out, "release.json"),
      `${JSON.stringify(release, null, 2)}\n`,
    );
  }
  await mkdir(options.out, { recursive: true });
  await writeFile(join(options.out, "differences.md"), markdown(outcomes));
  await writeChecked(
    options.out,
    source,
    options.now,
    outcomes.some((o) => o.version !== undefined) ? "new" : "nothing new",
  );
  return outcomes;
}

const LISTED = 50;

function listed(heading: string, keys: readonly string[]): string[] {
  if (keys.length === 0) return [];
  const shown = keys.slice(0, LISTED).map((key) => `- \`${key}\``);
  const more =
    keys.length > LISTED ? [`- and ${keys.length - LISTED} more`] : [];
  return [`${heading}:`, "", ...shown, ...more, ""];
}

/** The row differences, as a pull request's description shows them. */
export function markdown(outcomes: readonly Outcome[]): string {
  return outcomes
    .map((o) =>
      [
        `## ${o.label}`,
        "",
        o.version === undefined
          ? "Nothing new: its rows equal the current version's."
          : `\`${o.version}\`${o.previous === undefined ? "" : `, revising \`${o.previous}\``}: ${notes(o.differences)}.`,
        "",
        ...(o.version === undefined
          ? []
          : [
              ...listed("Added", o.differences.added),
              ...listed("Removed", o.differences.removed),
              ...listed("Changed", o.differences.changed),
            ]),
      ].join("\n"),
    )
    .join("\n");
}
