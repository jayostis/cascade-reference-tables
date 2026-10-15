import assert from "node:assert/strict";
import { test } from "node:test";
import { withProperty } from "../src/carry.js";
import { recordName } from "../src/names.js";
import { iri, literal, OWL, quad, REC } from "../src/rdf.js";

const OBO = "http://purl.obolibrary.org/obo/";
const [PANEL, MEMBER] = [
  "http://loinc.org/rdf/24318-8",
  "http://loinc.org/rdf/1",
];

test("a carried panel row, given the property its kind fixes, is named over its sequence as well", () => {
  const key = "urn:uuid:00000000-0000-8000-8000-000000000000";
  const triples = [
    [`${OWL}annotatedSource`, iri(PANEL)],
    [`${OWL}annotatedProperty`, iri(`${OBO}RO_0002350`)],
    [`${OWL}annotatedTarget`, iri(MEMBER)],
    [
      `${REC}panelSequence`,
      literal("03", "http://www.w3.org/2001/XMLSchema#integer"),
    ],
  ].map(([predicate, object]) =>
    quad(iri(key), iri(predicate as string), object as never),
  );
  const carried = withProperty({ key, triples }, `${OBO}RO_0002351`);
  assert.equal(
    carried.key,
    recordName([PANEL, `${OBO}RO_0002351`, MEMBER, "3"]),
  );
  assert.ok(carried.triples.every((t) => t.subject.value === carried.key));
});
