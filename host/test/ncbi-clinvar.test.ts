import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { before, test } from "node:test";
import { gunzipSync, gzipSync } from "node:zlib";
import { Refusal } from "../src/builder.js";
import { build, readContract, rowsOf } from "../src/pipeline.js";
import type { Contract } from "../src/pipeline.js";
import { DCT, REC } from "../src/rdf.js";
import { Feed } from "../src/feed.js";
import type { SeriesRows } from "../src/rows.js";
import { loadBuild, readSource, type Source } from "../src/source.js";

const ROOT = join(import.meta.dirname, "..", "..", "..");
const FOLDER = join(ROOT, "builders", "ncbi-clinvar");
const RELEASE = join(FOLDER, "fixtures", "release");
const GENOMICS = "https://ns.cascadeprotocol.org/genomics/v1#";
const SUMMARY = "variant_summary.txt.gz";
const SNAPSHOT = "hgvs4variation.txt.gz";

let contract: Contract;
let source: Source;
let classifications: string;
let names: string;

before(async () => {
  contract = await readContract(ROOT);
  source = await readSource(FOLDER);
  classifications = source.series.find(
    (s) => s.kind === `${REC}VariantClassifications`,
  )!.iri;
  names = source.series.find((s) => s.kind === `${REC}CodeNames`)!.iri;
});

const text = async (file: string): Promise<string[]> =>
  gunzipSync(await readFile(join(RELEASE, file)))
    .toString("utf8")
    .split("\n")
    .filter((line) => line !== "");

/** A release folder holding the two files with these lines, run through the builder. */
async function built(
  summary: readonly string[],
  snapshot: readonly string[],
): Promise<{ series: Map<string, SeriesRows>; findings: string[] }> {
  const dir = await mkdtemp(join(tmpdir(), "clinvar-"));
  try {
    await writeFile(join(dir, SUMMARY), gzipSync(`${summary.join("\n")}\n`));
    await writeFile(join(dir, SNAPSHOT), gzipSync(`${snapshot.join("\n")}\n`));
    const findings: string[] = [];
    const series = await rowsOf(
      contract,
      source,
      await loadBuild(ROOT, FOLDER),
      dir,
      findings,
    );
    return { series, findings };
  } finally {
    await rm(dir, { recursive: true, force: true });
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

const clinvar = (id: string): string =>
  `http://www.ncbi.nlm.nih.gov/clinvar/${id}`;

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

test("every value of the vocabulary's tests/vectors/clinvar/values.json parses to its concepts, and what it cannot map is a finding", async () => {
  const vectors = JSON.parse(
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
  ) as {
    classifications: {
      written: string;
      concepts: string[];
      findings: string[];
    }[];
    reviewStatuses: { written: string; concept: string | null }[];
  };
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
  const { series, findings } = await built(
    [header, ...lines],
    await text(SNAPSHOT),
  );
  for (const [i, v] of vectors.classifications.entries()) {
    assert.deepEqual(
      said(
        series,
        classifications,
        clinvar(String(1000 + i)),
        `${REC}clinvarClassification`,
      ),
      [...v.concepts].sort(),
      v.written,
    );
    for (const term of v.findings)
      assert.ok(
        findings.some((f) => f.includes(`"${term}"`)),
        `${v.written}: no finding names ${term}`,
      );
  }
  assert.equal(
    findings.filter((f) => f.startsWith("classification ")).length,
    new Set(vectors.classifications.flatMap((v) => v.findings)).size,
  );
  for (const [i, v] of vectors.reviewStatuses.entries())
    assert.deepEqual(
      said(
        series,
        classifications,
        clinvar(String(2000 + i)),
        `${REC}clinvarReviewStatus`,
      ),
      v.concept === null ? [] : [v.concept],
      v.written,
    );
});

test("the fixture release gives 90011's row both of its expressions, and each thing the builder leaves out is a finding", async () => {
  const { series, findings } = await built(
    await text(SUMMARY),
    await text(SNAPSHOT),
  );
  assert.deepEqual(
    said(series, classifications, clinvar("90011"), `${REC}hgvsExpression`),
    [
      "http://varnomen.hgvs.org/NM_000249.3%3Ac.2042C%3ET",
      "http://varnomen.hgvs.org/NM_000249.4%3Ac.2042C%3ET",
    ],
  );
  assert.deepEqual(
    said(
      series,
      classifications,
      clinvar("90011"),
      `${REC}clinvarClassification`,
    ),
    [`${GENOMICS}LikelyPathogenic`, `${GENOMICS}Pathogenic`],
  );
  assert.equal(
    series.get(names)!.rows.size,
    series.get(classifications)!.rows.size,
  );
  assert.equal(series.get(classifications)!.rows.has(clinvar("99001")), false);
  assert.equal(findings.length, 5, findings.join("\n"));
  for (const expected of [
    /NM_000249\.3:c\.100A>G/,
    /NM_001300\.5:n\.123A>G/,
    /"made-up term" .* 1 variation holds/,
    /GRCh38 and GRCh37 lines that disagree.*: 90015/,
    /not in variant_summary\.txt\.gz.*: 90019/,
  ])
    assert.ok(
      findings.some((f) => expected.test(f)),
      `no finding matches ${expected}:\n${findings.join("\n")}`,
    );
});

test("a variation only the summary has keeps its row, found by its name's expression", async () => {
  const { series } = await built(await text(SUMMARY), await text(SNAPSHOT));
  assert.deepEqual(
    said(series, classifications, clinvar("90020"), `${REC}hgvsExpression`),
    ["http://varnomen.hgvs.org/NM_000251.3%3Ac.2A%3EG"],
  );
});

test("the files with their columns in another order give the same rows", async () => {
  const plain = await built(await text(SUMMARY), await text(SNAPSHOT));
  const other = await built(
    reordered(await text(SUMMARY)),
    reordered(await text(SNAPSHOT)),
  );
  for (const [iri, rows] of plain.series)
    assert.deepEqual(other.series.get(iri)!.byKey(), rows.byKey());
  assert.deepEqual(other.findings, plain.findings);
});

test("a summary without the SCVs column, as before 2023, counts submitters, not contributing ones", async () => {
  const { series } = await built(
    without(await text(SUMMARY), "SCVsForAggregateGermlineClassification"),
    await text(SNAPSHOT),
  );
  assert.deepEqual(
    said(series, classifications, clinvar("90011"), `${REC}submitters`),
    ["5"],
  );
  assert.deepEqual(
    said(
      series,
      classifications,
      clinvar("90011"),
      `${REC}contributingSubmitters`,
    ),
    [],
  );
});

test("a column the builder needs that a file lacks is refused, naming it", async () => {
  for (const [file, column] of [
    [SUMMARY, "ClinicalSignificance"],
    [SNAPSHOT, "Submitted"],
  ] as const)
    await assert.rejects(
      built(
        file === SUMMARY
          ? without(await text(SUMMARY), column)
          : await text(SUMMARY),
        file === SNAPSHOT
          ? without(await text(SNAPSHOT), column)
          : await text(SNAPSHOT),
      ),
      (error) =>
        error instanceof Refusal &&
        error.message === `${file} has no column ${column}`,
      `${file} without ${column}`,
    );
});

test("a version states the genes it covers, cites the credit NCBI asks for, names both files and keeps the one NCBI does not", async () => {
  const dir = await mkdtemp(join(tmpdir(), "clinvar-"));
  try {
    await build(contract, {
      source,
      build: await loadBuild(ROOT, FOLDER),
      release: RELEASE,
      label: "2026-10",
      feed: join(dir, "feed.ttl"),
      out: join(dir, "out"),
      now: "2026-10-12T00:00:00Z",
    });
    const feed = await Feed.read(join(dir, "feed.ttl"));
    const series = source.series.find((s) => s.iri === classifications)!;
    const version = feed.current(classifications)!;
    assert.deepEqual(feed.coversOf(version), [
      "EPCAM",
      "MLH1",
      "MSH2",
      "MSH6",
      "PMS2",
    ]);
    const credit = feed.graph.value(
      classifications,
      `${DCT}bibliographicCitation`,
    );
    assert.equal(credit, series.credit);
    assert.match(
      credit!,
      /not intended for direct diagnostic use or medical decision-making without review by a genetics professional\.$/,
    );
    assert.deepEqual([...feed.inputsOf(classifications).keys()].sort(), [
      SNAPSHOT,
      "variant_summary_2026-10.txt.gz",
    ]);
    assert.equal(
      feed.graph.value(
        feed.inputsOf(classifications).get("variant_summary_2026-10.txt.gz")!
          .name,
        `${DCT}source`,
      ),
      "https://ftp.ncbi.nlm.nih.gov/pub/clinvar/tab_delimited/archive/variant_summary_2026-10.txt.gz",
    );
    const { files } = JSON.parse(
      await readFile(join(dir, "out", "release.json"), "utf8"),
    ) as { files: string[] };
    assert.deepEqual(
      files
        .filter((f) => f.startsWith("inputs/"))
        .map((f) => f.replace(/^inputs\/[0-9a-f]{64}-/, "")),
      [SNAPSHOT],
    );
    const differences = await readFile(
      join(dir, "out", "differences.md"),
      "utf8",
    );
    assert.match(differences, /## Findings\n\n- /);
    assert.match(
      differences,
      /`90011`: Likely pathogenic, Pathogenic \(criteria provided, multiple submitters, no conflicts\), 2024-12-11, 2 expressions/,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
