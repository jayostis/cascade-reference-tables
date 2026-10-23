import type { CsvRow, JsonLine, Line, XmlElement } from "./readers.js";

/** Input the contract refuses: the build writes nothing, and says why. */
export class Refusal extends Error {
  override name = "Refusal";
}

/** A file of the release, opened by the reader its format needs. */
export interface ReleaseFile {
  readonly name: string;
  /** Each non-empty line as text, for a builder that cuts only the fields it needs of a very large file. */
  lines(): AsyncIterable<{ readonly number: number; readonly text: string }>;
  delimited(delimiter: string): AsyncIterable<Line>;
  /**
   * Each record of an RFC 4180 file under its header, read by name; a quoted field may hold line breaks. The file is
   * refused when it lacks a column in `required` or holds a record of another width.
   */
  csv(required: readonly string[]): AsyncIterable<CsvRow>;
  fixedWidth(
    columns: readonly (readonly [number, number])[],
  ): AsyncIterable<Line>;
  json(): AsyncIterable<JsonLine>;
  /** The first sheet of an xlsx workbook, each row a line of its cells' text. */
  xlsx(): AsyncIterable<Line>;
  /** Each element of that name in an XML file, or in the one `.xml` entry of a zip, one at a time as it is read. */
  xml(element: string): AsyncIterable<XmlElement>;
}

/** What a builder is handed: the release's files, the IRIs of codes, and what the vocabulary and its source state. */
export interface Release {
  file(name: string): ReleaseFile;
  /** A code's IRI in a code system the vocabulary names, such as `cascade:CVX`. */
  codeIri(system: string, code: string): string;
  /**
   * Each label of a concept of the scheme, its `skos:prefLabel`, `skos:altLabel` and `skos:notation`, with the
   * concept's IRI, as the pinned vocabulary states them.
   */
  concepts(scheme: string): ReadonlyMap<string, string>;
  /** The genes (`cascade:coversGene`) the source declares for the series, sorted. */
  genes(series: string): readonly string[];
  /** Something a person should see on the pull request; the build goes on. */
  finding(text: string): void;
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

/** A row of a panel members kind: a mapping row with the member's place in the panel and, if the source states it, its requirement. */
export interface MemberRow extends Omit<MappingRow, "mapping_cardinality"> {
  readonly sequence: number;
  readonly required?: string;
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

/** A row of a drug products kind: the code and its term type. */
export interface TermTypeRow {
  readonly series: string;
  readonly subject: string;
  readonly termType: string;
}

/** A row of a variant classifications kind: a variation, its expressions and what its source says of it. */
export interface ClassificationRow {
  readonly series: string;
  readonly variation: string;
  readonly hgvs?: readonly string[];
  readonly classification?: readonly string[];
  readonly reviewStatus?: string;
  readonly lastEvaluated?: string;
  readonly contributingSubmitterCount?: number;
  readonly submitterCount?: number;
}

/** A row in one of `builder/interface.schema.json`'s forms. */
export type Row =
  | MappingRow
  | MemberRow
  | NamesRow
  | StatusRow
  | TermTypeRow
  | ClassificationRow;

/** A builder's `build.ts` exports this as its default. */
export type Build = (release: Release) => AsyncIterable<Row>;
