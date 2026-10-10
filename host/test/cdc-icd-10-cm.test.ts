import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";
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
const ICD = "http://hl7.org/fhir/sid/icd-10-cm/";

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
  };
}

async function rows(built: AsyncIterable<Row>): Promise<Row[]> {
  const found: Row[] = [];
  for await (const row of built) found.push(row);
  return found;
}

const tail = (iri: string): string => iri.slice(ICD.length);

test("a retired code is replaced by the codes in effect it converts to, each with its cardinality counted along the conversions, and a chain is followed", async () => {
  const build = await loadBuild(ROOT, FOLDER);
  const found = await rows(
    build(
      release(
        [
          ["M9701XA", "1"],
          ["V470XXA", "1"],
          ["D6911", "1"],
          ["D6919", "1"],
          ["C002", "1"],
          ["B001", "0"],
        ],
        [
          ["M97.01XA", "2024", "T84.040A"],
          ["V47.0XXA", "2024", "V47.01XA, V47.02XA"],
          ["D69.11", "2024", "D69.1"],
          ["D69.19", "2024", "D69.1"],
          ["B00.1", "2020", "A00.0"],
          ["C00.2", "2021", "B00.1"],
        ],
      ),
    ),
  );
  const conversions = found
    .filter((row): row is MappingRow => "subject_id" in row)
    .map(
      (row) =>
        `${tail(row.subject_id)} ${tail(row.object_id)} ${row.mapping_cardinality} ${row.mapping_justification.split("/").at(-1)}`,
    )
    .sort();
  assert.deepEqual(conversions, [
    "A00.0 C00.2 1:1 MappingChaining",
    "B00.1 C00.2 1:1 ManualMappingCuration",
    "D69.1 D69.11 1:n ManualMappingCuration",
    "D69.1 D69.19 1:n ManualMappingCuration",
    "T84.040A M97.01XA 1:1 ManualMappingCuration",
    "V47.01XA V47.0XXA n:1 ManualMappingCuration",
    "V47.02XA V47.0XXA n:1 ManualMappingCuration",
  ]);
  assert.equal(
    found.some((row) => "subject_id" in row && tail(row.object_id) === "B00.1"),
    false,
  );
  const replaced = found
    .filter((row): row is StatusRow => "replacedBy" in row)
    .filter((row) => tail(row.subject) === "A00.0");
  assert.deepEqual(
    replaced.map((row) => row.replacedBy?.map(tail)),
    [["C00.2"]],
  );
});
