import assert from "node:assert/strict";
import { join } from "node:path";
import { before, describe, it } from "node:test";
import type { Build } from "../src/builder.js";
import { builtRows, type Contract, readContract } from "../src/pipeline.js";
import { loadBuild, readSource, type Source } from "../src/source.js";
import { refusal, releaseFolder } from "./release-folder.js";

const ROOT = join(import.meta.dirname, "..", "..", "..");
const FOLDER = join(ROOT, "builders", "cdc-cvx");
const FLU =
  "88        |influenza, unspecified formulation|influenza virus vaccine, unspecified formulation||Inactive|False|2010/05/28";
const FLU_GROUP =
  "influenza, unspecified formulation|88        |Inactive|FLU|88";

const refused: [what: string, cvx: string, vg: string, reason: string][] = [
  [
    "a status it does not map",
    "88        |influenza|influenza virus vaccine||Withdrawn|False|2010/05/28",
    FLU_GROUP,
    'CVX.txt line 1 has the status "Withdrawn", which this builder does not map',
  ],
  [
    "a CVX.txt line with 6 fields",
    "88        |influenza|influenza virus vaccine|Inactive|False|2010/05/28",
    FLU_GROUP,
    "CVX.txt line 1 has 6 fields, not 7",
  ],
  [
    "a CVX.txt line with no code",
    "          |influenza|influenza virus vaccine||Inactive|False|2010/05/28",
    FLU_GROUP,
    "CVX.txt line 1 has no CVX code",
  ],
  [
    "a VG.txt line naming a code CVX.txt lacks",
    FLU,
    "Influenza, split virus|141       |Active|FLU|88",
    "VG.txt line 1 names 141, which CVX.txt lacks",
  ],
  [
    "a VG.txt line with 4 fields",
    FLU,
    "influenza|88|Inactive|FLU",
    "VG.txt line 1 has 4 fields, not 5",
  ],
  [
    "a VG.txt line with no vaccine group code",
    FLU,
    "influenza, unspecified formulation|88        |Inactive|FLU|   ",
    "VG.txt line 1 has no vaccine group CVX code",
  ],
];

/**
 * The builder reads CDC's `CVX.txt` (vaccine codes) and `VG.txt` (the vaccine groups they belong to). A line it cannot
 * read as CDC writes them refuses the build, naming the file, the line and why.
 */
describe("Vaccine codes and groups from CDC's CVX files · builders/cdc-cvx", () => {
  describe("given a line CDC would not write", () => {
    let contract: Contract;
    let source: Source;
    let build: Build;

    before(async () => {
      contract = await readContract(ROOT);
      source = await readSource(FOLDER);
      build = await loadBuild(ROOT, FOLDER);
    });

    for (const [what, cvx, vg, reason] of refused)
      it(`refuses ${what}`, async () => {
        const { folder, remove } = await releaseFolder({
          "CVX.txt": `\u{FEFF}${cvx}\r\n`,
          "VG.txt": `${vg}\r\n`,
        });
        try {
          assert.equal(
            await refusal(builtRows(contract, source, build, folder)),
            reason,
          );
        } finally {
          await remove();
        }
      });
  });
});
