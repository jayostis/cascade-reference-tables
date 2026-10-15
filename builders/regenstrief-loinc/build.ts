import { type Build, Refusal } from "../../host/src/builder.js";

const NAMES = "urn:uuid:b6ba7e56-1361-4d73-abef-42efe31e6943";
const STATUS = "urn:uuid:8caff025-8214-4910-81d7-16dfac334dae";
const MEMBERS = "urn:uuid:bc968e29-9f45-4160-b910-a70a06bbca9c";
const LOINC = "https://ns.cascadeprotocol.org/records/v1-draft#LOINC";
const HAS_MEMBER = "http://purl.obolibrary.org/obo/RO_0002351";
const CURATED = "https://w3id.org/semapv/vocab/ManualMappingCuration";

const TERMS = "LoincTable/Loinc.csv";
const MAP_TO = "LoincTable/MapTo.csv";
const PANELS = "AccessoryFiles/PanelsAndForms/PanelsAndForms.csv";

/** The CLASSTYPEs whose codes and panels ship: laboratory and clinical. Claims attachments and surveys do not. */
const SHIPPED_CLASSES = new Set(["1", "2"]);

const RETIRED = new Map([
  ["ACTIVE", false],
  ["TRIAL", false],
  ["DISCOURAGED", false],
  ["DEPRECATED", true],
]);

const CODE = /^[0-9]+-[0-9]$/;

function loincCode(code: string, where: string): string {
  if (!CODE.test(code))
    throw new Refusal(`${where} has "${code}", which is no LOINC code`);
  return code;
}

interface Term {
  readonly number: number;
  readonly classType: string;
  readonly status: string;
  readonly noticed: boolean;
  readonly name: string;
}

interface Member {
  readonly code: string;
  readonly sequence: number;
  readonly required: string;
  readonly noticed: boolean;
}

/** A panel as one copy of it lists its members: whether the copy is the panel's own, and its ParentId as a number. */
interface Copy {
  readonly parentId: number;
  root: boolean;
  readonly members: Member[];
}

/**
 * `Loinc.csv` gives the names and statuses of the codes, `MapTo.csv` what retires them, and `PanelsAndForms.csv` the
 * panels. LOINC's own fields are written as they are, and what carries a third party's copyright notice is left out:
 * a code with a notice, and a panel that has, or whose rows (in any copy of it) or members have, one. A retired code's
 * replacement is written only when this build names the replacement, so no relation points at an unnamed code.
 *
 * `PanelsAndForms.csv` lists a panel again under each panel that holds it, so a panel's members are read from its own
 * copy, the one whose `ID` is its `ParentId`, else from the copy with the lowest `ParentId`.
 */
const build: Build = async function* (release) {
  const terms = new Map<string, Term>();
  for await (const line of release
    .file(TERMS)
    .csv([
      "LOINC_NUM",
      "CLASSTYPE",
      "STATUS",
      "EXTERNAL_COPYRIGHT_NOTICE",
      "LONG_COMMON_NAME",
    ])) {
    const code = line.get("LOINC_NUM");
    if (terms.has(code))
      throw new Refusal(`${TERMS} line ${line.number} repeats ${code}`);
    terms.set(code, {
      number: line.number,
      classType: line.get("CLASSTYPE"),
      status: line.get("STATUS"),
      noticed: line.get("EXTERNAL_COPYRIGHT_NOTICE") !== "",
      name: line.get("LONG_COMMON_NAME"),
    });
  }

  const copies = new Map<string, Map<string, Copy>>();
  for await (const line of release
    .file(PANELS)
    .csv([
      "ParentId",
      "ParentLoinc",
      "ID",
      "SEQUENCE",
      "Loinc",
      "ObservationRequiredInPanel",
      "EXTERNAL_COPYRIGHT_NOTICE",
      "AdditionalCopyright",
    ])) {
    const panel = line.get("ParentLoinc");
    const parent = terms.get(panel);
    if (parent === undefined)
      throw new Refusal(
        `${PANELS} line ${line.number} is of the panel ${panel}, which ${TERMS} lacks`,
      );
    if (!SHIPPED_CLASSES.has(parent.classType)) continue;
    const parentId = line.get("ParentId");
    if (!/^[0-9]+$/.test(parentId))
      throw new Refusal(
        `${PANELS} line ${line.number} has the ParentId "${parentId}", which is no number`,
      );
    const sequence = line.get("SEQUENCE");
    if (!/^-?[0-9]+$/.test(sequence))
      throw new Refusal(
        `${PANELS} line ${line.number} has the SEQUENCE "${sequence}", which is no integer`,
      );
    const ofPanel = copies.get(panel) ?? new Map<string, Copy>();
    copies.set(panel, ofPanel);
    const copy = ofPanel.get(parentId) ?? {
      parentId: Number(parentId),
      root: false,
      members: [],
    };
    ofPanel.set(parentId, copy);
    if (line.get("ID") === parentId) copy.root = true;
    copy.members.push({
      code: loincCode(line.get("Loinc"), `${PANELS} line ${line.number}`),
      sequence: Number(sequence),
      required: line.get("ObservationRequiredInPanel"),
      noticed:
        line.get("EXTERNAL_COPYRIGHT_NOTICE") !== "" ||
        line.get("AdditionalCopyright") !== "",
    });
  }

  const named = new Set<string>();
  for (const [code, term] of terms)
    if (SHIPPED_CLASSES.has(term.classType) && !term.noticed) named.add(code);

  const rows: {
    panel: string;
    member: string;
    sequence: number;
    required: string;
  }[] = [];
  for (const [panel, ofPanel] of copies) {
    const [copy] = [...ofPanel.values()].sort(
      (a, b) => Number(b.root) - Number(a.root) || a.parentId - b.parentId,
    );
    const members = copy!.members.filter((m) => m.code !== panel);
    for (const { code } of members)
      if (!terms.has(code))
        throw new Refusal(
          `${PANELS} gives ${panel} the member ${code}, which ${TERMS} lacks`,
        );
    if (
      terms.get(panel)!.noticed ||
      [...ofPanel.values()].some((c) => c.members.some((m) => m.noticed)) ||
      members.some((m) => terms.get(m.code)!.noticed)
    )
      continue;
    for (const { code, sequence, required } of members) {
      rows.push({ panel, member: code, sequence, required });
      named.add(panel);
      named.add(code);
    }
  }

  const retired = new Set<string>();
  for (const code of [...named].sort()) {
    const term = terms.get(code)!;
    loincCode(code, `${TERMS} line ${term.number}`);
    if (term.name === "")
      throw new Refusal(
        `${TERMS} line ${term.number} gives ${code} no LONG_COMMON_NAME`,
      );
    yield {
      series: NAMES,
      subject: release.codeIri(LOINC, code),
      prefLabel: term.name,
      notation: code,
    };
    const isRetired = RETIRED.get(term.status);
    if (isRetired === undefined)
      throw new Refusal(
        `${TERMS} line ${term.number} has the status "${term.status}", which this builder does not map`,
      );
    if (isRetired) retired.add(code);
  }

  const replacedBy = new Map<string, Set<string>>();
  for await (const line of release.file(MAP_TO).csv(["LOINC", "MAP_TO"])) {
    const code = line.get("LOINC");
    if (!retired.has(code)) continue;
    const target = loincCode(
      line.get("MAP_TO"),
      `${MAP_TO} line ${line.number}`,
    );
    if (!terms.has(target))
      throw new Refusal(
        `${MAP_TO} line ${line.number} replaces ${code} with ${target}, which ${TERMS} lacks`,
      );
    if (!named.has(target)) continue;
    (replacedBy.get(code) ?? replacedBy.set(code, new Set()).get(code)!).add(
      target,
    );
  }
  for (const code of [...retired].sort())
    yield {
      series: STATUS,
      subject: release.codeIri(LOINC, code),
      replacedBy: [...(replacedBy.get(code) ?? [])]
        .sort()
        .map((target) => release.codeIri(LOINC, target)),
    };

  for (const { panel, member, sequence, required } of rows)
    yield {
      series: MEMBERS,
      subject_id: release.codeIri(LOINC, panel),
      predicate_id: HAS_MEMBER,
      object_id: release.codeIri(LOINC, member),
      mapping_justification: CURATED,
      sequence,
      ...(required === "" ? {} : { required }),
    };
};

export default build;
