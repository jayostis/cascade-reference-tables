import { type Build, Refusal } from "../../host/src/builder.js";

const NAMES = "urn:uuid:2f1d04ac-2101-4d15-8251-566846a14488";
const STATUS = "urn:uuid:f110e5af-abb3-418f-9b24-ecbd1ffa5540";
const CONVERSIONS = "urn:uuid:14f76251-2926-43ef-90c3-47101c1da3dd";
const ICD10CM = "https://ns.cascadeprotocol.org/records/v1-draft#ICD10CM";
const EXACT_MATCH = "http://www.w3.org/2004/02/skos/core#exactMatch";
const CURATED = "https://w3id.org/semapv/vocab/ManualMappingCuration";
const CODE = /^[A-Z][0-9A-Z]{2}(\.[0-9A-Z]{1,4})?$/;

/** The code as CDC's text files write it, without its dot, written with the dot after the third character. */
const dotted = (code: string): string =>
  code.length > 3 ? `${code.slice(0, 3)}.${code.slice(3)}` : code;

/**
 * The order file: order number, code without its dot, 1 for a code and 0 for a header, short title, long title, at
 * fixed columns. The conversion table's first sheet: a new code, the year it took effect, and the codes it was
 * before, joined by commas, semicolons, `&` or `and`; a range, `None` or other text names no code.
 */
const build: Build = async function* (release) {
  const valid = new Set<string>();
  for await (const { number, fields } of release
    .file("icd10cm-order.txt")
    .fixedWidth([
      [6, 13],
      [14, 15],
      [16, 76],
      [77, Infinity],
    ])) {
    const [code, flag, short, long] = fields.map((field) => field.trim());
    const notation = dotted(code!);
    if (!CODE.test(notation) || (flag !== "0" && flag !== "1") || long === "")
      throw new Refusal(
        `icd10cm-order.txt line ${number} is not a code, its flag and its titles`,
      );
    if (flag === "1") valid.add(notation);
    yield {
      series: NAMES,
      subject: release.codeIri(ICD10CM, notation),
      prefLabel: long!,
      ...(short === long || short === "" ? {} : { altLabel: [short!] }),
      notation,
    };
  }
  const converted = new Map<string, Set<string>>();
  for await (const { fields } of release.file("conversion-table.xlsx").xlsx()) {
    const [current = "", , previous = ""] = fields.map((field) => field.trim());
    if (!CODE.test(current)) continue;
    const codes = previous
      .split(/\s*(?:,|;|&|\band\b)\s*/)
      .filter((code) => code !== "");
    if (codes.length === 0 || !codes.every((code) => CODE.test(code))) continue;
    for (const code of codes) {
      if (!converted.has(code)) converted.set(code, new Set());
      converted.get(code)!.add(current);
    }
  }
  for (const [code, into] of converted) {
    if (valid.has(code)) continue;
    const subject = release.codeIri(ICD10CM, code);
    yield {
      series: STATUS,
      subject,
      replacedBy: [...into].map((to) => release.codeIri(ICD10CM, to)),
    };
    const [only] = into;
    if (into.size === 1 && valid.has(only!))
      yield {
        series: CONVERSIONS,
        subject_id: subject,
        predicate_id: EXACT_MATCH,
        object_id: release.codeIri(ICD10CM, only!),
        mapping_justification: CURATED,
      };
  }
};

export default build;
