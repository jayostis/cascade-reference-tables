import assert from "node:assert/strict";
import { join } from "node:path";
import { describe, it } from "node:test";
import type { Release, ReleaseFile } from "../src/builder.js";
import { xmlElements } from "../src/readers.js";
import { loadBuild } from "../src/source.js";
import { refusal, releaseFolder } from "./release-folder.js";

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

/** The message of the refusal the builder gives for a MED-RT file holding this XML. */
async function refused(xml: string): Promise<string> {
  const { folder, remove } = await releaseFolder({
    "medrt.xml": `<terminology>${xml}</terminology>`,
  });
  try {
    const release: Release = {
      file: (): ReleaseFile =>
        ({
          xml: (element: string) =>
            xmlElements(join(folder, "medrt.xml"), element),
        }) as ReleaseFile,
      codeIri: (system, code) => `${system}/${code}`,
      concepts: () => new Map(),
      genes: () => [],
      finding: () => undefined,
    };
    const build = await loadBuild(ROOT, FOLDER);
    return await refusal(
      (async () => {
        for await (const row of build(release)) void row;
      })(),
    );
  } finally {
    await remove();
  }
}

const cases: [what: string, xml: string, reason: string][] = [
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
    "a has_MoA to a class that is no MoA",
    association("has_MoA", RX, ["MED-RT", "Lower BP [PE]", "N4"]),
    "association 1 (has_MoA, 29046 to N4) of Authority FDASPL goes to a class that is not a [MoA] class",
  ],
  [
    "a has_PE to a class that is no PE",
    association("has_PE", RX, MOA),
    "association 1 (has_PE, 29046 to N2) of Authority FDASPL goes to a class that is not a [PE] class",
  ],
  [
    "a has_SC to a MED-RT class that is no EXT",
    association("has_SC", RX, MOA),
    "association 1 (has_SC, 29046 to N2) of Authority FDASPL goes to a class that is not a [EXT] class",
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

/**
 * The builder reads MED-RT's XML for the drug classes FDA's labelling gives each RxNorm code. An association it cannot
 * read refuses the build, naming the association by its place, relation and codes.
 */
describe("Drug classes from VA's MED-RT · builders/va-med-rt", () => {
  describe("given an association of authority FDASPL the builder cannot read", () => {
    for (const [what, xml, reason] of cases)
      it(`refuses ${what}`, async () => {
        assert.equal(await refused(xml), reason);
      });
  });
});
