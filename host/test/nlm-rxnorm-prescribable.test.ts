import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { before, describe, it } from "node:test";
import type { Build } from "../src/builder.js";
import { builtRows, type Contract, readContract } from "../src/pipeline.js";
import { parseTrig } from "../src/rdf.js";
import { releaseOf } from "../src/release.js";
import { keyed, SeriesRows, toRdf } from "../src/rows.js";
import { loadBuild, loadHistory, readSource } from "../src/source.js";
import { refusal, releaseFolder } from "./release-folder.js";

const ROOT = join(import.meta.dirname, "..", "..", "..");
const FOLDER = join(ROOT, "builders", "nlm-rxnorm-prescribable");
const STATUS = "urn:uuid:6828cb6b-4adc-460b-8f01-08d36ef2ae88";
const PRODUCTS = "urn:uuid:61ca1c5b-722e-4baa-88a8-1e4e4a8afe12";
const RXNORM = "https://ns.cascadeprotocol.org/codes/rxnorm/";

const conso = (code: string, type: string) =>
  `${code}|ENG||||||A${code}||||RXNORM|${type}|${code}|name ${code}||N|4096|\n`;
const rel = (to: string, relation: string, from: string) =>
  `${to}||CUI|RO|${from}||CUI|${relation}|R||RXNORM||||N||\n`;

/**
 * The builder reads RxNorm's release files, and RxNav's history answers for codes that left a release. What it cannot
 * map refuses the build.
 */
describe("Drug codes from NLM's prescribable RxNorm · builders/nlm-rxnorm-prescribable", () => {
  let contract: Contract;

  before(async () => {
    contract = await readContract(ROOT);
  });

  /** The status rows the builder gives for these history answers, one per line. */
  async function statusRows(history: string): Promise<SeriesRows> {
    const build = (await loadHistory(ROOT, FOLDER))!;
    const { folder, remove } = await releaseFolder({
      "history.jsonl": history,
    });
    try {
      const rows = new SeriesRows(STATUS);
      for await (const yielded of build(
        releaseOf(
          contract.vocabulary,
          "the history",
          new Set(["history.jsonl"]),
          folder,
        ),
      ))
        rows.add(toRdf(contract.schema.check(yielded)));
      return rows;
    } finally {
      await remove();
    }
  }

  describe("given RxNav's history answers", () => {
    it("gives a status row for each retired code and none for a code still active", async () => {
      const rows = await statusRows(
        await readFile(
          join(FOLDER, "fixtures", "history", "history.jsonl"),
          "utf8",
        ),
      );
      const expected = keyed(
        parseTrig(
          await readFile(
            join(FOLDER, "fixtures", "expected", "history.trig"),
            "utf8",
          ),
        ).filter((q) => q.graph.value === STATUS),
      );
      assert.deepEqual(rows.byKey(), expected);
    });

    const unmapped: [what: string, history: string, reason: string][] = [
      [
        "a status it does not map",
        '{"code":"1","answer":{"rxcuiStatusHistory":{"metaData":{"status":"UNKNOWN"}}}}',
        'history.jsonl line 1 gives 1 the status "UNKNOWN", which this builder does not map',
      ],
      [
        "an answer with no status",
        '{"code":"1","answer":{"rxcuiStatusHistory":{}}}',
        'history.jsonl line 1 gives 1 the status "none", which this builder does not map',
      ],
    ];
    for (const [what, history, reason] of unmapped)
      /** Rule H20 of rules/carry.feature, whose example runs the example builder; this is this builder's own sentence. */
      it(`refuses ${what}, naming the line`, async () => {
        assert.equal(await refusal(statusRows(`${history}\n`)), reason);
      });
  });

  /** The rows the builder yields for a release of these concepts (RXNCONSO lines) and relationships (RXNREL lines). */
  async function builtFrom(concepts: string, relations: string) {
    const build = await loadBuild(ROOT, FOLDER);
    const { folder, remove } = await releaseFolder({
      "RXNCONSO.RRF": concepts,
      "RXNREL.RRF": relations,
      "RXNSAT.RRF": "",
    });
    try {
      const release = releaseOf(
        contract.vocabulary,
        "the release",
        new Set(["RXNCONSO.RRF", "RXNREL.RRF", "RXNSAT.RRF"]),
        folder,
      );
      const rows = [];
      for await (const row of build(release)) rows.push(row);
      return rows;
    } finally {
      await remove();
    }
  }

  describe("given a release's RXNCONSO and RXNREL lines", () => {
    it("refuses a precise ingredient whose term type is not PIN, naming the concept", async () => {
      assert.equal(
        await refusal(
          builtFrom(
            conso("1", "IN") + conso("10", "SCDC"),
            rel("1", "has_precise_ingredient", "10"),
          ),
        ),
        "RXNREL.RRF gives 10 the precise ingredient 1, whose term type is IN, not PIN",
      );
    });

    it("gives no row, and no refusal, for a precise ingredient RXNCONSO does not hold", async () => {
      const rows = await builtFrom(
        conso("10", "SCDC"),
        rel("1", "has_precise_ingredient", "10"),
      );
      assert.equal(
        rows.filter(
          (row) =>
            "predicate_id" in row &&
            row.predicate_id.endsWith("hasPreciseIngredient"),
        ).length,
        0,
      );
    });
  });

  describe("given a build that yields a drug products row for an ingredient", () => {
    it("refuses it with the vocabulary's shape message", async () => {
      const source = await readSource(FOLDER);
      const notProduct: Build = async function* () {
        yield { series: PRODUCTS, subject: `${RXNORM}21`, termType: "IN" };
      };
      assert.match(
        await refusal(
          builtRows(
            contract,
            source,
            notProduct,
            join(FOLDER, "fixtures", "release"),
          ),
        ),
        /A drug product's term type is one of SCD, SBD, GPCK or BPCK\./,
      );
    });
  });
});
