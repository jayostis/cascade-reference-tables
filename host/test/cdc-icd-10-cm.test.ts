import assert from "node:assert/strict";
import { join } from "node:path";
import { before, describe, it } from "node:test";
import type {
  MappingRow,
  Release,
  ReleaseFile,
  Row,
  StatusRow,
} from "../src/builder.js";
import { loadBuild } from "../src/source.js";

const ROOT = join(import.meta.dirname, "..", "..", "..");
const FOLDER = join(ROOT, "builders", "cdc-icd-10-cm");
const ICD = "https://ns.cascadeprotocol.org/codes/icd10cm/";

/** Order lines as code without its dot, flag and title; conversion rows as new code, year and previous codes. */
function release(order: string[][], conversions: string[][]): Release {
  const lines = (rows: string[][]): AsyncIterable<never> =>
    (async function* () {
      for (const [index, fields] of rows.entries())
        yield { number: index + 1, fields } as never;
    })();
  return {
    file: (name): ReleaseFile =>
      ({
        fixedWidth: () =>
          lines(
            name === "icd10cm-order.txt"
              ? order.map(([code, flag]) => [code!, flag!, "title", "title"])
              : [],
          ),
        xlsx: () => lines(conversions),
      }) as unknown as ReleaseFile,
    codeIri: (_system, code) => `${ICD}${code}`,
    concepts: () => new Map(),
    genes: () => [],
    finding: () => undefined,
  };
}

async function rows(built: AsyncIterable<Row>): Promise<Row[]> {
  const found: Row[] = [];
  for await (const row of built) found.push(row);
  return found;
}

const tail = (iri: string): string => iri.slice(ICD.length);

/**
 * CDC's conversion table says which code of a new year takes the place of which earlier ones. The builder gives a
 * mapping row for each conversion, with its cardinality (how many to how many), and a status row saying what replaces
 * a retired code.
 */
describe("ICD-10-CM code conversions from CDC's files · builders/cdc-icd-10-cm", () => {
  describe("given a conversion table with a one-to-one change, a split, a merge and two chains", () => {
    let found: Row[];
    let mappings: {
      from: string;
      to: string;
      cardinality: string | undefined;
      justification: string | undefined;
    }[];

    before(async () => {
      const build = await loadBuild(ROOT, FOLDER);
      found = await rows(
        build(
          release(
            [
              ["M9701XA", "1"],
              ["V470XXA", "1"],
              ["D6911", "1"],
              ["D6919", "1"],
              ["C002", "1"],
              ["C003", "1"],
              ["Z002", "1"],
              ["B001", "0"],
            ],
            [
              ["M97.01XA", "2024", "T84.040A"],
              ["V47.0XXA", "2024", "V47.01XA, V47.02XA"],
              ["D69.11", "2024", "D69.1"],
              ["D69.19", "2024", "D69.1"],
              ["B00.1", "2020", "A00.0"],
              ["C00.2", "2021", "B00.1"],
              ["C00.3", "2021", "B00.1"],
              ["Y00.1", "2020", "X00.0, X00.9"],
              ["Z00.2", "2021", "Y00.1"],
            ],
          ),
        ),
      );
      mappings = found
        .filter((row): row is MappingRow => "subject_id" in row)
        .map((row) => ({
          from: tail(row.subject_id),
          to: tail(row.object_id),
          cardinality: row.mapping_cardinality,
          justification: row.mapping_justification.split("/").at(-1),
        }))
        .sort((a, b) => `${a.from} ${a.to}`.localeCompare(`${b.from} ${b.to}`));
    });

    const justifiedBy = (justification: string, showing: "codes" | "all") =>
      mappings
        .filter((mapping) => mapping.justification === justification)
        .map(({ from, to, cardinality }) =>
          showing === "codes"
            ? `${from} ${to}`
            : `${from} ${to} ${cardinality}`,
        );

    it("gives a 1:1, a 1:n and an n:1 mapping row as the table states them", () => {
      assert.equal(mappings.length, 12);
      assert.deepEqual(justifiedBy("ManualMappingCuration", "all"), [
        "B00.1 C00.2 1:n",
        "B00.1 C00.3 1:n",
        "D69.1 D69.11 1:n",
        "D69.1 D69.19 1:n",
        "T84.040A M97.01XA 1:1",
        "V47.01XA V47.0XXA n:1",
        "V47.02XA V47.0XXA n:1",
        "Y00.1 Z00.2 1:1",
      ]);
    });

    it("follows a chain to the codes in effect, marking those rows as chained", () => {
      assert.deepEqual(justifiedBy("MappingChaining", "codes"), [
        "A00.0 C00.2",
        "A00.0 C00.3",
        "X00.0 Z00.2",
        "X00.9 Z00.2",
      ]);
    });

    it("shows a split or a merge inside a chain in the chained rows' cardinality", () => {
      assert.deepEqual(justifiedBy("MappingChaining", "all"), [
        "A00.0 C00.2 1:n",
        "A00.0 C00.3 1:n",
        "X00.0 Z00.2 n:1",
        "X00.9 Z00.2 n:1",
      ]);
    });

    it("gives no mapping row to a code no longer in effect", () => {
      assert.equal(
        found.some(
          (row) => "subject_id" in row && tail(row.object_id) === "B00.1",
        ),
        false,
      );
    });

    it("lists every code in effect that replaces a retired code, on its status row", () => {
      const replaced = found
        .filter((row): row is StatusRow => "replacedBy" in row)
        .filter((row) => tail(row.subject) === "A00.0");
      assert.deepEqual(
        replaced.map((row) => row.replacedBy?.map(tail)),
        [["C00.2", "C00.3"]],
      );
    });
  });
});
