import { existsSync } from "node:fs";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import {
  type Build,
  Refusal,
  type Release,
  type ReleaseFile,
} from "./builder.js";
import { extract, unzip } from "./archive.js";
import { type Described, describe } from "./describe.js";
import { TABLES } from "./rdf.js";
import { readRowsFile, rowsFile } from "./distribution.js";
import { Feed, type Input } from "./feed.js";
import { documentName, sha256, versionName } from "./names.js";
import { delimited, fixedWidth, jsonLines, xlsx } from "./readers.js";
import { keyed, RowSchema, SeriesRows, toRdf } from "./rows.js";
import { Shapes } from "./shapes.js";
import { folderStore, type RowsStore } from "./stores.js";
import { matches, type Source } from "./source.js";
import { resolveVocabulary, Vocabulary } from "./vocabulary.js";

/** Rows checked by one validator: one validator over every row costs more than linearly. */
const SHAPE_CHUNK = 2000;

const BY_API = `${TABLES}ReleaseApi`;
const BY_LISTING = `${TABLES}FolderListing`;

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

export async function readContract(
  root: string,
  vocabularyFolder?: string,
): Promise<Contract> {
  const resolved =
    vocabularyFolder === undefined
      ? await resolveVocabulary(root)
      : {
          folder: resolve(vocabularyFolder),
          said: `cascade-vocabulary: ${resolve(vocabularyFolder)}, as given`,
        };
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
        xlsx: () => xlsx(path),
      };
    },
    codeIri: (system, code) => contract.vocabulary.codeIri(system, code),
  };
}

/**
 * The files of a release kept as its inputs: each file the source names, or, from a release API, its one zip, or, from
 * a folder listing, every file the check took.
 */
async function inputsOf(source: Source, release: string): Promise<string[]> {
  if (source.detectedBy === BY_LISTING)
    return existsSync(release) ? (await readdir(release)).sort() : [];
  if (source.detectedBy !== BY_API) return [...source.files.keys()].sort();
  const zips = existsSync(release)
    ? (await readdir(release)).filter((file) => file.endsWith(".zip"))
    : [];
  if (zips.length !== 1)
    throw new Refusal(`the release holds ${zips.length} zips, not one`);
  return zips;
}

/**
 * Writes each file a folder-listing source names into the folder, from the one file of the release, or entry of one of
 * its zips matching the file's archive pattern, whose name matches its pattern; none or several is refused.
 */
async function openListed(
  source: Source,
  release: string,
  folder: string,
): Promise<void> {
  const files = source.listing!.files;
  const found = new Map(
    [...files.keys()].map((title) => [title, [] as string[]]),
  );
  const titleOf = (name: string, zip?: string): string | undefined =>
    [...files].find(
      ([, file]) =>
        matches(file.namePattern, basename(name)) &&
        (zip === undefined ||
          (file.archivePattern !== undefined &&
            matches(file.archivePattern, zip))),
    )?.[0];
  for (const name of await inputsOf(source, release)) {
    const title = titleOf(name);
    if (title !== undefined) {
      await copyFile(join(release, name), join(folder, title));
      found.get(title)!.push(name);
    } else if (/\.zip$/i.test(name))
      for (const path of await extract(
        join(release, name),
        (path) => titleOf(path, name),
        folder,
      ))
        found.get(titleOf(path, name)!)!.push(`${name}/${path}`);
  }
  for (const [title, taken] of found)
    if (taken.length !== 1)
      throw new Refusal(
        `the release has ${taken.length} files for ${title}, not one${taken.length === 0 ? "" : `: ${taken.join(", ")}`}`,
      );
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
  const opened =
    source.detectedBy === BY_API || source.detectedBy === BY_LISTING
      ? await mkdtemp(join(tmpdir(), "release-"))
      : release;
  try {
    if (source.detectedBy === BY_API) {
      const [zip] = await inputsOf(source, release);
      await unzip(join(release, zip!), source.files, opened);
    }
    if (source.detectedBy === BY_LISTING)
      await openListed(source, release, opened);
    for await (const yielded of build(releaseOf(contract, source, opened))) {
      const row = contract.schema.check(yielded);
      const into = series.get(row.series);
      if (into === undefined)
        throw new Refusal(
          `${row.series} is not a series ${source.label} declares`,
        );
      into.add(toRdf(row));
    }
  } finally {
    if (opened !== release) await rm(opened, { recursive: true, force: true });
  }
  for (const description of source.series) {
    const rows = series.get(description.iri)!;
    const kind = contract.vocabulary.kind(description.kind);
    const keys = [...rows.rows.keys()];
    const found: string[] = [];
    for (let start = 0; start < keys.length; start += SHAPE_CHUNK) {
      const chunk = keys.slice(start, start + SHAPE_CHUNK);
      found.push(
        ...(await contract.rowShapes.violationsOf(
          chunk.flatMap((key) => rows.rows.get(key)!),
          chunk,
          kind.rowShape,
        )),
      );
    }
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
  /** The differences as lines a person can read, by the rows' codes. */
  readonly described: Described;
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

/** Each release file's checksum and `Last-Modified`, by name, as the last check that built no new version saw them. */
export type Seen = Readonly<
  Record<string, { readonly checksum: string; readonly modified?: string }>
>;

/** Writes `<out>/checked.json`: when the source was checked, whether it gave a new version, and what it saw if not. */
export async function writeChecked(
  out: string,
  source: Source,
  at: string,
  found: "new" | "nothing new",
  inputs?: Seen,
): Promise<void> {
  await mkdir(out, { recursive: true });
  const checked = {
    checked: {
      [source.iri]: {
        label: source.label,
        at,
        found,
        ...(inputs === undefined ? {} : { inputs }),
      },
    },
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
  for (const title of await inputsOf(source, options.release)) {
    const path = join(options.release, title);
    if (!existsSync(path)) throw new Refusal(`the release has no ${title}`);
    const bytes = await readFile(path);
    const modified = options.modified?.get(title);
    const checksum = sha256(bytes).toString("hex");
    inputFiles.push({ file: `inputs/${checksum}-${title}`, bytes });
    inputs.push({
      name: documentName(bytes),
      title,
      checksum,
      ...(modified === undefined ? {} : { modified }),
    });
  }
  const outcomes: Outcome[] = [];
  const files: { file: string; bytes: Buffer; checksum: string }[] = [];
  for (const description of source.series) {
    const rows = series.get(description.iri)!;
    const previous = feed.current(description.iri);
    const held = previous === undefined ? undefined : feed.rowsOf(previous);
    const beforeRows =
      held === undefined
        ? []
        : await rowsAtHand(held.file, held.checksum, folders);
    const after = rows.byKey();
    const found = differences(keyed(beforeRows), after);
    const same =
      previous !== undefined &&
      found.added.length + found.removed.length + found.changed.length === 0;
    if (same) {
      outcomes.push({
        series: description.iri,
        label: description.label,
        previous,
        differences: found,
        described: { added: [], removed: [], changed: [] },
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
      described: describe(beforeRows, rows.triples(), found),
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
    const sum = sha256(
      [...inputs, ...files].map(({ checksum }) => checksum).join("\n"),
    );
    const release = {
      tag: `${basename(source.folder)}-${sum.toString("hex").slice(0, 12)}`,
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
  const built = outcomes.some((o) => o.version !== undefined);
  await writeChecked(
    options.out,
    source,
    options.now,
    built ? "new" : "nothing new",
    built
      ? undefined
      : Object.fromEntries(
          inputs.map(({ title, checksum, modified }) => [
            title,
            modified === undefined ? { checksum } : { checksum, modified },
          ]),
        ),
  );
  return outcomes;
}

const FOLDED_FROM = 10;
const BODY_CHARACTERS = 60000;

/** A list of rows, folded when long, cut to the characters it may take with the rest counted. */
function listed(
  heading: string,
  lines: readonly string[],
  share: number,
): string[] {
  if (lines.length === 0) return [];
  const shown: string[] = [];
  let used = 0;
  for (const text of lines) {
    used += text.length + 3;
    if (used > share) break;
    shown.push(`- ${text}`);
  }
  const more =
    lines.length > shown.length
      ? [`- and ${lines.length - shown.length} more`]
      : [];
  const summary = `${heading} (${lines.length})`;
  return lines.length < FOLDED_FROM
    ? [`${summary}:`, "", ...shown, ...more, ""]
    : [
        `<details><summary>${summary}</summary>`,
        "",
        ...shown,
        ...more,
        "",
        "</details>",
        "",
      ];
}

/** The row differences, as a pull request's description shows them. */
export function markdown(outcomes: readonly Outcome[]): string {
  const lists = outcomes.flatMap((o) =>
    o.version === undefined
      ? []
      : [o.described.added, o.described.removed, o.described.changed],
  );
  const share = Math.floor(
    BODY_CHARACTERS / Math.max(1, lists.filter((l) => l.length > 0).length),
  );
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
              ...listed("Added", o.described.added, share),
              ...listed("Removed", o.described.removed, share),
              ...listed("Changed", o.described.changed, share),
            ]),
      ].join("\n"),
    )
    .join("\n");
}
