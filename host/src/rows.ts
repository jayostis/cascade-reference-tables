import { readFileSync } from "node:fs";
import { Ajv2020 } from "ajv/dist/2020.js";
import { Refusal, type Row } from "./builder.js";
import { recordName } from "./names.js";
import {
  DCT,
  literal,
  ntLine,
  OWL,
  type Quad,
  RDF,
  REC,
  SKOS,
  SSSOM,
  triple,
  XSD,
} from "./rdf.js";

export type Form = "mapping" | "names" | "status" | "termType";

/** A row as RDF: its key, the subject every one of its triples is about. */
export interface RdfRow {
  readonly form: Form;
  readonly key: string;
  readonly triples: readonly Quad[];
}

/** The row's triples, a mapping row named by the record rule over its subject, predicate and object (N11). */
export function toRdf(row: Row): RdfRow {
  if ("subject_id" in row) {
    const key = recordName([row.subject_id, row.predicate_id, row.object_id]);
    return {
      form: "mapping",
      key,
      triples: [
        triple(key, `${RDF}type`, `${OWL}Axiom`),
        triple(key, `${OWL}annotatedSource`, row.subject_id),
        triple(key, `${OWL}annotatedProperty`, row.predicate_id),
        triple(key, `${OWL}annotatedTarget`, row.object_id),
        triple(key, `${SSSOM}mapping_justification`, row.mapping_justification),
        ...(row.mapping_cardinality === undefined
          ? []
          : [
              triple(
                key,
                `${SSSOM}mapping_cardinality`,
                literal(row.mapping_cardinality),
              ),
            ]),
      ],
    };
  }
  if ("prefLabel" in row)
    return {
      form: "names",
      key: row.subject,
      triples: [
        triple(row.subject, `${SKOS}prefLabel`, literal(row.prefLabel)),
        ...(row.altLabel ?? []).map((label) =>
          triple(row.subject, `${SKOS}altLabel`, literal(label)),
        ),
        triple(row.subject, `${SKOS}notation`, literal(row.notation)),
      ],
    };
  if ("termType" in row)
    return {
      form: "termType",
      key: row.subject,
      triples: [triple(row.subject, `${REC}termType`, literal(row.termType))],
    };
  return {
    form: "status",
    key: row.subject,
    triples: [
      triple(row.subject, `${OWL}deprecated`, literal("true", `${XSD}boolean`)),
      ...(row.replacedBy ?? []).map((code) =>
        triple(row.subject, `${DCT}isReplacedBy`, code),
      ),
    ],
  };
}

/** One series' rows by key, each key's triples as sorted N-Triples lines. */
export class SeriesRows {
  readonly rows = new Map<string, Quad[]>();
  form: Form | undefined;

  constructor(readonly series: string) {}

  /** Adds a row; the same row twice is one row, and one key with other triples is refused. */
  add(row: RdfRow): void {
    if (this.form !== undefined && this.form !== row.form)
      throw new Refusal(
        `${this.series} is given rows of two forms, ${this.form} and ${row.form}`,
      );
    this.form = row.form;
    const held = this.rows.get(row.key);
    if (held === undefined) {
      this.rows.set(row.key, [...row.triples]);
      return;
    }
    if (lines(held) !== lines(row.triples))
      throw new Refusal(`${row.key} is given twice, with different triples`);
  }

  triples(): Quad[] {
    return [...this.rows.values()].flat();
  }

  /** Each key's triples as one string, for comparing two versions' rows. */
  byKey(): Map<string, string> {
    return keyed(this.triples());
  }
}

function lines(triples: readonly Quad[]): string {
  return triples.map(ntLine).sort().join("\n");
}

/** Triples grouped by subject, each group as its sorted N-Triples lines. */
export function keyed(triples: readonly Quad[]): Map<string, string> {
  const groups = new Map<string, Quad[]>();
  for (const t of triples) {
    const group = groups.get(t.subject.value) ?? [];
    group.push(t);
    groups.set(t.subject.value, group);
  }
  return new Map([...groups].map(([key, group]) => [key, lines(group)]));
}

/** Checks a builder's output against `builder/interface.schema.json`. */
export class RowSchema {
  private readonly validate;

  constructor(schemaPath: string) {
    this.validate = new Ajv2020({ allErrors: false }).compile<Row>(
      JSON.parse(readFileSync(schemaPath, "utf8")) as object,
    );
  }

  check(row: unknown): Row {
    if (this.validate(row)) return row;
    throw new Refusal(
      `${JSON.stringify(row)} is no row of builder/interface.schema.json`,
    );
  }
}
