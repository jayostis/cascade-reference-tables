import { escape, PREFIXES, type Quad, RDF, type Term, XSD } from "./rdf.js";

/**
 * Triples as Turtle a person reviews: prefixed names, IRIs under the base written relative to it, one block per
 * subject, the base's first, blank nodes inline, everything sorted.
 */
export function writeTurtle(triples: readonly Quad[], base: string): string {
  const bySubject = new Map<string, Quad[]>();
  const blanks = new Map<string, Quad[]>();
  for (const t of triples) {
    const into = t.subject.termType === "BlankNode" ? blanks : bySubject;
    const group = into.get(t.subject.value) ?? [];
    group.push(t);
    into.set(t.subject.value, group);
  }
  const used = new Set<string>();
  const name = (term: Term): string => {
    if (term.termType === "NamedNode") {
      if (term.value.startsWith(base))
        return `<${term.value.slice(base.length)}>`;
      for (const [prefix, space] of Object.entries(PREFIXES)) {
        const local = term.value.slice(space.length);
        if (term.value.startsWith(space) && /^[A-Za-z_][\w-]*$/.test(local)) {
          used.add(prefix);
          return `${prefix}:${local}`;
        }
      }
      return `<${term.value}>`;
    }
    if (term.termType === "BlankNode")
      return `[ ${properties(blanks.get(term.value) ?? [], "    ").join(" ; ")} ]`;
    if (term.termType === "Literal") {
      const text = `"${escape(term.value)}"`;
      if (term.language !== "") return `${text}@${term.language}`;
      if (term.datatype.value === `${XSD}string`) return text;
      if (term.datatype.value === `${XSD}boolean`) return term.value;
      return `${text}^^${name(term.datatype)}`;
    }
    throw new Error(`${term.termType} is not written`);
  };
  const properties = (group: readonly Quad[], indent: string): string[] => {
    const byPredicate = new Map<string, Term[]>();
    for (const t of group) {
      const objects = byPredicate.get(t.predicate.value) ?? [];
      objects.push(t.object);
      byPredicate.set(t.predicate.value, objects);
    }
    return [...byPredicate]
      .map(([predicate, objects]) => {
        const verb =
          predicate === `${RDF}type`
            ? "a"
            : name({ termType: "NamedNode", value: predicate } as Term);
        const written = objects.map(name).sort();
        return `${verb} ${written.join(`,\n${indent}    `)}`;
      })
      .sort((a, b) =>
        a.startsWith("a ") ? -1 : b.startsWith("a ") ? 1 : a < b ? -1 : 1,
      );
  };
  const blocks = [...bySubject]
    .map(([subject, group]) => {
      const head = name({ termType: "NamedNode", value: subject } as Term);
      return {
        head,
        text: `${head}\n    ${properties(group, "    ").join(" ;\n    ")} .`,
      };
    })
    .sort((a, b) =>
      a.head === "<>" ? -1 : b.head === "<>" ? 1 : a.head < b.head ? -1 : 1,
    )
    .map(({ text }) => text);
  const prefixes = [...used]
    .sort()
    .map((prefix) => `@prefix ${prefix}: <${PREFIXES[prefix]}> .`);
  return `${prefixes.join("\n")}\n\n${blocks.join("\n\n")}\n`;
}
