import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, rename, rm } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import { Graph, parseTurtle, type Quad, REC, VOID } from "./rdf.js";

const run = promisify(execFile);
const RECORDS = "ontologies/records/v1-draft/";

export interface Pin {
  readonly repository: string;
  readonly commit: string;
}

/** The folder the vocabulary is read from, and how it was found. */
export interface Resolved {
  readonly folder: string;
  readonly said: string;
}

async function git(folder: string, ...args: string[]): Promise<string> {
  return (await run("git", ["-C", folder, ...args])).stdout.trim();
}

/**
 * The vocabulary's folder, first match wins: `CASCADE_VOCABULARY`; the sibling checkout `../cascade-vocabulary`; the
 * commit `vocabulary.json` pins, fetched once into `.cache/`.
 */
export async function resolveVocabulary(root: string): Promise<Resolved> {
  const pin = JSON.parse(
    await readFile(join(root, "vocabulary.json"), "utf8"),
  ) as Pin;
  const named = process.env.CASCADE_VOCABULARY;
  if (named !== undefined && named !== "")
    return { folder: resolve(named), said: `cascade-vocabulary: ${named}` };
  const sibling = join(dirname(resolve(root)), basename(pin.repository));
  if (existsSync(join(sibling, RECORDS))) {
    const commit = await git(sibling, "rev-parse", "HEAD").catch(() => "");
    return {
      folder: sibling,
      said: `cascade-vocabulary: the sibling checkout ${sibling}${commit === "" ? "" : ` at ${commit.slice(0, 12)}`}, not the pinned ${pin.commit.slice(0, 12)}`,
    };
  }
  const folder = join(root, ".cache", "cascade-vocabulary", pin.commit);
  if (!existsSync(join(folder, RECORDS))) {
    const partial = `${folder}.partial`;
    await rm(partial, { recursive: true, force: true });
    await mkdir(partial, { recursive: true });
    await git(partial, "init", "--quiet");
    await git(
      partial,
      "fetch",
      "--quiet",
      "--depth",
      "1",
      pin.repository,
      pin.commit,
    );
    await git(
      partial,
      "-c",
      "advice.detachedHead=false",
      "checkout",
      "--quiet",
      "FETCH_HEAD",
    );
    await rename(partial, folder);
  }
  return {
    folder,
    said: `cascade-vocabulary: the pinned ${pin.commit.slice(0, 12)}`,
  };
}

/** A table kind as the vocabulary states it. */
export interface Kind {
  readonly iri: string;
  readonly rowShape: string;
}

/** What the host reads from the vocabulary: the table kinds, their row shapes and the code systems. */
export class Vocabulary {
  private constructor(
    readonly folder: string,
    readonly terms: Graph,
    readonly shapes: readonly Quad[],
  ) {}

  static async read(folder: string): Promise<Vocabulary> {
    const read = async (file: string): Promise<Quad[]> =>
      parseTurtle(
        await readFile(join(folder, RECORDS, file), "utf8"),
        `${REC}`,
      );
    return new Vocabulary(
      folder,
      new Graph(await read("records.ttl")),
      await read("records.shapes.ttl"),
    );
  }

  kind(iri: string): Kind {
    const rowShape = this.terms.value(iri, `${REC}rowShape`);
    if (rowShape === undefined) throw new Error(`${iri} is not a table kind`);
    return { iri, rowShape };
  }

  /** A code's IRI: its system's `void:uriSpace` followed by the code. */
  codeIri(system: string, code: string): string {
    const space = this.terms.value(system, `${VOID}uriSpace`);
    if (space === undefined) throw new Error(`${system} is not a code system`);
    return space + code;
  }
}
