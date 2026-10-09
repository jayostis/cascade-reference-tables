import { type Build, type Row } from "../../host/src/builder.js";

const INGREDIENTS = "urn:uuid:cab9299d-e0e6-4d85-858b-7167d0fcbeb6";
const GENERICS = "urn:uuid:cf861deb-999f-4f57-9cca-4b2cbe421bf4";
const NDCS = "urn:uuid:32deac38-90ec-4962-bb25-0f455f1cb3cf";
const NAMES = "urn:uuid:9e794869-eb5a-4818-a8d9-1cff8abae5ba";
const REC = "https://ns.cascadeprotocol.org/records/v1-draft#";
const BROAD_MATCH = "http://www.w3.org/2004/02/skos/core#broadMatch";
const CURATED = "https://w3id.org/semapv/vocab/ManualMappingCuration";
const CHAINED = "https://w3id.org/semapv/vocab/MappingChaining";

/** Term types other names are given as. */
const OTHER_NAMES = new Set(["SY", "TMSY", "PSN"]);

/** Each branded term type and its generic's. */
const GENERIC = new Map([
  ["SBD", "SCD"],
  ["SBDC", "SCDC"],
  ["SBDF", "SCDF"],
  ["SBDG", "SCDG"],
  ["SBDFP", "SCDFP"],
  ["BPCK", "GPCK"],
]);

/**
 * `RXNCONSO.RRF`: RXCUI 0, SAB 11, TTY 12, STR 14, SUPPRESS 16. `RXNREL.RRF`: RXCUI1 0, STYPE1 2, RXCUI2 4, RELA 7,
 * SAB 10, read as RXCUI2 RELA RXCUI1. `RXNSAT.RRF`: RXCUI 0, ATN 8, SAB 9, ATV 10, SUPPRESS 11. All `|`-separated.
 */
const build: Build = async function* (release) {
  const rxnorm = (code: string): string =>
    release.codeIri(`${REC}RxNorm`, code);
  const termType = new Map<string, string>();
  const preferred = new Map<string, string>();
  const others = new Map<string, Set<string>>();
  for await (const { fields } of release.file("RXNCONSO.RRF").delimited("|")) {
    if (fields[11] !== "RXNORM" || fields[16] !== "N") continue;
    const [code, type, name] = [fields[0]!, fields[12]!, fields[14]!];
    if (OTHER_NAMES.has(type)) {
      if (!others.has(code)) others.set(code, new Set());
      others.get(code)!.add(name);
    } else {
      termType.set(code, type);
      preferred.set(code, name);
    }
  }
  const related = new Map<string, Map<string, Set<string>>>();
  for await (const { fields } of release.file("RXNREL.RRF").delimited("|")) {
    if (fields[10] !== "RXNORM" || fields[2] !== "CUI") continue;
    const [to, from, relation] = [fields[0]!, fields[4]!, fields[7]!];
    if (!related.has(relation)) related.set(relation, new Map());
    const by = related.get(relation)!;
    if (!by.has(from)) by.set(from, new Set());
    by.get(from)!.add(to);
  }
  const via = (relation: string, code: string, type: string): string[] =>
    [...(related.get(relation)?.get(code) ?? [])].filter(
      (to) => termType.get(to) === type,
    );
  const ingredientsOf = (codes: readonly string[]): string[] => [
    ...new Set(codes.flatMap((code) => via("has_ingredient", code, "IN"))),
  ];
  /** A concept's ingredients, and whether more than one relationship joins them. */
  const chains: Record<string, (code: string) => [string[], boolean]> = {
    SCDC: (code) => [via("has_ingredient", code, "IN"), false],
    SCDF: (code) => [via("has_ingredient", code, "IN"), false],
    SCDG: (code) => [via("has_ingredient", code, "IN"), false],
    BN: (code) => [via("tradename_of", code, "IN"), false],
    PIN: (code) => [via("form_of", code, "IN"), false],
    SCD: (code) => [ingredientsOf(via("consists_of", code, "SCDC")), true],
    SBD: (code) => [ingredientsOf(via("consists_of", code, "SCDC")), true],
    SBDC: (code) => [ingredientsOf(via("tradename_of", code, "SCDC")), true],
    SBDF: (code) => [ingredientsOf(via("tradename_of", code, "SCDF")), true],
    SBDG: (code) => [ingredientsOf(via("tradename_of", code, "SCDG")), true],
    SCDFP: (code) => [ingredientsOf(via("form_of", code, "SCDF")), true],
    SCDGP: (code) => [ingredientsOf(via("form_of", code, "SCDG")), true],
    SBDFP: (code) => [
      ingredientsOf(
        via("form_of", code, "SBDF").flatMap((brand) =>
          via("tradename_of", brand, "SCDF"),
        ),
      ),
      true,
    ],
  };
  const multiple = new Map<string, string>();
  for (const [code, type] of termType)
    if (type === "MIN")
      multiple.set(via("has_part", code, "IN").sort().join(" "), code);
  const mapping = (
    series: string,
    from: string,
    to: string,
    chained: boolean,
  ): Row => ({
    series,
    subject_id: from,
    predicate_id: BROAD_MATCH,
    object_id: to,
    mapping_justification: chained ? CHAINED : CURATED,
  });
  for (const [code, type] of [...termType].sort()) {
    if (type === "IN" || type === "MIN") {
      yield mapping(INGREDIENTS, rxnorm(code), rxnorm(code), false);
      continue;
    }
    const generic = GENERIC.get(type);
    if (generic !== undefined)
      for (const to of via("tradename_of", code, generic))
        yield mapping(GENERICS, rxnorm(code), rxnorm(to), false);
    const chain = chains[type];
    if (chain === undefined) continue;
    const [found, chained] = chain(code);
    if (found.length === 1)
      yield mapping(INGREDIENTS, rxnorm(code), rxnorm(found[0]!), chained);
    const combined =
      found.length > 1 ? multiple.get(found.sort().join(" ")) : undefined;
    if (combined !== undefined)
      yield mapping(INGREDIENTS, rxnorm(code), rxnorm(combined), true);
  }
  for await (const { fields } of release.file("RXNSAT.RRF").delimited("|")) {
    if (fields[9] !== "RXNORM" || fields[8] !== "NDC" || fields[11] !== "N")
      continue;
    if (!termType.has(fields[0]!)) continue;
    yield mapping(
      NDCS,
      release.codeIri(`${REC}NDC`, fields[10]!),
      rxnorm(fields[0]!),
      false,
    );
  }
  for (const [code, name] of preferred) {
    const also = [...(others.get(code) ?? [])]
      .filter((other) => other !== name)
      .sort();
    yield {
      series: NAMES,
      subject: rxnorm(code),
      prefLabel: name,
      ...(also.length === 0 ? {} : { altLabel: also }),
      notation: code,
    };
  }
};

export default build;
