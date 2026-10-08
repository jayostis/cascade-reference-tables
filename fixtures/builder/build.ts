import { type Build, Refusal } from "../../host/src/builder.js";

const GROUPS = "urn:uuid:c1a6678c-2b4d-4287-b852-9039e6a71afd";
const NAMES = "urn:uuid:6e9c1dc9-8c36-49a8-929c-cd9f6701076c";
const STATUS = "urn:uuid:57b9415b-3531-4995-8dfb-48b69ead096f";
const CVX = "https://ns.cascadeprotocol.org/records/v1-draft#CVX";
const RETIRED = new Map([
  ["Active", false],
  ["Retired", true],
]);

/** `codes.txt`: code, name, full name, group, status, separated by `|`. */
const build: Build = async function* (release) {
  for await (const { number, fields } of release
    .file("codes.txt")
    .delimited("|")) {
    const [code, name, fullName, group, status] = fields;
    if (status === undefined || fields.length !== 5)
      throw new Refusal(
        `codes.txt line ${number} has ${fields.length} fields, not 5`,
      );
    const retired = RETIRED.get(status);
    if (retired === undefined)
      throw new Refusal(
        `codes.txt line ${number} has the status ${status}, which is not mapped`,
      );
    const subject = release.codeIri(CVX, code!);
    if (group !== "")
      yield {
        series: GROUPS,
        subject_id: subject,
        predicate_id: "http://www.w3.org/2004/02/skos/core#broadMatch",
        object_id: release.codeIri(CVX, group!),
        mapping_justification:
          "https://w3id.org/semapv/vocab/ManualMappingCuration",
      };
    yield {
      series: NAMES,
      subject,
      prefLabel: name!,
      ...(fullName === name ? {} : { altLabel: [fullName!] }),
      notation: code!,
    };
    if (retired) yield { series: STATUS, subject };
  }
};

export default build;
