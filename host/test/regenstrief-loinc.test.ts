import assert from "node:assert/strict";
import { cp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { before, describe, it } from "node:test";
import { builtRows, type Contract, readContract } from "../src/pipeline.js";
import { csv } from "../src/readers.js";
import { CASCADE, OWL, parseTurtle, SKOS } from "../src/rdf.js";
import { keyed, type SeriesRows, toRdf } from "../src/rows.js";
import { loadBuild, readSource } from "../src/source.js";
import { refusal, releaseFolder } from "./release-folder.js";

const ROOT = join(import.meta.dirname, "..", "..", "..");
const FOLDER = join(ROOT, "builders", "regenstrief-loinc");
const FIXTURE = join(FOLDER, "fixtures", "release");

const NAMES = "urn:uuid:b6ba7e56-1361-4d73-abef-42efe31e6943";
const STATUS = "urn:uuid:8caff025-8214-4910-81d7-16dfac334dae";
const MEMBERS = "urn:uuid:bc968e29-9f45-4160-b910-a70a06bbca9c";
const DCT = "http://purl.org/dc/terms/";
const TERMS = "LoincTable/Loinc.csv";
const MAP_TO = "LoincTable/MapTo.csv";
const PANELS = "AccessoryFiles/PanelsAndForms/PanelsAndForms.csv";
const CODE_STEM = "http://loinc.org/rdf/";
const HAS_MEMBER = "http://purl.obolibrary.org/obo/RO_0002351";
const CURATED = "https://w3id.org/semapv/vocab/ManualMappingCuration";

let contract: Contract;

type Edits = Partial<Record<string, (text: string) => string>>;

/** The text with the one place `from` is replaced; an edit that finds no such place, or several, fails loudly. */
function swap(text: string, from: string, to: string): string {
  const parts = text.split(from);
  assert.equal(parts.length, 2, `${from} is not in the text exactly once`);
  return parts.join(to);
}

/** The number of the line holding the text, counted from 1. */
function lineOf(text: string, needle: string): number {
  return text.slice(0, text.indexOf(needle)).split("\n").length;
}

/** The rows of the fixture release with the files edited as given. */
async function built(edits: Edits): Promise<Map<string, SeriesRows>> {
  const { folder, remove } = await releaseFolder();
  try {
    await cp(FIXTURE, folder, { recursive: true });
    for (const [file, edit] of Object.entries(edits)) {
      const path = join(folder, file);
      await writeFile(path, edit!(await readFile(path, "utf8")));
    }
    return await builtRows(
      contract,
      await readSource(FOLDER),
      await loadBuild(ROOT, FOLDER),
      folder,
    );
  } finally {
    await remove();
  }
}

function codeOf(iri: string): string {
  return iri.slice(CODE_STEM.length);
}

function namedCodes(rows: Map<string, SeriesRows>): Set<string> {
  return new Set([...rows.get(NAMES)!.rows.keys()].map(codeOf));
}

interface Member {
  readonly panel: string;
  readonly member: string;
  readonly sequence: number;
  readonly required?: string;
}

function membersOf(rows: Map<string, SeriesRows>): Member[] {
  const byRow = new Map<string, Record<string, string>>();
  for (const q of rows.get(MEMBERS)!.triples()) {
    const row = byRow.get(q.subject.value) ?? {};
    byRow.set(q.subject.value, row);
    row[q.predicate.value] = q.object.value;
  }
  return [...byRow.values()]
    .map((row) => ({
      panel: codeOf(row[`${OWL}annotatedSource`]!),
      member: codeOf(row[`${OWL}annotatedTarget`]!),
      sequence: Number(row[`${CASCADE}panelSequence`]),
      ...(row[`${CASCADE}observationRequiredInPanel`] === undefined
        ? {}
        : { required: row[`${CASCADE}observationRequiredInPanel`]! }),
    }))
    .sort(
      (a, b) =>
        a.panel.localeCompare(b.panel) ||
        a.sequence - b.sequence ||
        a.member.localeCompare(b.member),
    );
}

/** The label of each named code. */
function labelsOf(rows: Map<string, SeriesRows>): Map<string, string> {
  return new Map(
    rows
      .get(NAMES)!
      .triples()
      .filter((q) => q.predicate.value === `${SKOS}prefLabel`)
      .map((q) => [codeOf(q.subject.value), q.object.value]),
  );
}

/** The given columns of each record of a release file. */
async function recordsOf(
  file: string,
  columns: readonly string[],
): Promise<Record<string, string>[]> {
  const records: Record<string, string>[] = [];
  for await (const row of csv(join(FIXTURE, file), file, columns))
    records.push(Object.fromEntries(columns.map((c) => [c, row.get(c)])));
  return records;
}

/** What differs between what the builder wrote and the release's own fields. */
async function editedFields(
  labels: ReadonlyMap<string, string>,
  members: readonly Member[],
): Promise<string[]> {
  const edited: string[] = [];
  const names = new Map(
    (await recordsOf(TERMS, ["LOINC_NUM", "LONG_COMMON_NAME"])).map((r) => [
      r.LOINC_NUM!,
      r.LONG_COMMON_NAME!,
    ]),
  );
  for (const [code, label] of labels)
    if (names.get(code) !== label)
      edited.push(`${code}: "${label}" is not "${names.get(code)}"`);
  const listed = new Set(
    (
      await recordsOf(PANELS, [
        "ParentLoinc",
        "Loinc",
        "SEQUENCE",
        "ObservationRequiredInPanel",
      ])
    ).map((r) =>
      [r.ParentLoinc, r.Loinc, r.SEQUENCE, r.ObservationRequiredInPanel].join(
        "|",
      ),
    ),
  );
  for (const m of members)
    if (
      !listed.has([m.panel, m.member, m.sequence, m.required ?? ""].join("|"))
    )
      edited.push(
        `${m.panel} has the member ${m.member} at ${m.sequence} as ${m.required ?? "unstated"}, which the release does not list`,
      );
  return edited;
}

const refused: [
  what: string,
  file: string,
  from: string,
  to: string,
  reason: (text: string) => string,
][] = [
  [
    "a panel member that is a part, not a LOINC code",
    PANELS,
    '"2160-0","R"',
    '"LP7819-8","R"',
    (text) =>
      `${PANELS} line ${lineOf(text, "LP7819-8")} has "LP7819-8", which is no LOINC code`,
  ],
  [
    "a code of the names that is an answer list, not a LOINC code",
    TERMS,
    '"100854-9","1","TRIAL"',
    '"LL1001-8","1","TRIAL"',
    (text) =>
      `${TERMS} line ${lineOf(text, "LL1001-8")} has "LL1001-8", which is no LOINC code`,
  ],
  [
    "a replacement that is an answer, not a LOINC code",
    MAP_TO,
    '"1009-0","1007-4"',
    '"1009-0","LA6576-8"',
    (text) =>
      `${MAP_TO} line ${lineOf(text, "LA6576-8")} has "LA6576-8", which is no LOINC code`,
  ],
  [
    "a panel member the names do not carry",
    PANELS,
    '"2160-0","R"',
    '"9999-9","R"',
    () => `${PANELS} gives 24320-4 the member 9999-9, which ${TERMS} lacks`,
  ],
  [
    "a panel the names do not carry",
    PANELS,
    '"10322","24320-4","10325"',
    '"10322","9999-9","10325"',
    (text) =>
      `${PANELS} line ${lineOf(text, "9999-9")} is of the panel 9999-9, which ${TERMS} lacks`,
  ],
  [
    "a code with no display name",
    TERMS,
    '"Respiratory rate"',
    '""',
    (text) =>
      `${TERMS} line ${lineOf(text, '"9279-1"')} gives 9279-1 no LONG_COMMON_NAME`,
  ],
  [
    "a status the builder does not map",
    TERMS,
    '"2","ACTIVE","","Respiratory rate"',
    '"2","SUPERSEDED","","Respiratory rate"',
    (text) =>
      `${TERMS} line ${lineOf(text, "SUPERSEDED")} has the status "SUPERSEDED", which this builder does not map`,
  ],
  [
    "a code given twice",
    TERMS,
    '"2160-0","1","ACTIVE","","Creatinine [Mass/volume] in Serum or Plasma"\n',
    '"2160-0","1","ACTIVE","","Creatinine [Mass/volume] in Serum or Plasma"\n"2160-0","1","ACTIVE","","Creatinine"\n',
    (text) => `${TERMS} line ${lineOf(text, '"Creatinine"\n')} repeats 2160-0`,
  ],
  [
    "a column the builder reads gone",
    TERMS,
    '"LONG_COMMON_NAME"',
    '"LONG_NAME"',
    () => `${TERMS} has no column LONG_COMMON_NAME`,
  ],
  [
    "a record of another width",
    TERMS,
    '"Respiratory rate"',
    '"Respiratory rate","x"',
    (text) =>
      `${TERMS} line ${lineOf(text, '"x"')}: Invalid Record Length: columns length is 5, got 6 on line ${lineOf(text, '"x"')}`,
  ],
  [
    "a replacement the names lack",
    MAP_TO,
    '"1009-0","1007-4"',
    '"1009-0","9999-9"',
    (text) =>
      `${MAP_TO} line ${lineOf(text, "9999-9")} replaces 1009-0 with 9999-9, which ${TERMS} lacks`,
  ],
  [
    "a sequence that is no integer",
    PANELS,
    '"10325","3"',
    '"10325","three"',
    (text) =>
      `${PANELS} line ${lineOf(text, "three")} has the SEQUENCE "three", which is no integer`,
  ],
  [
    "a ParentId that is no number",
    PANELS,
    '"10322","24320-4","10325"',
    '"x","24320-4","10325"',
    (text) =>
      `${PANELS} line ${lineOf(text, '"x"')} has the ParentId "x", which is no number`,
  ],
];

/** A change of one place in a release file, and what it should leave out of the rows. */
const noticed: [
  what: string,
  file: string,
  from: string,
  to: string,
  panels: string[],
  codes: string[],
][] = [
  [
    "a notice on a row of the panel",
    PANELS,
    '"10326","1","2345-7","R","",""',
    '"10326","1","2345-7","R","(c) a third party",""',
    ["24320-4"],
    [],
  ],
  [
    "an additional copyright on a row of the panel",
    PANELS,
    '"10325","3","2160-0","R","",""',
    '"10325","3","2160-0","R","","(c) a third party"',
    ["24320-4"],
    [],
  ],
  [
    "a notice on a member",
    TERMS,
    '"2345-7","1","ACTIVE",""',
    '"2345-7","1","ACTIVE","(c) a third party"',
    ["24320-4"],
    ["2345-7"],
  ],
  [
    "a notice on the panel itself",
    TERMS,
    '"24320-4","1","ACTIVE",""',
    '"24320-4","1","ACTIVE","(c) a third party"',
    ["24320-4"],
    ["24320-4"],
  ],
];

const header =
  '"ParentId","ParentLoinc","ID","SEQUENCE","Loinc","ObservationRequiredInPanel","EXTERNAL_COPYRIGHT_NOTICE","AdditionalCopyright"\n';
const panels = (rows: string[]): Edits => ({
  [PANELS]: () =>
    header +
    rows
      .map((row) =>
        row
          .split(",")
          .map((field) => `"${field}"`)
          .concat('"",""')
          .join(","),
      )
      .join("\n") +
    "\n",
});

const copies: [what: string, rows: string[], expected: Member[]][] = [
  [
    "reads its own copy, not a nested one with a lower ParentId, and not the panel as its own member",
    [
      "5,24320-4,9,1,2160-0,R",
      "10,24320-4,10,360,24320-4,",
      "10,24320-4,11,2,2345-7,",
    ],
    [{ panel: "24320-4", member: "2345-7", sequence: 2 }],
  ],
  [
    "reads the copy with the lowest ParentId, counted as numbers, when it has no copy of its own",
    ["10,24320-4,12,1,2160-0,R", "9,24320-4,13,2,2345-7,O"],
    [{ panel: "24320-4", member: "2345-7", sequence: 2, required: "O" }],
  ],
  [
    "gives a member listed at two places as two rows",
    [
      "10,24320-4,10,360,24320-4,",
      "10,24320-4,11,4,2160-0,C",
      "10,24320-4,12,9,2160-0,O",
    ],
    [
      { panel: "24320-4", member: "2160-0", sequence: 4, required: "C" },
      { panel: "24320-4", member: "2160-0", sequence: 9, required: "O" },
    ],
  ],
];

/**
 * The builder reads a LOINC release a person downloaded: code names, code status and panel members. LOINC's licence
 * shapes it: nothing carrying a third party's copyright notice is published, and no field is edited.
 */
describe("Lab codes and panels from Regenstrief's LOINC · builders/regenstrief-loinc", () => {
  let base: Map<string, SeriesRows>;

  before(async () => {
    contract = await readContract(ROOT);
    base = await built({});
  });

  describe("given a line LOINC would not write", () => {
    for (const [what, file, from, to, reason] of refused)
      it(`refuses ${what}`, async () => {
        let edited = "";
        const message = await refusal(
          built({
            [file]: (text) => {
              edited = swap(text, from, to);
              return edited;
            },
          }),
        );
        assert.equal(message, reason(edited));
      });
  });

  describe("given a third party's copyright notice", () => {
    const left = new Map<string, { panels: string[]; codes: string[] }>();
    const panelsOf = (rows: Map<string, SeriesRows>) =>
      new Set(membersOf(rows).map((m) => m.panel));

    before(async () => {
      for (const [what, file, from, to] of noticed) {
        const rows = await built({ [file]: (text) => swap(text, from, to) });
        left.set(what, {
          panels: [...panelsOf(base)]
            .filter((panel) => !panelsOf(rows).has(panel))
            .sort(),
          codes: [...namedCodes(base)]
            .filter((code) => !namedCodes(rows).has(code))
            .sort(),
        });
      }
    });

    /** Whether everything a case should leave out is left out, whatever else is. */
    const leavesOut = (what: string): void => {
      const [, , , , panels, codes] = noticed.find(([name]) => name === what)!;
      const found = left.get(what)!;
      assert.deepEqual(
        panels.filter((panel) => !found.panels.includes(panel)),
        [],
        `${what}: panels not left out`,
      );
      assert.deepEqual(
        codes.filter((code) => !found.codes.includes(code)),
        [],
        `${what}: codes not left out`,
      );
    };

    it("leaves out the whole panel when a row of it carries a notice", () => {
      leavesOut("a notice on a row of the panel");
      leavesOut("an additional copyright on a row of the panel");
    });

    it("leaves out a member's name and the panel when the member carries one", () => {
      leavesOut("a notice on a member");
    });

    it("leaves out the panel and its name when the panel itself carries one", () => {
      leavesOut("a notice on the panel itself");
    });

    it("leaves out nothing else", () => {
      assert.deepEqual(
        [...panelsOf(base)].sort(),
        ["24318-8", "24320-4", "55175-4", "85353-1", "85354-9"],
        "the fixture's panels",
      );
      for (const [what, , , , panels, codes] of noticed)
        assert.deepEqual(
          left.get(what),
          { panels, codes },
          `${what}: what is left out`,
        );
    });
  });

  describe("given a retired code", () => {
    let withNotice: Map<string, SeriesRows>;
    const replacements = (rows: Map<string, SeriesRows>) => {
      const found = new Map<string, string[]>();
      for (const q of rows.get(STATUS)!.triples()) {
        const code = codeOf(q.subject.value);
        found.set(code, found.get(code) ?? []);
        if (q.predicate.value === `${DCT}isReplacedBy`)
          found.get(code)!.push(codeOf(q.object.value));
      }
      return found;
    };

    before(async () => {
      withNotice = await built({
        [TERMS]: (text) =>
          swap(
            text,
            '"1007-4","1","ACTIVE",""',
            '"1007-4","1","ACTIVE","(c) a third party"',
          ),
      });
    });

    it("writes its replacement when this build names the replacing code", () => {
      assert.deepEqual(
        [...replacements(base)]
          .filter(([, targets]) => targets.length > 0)
          .sort(),
        [
          ["1009-0", ["1007-4"]],
          ["11491-6", ["15507-7"]],
          ["5895-7", ["6301-6"]],
        ],
      );
    });

    it("writes the retirement with no replacement when the replacing code is left out", () => {
      assert.deepEqual(
        [...replacements(base).keys()].sort(),
        ["1009-0", "11491-6", "33727-9", "5895-7"],
        "33727-9's replacement carries a notice, so it is retired with none",
      );
      assert.deepEqual(replacements(base).get("33727-9"), []);
      assert.deepEqual(replacements(withNotice).get("1009-0"), []);
    });

    it("names only codes this build names as replacements", () => {
      const named = namedCodes(base);
      for (const targets of replacements(base).values())
        for (const target of targets) assert.ok(named.has(target), target);
    });
  });

  describe("given a panel listed in more than one copy", () => {
    for (const [what, rows, expected] of copies)
      it(what, async () => {
        assert.deepEqual(membersOf(await built(panels(rows))), expected);
      });
  });

  describe("given the fixture release", () => {
    it("writes each label and each panel row's fields as the release has them", async () => {
      assert.deepEqual(await editedFields(labelsOf(base), membersOf(base)), []);
    });

    /** Rule H2 of rules/rows.feature, as the vocabulary's vector for panel member rows holds it. */
    it("names a panel member row as the vocabulary's panel-members-1.ttl does", async () => {
      const vector = keyed(
        parseTurtle(
          await readFile(
            join(
              contract.vocabulary.folder,
              "tests",
              "table-versions",
              "panel-members-1.ttl",
            ),
            "utf8",
          ),
          "http://example/",
        ),
      );
      const row = (
        panel: string,
        member: string,
        sequence: number,
        required?: string,
      ) =>
        toRdf({
          series: MEMBERS,
          subject_id: `${CODE_STEM}${panel}`,
          predicate_id: HAS_MEMBER,
          object_id: `${CODE_STEM}${member}`,
          mapping_justification: CURATED,
          sequence,
          ...(required === undefined ? {} : { required }),
        });
      const made = [
        row("24318-8", "24320-4", 1),
        row("24318-8", "30395-8", 4, "R"),
        row("24318-8", "30395-8", 9, "O"),
        row("24318-8", "30394-1", 5),
        row("24320-4", "718-7", 1, "R"),
      ];
      assert.deepEqual(
        new Map(made.map((m) => [m.key, keyed(m.triples).get(m.key)])),
        vector,
      );
    });
  });

  describe("given the page LOINC announces versions on", () => {
    it("finds each version with the source's announcement pattern", async () => {
      const { announcement } = await readSource(FOLDER);
      const answer =
        '{"resourceType":"Bundle","entry":[{"resource":{"resourceType":"CodeSystem","url":"http://loinc.org","version":"2.77","name":"LOINC"}},{"resource":{"resourceType":"CodeSystem","url":"http://loinc.org","version":"2.82","name":"LOINC"}}]}';
      assert.deepEqual(
        [...answer.matchAll(new RegExp(announcement!.pattern, "gi"))].map(
          (found) => found[1],
        ),
        ["2.77", "2.82"],
      );
    });
  });
});
