import * as oxigraph from "oxigraph";

export interface NamedNode {
  readonly termType: "NamedNode";
  readonly value: string;
}
export interface BlankNode {
  readonly termType: "BlankNode";
  readonly value: string;
}
export interface Literal {
  readonly termType: "Literal";
  readonly value: string;
  readonly language: string;
  readonly datatype: NamedNode;
}
export interface DefaultGraph {
  readonly termType: "DefaultGraph";
  readonly value: "";
}
export type Term = NamedNode | BlankNode | Literal;
/** A quad as plain JS objects: Oxigraph's wasm terms cost a crossing for every field read. */
export interface Quad {
  readonly subject: NamedNode | BlankNode;
  readonly predicate: NamedNode;
  readonly object: Term;
  readonly graph: NamedNode | BlankNode | DefaultGraph;
}

export const RDF = "http://www.w3.org/1999/02/22-rdf-syntax-ns#";
export const RDFS = "http://www.w3.org/2000/01/rdf-schema#";
export const XSD = "http://www.w3.org/2001/XMLSchema#";
export const OWL = "http://www.w3.org/2002/07/owl#";
export const SKOS = "http://www.w3.org/2004/02/skos/core#";
export const SH = "http://www.w3.org/ns/shacl#";
export const DCT = "http://purl.org/dc/terms/";
export const DCAT = "http://www.w3.org/ns/dcat#";
export const PROV = "http://www.w3.org/ns/prov#";
export const PAV = "http://purl.org/pav/";
export const ADMS = "http://www.w3.org/ns/adms#";
export const SPDX = "http://spdx.org/rdf/terms#";
export const VOID = "http://rdfs.org/ns/void#";
export const SSSOM = "https://w3id.org/sssom/";
export const SEMAPV = "https://w3id.org/semapv/vocab/";
export const REC = "https://ns.cascadeprotocol.org/records/v1-draft#";
export const TABLES = "https://ns.cascadeprotocol.org/tables/v1-draft#";

export const PREFIXES: Readonly<Record<string, string>> = {
  adms: ADMS,
  dcat: DCAT,
  dct: DCT,
  owl: OWL,
  pav: PAV,
  prov: PROV,
  rdf: RDF,
  rdfs: RDFS,
  rec: REC,
  semapv: SEMAPV,
  skos: SKOS,
  spdx: SPDX,
  sssom: SSSOM,
  tables: TABLES,
  xsd: XSD,
};

export function iri(value: string): NamedNode {
  return { termType: "NamedNode", value };
}

export const namedNode = iri;

let blanks = 0;

export function blankNode(value = `b${++blanks}`): BlankNode {
  return { termType: "BlankNode", value };
}

const DEFAULT_GRAPH: DefaultGraph = { termType: "DefaultGraph", value: "" };

export function defaultGraph(): DefaultGraph {
  return DEFAULT_GRAPH;
}

/** A literal, an `xsd:string` unless a datatype's IRI is given. */
export function literal(
  value: string,
  datatype?: string,
  language = "",
): Literal {
  return {
    termType: "Literal",
    value,
    language,
    datatype: iri(
      language !== "" ? `${RDF}langString` : (datatype ?? `${XSD}string`),
    ),
  };
}

export function quad(
  subject: NamedNode | BlankNode,
  predicate: NamedNode,
  object: Term,
  graph: Quad["graph"] = DEFAULT_GRAPH,
): Quad {
  return { subject, predicate, object, graph };
}

export function triple(
  subject: string | BlankNode,
  predicate: string,
  object: string | Term,
): Quad {
  return quad(
    typeof subject === "string" ? iri(subject) : subject,
    iri(predicate),
    typeof object === "string" ? iri(object) : object,
  );
}

/** Two terms are the same term. */
export function same(
  a: Term | Quad["graph"],
  b: Term | Quad["graph"],
): boolean {
  return (
    a.termType === b.termType &&
    a.value === b.value &&
    (a.termType !== "Literal" ||
      (b.termType === "Literal" &&
        a.language === b.language &&
        a.datatype.value === b.datatype.value))
  );
}

/** Two quads are the same quad. */
export function sameQuad(a: Quad, b: Quad): boolean {
  return (
    same(a.subject, b.subject) &&
    same(a.predicate, b.predicate) &&
    same(a.object, b.object) &&
    same(a.graph, b.graph)
  );
}

function plainTerm(term: oxigraph.Term): Term | DefaultGraph {
  switch (term.termType) {
    case "NamedNode":
      return iri(term.value);
    case "BlankNode":
      return blankNode(term.value);
    case "Literal":
      return literal(term.value, term.datatype.value, term.language);
    case "DefaultGraph":
      return DEFAULT_GRAPH;
    default:
      throw new Error(`${term.termType} is not read`);
  }
}

export function fromOxigraph(q: oxigraph.Quad): Quad {
  return quad(
    plainTerm(q.subject) as NamedNode | BlankNode,
    iri(q.predicate.value),
    plainTerm(q.object) as Term,
    plainTerm(q.graph) as Quad["graph"],
  );
}

function oxigraphTerm(term: Term | Quad["graph"]): oxigraph.Term {
  switch (term.termType) {
    case "NamedNode":
      return oxigraph.namedNode(term.value);
    case "BlankNode":
      return oxigraph.blankNode(term.value);
    case "Literal":
      return term.language !== ""
        ? oxigraph.literal(term.value, term.language)
        : oxigraph.literal(term.value, oxigraph.namedNode(term.datatype.value));
    default:
      return oxigraph.defaultGraph();
  }
}

export function toOxigraph(q: Quad): oxigraph.Quad {
  return oxigraph.quad(
    oxigraphTerm(q.subject) as oxigraph.Quad_Subject,
    oxigraph.namedNode(q.predicate.value),
    oxigraphTerm(q.object) as oxigraph.Quad_Object,
    oxigraphTerm(q.graph) as oxigraph.Quad_Graph,
  );
}

export function parseTurtle(text: string, base: string): Quad[] {
  return oxigraph
    .parse(text, { format: "text/turtle", base_iri: base })
    .map(fromOxigraph);
}

export function parseTrig(text: string): Quad[] {
  return oxigraph.parse(text, { format: "application/trig" }).map(fromOxigraph);
}

const NQUADS_LINE =
  /^<([^>]*)> <([^>]*)> (?:<([^>]*)>|"((?:[^"\\]|\\.)*)"(?:@([a-zA-Z]+(?:-[a-zA-Z0-9]+)*)|\^\^<([^>]*)>)?)(?: <([^>]*)>)? \.$/;

const UNESCAPED: Readonly<Record<string, string>> = {
  t: "\t",
  b: "\b",
  n: "\n",
  r: "\r",
  f: "\f",
  '"': '"',
  "'": "'",
  "\\": "\\",
};

function unescaped(text: string): string {
  return text.replace(
    /\\(?:u([0-9A-Fa-f]{4})|U([0-9A-Fa-f]{8})|(.))/g,
    (whole, short?: string, long?: string, char?: string) => {
      const hex = short ?? long;
      if (hex !== undefined) return String.fromCodePoint(parseInt(hex, 16));
      const found = UNESCAPED[char!];
      if (found === undefined) throw new Error(`${whole} is no escape`);
      return found;
    },
  );
}

/**
 * N-Quads whose terms are IRIs and literals, as the host writes rows files, read line by line without Oxigraph: a
 * large version read into its wasm memory keeps that memory for the rest of the run.
 */
export function parseNQuads(text: string): Quad[] {
  const quads: Quad[] = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "") continue;
    const found = NQUADS_LINE.exec(trimmed);
    if (found === null)
      throw new Error(`${trimmed} is not an N-Quads line of IRIs and literals`);
    const [, subject, predicate, object, value, language, datatype, graph] =
      found;
    quads.push(
      quad(
        iri(subject!),
        iri(predicate!),
        object !== undefined
          ? iri(object)
          : literal(unescaped(value!), datatype, language ?? ""),
        graph === undefined ? DEFAULT_GRAPH : iri(graph),
      ),
    );
  }
  return quads;
}

/** A term as N-Triples writes it. */
export function nt(term: Term): string {
  switch (term.termType) {
    case "NamedNode":
      return `<${term.value}>`;
    case "BlankNode":
      return `_:${term.value}`;
    case "Literal": {
      const text = `"${escape(term.value)}"`;
      if (term.language !== "") return `${text}@${term.language}`;
      if (term.datatype.value === `${XSD}string`) return text;
      return `${text}^^<${term.datatype.value}>`;
    }
    default:
      throw new Error(
        `${(term as { termType: string }).termType} is not written`,
      );
  }
}

export function escape(text: string): string {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r");
}

export function ntLine(q: Quad): string {
  return `${nt(q.subject)} ${nt(q.predicate)} ${nt(q.object)} .`;
}

/** A graph read by subject and predicate. */
export class Graph {
  private readonly bySubject = new Map<string, Quad[]>();
  private readonly byPredicate = new Map<string, Quad[]>();

  constructor(readonly quads: readonly Quad[]) {
    const seen = new Set<string>();
    for (const q of quads) {
      const line = `${ntLine(q)} ${q.graph.termType} ${q.graph.value}`;
      if (seen.has(line)) continue;
      seen.add(line);
      const subject = key(q.subject);
      if (!this.bySubject.has(subject)) this.bySubject.set(subject, []);
      this.bySubject.get(subject)!.push(q);
      const predicate = q.predicate.value;
      if (!this.byPredicate.has(predicate)) this.byPredicate.set(predicate, []);
      this.byPredicate.get(predicate)!.push(q);
    }
  }

  objects(subject: string | Term, predicate: string): Term[] {
    return (this.bySubject.get(key(subject)) ?? [])
      .filter((q) => q.predicate.value === predicate)
      .map((q) => q.object);
  }

  subjects(predicate: string, object: string | Term): string[] {
    const wanted = typeof object === "string" ? iri(object) : object;
    return (this.byPredicate.get(predicate) ?? [])
      .filter((q) => same(q.object, wanted))
      .map((q) => q.subject.value);
  }

  one(subject: string | Term, predicate: string): Term | undefined {
    return this.objects(subject, predicate)[0];
  }

  value(subject: string | Term, predicate: string): string | undefined {
    return this.one(subject, predicate)?.value;
  }

  about(subject: string): Quad[] {
    return this.bySubject.get(key(subject)) ?? [];
  }
}

function key(subject: string | Term): string {
  return typeof subject === "string"
    ? `NamedNode ${subject}`
    : `${subject.termType} ${subject.value}`;
}
