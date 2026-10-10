import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { Refusal } from "../src/builder.js";
import { readContract } from "../src/pipeline.js";
import { parseTrig } from "../src/rdf.js";
import { releaseOf } from "../src/release.js";
import { keyed, SeriesRows, toRdf } from "../src/rows.js";
import { loadHistory } from "../src/source.js";

const ROOT = join(import.meta.dirname, "..", "..", "..");
const FOLDER = join(ROOT, "builders", "nlm-rxnorm-prescribable");
const STATUS = "urn:uuid:6828cb6b-4adc-460b-8f01-08d36ef2ae88";

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
