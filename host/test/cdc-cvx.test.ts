import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { Refusal } from "../src/builder.js";
import { readContract, rowsOf } from "../src/pipeline.js";
import { loadBuild, readSource } from "../src/source.js";

const ROOT = join(import.meta.dirname, "..", "..", "..");
const FOLDER = join(ROOT, "builders", "cdc-cvx");
const FLU =
  "88        |influenza, unspecified formulation|influenza virus vaccine, unspecified formulation||Inactive|False|2010/05/28";
const FLU_GROUP =
  "influenza, unspecified formulation|88        |Inactive|FLU|88";

test("CDC's files are refused, naming the line and why, when the builder cannot read them as CDC writes them", async () => {
  const contract = await readContract(ROOT);
  const source = await readSource(FOLDER);
  const build = await loadBuild(ROOT, FOLDER);
  const cases: [string, string, string][] = [
    [
      "88        |influenza|influenza virus vaccine||Withdrawn|False|2010/05/28",
      FLU_GROUP,
      'CVX.txt line 1 has the status "Withdrawn", which this builder does not map',
    ],
    [
      "88        |influenza|influenza virus vaccine|Inactive|False|2010/05/28",
      FLU_GROUP,
      "CVX.txt line 1 has 6 fields, not 7",
    ],
    [
      "          |influenza|influenza virus vaccine||Inactive|False|2010/05/28",
      FLU_GROUP,
      "CVX.txt line 1 has no CVX code",
    ],
    [
      FLU,
      "Influenza, split virus|141       |Active|FLU|88",
      "VG.txt line 1 names 141, which CVX.txt lacks",
    ],
    [FLU, "influenza|88|Inactive|FLU", "VG.txt line 1 has 4 fields, not 5"],
    [
      FLU,
      "influenza, unspecified formulation|88        |Inactive|FLU|   ",
      "VG.txt line 1 has no vaccine group CVX code",
    ],
  ];
  const release = await mkdtemp(join(tmpdir(), "cdc-cvx-"));
  try {
    for (const [cvx, vg, reason] of cases) {
      await writeFile(join(release, "CVX.txt"), `\uFEFF${cvx}\r\n`);
      await writeFile(join(release, "VG.txt"), `${vg}\r\n`);
      await assert.rejects(
        rowsOf(contract, source, build, release),
        (error) => error instanceof Refusal && error.message === reason,
        reason,
      );
    }
  } finally {
    await rm(release, { recursive: true, force: true });
  }
});
