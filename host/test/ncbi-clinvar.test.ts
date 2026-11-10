import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { gunzipSync, gzipSync } from "node:zlib";
import {
  build,
  builtRows,
  type Contract,
  readContract,
} from "../src/pipeline.js";
import { CASCADE, DCT } from "../src/rdf.js";
import { Feed } from "../src/feed.js";
import type { SeriesRows } from "../src/rows.js";
import { loadBuild, readSource, type Source } from "../src/source.js";
import { refusal, releaseFolder } from "./release-folder.js";

const ROOT = join(import.meta.dirname, "..", "..", "..");
const FOLDER = join(ROOT, "builders", "ncbi-clinvar");
const RELEASE = join(FOLDER, "fixtures", "release");
const SUMMARY = "variant_summary.txt.gz";
const SNAPSHOT = "hgvs4variation.txt.gz";

let contract: Contract;
let source: Source;
let classifications: string;
let names: string;

const text = async (file: string): Promise<string[]> =>
  gunzipSync(await readFile(join(RELEASE, file)))
    .toString("utf8")
    .split("\n")
    .filter((line) => line !== "");

interface Built {
  series: Map<string, SeriesRows>;
  findings: string[];
}

/** A release folder holding the two files with these lines, run through the builder. */
async function built(
  summary: readonly string[],
  snapshot: readonly string[],
): Promise<Built> {
  const { folder, remove } = await releaseFolder({
    [SUMMARY]: gzipSync(`${summary.join("\n")}\n`),
    [SNAPSHOT]: gzipSync(`${snapshot.join("\n")}\n`),
  });
  try {
    const findings: string[] = [];
    const series = await builtRows(
      contract,
      source,
      await loadBuild(ROOT, FOLDER),
      folder,
      findings,
    );
    return { series, findings };
  } finally {
    await remove();
  }
}

/** What a series says of a key with a predicate, in the vocabulary's records namespace unless the IRI is whole. */
function said(
  series: Map<string, SeriesRows>,
  of: string,
  key: string,
  predicate: string,
): string[] {
  return (series.get(of)!.rows.get(key) ?? [])
    .filter((q) => q.predicate.value === predicate)
    .map((q) => q.object.value)
    .sort();
}

const clinvar = (id: string): string => `https://identifiers.org/clinvar:${id}`;

/** The same lines with their columns in another order, the first column staying first. */
const reordered = (lines: readonly string[]): string[] =>
  lines.map((line) => {
    const cells = line.split("\t");
    return cells.length < 2
      ? line
      : [cells[0]!, ...cells.slice(1).reverse()].join("\t");
  });

/** The lines without a column, found by its name in the header. */
function without(lines: readonly string[], column: string): string[] {
  const header = lines.find((line) => line.split("\t").length > 1)!;
  const at = header.replace(/^#/, "").split("\t").indexOf(column);
  assert.ok(at >= 0, `no column ${column}`);
  return lines.map((line) => {
    const cells = line.split("\t");
    return cells.length < 2
      ? line
      : cells.filter((_, i) => i !== at).join("\t");
  });
}

/**
 * The builder reads ClinVar's monthly `variant_summary` and its `hgvs4variation` file, and gives a classification row
 * for each variation: its classes, its review status and the HGVS expressions that find it. What it leaves out is a
 * finding, shown to whoever reviews the version; it is no refusal.
 */
describe("Variant classifications from NCBI's ClinVar · builders/ncbi-clinvar", () => {
  before(async () => {
    contract = await readContract(ROOT);
    source = await readSource(FOLDER);
    classifications = source.series.find(
      (s) => s.kind === `${CASCADE}VariantClassifications`,
    )!.iri;
    names = source.series.find((s) => s.kind === `${CASCADE}CodeNames`)!.iri;
  });

  describe("given the vocabulary's ClinVar vectors", () => {
    interface Vectors {
      classifications: {
        written: string;
        concepts: string[];
        findings: string[];
      }[];
      reviewStatuses: { written: string; concept: string | null }[];
    }
    let vectors: Vectors;
    let result: Built;

    before(async () => {
      vectors = JSON.parse(
        await readFile(
          join(
            contract.vocabulary.folder,
            "tests",
            "vectors",
            "clinvar",
            "values.json",
          ),
          "utf8",
        ),
      ) as Vectors;
      const [header, template] = (await text(SUMMARY)) as [string, string];
      const columns = header.replace(/^#/, "").split("\t");
      const line = (id: number, set: Record<string, string>): string => {
        const cells = template.split("\t");
        cells[columns.indexOf("VariationID")] = String(id);
        cells[columns.indexOf("Assembly")] = "GRCh38";
        cells[columns.indexOf("GeneSymbol")] = "MLH1";
        for (const [name, value] of Object.entries(set))
          cells[columns.indexOf(name)] = value;
        return cells.join("\t");
      };
      const lines = [
        ...vectors.classifications.map((v, i) =>
          line(1000 + i, { ClinicalSignificance: v.written }),
        ),
        ...vectors.reviewStatuses.map((v, i) =>
          line(2000 + i, { ReviewStatus: v.written }),
        ),
      ];
      result = await built([header, ...lines], await text(SNAPSHOT));
    });

    it("maps each classification as written to its concepts", () => {
      for (const [i, v] of vectors.classifications.entries())
        assert.deepEqual(
          said(
            result.series,
            classifications,
            clinvar(String(1000 + i)),
            `${CASCADE}clinvarClassification`,
          ),
          [...v.concepts].sort(),
          v.written,
        );
    });

    it("reports each term it cannot map as a finding, once", () => {
      for (const v of vectors.classifications)
        for (const term of v.findings)
          assert.ok(
            result.findings.some((f) => f.includes(`"${term}"`)),
            `${v.written}: no finding names ${term}`,
          );
      assert.equal(
        result.findings.filter((f) => f.startsWith("classification ")).length,
        new Set(vectors.classifications.flatMap((v) => v.findings)).size,
      );
    });

    it("maps each review status to its concept, or to none", () => {
      for (const [i, v] of vectors.reviewStatuses.entries())
        assert.deepEqual(
          said(
            result.series,
            classifications,
            clinvar(String(2000 + i)),
            `${CASCADE}clinvarReviewStatus`,
          ),
          v.concept === null ? [] : [v.concept],
          v.written,
        );
    });
  });

  describe("given the fixture release", () => {
    let result: Built;

    before(async () => {
      result = await built(await text(SUMMARY), await text(SNAPSHOT));
    });

    it("gives variation 90011 both of its expressions and both of its classes", () => {
      assert.deepEqual(
        said(
          result.series,
          classifications,
          clinvar("90011"),
          `${CASCADE}hgvsExpression`,
        ),
        [
          "https://ns.cascadeprotocol.org/codes/hgvs/NM_000249.3%3Ac.2042C%3ET",
          "https://ns.cascadeprotocol.org/codes/hgvs/NM_000249.4%3Ac.2042C%3ET",
        ],
      );
      assert.deepEqual(
        said(
          result.series,
          classifications,
          clinvar("90011"),
          `${CASCADE}clinvarClassification`,
        ),
        [`${CASCADE}LikelyPathogenic`, `${CASCADE}Pathogenic`],
      );
    });

    it("gives each classified variation a name row", () => {
      assert.equal(
        result.series.get(names)!.rows.size,
        result.series.get(classifications)!.rows.size,
      );
    });

    it("gives no row to a variation only hgvs4variation has", () => {
      assert.equal(
        result.series.get(classifications)!.rows.has(clinvar("99001")),
        false,
      );
    });

    it("reports exactly five findings, one for each thing it left out", () => {
      assert.equal(result.findings.length, 5, result.findings.join("\n"));
      for (const expected of [
        /NM_000249\.3:c\.100A>G/,
        /NM_001300\.5:n\.123A>G/,
        /"made-up term" .* 1 variation holds/,
        /GRCh38 and GRCh37 lines that disagree.*: 90015/,
        /not in variant_summary\.txt\.gz.*: 90019/,
      ])
        assert.ok(
          result.findings.some((f) => expected.test(f)),
          `no finding matches ${expected}:\n${result.findings.join("\n")}`,
        );
    });

    it("keeps the row of a variation only the summary has, found by its name's expression", () => {
      assert.deepEqual(
        said(
          result.series,
          classifications,
          clinvar("90020"),
          `${CASCADE}hgvsExpression`,
        ),
        ["https://ns.cascadeprotocol.org/codes/hgvs/NM_000251.3%3Ac.2A%3EG"],
      );
    });

    it("gives the same rows and findings when the files' columns are in another order", async () => {
      const other = await built(
        reordered(await text(SUMMARY)),
        reordered(await text(SNAPSHOT)),
      );
      for (const [iri, rows] of result.series)
        assert.deepEqual(other.series.get(iri)!.byKey(), rows.byKey());
      assert.deepEqual(other.findings, result.findings);
    });
  });

  describe("given a summary without the `SCVs` column, as before 2023", () => {
    it("counts submitters, and writes no count of contributing ones", async () => {
      const { series } = await built(
        without(await text(SUMMARY), "SCVsForAggregateGermlineClassification"),
        await text(SNAPSHOT),
      );
      assert.deepEqual(
        said(
          series,
          classifications,
          clinvar("90011"),
          `${CASCADE}submitterCount`,
        ),
        ["5"],
      );
      assert.deepEqual(
        said(
          series,
          classifications,
          clinvar("90011"),
          `${CASCADE}contributingSubmitterCount`,
        ),
        [],
      );
    });
  });

  describe("given a file lacking a column the builder needs", () => {
    for (const [file, column] of [
      [SUMMARY, "ClinicalSignificance"],
      [SNAPSHOT, "Submitted"],
    ] as const)
      it(`refuses ${file} without ${column}, naming the file and the column`, async () => {
        assert.equal(
          await refusal(
            built(
              file === SUMMARY
                ? without(await text(SUMMARY), column)
                : await text(SUMMARY),
              file === SNAPSHOT
                ? without(await text(SNAPSHOT), column)
                : await text(SNAPSHOT),
            ),
          ),
          `${file} has no column ${column}`,
        );
      });
  });

  describe("given a version built from the fixture release", () => {
    let dir: string;
    let removeDir: () => Promise<void>;
    let feed: Feed;

    before(async () => {
      ({ folder: dir, remove: removeDir } = await releaseFolder());
      await build(contract, {
        source,
        build: await loadBuild(ROOT, FOLDER),
        release: RELEASE,
        label: "2026-10",
        feed: join(dir, "feed.ttl"),
        out: join(dir, "out"),
        now: "2026-10-12T00:00:00Z",
      });
      feed = await Feed.read(join(dir, "feed.ttl"));
    });
    after(() => removeDir());

    /** Rule H25 of `rules/versions.feature`. */
    it("states the genes the series covers", () => {
      assert.deepEqual(feed.coversOf(feed.current(classifications)!), [
        "EPCAM",
        "MLH1",
        "MSH2",
        "MSH6",
        "PMS2",
      ]);
    });

    it("cites the credit the source declares, ending with NCBI's caution", () => {
      const credit = feed.graph.value(
        classifications,
        `${DCT}bibliographicCitation`,
      );
      assert.equal(
        credit,
        source.series.find((s) => s.iri === classifications)!.credit,
      );
      assert.match(
        credit!,
        /not intended for direct diagnostic use or medical decision-making without review by a genetics professional\.$/,
      );
    });

    it("names both files as its inputs, the summary by its address in NCBI's archive", () => {
      const inputs = feed.inputsOf(classifications);
      assert.deepEqual([...inputs.keys()].sort(), [
        SNAPSHOT,
        "variant_summary_2026-10.txt.gz",
      ]);
      assert.equal(
        feed.graph.value(
          inputs.get("variant_summary_2026-10.txt.gz")!.name,
          `${DCT}source`,
        ),
        "https://ftp.ncbi.nlm.nih.gov/pub/clinvar/tab_delimited/archive/variant_summary_2026-10.txt.gz",
      );
    });

    /** Rule H23 of `rules/versions.feature`. */
    it("keeps only the file NCBI does not archive in the release", async () => {
      const { files } = JSON.parse(
        await readFile(join(dir, "out", "release.json"), "utf8"),
      ) as { files: string[] };
      assert.deepEqual(
        files
          .filter((f) => f.startsWith("inputs/"))
          .map((f) => f.replace(/^inputs\/[0-9a-f]{64}-/, "")),
        [SNAPSHOT],
      );
    });
  });
});
