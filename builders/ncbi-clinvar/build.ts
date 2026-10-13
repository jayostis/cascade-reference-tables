import {
  type Build,
  Refusal,
  type Release,
  type ReleaseFile,
} from "../../host/src/builder.js";

const CLASSIFICATIONS = "urn:uuid:84a9f86a-f5e4-45b1-9e92-cd4ba027a389";
const NAMES = "urn:uuid:1653be1a-b871-4e0f-8c22-f13bbbf1b6d6";
const REC = "https://ns.cascadeprotocol.org/records/v1-draft#";
const VARIANT_SUMMARY = "variant_summary.txt.gz";
const HGVS4VARIATION = "hgvs4variation.txt.gz";
const SCVS = "SCVsForAggregateGermlineClassification";
const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];
/** The shown examples of a finding. */
const SHOWN = 5;

/** A coding `NM_` expression in the normal form, as the vocabulary's `rec:HgvsCodeShape` holds its IRI. */
const HGVS_CODE =
  /^http:\/\/varnomen\.hgvs\.org\/NM_[0-9]+\.[0-9]+%3Ac\.([A-Za-z0-9._~-]|%[0-9A-F]{2})+$/;
/** The expression in a variation's name: the gene and the protein change removed. */
const NAME_EXPRESSION = /^(NM_\d+\.\d+)(\([^)]*\))?:(c\.\S+)/;

type Columns = Readonly<Record<string, number | undefined>>;

/**
 * Calls `each` with every data line of the tab-separated file and the header's columns by name. The header is the
 * first line with more than one field, its leading `#` dropped; a column in `required` it lacks is refused. A line is
 * handed whole, and `field` cuts the one column a pass needs: nine million lines of forty-three fields, and forty-six
 * million of thirteen, are not split to read one.
 */
async function scan(
  file: ReleaseFile,
  required: readonly string[],
  each: (line: string, at: Columns) => void,
): Promise<void> {
  let at: Columns | undefined;
  for await (const { text } of file.lines()) {
    if (at === undefined) {
      const names = text.split("\t");
      if (names.length < 2) continue;
      at = Object.fromEntries(
        names.map((name, i) => [i === 0 ? name.slice(1) : name, i]),
      );
      for (const name of required)
        if (at[name] === undefined)
          throw new Refusal(`${file.name} has no column ${name}`);
      continue;
    }
    each(text, at);
  }
  if (at === undefined) throw new Refusal(`${file.name} has no header`);
}

/** The text of the column at the index, cut without splitting the line; "" past its last. */
function field(line: string, index: number): string {
  let start = 0;
  for (let i = 0; i < index; i++) {
    start = line.indexOf("\t", start) + 1;
    if (start === 0) return "";
  }
  const end = line.indexOf("\t", start);
  return line.slice(start, end < 0 ? line.length : end);
}

/**
 * A copy of a field to keep: a long substring of a line shares the memory of the chunk it was cut from, and a few
 * thousand kept fields would hold the whole file.
 */
const own = (text: string): string => Buffer.from(text).toString();

/** A column's text of a line cut into its fields; `at` is checked to hold the column. */
const cell = (fields: readonly string[], at: Columns, name: string): string =>
  fields[at[name]!] ?? "";

/** The column at the index of a line in a file checked to hold it. */
const column = (at: Columns, name: string): number => at[name]!;

/** The expression a variation's name holds, `NM_000249.4:c.2042C>T` of `NM_000249.4(MLH1):c.2042C>T (p.Ala681Val)`. */
function nameExpression(name: string): string | undefined {
  if (!name.startsWith("NM_")) return undefined;
  const found = NAME_EXPRESSION.exec(name);
  return found === null ? undefined : `${found[1]}:${found[3]}`;
}

/** A coding expression of one reference sequence, not of a complex allele such as `coding, Haplotype`. */
const simple = (type: string): boolean => !type.includes(",");

/** What one assembly's line of a variation says. */
interface Says {
  readonly classification: string;
  readonly reviewStatus: string;
  readonly lastEvaluated: string;
  readonly submitters: string;
  readonly scvs: string | undefined;
}

interface Variation {
  readonly name: string;
  readonly says: Map<string, Says>;
}

const sameSaid = (a: Says, b: Says): boolean =>
  a.classification === b.classification &&
  a.reviewStatus === b.reviewStatus &&
  a.lastEvaluated === b.lastEvaluated &&
  a.submitters === b.submitters &&
  a.scvs === b.scvs;

/** The ids as a finding shows them: the first few in numeric order. */
function firstOf(ids: Iterable<string>): string {
  const sorted = [...ids].sort((a, b) => Number(a) - Number(b));
  return `${sorted.slice(0, SHOWN).join(", ")}${sorted.length > SHOWN ? ", …" : ""}`;
}

function day(text: string): string | undefined {
  const found = /^([A-Z][a-z]{2}) (\d{2}), (\d{4})$/.exec(text);
  const month = MONTHS.indexOf(found?.[1] ?? "");
  return found === null || month < 0
    ? undefined
    : `${found[3]}-${String(month + 1).padStart(2, "0")}-${found[2]}`;
}

/**
 * `variant_summary` (the monthly archive) and `hgvs4variation` (the current snapshot), both tab-separated gzip, read by
 * their header's names. A variation of the declared genes is a row; its expressions are what a submitter used, and
 * the one its name holds, but not an expression that names more than one variation anywhere in either file.
 */
const build: Build = async function* (release: Release) {
  const genes = new Set(release.genes(CLASSIFICATIONS));
  if (genes.size === 0)
    throw new Refusal("the source declares no genes for its classifications");
  const classes = release.concepts(`${REC}ClinVarClassifications`);
  const statuses = release.concepts(`${REC}ClinVarReviewStatuses`);
  const variationIri = (id: string): string =>
    release.codeIri(`${REC}ClinVar`, id);
  const summary = release.file(VARIANT_SUMMARY);
  const snapshot = release.file(HGVS4VARIATION);

  const listed = new Map<string, Variation>();
  await scan(
    summary,
    [
      "VariationID",
      "GeneSymbol",
      "Name",
      "Assembly",
      "ClinicalSignificance",
      "ReviewStatus",
      "LastEvaluated",
      "NumberSubmitters",
    ],
    (line, at) => {
      const symbols = field(line, column(at, "GeneSymbol"));
      if (
        symbols.includes(";")
          ? !symbols.split(";").some((g) => genes.has(g))
          : !genes.has(symbols)
      )
        return;
      const fields = line.split("\t");
      const id = cell(fields, at, "VariationID");
      let held = listed.get(id);
      if (held === undefined) {
        held = { name: own(cell(fields, at, "Name")), says: new Map() };
        listed.set(own(id), held);
      }
      held.says.set(cell(fields, at, "Assembly"), {
        classification: own(cell(fields, at, "ClinicalSignificance")),
        reviewStatus: own(cell(fields, at, "ReviewStatus")),
        lastEvaluated: own(cell(fields, at, "LastEvaluated")),
        submitters: own(cell(fields, at, "NumberSubmitters")),
        scvs: at[SCVS] === undefined ? undefined : own(cell(fields, at, SCVS)),
      });
    },
  );

  const submitted = new Map<string, Set<string>>();
  const unlisted = new Set<string>();
  await scan(
    snapshot,
    ["Symbol", "VariationID", "Type", "NucleotideExpression", "Submitted"],
    (line, at) => {
      const id = field(line, column(at, "VariationID"));
      if (!listed.has(id)) {
        if (genes.has(field(line, column(at, "Symbol")))) unlisted.add(id);
        return;
      }
      const fields = line.split("\t");
      const expression = cell(fields, at, "NucleotideExpression");
      const used = cell(fields, at, "Submitted");
      if (
        !expression.startsWith("NM_") ||
        !simple(cell(fields, at, "Type")) ||
        (used !== "Current" && used !== "Previous")
      )
        return;
      let held = submitted.get(id);
      if (held === undefined) submitted.set(id, (held = new Set()));
      held.add(own(expression));
    },
  );

  const candidates = new Set<string>();
  for (const expressions of submitted.values())
    for (const expression of expressions) candidates.add(expression);
  for (const { name } of listed.values()) {
    const expression = nameExpression(name);
    if (expression !== undefined) candidates.add(expression);
  }

  /** A candidate's first owner, or "" once a second variation has it. */
  const owner = new Map<string, string>();
  const owns = (expression: string, id: string): void => {
    const held = owner.get(expression);
    if (held === undefined) owner.set(own(expression), id);
    else if (held !== id) owner.set(expression, "");
  };
  await scan(
    snapshot,
    ["VariationID", "Type", "NucleotideExpression"],
    (line, at) => {
      const expression = field(line, column(at, "NucleotideExpression"));
      if (
        expression.startsWith("NM_") &&
        candidates.has(expression) &&
        simple(field(line, column(at, "Type")))
      )
        owns(expression, field(line, column(at, "VariationID")));
    },
  );
  await scan(summary, ["VariationID", "Name"], (line, at) => {
    const expression = nameExpression(field(line, column(at, "Name")));
    const key = expression !== undefined && candidates.has(expression);
    if (!key && unlisted.size === 0) return;
    const id = field(line, column(at, "VariationID"));
    unlisted.delete(id);
    if (key) owns(expression!, id);
  });

  const ambiguous = new Set(
    [...owner]
      .filter(([, who]) => who === "")
      .map(([expression]) => expression),
  );
  const notCoding: string[] = [];
  const unmapped = new Map<string, number>();
  const disagreeing: string[] = [];
  const unmappedIn = (kind: string, term: string): void => {
    const key = `${kind} "${term}"`;
    unmapped.set(key, (unmapped.get(key) ?? 0) + 1);
  };

  const ids = [...listed.keys()].sort((a, b) => Number(a) - Number(b));
  for (const id of ids) {
    const { name, says } = listed.get(id)!;
    const g38 = says.get("GRCh38");
    const g37 = says.get("GRCh37");
    if (g38 !== undefined && g37 !== undefined && !sameSaid(g38, g37))
      disagreeing.push(id);
    const said = g38 ?? g37 ?? [...says.values()][0]!;

    const concepts: string[] = [];
    const terms =
      said.classification === "-"
        ? ["-"]
        : said.classification
            .split("; ")
            .flatMap((part) => part.split("/"))
            .filter((term) => term !== "");
    for (const term of terms) {
      const concept = classes.get(term);
      if (concept === undefined) unmappedIn("classification", term);
      else if (!concepts.includes(concept)) concepts.push(concept);
    }
    let reviewStatus: string | undefined;
    if (said.reviewStatus !== "-") {
      reviewStatus = statuses.get(said.reviewStatus);
      if (reviewStatus === undefined)
        unmappedIn("review status", said.reviewStatus);
    }
    const lastEvaluated =
      said.lastEvaluated === "-" ? undefined : day(said.lastEvaluated);
    if (said.lastEvaluated !== "-" && lastEvaluated === undefined)
      unmappedIn("last evaluated", said.lastEvaluated);

    const expressions = new Set<string>(submitted.get(id));
    const named = nameExpression(name);
    if (named !== undefined) expressions.add(named);
    const hgvs: string[] = [];
    for (const expression of [...expressions].sort()) {
      if (ambiguous.has(expression)) continue;
      const code = release.codeIri(`${REC}HGVS`, expression);
      if (HGVS_CODE.test(code)) hgvs.push(code);
      else notCoding.push(expression);
    }

    const count =
      said.scvs === undefined
        ? { submitters: Number(said.submitters) }
        : {
            contributingSubmitters:
              said.scvs === "-" ? 0 : said.scvs.split("|").length,
          };
    yield {
      series: CLASSIFICATIONS,
      variation: variationIri(id),
      ...(hgvs.length === 0 ? {} : { hgvs }),
      ...(concepts.length === 0 ? {} : { classification: concepts }),
      ...(reviewStatus === undefined ? {} : { reviewStatus }),
      ...(lastEvaluated === undefined ? {} : { lastEvaluated }),
      ...count,
    };
    yield {
      series: NAMES,
      subject: variationIri(id),
      prefLabel: name,
      notation: id,
    };
  }

  if (ambiguous.size > 0)
    release.finding(
      `${ambiguous.size} expressions name more than one VariationID in ${HGVS4VARIATION} or ${VARIANT_SUMMARY} and key no row: ${[...ambiguous].sort().slice(0, SHOWN).join(", ")}${ambiguous.size > SHOWN ? ", …" : ""}`,
    );
  if (notCoding.length > 0)
    release.finding(
      `${notCoding.length} expressions are no coding NM_ expression in its normal form and key no row: ${notCoding.slice(0, SHOWN).join(", ")}${notCoding.length > SHOWN ? ", …" : ""}`,
    );
  for (const [term, rows] of [...unmapped].sort())
    release.finding(
      `${term} is in no concept of the vocabulary's schemes: ${rows} variations hold it, and keep the terms that matched`,
    );
  if (disagreeing.length > 0)
    release.finding(
      `${disagreeing.length} variations have GRCh38 and GRCh37 lines that disagree, and GRCh38 was taken: ${firstOf(disagreeing)}`,
    );
  if (unlisted.size > 0)
    release.finding(
      `${unlisted.size} VariationIDs of ${[...genes].sort().join(", ")} are in ${HGVS4VARIATION} and not in ${VARIANT_SUMMARY}, and were skipped: ${firstOf(unlisted)}`,
    );
};

export default build;
