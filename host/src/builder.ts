import type { JsonLine, Line } from "./readers.js";

/** Input the contract refuses: the build writes nothing, and says why. */
export class Refusal extends Error {
  override name = "Refusal";
}

/** A file of the release, opened by the reader its format needs. */
export interface ReleaseFile {
  readonly name: string;
  delimited(delimiter: string): AsyncIterable<Line>;
  fixedWidth(
    columns: readonly (readonly [number, number])[],
  ): AsyncIterable<Line>;
  json(): AsyncIterable<JsonLine>;
  /** The first sheet of an xlsx workbook, each row a line of its cells' text. */
  xlsx(): AsyncIterable<Line>;
}

/** What a builder is handed: the release's files, and the IRIs of codes. */
export interface Release {
  file(name: string): ReleaseFile;
  /** A code's IRI in a code system the vocabulary names, such as `rec:CVX`. */
  codeIri(system: string, code: string): string;
}

/** A row of a mapping kind, by SSSOM's slots. */
export interface MappingRow {
  readonly series: string;
  readonly subject_id: string;
  readonly predicate_id: string;
  readonly object_id: string;
  readonly mapping_justification: string;
  readonly mapping_cardinality?: "1:1" | "1:n" | "n:1" | "n:n";
}

/** A row of a names kind, by SKOS. */
export interface NamesRow {
  readonly series: string;
  readonly subject: string;
  readonly prefLabel: string;
  readonly altLabel?: readonly string[];
  readonly notation: string;
}

/** A row of a code status kind: the code is retired, and what replaces it. */
export interface StatusRow {
  readonly series: string;
  readonly subject: string;
  readonly replacedBy?: readonly string[];
}

/** A row in one of `builder/interface.schema.json`'s forms. */
export type Row = MappingRow | NamesRow | StatusRow;

/** A builder's `build.ts` exports this as its default. */
export type Build = (release: Release) => AsyncIterable<Row>;
