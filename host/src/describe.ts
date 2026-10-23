import type { Differences } from "./pipeline.js";
import { DCT, OWL, type Quad, CASCADE, SKOS, SSSOM } from "./rdf.js";

/** The label of a concept IRI, where the vocabulary gives one. */
export type LabelOf = (iri: string) => string | undefined;

/** Each difference as a line a person can read, sorted by code. */
export interface Described {
  readonly added: readonly string[];
  readonly removed: readonly string[];
  readonly changed: readonly string[];
}

interface Line {
  readonly sort: readonly string[];
  readonly text: string;
}

const NUMERIC = new Intl.Collator("en", { numeric: true });

function codeOf(iri: string): string {
  return iri
    .split(/[/#]/)
    .pop()!
    .replace(/^(clinvar|unii):/, "");
}

function plain(text: string): string {
  return text
    .replace(/[\\`*_[\]<>&|@~#]/g, (c) => `\\${c}`)
    .replace(/\s+/g, " ");
}

function code(iri: string): string {
  return `\`${codeOf(iri)}\``;
}

function objectsOf(rows: readonly Quad[], predicate: string): string[] {
  return rows
    .filter((q) => q.predicate.value === predicate)
    .map((q) => q.object.value);
}

const CLASSIFICATION_PREDICATES = [
  "hgvsExpression",
  "clinvarClassification",
  "clinvarReviewStatus",
  "lastEvaluated",
  "contributingSubmitterCount",
  "submitterCount",
].map((name) => `${CASCADE}${name}`);

/** A classification row by its variation, what its source classes it as, when, and how many expressions find it. */
function classification(rows: readonly Quad[], labelOf: LabelOf): Line {
  const subject = rows[0]!.subject.value;
  const named = (iri: string): string => plain(labelOf(iri) ?? codeOf(iri));
  const classes = objectsOf(rows, `${CASCADE}clinvarClassification`)
    .map(named)
    .sort();
  const [status] = objectsOf(rows, `${CASCADE}clinvarReviewStatus`);
  const [evaluated] = objectsOf(rows, `${CASCADE}lastEvaluated`);
  const expressions = objectsOf(rows, `${CASCADE}hgvsExpression`).length;
  const parts = [
    classes.length === 0 ? "no classification" : classes.join(", "),
    ...(status === undefined ? [] : [`(${named(status)})`]),
  ];
  return {
    sort: [codeOf(subject)],
    text: `${code(subject)}: ${parts.join(" ")}${evaluated === undefined ? "" : `, ${evaluated}`}, ${expressions} ${expressions === 1 ? "expression" : "expressions"}`,
  };
}

/** A row by what it says: a mapping as source code, target code and predicate, names as code and label, status as code and status. */
function line(rows: readonly Quad[], labelOf: LabelOf, whole = false): Line {
  if (rows.some((q) => CLASSIFICATION_PREDICATES.includes(q.predicate.value)))
    return classification(rows, labelOf);
  const [source] = objectsOf(rows, `${OWL}annotatedSource`);
  if (source !== undefined) {
    const target = objectsOf(rows, `${OWL}annotatedTarget`)[0]!;
    const predicate = codeOf(objectsOf(rows, `${OWL}annotatedProperty`)[0]!);
    const [justification] = objectsOf(rows, `${SSSOM}mapping_justification`);
    const [sequence] = objectsOf(rows, `${CASCADE}panelSequence`);
    const [required] = objectsOf(rows, `${CASCADE}observationRequiredInPanel`);
    const place =
      sequence === undefined
        ? ""
        : `, at ${sequence}${required === undefined ? "" : `, ${required}`}`;
    return {
      sort: [codeOf(source), predicate, codeOf(target), sequence ?? ""],
      text: `${code(source)} → ${code(target)} (${predicate}${place}${whole && justification !== undefined ? `, justified by ${codeOf(justification)}` : ""})`,
    };
  }
  const subject = rows[0]!.subject.value;
  const [label] = objectsOf(rows, `${SKOS}prefLabel`);
  const notation = objectsOf(rows, `${SKOS}notation`)[0] ?? codeOf(subject);
  if (label !== undefined) {
    const alternatives = objectsOf(rows, `${SKOS}altLabel`).sort();
    return {
      sort: [notation],
      text: `\`${notation}\`: ${plain(label)}${whole && alternatives.length > 0 ? `, also called ${alternatives.map(plain).join("; ")}` : ""}`,
    };
  }
  const replacements = objectsOf(rows, `${DCT}isReplacedBy`).map(code);
  return {
    sort: [codeOf(subject)],
    text: `${code(subject)}: retired${replacements.length === 0 ? "" : `, replaced by ${replacements.join(", ")}`}`,
  };
}

function byKey(rows: readonly Quad[]): Map<string, Quad[]> {
  const found = new Map<string, Quad[]>();
  for (const q of rows) {
    const group = found.get(q.subject.value) ?? [];
    group.push(q);
    found.set(q.subject.value, group);
  }
  return found;
}

function sorted(lines: readonly Line[]): string[] {
  return [...lines]
    .sort((a, b) => {
      for (const [i, part] of a.sort.entries()) {
        const order = NUMERIC.compare(part, b.sort[i] ?? "");
        if (order !== 0) return order;
      }
      return NUMERIC.compare(a.text, b.text);
    })
    .map(({ text }) => text);
}

/** The rows of two versions' differences, each described by its codes rather than its record ID. */
export function describe(
  before: readonly Quad[],
  after: readonly Quad[],
  found: Differences,
  labelOf: LabelOf = () => undefined,
): Described {
  const was = byKey(before);
  const now = byKey(after);
  return {
    added: sorted(found.added.map((key) => line(now.get(key)!, labelOf))),
    removed: sorted(found.removed.map((key) => line(was.get(key)!, labelOf))),
    changed: sorted(
      found.changed.map((key) => {
        const next = line(now.get(key)!, labelOf, true);
        return {
          ...next,
          text: `${next.text} (was ${line(was.get(key)!, labelOf, true).text})`,
        };
      }),
    ),
  };
}
