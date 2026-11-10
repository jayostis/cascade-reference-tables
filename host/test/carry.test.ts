import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { before, describe, it } from "node:test";
import { carry, withProperty } from "../src/carry.js";
import type { Fetch } from "../src/detection.js";
import { tableRowName } from "../src/names.js";
import { readContract } from "../src/pipeline.js";
import { CASCADE, iri, literal, OWL, parseTrig, quad } from "../src/rdf.js";
import { SeriesRows, toRdf } from "../src/rows.js";
import { loadHistory, readSource } from "../src/source.js";

const ROOT = join(import.meta.dirname, "..", "..", "..");
const OBO = "http://purl.obolibrary.org/obo/";
const [PANEL, MEMBER] = [
  "http://loinc.org/rdf/24318-8",
  "http://loinc.org/rdf/1",
];
const FOLDER = join(ROOT, "builders", "nlm-rxnorm-prescribable");
const PRODUCTS = "urn:uuid:61ca1c5b-722e-4baa-88a8-1e4e4a8afe12";
const RXNORM = "https://ns.cascadeprotocol.org/codes/rxnorm/";

/**
 * A series that carries rows forward keeps the rows of a code its publisher's new release no longer names, so a record
 * coded long ago still finds its table row. `carry()` returns those rows; `withProperty()` rewrites a carried mapping
 * row to the property its table kind now fixes.
 */
describe("Carrying forward the rows of a code that leaves a release · carry(), withProperty()", () => {
  /** Rule H19 of rules/carry.feature, whose example carries names; this is RxNorm's carried form. */
  describe("carry()", () => {
    let carried: readonly { form: string; key: string }[] | undefined;

    before(async () => {
      const contract = await readContract(ROOT);
      const source = await readSource(FOLDER);
      const current = parseTrig(
        await readFile(
          join(FOLDER, "fixtures", "expected", "rows.trig"),
          "utf8",
        ),
      ).filter((q) => q.graph.value === PRODUCTS);
      const stays = new SeriesRows(PRODUCTS);
      for (const [code, termType] of [
        ["13", "SBD"],
        ["32", "SCD"],
        ["19", "GPCK"],
        ["20", "BPCK"],
      ] as const)
        stays.add(
          toRdf({ series: PRODUCTS, subject: `${RXNORM}${code}`, termType }),
        );
      const active = (async () => ({
        ok: true,
        json: async () => ({
          rxcuiStatusHistory: { metaData: { status: "Active" } },
        }),
      })) as unknown as Fetch;
      const result = await carry({
        contract,
        source,
        built: new Map([[PRODUCTS, stays]]),
        current: async (series) => (series === PRODUCTS ? current : []),
        history: (await loadHistory(ROOT, FOLDER))!,
        fetch: active,
      });
      carried = result.rows.get(PRODUCTS);
    });

    it("returns a term type row for an RxNorm product the release no longer names", () => {
      assert.deepEqual(
        carried
          ?.filter(({ key }) => key === `${RXNORM}11`)
          .map(({ form }) => form),
        ["termType"],
      );
    });

    it("returns none for the products the release still names", () => {
      assert.equal(carried?.length, 1);
    });
  });

  /** Rule H27 of rules/carry.feature, whose one example carries a vaccine group, which has no sequence. */
  describe("withProperty()", () => {
    it("names a carried panel member row over its panel, the new property, its member and its sequence", () => {
      const key = "urn:uuid:00000000-0000-8000-8000-000000000000";
      const triples = [
        [`${OWL}annotatedSource`, iri(PANEL)],
        [`${OWL}annotatedProperty`, iri(`${OBO}RO_0002350`)],
        [`${OWL}annotatedTarget`, iri(MEMBER)],
        [
          `${CASCADE}panelSequence`,
          literal("03", "http://www.w3.org/2001/XMLSchema#integer"),
        ],
      ].map(([predicate, object]) =>
        quad(iri(key), iri(predicate as string), object as never),
      );
      const carried = withProperty({ key, triples }, `${OBO}RO_0002351`);
      assert.equal(
        carried.key,
        tableRowName(PANEL, `${OBO}RO_0002351`, MEMBER, 3n),
      );
      assert.ok(carried.triples.every((t) => t.subject.value === carried.key));
    });
  });
});
