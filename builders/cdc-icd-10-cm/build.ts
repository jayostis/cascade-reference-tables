import {
  type Build,
  type MappingRow,
  Refusal,
} from "../../host/src/builder.js";

const NAMES = "urn:uuid:2f1d04ac-2101-4d15-8251-566846a14488";
const STATUS = "urn:uuid:f110e5af-abb3-418f-9b24-ecbd1ffa5540";
const CONVERSIONS = "urn:uuid:14f76251-2926-43ef-90c3-47101c1da3dd";
const ICD10CM = "https://ns.cascadeprotocol.org/records/v1-draft#ICD10CM";
const IS_REPLACED_BY = "http://purl.org/dc/terms/isReplacedBy";
const CURATED = "https://w3id.org/semapv/vocab/ManualMappingCuration";
const CHAINED = "https://w3id.org/semapv/vocab/MappingChaining";
const CODE = /^[A-Z][0-9A-Z]{2}(\.[0-9A-Z]{1,4})?$/;
const SEPARATOR = /\s*(?:,|;|&|\band\b)\s*/;

/** The code as CDC's text files write it, without its dot, written with the dot after the third character. */
const dotted = (code: string): string =>
  code.length > 3 ? `${code.slice(0, 3)}.${code.slice(3)}` : code;

/**
 * The order file: order number, code without its dot, 1 for a code and 0 for a header, short title, long title, at
 * fixed columns. The conversion table's first sheet: a new code, the year it took effect, and the codes it was
 * before, joined by commas, semicolons, `&` or `and`; a range, `None` or other text names no code.
 *
 * A retired code is a previous code that is no code in effect. CDC lists each conversion in its own year, so a
 * retired code's successors in effect are found by following the conversions of any successor that is itself retired,
 * each code once along a path; a successor that is neither is dropped. A row's cardinality is counted along those
 * conversions, not over the table: its left side is `n` when CDC gives a code on the path anything but the code
 * before it as previous codes, its right side when a code before the end converts into more than one code.
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
  const previous = new Map<string, string[]>();
  for await (const { fields } of release.file("conversion-table.xlsx").xlsx()) {
    const [current = "", , cell = ""] = fields.map((field) => field.trim());
    if (!CODE.test(current)) continue;
    previous.set(current, [...(previous.get(current) ?? []), cell]);
    for (const code of cell.split(SEPARATOR).filter((c) => CODE.test(c))) {
      if (!converted.has(code)) converted.set(code, new Set());
      converted.get(code)!.add(current);
    }
  }
  const givenBesides = (from: string, to: string): boolean =>
    (previous.get(to) ?? []).some((cell) =>
      cell.split(SEPARATOR).some((part) => part !== "" && part !== from),
    );
  /** Each code in effect `code` converts into, with the codes on the way from `code` to it. */
  function* inEffect(
    code: string,
    path: readonly string[],
  ): Generator<[string, readonly string[]]> {
    for (const next of [...(converted.get(code) ?? [])].sort()) {
      if (valid.has(next)) yield [next, path];
      else if (converted.has(next) && !path.includes(next))
        for (const [end, via] of inEffect(next, [...path, next]))
          yield [end, via];
    }
  }
  for (const code of [...converted.keys()].sort()) {
    if (valid.has(code)) continue;
    const sides = new Map<string, [boolean, boolean]>();
    for (const [end, path] of inEffect(code, [code])) {
      const hops = [...path, end].slice(1).map((to, i) => [path[i]!, to]);
      const left = hops.some(([from, to]) => givenBesides(from!, to!));
      const right = path.some((from) => converted.get(from)!.size > 1);
      const before = sides.get(end) ?? [false, false];
      sides.set(end, [before[0] || left, before[1] || right]);
    }
    const subject = release.codeIri(ICD10CM, code);
    const replacedBy = [...sides.keys()].map((to) =>
      release.codeIri(ICD10CM, to),
    );
    yield {
      series: STATUS,
      subject,
      ...(replacedBy.length === 0 ? {} : { replacedBy }),
    };
    for (const [end, [left, right]] of sides) {
      const cardinality: MappingRow["mapping_cardinality"] = `${left ? "n" : "1"}:${right ? "n" : "1"}`;
      yield {
        series: CONVERSIONS,
        subject_id: subject,
        predicate_id: IS_REPLACED_BY,
        object_id: release.codeIri(ICD10CM, end),
        mapping_justification: converted.get(code)!.has(end)
          ? CURATED
          : CHAINED,
        mapping_cardinality: cardinality,
      };
    }
  }
};

export default build;
