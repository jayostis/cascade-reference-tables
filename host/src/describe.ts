import type { Differences } from "./pipeline.js";
import { DCT, OWL, type Quad, SKOS } from "./rdf.js";

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
  return decodeURIComponent(iri.split(/[/#]/).pop()!);
}

function plain(text: string): string {
  return text.replace(/[\\`*_[\]<>&|]/g, (c) => `\\${c}`).replace(/\s+/g, " ");
}

function code(iri: string): string {
  return `\`${codeOf(iri)}\``;
}

function objectsOf(rows: readonly Quad[], predicate: string): string[] {
  return rows
    .filter((q) => q.predicate.value === predicate)
    .map((q) => q.object.value);
}

/** A row by what it says: a mapping as source code, target code and predicate, names as code and label, status as code and status. */
function line(rows: readonly Quad[]): Line {
  const [source] = objectsOf(rows, `${OWL}annotatedSource`);
  if (source !== undefined) {
    const target = objectsOf(rows, `${OWL}annotatedTarget`)[0]!;
    const predicate = codeOf(objectsOf(rows, `${OWL}annotatedProperty`)[0]!);
    return {
      sort: [codeOf(source), predicate, codeOf(target)],
      text: `${code(source)} → ${code(target)} (${predicate})`,
    };
  }
  const subject = rows[0]!.subject.value;
  const [label] = objectsOf(rows, `${SKOS}prefLabel`);
  const notation = objectsOf(rows, `${SKOS}notation`)[0] ?? codeOf(subject);
  if (label !== undefined)
    return {
      sort: [notation],
      text: `\`${notation}\`: ${plain(label)}`,
    };
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
): Described {
  const was = byKey(before);
  const now = byKey(after);
  return {
    added: sorted(found.added.map((key) => line(now.get(key)!))),
    removed: sorted(found.removed.map((key) => line(was.get(key)!))),
    changed: sorted(
      found.changed.map((key) => {
        const next = line(now.get(key)!);
        return {
          ...next,
          text: `${next.text} (was ${line(was.get(key)!).text})`,
        };
      }),
    ),
  };
}
