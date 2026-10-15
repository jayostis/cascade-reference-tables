import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { gzipSync } from "node:zlib";
import { Refusal } from "../src/builder.js";
import { texts } from "../src/archive.js";
import {
  delimited,
  fixedWidth,
  jsonLines,
  xlsx,
  xmlElements,
} from "../src/readers.js";

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

test("a gzip file is read line for line as its plain twin is, and a file that is not gzip is refused", async () => {
  const dir = await mkdtemp(join(tmpdir(), "readers-"));
  try {
    const text = "﻿a|b\r\n\n".concat("c|d\n".repeat(50000), "e|f");
    await writeFile(join(dir, "plain.txt"), text);
    await writeFile(join(dir, "zipped.txt.gz"), gzipSync(text));
    const read = async (path: string, gzip: boolean) => {
      const found: unknown[] = [];
      for await (const line of delimited(path, "|", gzip)) found.push(line);
      return found;
    };
    const plain = await read(join(dir, "plain.txt"), false);
    assert.equal(plain.length, 50002);
    assert.deepEqual(await read(join(dir, "zipped.txt.gz"), true), plain);
    await assert.rejects(
      read(join(dir, "plain.txt"), true),
      (error) =>
        error instanceof Refusal && /not a gzip file/.test(error.message),
    );
    await writeFile(join(dir, "cut.txt.gz"), gzipSync(text).subarray(0, 40));
    await assert.rejects(read(join(dir, "cut.txt.gz"), true), Refusal);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

const XLSX = join(
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

test("an xlsx's first sheet is read row by row, each cell as its text, an empty one as nothing", async () => {
  const rows = new Map<number, readonly string[]>();
  for await (const { number, fields } of xlsx(XLSX)) rows.set(number, fields);
  assert.deepEqual(rows.get(2), [
    "Current code assignment",
    "Effective",
    "Previous Code(s) Assignment",
  ]);
  assert.deepEqual(rows.get(7), ["E66.813", "2024", "E66.01, E66.8"]);
  assert.deepEqual(rows.get(8), ["M97.01XA  ", "45017", "T84.040A"]);
  assert.deepEqual(rows.get(9), ["H02.151", "", "H02.101-H02.106; H02.109"]);
});

test("an xlsx whose entry does not inflate is refused", async () => {
  const dir = await mkdtemp(join(tmpdir(), "readers-"));
  try {
    const bytes = await readFile(XLSX);
    const name = bytes.indexOf("xl/workbook.xml");
    const data = name + 15 + bytes.readUInt16LE(name - 2);
    bytes.fill(0xff, data, data + 10);
    const path = join(dir, "corrupt.xlsx");
    await writeFile(path, bytes);
    await assert.rejects(xlsx(path)[Symbol.asyncIterator]().next(), Refusal);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

const MEDRT_ZIP = join(
  import.meta.dirname,
  "..",
  "..",
  "..",
  "builders",
  "va-med-rt",
  "fixtures",
  "release",
  "Core_MEDRT_XML.zip",
);

test("an XML file's elements are read one at a time with their children, in a zip's one XML entry as in a plain file, and a file that is not well-formed is refused", async () => {
  const dir = await mkdtemp(join(tmpdir(), "readers-"));
  const read = async (path: string, element: string) => {
    const found: unknown[] = [];
    for await (const e of xmlElements(path, element)) found.push(e);
    return found;
  };
  try {
    const entry = [...(await texts(MEDRT_ZIP, (n) => n.endsWith(".xml")))][0]!;
    await writeFile(join(dir, "plain.xml"), entry[1]);
    const concepts = await read(MEDRT_ZIP, "concept");
    assert.equal(concepts.length, 5);
    assert.deepEqual(concepts, await read(join(dir, "plain.xml"), "concept"));
    assert.deepEqual(concepts[3], {
      name: "concept",
      attributes: {},
      text: "",
      children: [
        { name: "namespace", attributes: {}, text: "MED-RT", children: [] },
        {
          name: "name",
          attributes: {},
          text: "Allergenic Extracts & Pollen [EXT]",
          children: [],
        },
        { name: "code", attributes: {}, text: "N0000007001", children: [] },
        { name: "status", attributes: {}, text: "A", children: [] },
      ],
    });
    assert.equal((await read(MEDRT_ZIP, "association")).length, 10);

    await writeFile(join(dir, "cut.xml"), "<a><b>1</b><b>2</c></a>");
    await assert.rejects(
      read(join(dir, "cut.xml"), "b"),
      (error) =>
        error instanceof Refusal && /not well-formed XML/.test(error.message),
    );
    await writeFile(join(dir, "plain.zip"), "<a/>");
    await assert.rejects(read(join(dir, "plain.zip"), "a"), Refusal);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
