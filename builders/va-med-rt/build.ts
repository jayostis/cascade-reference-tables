import { type Build, Refusal } from "../../host/src/builder.js";
import type { XmlElement } from "../../host/src/readers.js";

const CLASSES = "urn:uuid:ab73ff9e-83d8-4886-96bc-40a59d3cb28a";
const NAMES = "urn:uuid:9ded4da0-51bc-49fe-964a-19d74a36b91f";
const REC = "https://ns.cascadeprotocol.org/records/v1-draft#";
const RXNORM = `${REC}RxNorm`;
const MEDRT = `${REC}MEDRT`;
const MESH = `${REC}MeSH`;
const CURATED = "https://w3id.org/semapv/vocab/ManualMappingCuration";
const FDA = "FDASPL";

const EPC = `${REC}establishedPharmacologicClass`;
const RELATIONS = new Map([
  ["has_MoA", `${REC}mechanismOfAction`],
  ["has_PE", `${REC}physiologicEffect`],
  ["has_SC", `${REC}chemicalStructure`],
]);

const field = (element: XmlElement, name: string): string =>
  element.children.find((child) => child.name === name)?.text ?? "";

const authorities = (association: XmlElement): string[] =>
  association.children
    .filter(
      (child) =>
        child.name === "qualifier" && field(child, "name") === "Authority",
    )
    .map((qualifier) => field(qualifier, "value"));

/**
 * `Core_MEDRT_XML.zip`'s XML: each `<association>` of Authority FDASPL from an RxNorm code to a class, a `has_MoA`,
 * `has_PE` or `has_SC`, or a `Parent Of` from an established pharmacologic class to an RxNorm code, read the other
 * way round; and each class's `<concept>` for its name. A MeSH code is named by the association's `to_name`.
 */
const build: Build = async function* (release) {
  const classes = new Set<string>();
  const meshNames = new Map<string, string>();
  let number = 0;
  for await (const association of release
    .file("Core_MEDRT_XML.zip")
    .xml("association")) {
    number += 1;
    if (!authorities(association).includes(FDA)) continue;
    const relation = field(association, "name");
    const from = field(association, "from_namespace");
    const to = field(association, "to_namespace");
    const fromCode = field(association, "from_code");
    const toCode = field(association, "to_code");
    const refuse = (why: string) =>
      new Refusal(
        `association ${number} (${relation}, ${fromCode} to ${toCode}) ${why}`,
      );
    if (relation === "Parent Of") {
      if (from !== "MED-RT" || to !== "RxNorm") continue;
      if (!field(association, "from_name").endsWith("[EPC]"))
        throw refuse(
          "of Authority FDASPL is from a class that is not an established pharmacologic class",
        );
      classes.add(fromCode);
      yield {
        series: CLASSES,
        subject_id: release.codeIri(RXNORM, toCode),
        predicate_id: EPC,
        object_id: release.codeIri(MEDRT, fromCode),
        mapping_justification: CURATED,
      };
      continue;
    }
    const predicate = RELATIONS.get(relation);
    if (predicate === undefined) continue;
    if (from !== "RxNorm" || fromCode === "" || toCode === "")
      throw refuse("of Authority FDASPL is not from an RxNorm code to a class");
    if (to === "MED-RT") classes.add(toCode);
    else if (to === "MeSH" && relation === "has_SC") {
      const name = field(association, "to_name");
      if (name === "") throw refuse("names no MeSH name");
      const known = meshNames.get(toCode);
      if (known !== undefined && known !== name)
        throw refuse(
          `names ${toCode} ${name}, and another association ${known}`,
        );
      meshNames.set(toCode, name);
    } else throw refuse(`of Authority FDASPL goes to a ${to} code`);
    yield {
      series: CLASSES,
      subject_id: release.codeIri(RXNORM, fromCode),
      predicate_id: predicate,
      object_id: release.codeIri(to === "MeSH" ? MESH : MEDRT, toCode),
      mapping_justification: CURATED,
    };
  }
  for (const [code, name] of meshNames)
    yield {
      series: NAMES,
      subject: release.codeIri(MESH, code),
      prefLabel: name,
      notation: code,
    };
  const unnamed = new Set(classes);
  for await (const concept of release
    .file("Core_MEDRT_XML.zip")
    .xml("concept")) {
    const code = field(concept, "code");
    if (!unnamed.delete(code)) continue;
    yield {
      series: NAMES,
      subject: release.codeIri(MEDRT, code),
      prefLabel: field(concept, "name"),
      notation: code,
    };
  }
  if (unnamed.size > 0)
    throw new Refusal(
      `${unnamed.size} classes have no concept to name them, such as ${[...unnamed].sort()[0]}`,
    );
};

export default build;
