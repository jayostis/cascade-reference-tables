import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { Refusal, type Release, type ReleaseFile } from "../src/builder.js";
import { xmlElements } from "../src/readers.js";
import { loadBuild } from "../src/source.js";

const ROOT = join(import.meta.dirname, "..", "..", "..");
const FOLDER = join(ROOT, "builders", "va-med-rt");

const concept = (code: string, name: string) =>
  `<concept><namespace>MED-RT</namespace><name>${name}</name><code>${code}</code></concept>`;

const association = (
  relation: string,
  from: [string, string, string],
  to: [string, string, string],
  authority = "FDASPL",
) =>
  `<association><name>${relation}</name>
    <from_namespace>${from[0]}</from_namespace><from_name>${from[1]}</from_name><from_code>${from[2]}</from_code>
    <to_namespace>${to[0]}</to_namespace><to_name>${to[1]}</to_name><to_code>${to[2]}</to_code>
    <qualifier><namespace>MED-RT</namespace><name>Authority</name><value>${authority}</value></qualifier></association>`;

const EPC: [string, string, string] = ["MED-RT", "ACE Inhibitor [EPC]", "N1"];
const RX: [string, string, string] = ["RxNorm", "lisinopril", "29046"];
const MOA: [string, string, string] = ["MED-RT", "ACE [MoA]", "N2"];
const MESH: [string, string, string] = ["MeSH", "Dihydropyridines", "M1"];

async function refusal(xml: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "va-med-rt-"));
  try {
    const path = join(dir, "medrt.xml");
    await writeFile(path, `<terminology>${xml}</terminology>`);
    const release: Release = {
      file: (): ReleaseFile =>
        ({
          xml: (element: string) => xmlElements(path, element),
        }) as ReleaseFile,
      codeIri: (system, code) => `${system}/${code}`,
      concepts: () => new Map(),
      genes: () => [],
      finding: () => undefined,
    };
    const build = await loadBuild(ROOT, FOLDER);
    try {
      for await (const row of build(release)) void row;
    } catch (error) {
      assert.ok(error instanceof Refusal, String(error));
      return error.message;
    }
    return "";
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("MED-RT's file is refused, naming why, when an FDA association is not one the builder can read", async () => {
  const cases: [string, string, string][] = [
    [
      "an EPC association from a class that is no EPC",
      association("Parent Of", ["MED-RT", "Diuretic [TC]", "N9"], RX),
      "association 1 (Parent Of, N9 to 29046) of Authority FDASPL is from a class that is not an established pharmacologic class",
    ],
    [
      "a has_MoA from a code that is not RxNorm",
      association("has_MoA", EPC, MOA),
      "association 1 (has_MoA, N1 to N2) of Authority FDASPL is not from an RxNorm code to a class",
    ],
    [
      "a has_PE to a MeSH code",
      association("has_PE", RX, MESH),
      "association 1 (has_PE, 29046 to M1) of Authority FDASPL goes to a MeSH code",
    ],
    [
      "a MeSH code given two names",
      association("has_SC", RX, MESH) +
        association("has_SC", ["RxNorm", "x", "1"], ["MeSH", "Other", "M1"]),
      "association 2 (has_SC, 1 to M1) names M1 Other, and another association Dihydropyridines",
    ],
    [
      "a class with no concept to name it",
      association("has_MoA", RX, MOA) + concept("N3", "Other"),
      "1 classes have no concept to name them, such as N2",
    ],
  ];
  for (const [what, xml, reason] of cases)
    assert.equal(await refusal(xml), reason, what);
});
