import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { type Build, Refusal } from "../src/builder.js";
import { carry } from "../src/carry.js";
import type { Fetch } from "../src/detection.js";
import { readContract, rowsOf } from "../src/pipeline.js";
import { parseTrig } from "../src/rdf.js";
import { releaseOf } from "../src/release.js";
import { keyed, SeriesRows, toRdf } from "../src/rows.js";
import { loadHistory, readSource } from "../src/source.js";

const ROOT = join(import.meta.dirname, "..", "..", "..");
const FOLDER = join(ROOT, "builders", "nlm-rxnorm-prescribable");
const STATUS = "urn:uuid:6828cb6b-4adc-460b-8f01-08d36ef2ae88";
const PRODUCTS = "urn:uuid:61ca1c5b-722e-4baa-88a8-1e4e4a8afe12";
const RXNORM = "http://www.nlm.nih.gov/research/umls/rxnorm/";

async function statusRows(history: string): Promise<SeriesRows> {
  const contract = await readContract(ROOT);
  const build = (await loadHistory(ROOT, FOLDER))!;
  const dir = await mkdtemp(join(tmpdir(), "rxnorm-history-"));
  try {
    await writeFile(join(dir, "history.jsonl"), history);
    const rows = new SeriesRows(STATUS);
    for await (const yielded of build(
      releaseOf(
        contract.vocabulary,
        "the history",
        new Set(["history.jsonl"]),
        dir,
      ),
    ))
      rows.add(toRdf(contract.schema.check(yielded)));
    return rows;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("RxNav's answers give a status row for each retired code, and none for a code still active", async () => {
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

test("a history answer the builder does not map is refused, naming the line and why", async () => {
  const cases: [string, string][] = [
    [
      '{"code":"1","answer":{"rxcuiStatusHistory":{"metaData":{"status":"UNKNOWN"}}}}',
      'history.jsonl line 1 gives 1 the status "UNKNOWN", which this builder does not map',
    ],
    [
      '{"code":"1","answer":{"rxcuiStatusHistory":{}}}',
      'history.jsonl line 1 gives 1 the status "none", which this builder does not map',
    ],
  ];
  for (const [history, reason] of cases)
    await assert.rejects(
      statusRows(`${history}\n`),
      (error) => error instanceof Refusal && error.message === reason,
      reason,
    );
});

test("a drug products row for a code that is no product is refused with the shape's message", async () => {
  const contract = await readContract(ROOT);
  const source = await readSource(FOLDER);
  const notProduct: Build = async function* () {
    yield { series: PRODUCTS, subject: `${RXNORM}21`, termType: "IN" };
  };
  await assert.rejects(
    rowsOf(contract, source, notProduct, join(FOLDER, "fixtures", "release")),
    (error) =>
      error instanceof Refusal &&
      error.message.includes(
        "A drug product's term type is one of SCD, SBD, GPCK or BPCK.",
      ),
  );
});

test("a product that leaves the release is carried as a term type row", async () => {
  const contract = await readContract(ROOT);
  const source = await readSource(FOLDER);
  const current = parseTrig(
    await readFile(join(FOLDER, "fixtures", "expected", "rows.trig"), "utf8"),
  ).filter((q) => q.graph.value === PRODUCTS);
  const stays = new SeriesRows(PRODUCTS);
  for (const [code, termType] of [
    ["13", "SBD"],
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
  const carried = await carry({
    contract,
    source,
    built: new Map([[PRODUCTS, stays]]),
    current: async (series) => (series === PRODUCTS ? current : []),
    history: (await loadHistory(ROOT, FOLDER))!,
    fetch: active,
  });
  assert.deepEqual(
    carried.rows.get(PRODUCTS)?.map(({ form, key }) => [form, key]),
    [["termType", `${RXNORM}11`]],
  );
});
