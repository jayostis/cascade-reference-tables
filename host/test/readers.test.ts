import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { delimited, fixedWidth, jsonLines } from "../src/readers.js";

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
