import { type Build, Refusal } from "../../host/src/builder.js";

const GROUPS = "urn:uuid:25623afd-6445-4394-8174-93ffacaea90e";
const NAMES = "urn:uuid:f71f6797-48ec-4875-9b87-4cb1be1d9be0";
const STATUS = "urn:uuid:624f752e-dfba-45e7-a3e5-710ff7204a79";
const CVX = "https://ns.cascadeprotocol.org/records/v1-draft#CVX";
const BROAD_MATCH = "http://www.w3.org/2004/02/skos/core#broadMatch";
const CURATED = "https://w3id.org/semapv/vocab/ManualMappingCuration";

const RETIRED = new Map([
  ["Active", false],
  ["Inactive", false],
  ["Non-US", false],
  ["Never Active", true],
]);

function fieldsOf(
  file: string,
  number: number,
  fields: readonly string[],
  count: number,
  codeAt: number,
): string[] {
  if (fields.length !== count)
    throw new Refusal(
      `${file} line ${number} has ${fields.length} fields, not ${count}`,
    );
  const trimmed = fields.map((field) => field.trim());
  if (trimmed[codeAt] === "")
    throw new Refusal(`${file} line ${number} has no CVX code`);
  return trimmed;
}

/**
 * `CVX.txt`: code, short description, full vaccine name, notes, status, nonvaccine, last updated. `VG.txt`: short
 * description, code, status, vaccine group name, CVX for vaccine group. Both are `|`-separated, codes padded with
 * spaces.
 */
const build: Build = async function* (release) {
  const codes = new Set<string>();
  for await (const { number, fields } of release
    .file("CVX.txt")
    .delimited("|")) {
    const [code, short, full, , status] = fieldsOf(
      "CVX.txt",
      number,
      fields,
      7,
      0,
    );
    const retired = RETIRED.get(status!);
    if (retired === undefined)
      throw new Refusal(
        `CVX.txt line ${number} has the status "${status}", which this builder does not map`,
      );
    const subject = release.codeIri(CVX, code!);
    codes.add(code!);
    yield {
      series: NAMES,
      subject,
      prefLabel: short!,
      ...(full === short ? {} : { altLabel: [full!] }),
      notation: code!,
    };
    if (retired) yield { series: STATUS, subject };
  }
  for await (const { number, fields } of release
    .file("VG.txt")
    .delimited("|")) {
    const [, code, , , group] = fieldsOf("VG.txt", number, fields, 5, 1);
    if (group === "")
      throw new Refusal(`VG.txt line ${number} has no vaccine group CVX code`);
    for (const named of [code!, group!])
      if (!codes.has(named))
        throw new Refusal(
          `VG.txt line ${number} names ${named}, which CVX.txt lacks`,
        );
    yield {
      series: GROUPS,
      subject_id: release.codeIri(CVX, code!),
      predicate_id: BROAD_MATCH,
      object_id: release.codeIri(CVX, group!),
      mapping_justification: CURATED,
    };
  }
};

export default build;
