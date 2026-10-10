import assert from "node:assert/strict";
import { test } from "node:test";
import type { Row } from "../src/builder.js";
import { describe } from "../src/describe.js";
import { differences, markdown, type Outcome } from "../src/pipeline.js";
import { keyed, toRdf } from "../src/rows.js";

const CVX = "http://hl7.org/fhir/sid/cvx/";
const SKOS = "http://www.w3.org/2004/02/skos/core#";
const SERIES = "urn:uuid:f71f6797-48ec-4875-9b87-4cb1be1d9be0";

function quadsOf(rows: readonly Row[]) {
  return rows.flatMap((row) => toRdf(row).triples);
}

function outcomeOf(before: readonly Row[], after: readonly Row[]): Outcome {
  const found = differences(keyed(quadsOf(before)), keyed(quadsOf(after)));
  return {
    series: SERIES,
    label: "Example",
    version: "ni:///sha-256;abc",
    differences: found,
    described: describe(quadsOf(before), quadsOf(after), found),
  };
}

const name = (code: string, prefLabel: string): Row => ({
  series: SERIES,
  subject: `${CVX}${code}`,
  prefLabel,
  notation: code,
});
const mapping = (from: string, to: string): Row => ({
  series: SERIES,
  subject_id: `${CVX}${from}`,
  predicate_id: `${SKOS}broadMatch`,
  object_id: `${CVX}${to}`,
  mapping_justification: "https://w3id.org/semapv/vocab/ManualMappingCuration",
});
const retired = (code: string, replacedBy: string[] = []): Row => ({
  series: SERIES,
  subject: `${CVX}${code}`,
  replacedBy: replacedBy.map((c) => `${CVX}${c}`),
});

test("a version's differences read by their codes, sorted by code, whatever the kind of row", () => {
  const cases: [
    string,
    Row[],
    Row[],
    Partial<Record<"added" | "removed" | "changed", string[]>>,
  ][] = [
    [
      "names: code and label; a change shows what it was",
      [name("9", "nine"), name("45", "old <label>")],
      [name("10", "ten"), name("45", "new label")],
      {
        added: ["`10`: ten"],
        removed: ["`9`: nine"],
        changed: ["`45`: new label (was `45`: old \\<label\\>)"],
      },
    ],
    [
      "mappings: source code, target code and predicate",
      [mapping("77", "222")],
      [mapping("88", "88"), mapping("8", "88")],
      {
        added: ["`8` → `88` (broadMatch)", "`88` → `88` (broadMatch)"],
        removed: ["`77` → `222` (broadMatch)"],
      },
    ],
    [
      "status: code and its status, with what replaces it",
      [],
      [retired("57"), retired("17", ["45", "88"])],
      {
        added: ["`17`: retired, replaced by `45`, `88`", "`57`: retired"],
      },
    ],
  ];
  for (const [kind, before, after, expected] of cases) {
    const { described } = outcomeOf(before, after);
    assert.deepEqual(
      described,
      { added: [], removed: [], changed: [], ...expected },
      kind,
    );
  }
});

test("a long list is folded after its count, and a very long one is cut to what a pull request body holds", () => {
  const rows = (n: number) =>
    Array.from({ length: n }, (_, i) =>
      name(String(i), `label ${i} ${"x".repeat(80)}`),
    );
  const short = markdown([outcomeOf([], rows(3))]);
  assert.match(short, /Added \(3\):\n\n- `0`: label 0/);
  assert.doesNotMatch(short, /<details>/);
  const folded = markdown([outcomeOf([], rows(12))]);
  assert.match(
    folded,
    /<details><summary>Added \(12\)<\/summary>\n\n- `0`: label 0/,
  );
  assert.doesNotMatch(folded, /urn:uuid/);
  const huge = markdown([outcomeOf([], rows(2000))]);
  assert.ok(huge.length < 65536);
  assert.match(huge, /- and \d+ more/);
});
