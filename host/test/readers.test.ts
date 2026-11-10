import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { before, describe, it } from "node:test";
import { gzipSync } from "node:zlib";
import { texts } from "../src/archive.js";
// A builder reaches these as `release.file(name).csv()` and so on (`ReleaseFile` in ../src/builder.ts); a test calls them
// as the file of the release is named, by its path.
import {
  csv,
  delimited,
  fixedWidth,
  jsonLines,
  xlsx,
  xmlElements,
} from "../src/readers.js";
import { refusal, releaseFolder } from "./release-folder.js";

const BUILDERS = join(import.meta.dirname, "..", "..", "..", "builders");
const XLSX = join(
  BUILDERS,
  "cdc-icd-10-cm",
  "fixtures",
  "release",
  "ICD-10-CM-CONVERSION-TABLE-FY2027.xlsx",
);
const MEDRT_ZIP = join(
  BUILDERS,
  "va-med-rt",
  "fixtures",
  "release",
  "Core_MEDRT_XML.zip",
);

async function collect<T>(lines: AsyncIterable<T>): Promise<T[]> {
  const found: T[] = [];
  for await (const line of lines) found.push(line);
  return found;
}

/** Everything `reader` gives for a file holding `content`. */
async function readAll<T>(
  content: string | Buffer,
  reader: (path: string) => AsyncIterable<T>,
  name = "in.txt",
): Promise<T[]> {
  const { folder, remove } = await releaseFolder({ [name]: content });
  try {
    return await collect(reader(join(folder, name)));
  } finally {
    await remove();
  }
}

/**
 * A builder is handed its publisher's release and reads each file through one of these readers, a line, a row or an
 * element at a time. A file that cannot be read as asked throws a
 * Refusal naming it, and the build writes nothing.
 */
describe("Reading a release's files · csv(), delimited(), fixedWidth(), jsonLines(), xlsx(), xmlElements()", () => {
  describe("csv()", () => {
    const records = (text: string, required = ["x"]) =>
      readAll(
        text,
        async function* (path) {
          for await (const row of csv(path, "in.csv", required))
            yield { number: row.number, x: row.get("x"), y: row.get("y") };
        },
        "in.csv",
      );
    let found: Awaited<ReturnType<typeof records>>;

    before(async () => {
      found = await records(
        '\u{FEFF}x,y\r\n\r\n"a,b","line one\nline ""two"""\r\nend,\r\n',
      );
    });

    it("gives each record's fields by the header's names, with its line number", () => {
      assert.deepEqual(found[1], { number: 5, x: "end", y: "" });
    });

    it("reads a quoted field holding a comma, a line break and a doubled quote", () => {
      assert.deepEqual(found[0], {
        number: 4,
        x: "a,b",
        y: 'line one\nline "two"',
      });
    });

    it("ignores a byte order mark and an empty line", () => {
      assert.deepEqual(
        found.map((record) => record.x),
        ["a,b", "end"],
      );
    });

    it("refuses an empty file", async () => {
      assert.match(await refusal(records("")), /^in\.csv is empty$/);
    });

    it("refuses a quote never closed, naming the line", async () => {
      assert.match(
        await refusal(records('x,y\na,"never closed\n')),
        /^in\.csv line \d+: /,
      );
    });

    it("refuses a record with more fields than the header, naming the line", async () => {
      assert.match(await refusal(records("x,y\na,b,c\n")), /^in\.csv line 2: /);
    });

    it("refuses a file lacking a column the builder requires, naming the column", async () => {
      assert.match(
        await refusal(records("x,y\na,b\n", ["z"])),
        /^in\.csv has no column z$/,
      );
    });
  });

  describe("delimited()", () => {
    const text = "\u{FEFF}a|b\r\n\n".concat("c|d\n".repeat(3), "e|f");

    it("cuts each line at the separator asked, keeping a field's spaces and an empty last field", async () => {
      assert.deepEqual(
        await readAll("\uFEFF08 |Hep B|Active\r\n141|flu|\r\n", (path) =>
          delimited(path, "|"),
        ),
        [
          { number: 1, fields: ["08 ", "Hep B", "Active"] },
          { number: 2, fields: ["141", "flu", ""] },
        ],
      );
    });

    it("gives a line longer than one read of the file whole", async () => {
      const long = "x".repeat((1 << 20) + 10);
      assert.deepEqual(
        await readAll(`${long}\nshort\n`, (path) => delimited(path, "|")),
        [
          { number: 1, fields: [long] },
          { number: 2, fields: ["short"] },
        ],
      );
    });

    it("reads a gzip file line for line as its plain twin", async () => {
      const plain = await readAll(text, (path) => delimited(path, "|", false));
      assert.equal(plain.length, 5);
      assert.deepEqual(
        await readAll(
          gzipSync(text),
          (path) => delimited(path, "|", true),
          "zipped.txt.gz",
        ),
        plain,
      );
    });

    it("refuses a file that is not gzip when gzip is asked", async () => {
      assert.match(
        await refusal(readAll(text, (path) => delimited(path, "|", true))),
        /not a gzip file/,
      );
    });

    it("refuses a gzip file cut short, naming the file", async () => {
      assert.match(
        await refusal(
          readAll(
            gzipSync(text).subarray(0, 20),
            (path) => delimited(path, "|", true),
            "cut.txt.gz",
          ),
        ),
        /cut\.txt\.gz/,
      );
    });
  });

  describe("fixedWidth()", () => {
    it("cuts each line at the columns asked, numbering lines as the file does and giving no empty one", async () => {
      assert.deepEqual(
        await readAll("A0100Cholera\n\nA0110Typhoid\n", (path) =>
          fixedWidth(path, [
            [0, 5],
            [5, 12],
          ]),
        ),
        [
          { number: 1, fields: ["A0100", "Cholera"] },
          { number: 3, fields: ["A0110", "Typhoid"] },
        ],
      );
    });
  });

  describe("jsonLines()", () => {
    it("gives each line's JSON value with its line number", async () => {
      assert.deepEqual(await readAll('{"rxcui": "7980"}\n', jsonLines), [
        { number: 1, value: { rxcui: "7980" } },
      ]);
    });
  });

  describe("xlsx()", () => {
    it('gives each row of the first sheet, each cell as its text and an empty cell as ""', async () => {
      const rows = new Map<number, readonly string[]>();
      for await (const { number, fields } of xlsx(XLSX))
        rows.set(number, fields);
      assert.deepEqual(rows.get(2), [
        "Current code assignment",
        "Effective",
        "Previous Code(s) Assignment",
      ]);
      assert.deepEqual(rows.get(7), ["E66.813", "2024", "E66.01, E66.8"]);
      assert.deepEqual(rows.get(8), ["M97.01XA  ", "45017", "T84.040A"]);
      assert.deepEqual(rows.get(9), [
        "H02.151",
        "",
        "H02.101-H02.106; H02.109",
      ]);
    });

    it("refuses a workbook whose compressed entry is corrupt, naming the file", async () => {
      const bytes = await readFile(XLSX);
      const name = bytes.indexOf("xl/workbook.xml");
      const data = name + 15 + bytes.readUInt16LE(name - 2);
      bytes.fill(0xff, data, data + 10);
      assert.match(
        await refusal(readAll(bytes, xlsx, "corrupt.xlsx")),
        /corrupt\.xlsx/,
      );
    });
  });

  describe("xmlElements()", () => {
    let concepts: unknown[];

    before(async () => {
      concepts = await collect(xmlElements(MEDRT_ZIP, "concept"));
    });

    it("gives each element of the name asked with its attributes, text and children", () => {
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
    });

    it("reads a zip's one XML entry as it reads the plain file, and finds its 10 associations", async () => {
      const entry = [
        ...(await texts(MEDRT_ZIP, (n) => n.endsWith(".xml"))),
      ][0]!;
      assert.equal(concepts.length, 5);
      assert.deepEqual(
        await readAll(
          entry[1],
          (path) => xmlElements(path, "concept"),
          "plain.xml",
        ),
        concepts,
      );
      assert.equal(
        (await collect(xmlElements(MEDRT_ZIP, "association"))).length,
        10,
      );
    });

    it("refuses a file whose XML tags do not match", async () => {
      assert.match(
        await refusal(
          readAll(
            "<a><b>1</b><b>2</c></a>",
            (path) => xmlElements(path, "b"),
            "cut.xml",
          ),
        ),
        /not well-formed XML/,
      );
    });

    it("refuses a file named .zip that is no zip, naming the file", async () => {
      assert.match(
        await refusal(
          readAll("<a/>", (path) => xmlElements(path, "a"), "plain.zip"),
        ),
        /plain\.zip/,
      );
    });
  });
});
