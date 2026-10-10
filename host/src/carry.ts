import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Build, Refusal } from "./builder.js";
import type { Fetch } from "./detection.js";
import type { Contract } from "./pipeline.js";
import { OWL, type Quad, REC, SKOS } from "./rdf.js";
import { releaseOf } from "./release.js";
import { type Form, type RdfRow, type SeriesRows, toRdf } from "./rows.js";
import type { Source } from "./source.js";

const START_EVERY_MS = 50;
const IN_FLIGHT = 10;
const HISTORY = "history.jsonl";

/** The rows to add to a new build, by series, and the bytes of the history they were looked up in, if any. */
export interface Carried {
  readonly rows: ReadonlyMap<string, readonly RdfRow[]>;
  readonly history?: Buffer;
}

export interface CarryInput {
  readonly contract: Pick<Contract, "vocabulary" | "schema">;
  readonly source: Source;
  /** The rows the builder gave from the release, by series. */
  readonly built: ReadonlyMap<string, SeriesRows>;
  /** A series' rows in its current version, read when asked for so that one series' rows are held at a time. */
  readonly current: (series: string) => Promise<readonly Quad[]>;
  readonly history?: Build | undefined;
  readonly fetch?: Fetch | undefined;
}

interface Group {
  readonly key: string;
  readonly triples: Quad[];
}

function groups(triples: readonly Quad[]): Group[] {
  const by = new Map<string, Group>();
  for (const t of triples) {
    const held = by.get(t.subject.value);
    if (held === undefined)
      by.set(t.subject.value, { key: t.subject.value, triples: [t] });
    else held.triples.push(t);
  }
  return [...by.values()];
}

function formOf({ triples }: Group): Form {
  if (triples.some((t) => t.predicate.value === `${OWL}annotatedSource`))
    return "mapping";
  if (triples.some((t) => t.predicate.value === `${SKOS}prefLabel`))
    return "names";
  return triples.some((t) => t.predicate.value === `${REC}termType`)
    ? "termType"
    : "status";
}

/** The code a row is about: a mapping row's source, else its subject. */
function subjectOf(group: Group): string {
  return (
    group.triples.find((t) => t.predicate.value === `${OWL}annotatedSource`)
      ?.object.value ?? group.key
  );
}

/** Every code the builder's rows name: mapping rows' sources and targets, the other forms' subjects. */
function named(built: ReadonlyMap<string, SeriesRows>): Set<string> {
  const codes = new Set<string>();
  for (const rows of built.values())
    for (const t of rows.triples()) {
      if (rows.form === "mapping") {
        if (
          t.predicate.value === `${OWL}annotatedSource` ||
          t.predicate.value === `${OWL}annotatedTarget`
        )
          codes.add(t.object.value);
      } else codes.add(t.subject.value);
    }
  return codes;
}

/** The answers for the codes, as the lines of `history.jsonl`, started at most every 50 ms and 10 at a time. */
async function ask(
  codes: readonly string[],
  template: string,
  fetchWith: Fetch,
): Promise<string[]> {
  const lines: string[] = [];
  const stop = new AbortController();
  let next = 0;
  let free = 0;
  let failed = false;
  const worker = async (): Promise<void> => {
    while (!failed && next < codes.length) {
      const at = next++;
      const code = codes[at]!;
      const start = Math.max(free, Date.now());
      free = start + START_EVERY_MS;
      await new Promise((done) => setTimeout(done, start - Date.now()));
      try {
        const url = template.replace("{code}", encodeURIComponent(code));
        const response = await fetchWith(url, { signal: stop.signal });
        if (!response.ok) throw new Error(`${url} answered ${response.status}`);
        lines[at] = JSON.stringify({
          code,
          answer: (await response.json()) as unknown,
        });
      } catch (error) {
        failed = true;
        stop.abort();
        throw error;
      }
    }
  };
  await Promise.all(Array.from({ length: IN_FLIGHT }, worker));
  return lines;
}

/**
 * The rows of the current versions that a carrying series keeps because their code is named by no row of the new
 * release and lies in the space of a code system the vocabulary registers, the status rows kept with them, and the status rows the history of the carried codes gives.
 */
export async function carry(input: CarryInput): Promise<Carried> {
  const { contract, source, built, current } = input;
  const carrying = source.series.filter((s) => s.carriesForward);
  if (carrying.length === 0) return { rows: new Map() };
  const status = source.historyLookup
    ? source.series.find((s) => s.kind === `${REC}CodeStatus`)
    : undefined;
  const taken = named(built);
  const rows = new Map<string, RdfRow[]>();
  const carried: string[] = [];
  const add = (series: string, row: RdfRow): void => {
    if (!rows.has(series)) rows.set(series, []);
    rows.get(series)!.push(row);
  };
  const keep = (series: string, group: Group): boolean => {
    if (contract.vocabulary.systemOf(subjectOf(group)) === undefined)
      return false;
    add(series, {
      form: formOf(group),
      key: group.key,
      triples: group.triples,
    });
    return true;
  };
  for (const { iri } of carrying)
    for (const group of groups(await current(iri))) {
      const subject = subjectOf(group);
      if (!taken.has(subject) && keep(iri, group)) carried.push(subject);
    }
  if (status === undefined || source.historyLookup === undefined)
    return { rows };
  const { system, urlTemplate } = source.historyLookup;
  const retired = new Set<string>();
  for (const group of groups(await current(status.iri))) {
    retired.add(group.key);
    if (!taken.has(group.key)) keep(status.iri, group);
  }
  const codes = [
    ...new Set(
      carried
        .filter((subject) => !retired.has(subject))
        .flatMap((subject) => {
          const code = contract.vocabulary.codeOf(system, subject);
          return code === undefined ? [] : [code];
        }),
    ),
  ].sort();
  if (codes.length === 0) return { rows };
  if (input.fetch === undefined || input.history === undefined)
    throw new Error(
      `${codes.length} carried codes are to be looked up, and the build was given no ${input.fetch === undefined ? "fetch" : "history"}`,
    );
  const bytes = Buffer.from(
    `${(await ask(codes, urlTemplate, input.fetch)).join("\n")}\n`,
  );
  const folder = await mkdtemp(join(tmpdir(), "history-"));
  try {
    await writeFile(join(folder, HISTORY), bytes);
    const release = releaseOf(
      contract.vocabulary,
      "the history",
      new Set([HISTORY]),
      folder,
    );
    for await (const yielded of input.history(release)) {
      const row = contract.schema.check(yielded);
      if (row.series !== status.iri)
        throw new Refusal(
          `the history gives a row of ${row.series}, not of ${status.label}`,
        );
      add(status.iri, toRdf(row));
    }
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
  return { rows, history: bytes };
}
