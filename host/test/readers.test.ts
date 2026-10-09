import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { delimited, fixedWidth, jsonLines, xlsx } from "../src/readers.js";

test("a release file is read line by line, as each reader cuts it", async () => {
  const dir = await mkdtemp(join(tmpdir(), "readers-"));
  const cases: [string, (path: string) => AsyncIterable<unknown>, unknown[]][] =
    [
      [
        "\uFEFF08 |Hep B|Active\r\n141|flu|\r\n",
        (path) => delimited(path, "|"),
        [
          { number: 1, fields: ["08 ", "Hep B", "Active"] },
          { number: 2, fields: ["141", "flu", ""] },
        ],
      ],
      [
        "A0100Cholera\n\nA0110Typhoid\n",
        (path) =>
          fixedWidth(path, [
            [0, 5],
            [5, 12],
          ]),
        [
          { number: 1, fields: ["A0100", "Cholera"] },
          { number: 3, fields: ["A0110", "Typhoid"] },
        ],
      ],
      [
        '{"rxcui": "7980"}\n',
        jsonLines,
        [{ number: 1, value: { rxcui: "7980" } }],
      ],
    ];
  try {
    for (const [index, [text, reader, expected]] of cases.entries()) {
      const path = join(dir, `${index}.txt`);
      await writeFile(path, text);
      const found: unknown[] = [];
      for await (const line of reader(path)) found.push(line);
      assert.deepEqual(found, expected, JSON.stringify(text));
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("an xlsx's first sheet is read row by row, each cell as its text, an empty one as nothing", async () => {
  const path = join(
    import.meta.dirname,
    "..",
    "..",
    "..",
    "builders",
    "cdc-icd-10-cm",
    "fixtures",
    "release",
    "ICD-10-CM-CONVERSION-TABLE-FY2027.xlsx",
  );
  const rows = new Map<number, readonly string[]>();
  for await (const { number, fields } of xlsx(path)) rows.set(number, fields);
  assert.deepEqual(rows.get(2), [
    "Current code assignment",
    "Effective",
    "Previous Code(s) Assignment",
  ]);
  assert.deepEqual(rows.get(7), ["E66.813", "2024", "E66.01, E66.8"]);
  assert.deepEqual(rows.get(8), ["M97.01XA  ", "45017", "T84.040A"]);
  assert.deepEqual(rows.get(9), ["H02.151", "", "H02.101-H02.106; H02.109"]);
});
