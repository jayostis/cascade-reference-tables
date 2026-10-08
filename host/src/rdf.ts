import * as oxigraph from "oxigraph";

export type Quad = oxigraph.Quad;
export type Term = oxigraph.Term;
export type NamedNode = oxigraph.NamedNode;
export type Literal = oxigraph.Literal;

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

export const { namedNode, blankNode, quad, defaultGraph } = oxigraph;

/** A literal, an `xsd:string` unless a datatype's IRI is given. */
export function literal(value: string, datatype?: string): Literal {
  return datatype === undefined
    ? oxigraph.literal(value)
    : oxigraph.literal(value, oxigraph.namedNode(datatype));
}

export function iri(value: string): NamedNode {
  return oxigraph.namedNode(value);
}

export function triple(
  subject: string | oxigraph.BlankNode,
  predicate: string,
  object: string | Term,
): Quad {
  return oxigraph.quad(
    typeof subject === "string" ? iri(subject) : subject,
    iri(predicate),
    (typeof object === "string" ? iri(object) : object) as oxigraph.Quad_Object,
  );
}

export function parseTurtle(text: string, base: string): Quad[] {
  return oxigraph.parse(text, { format: "text/turtle", base_iri: base });
}

export function parseTrig(text: string): Quad[] {
  return oxigraph.parse(text, { format: "application/trig" });
}

export function parseNQuads(text: string): Quad[] {
  return oxigraph.parse(text, { format: "application/n-quads" });
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
      throw new Error(`${term.termType} is not written`);
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
  private readonly store: oxigraph.Store;

  constructor(readonly quads: readonly Quad[]) {
    this.store = new oxigraph.Store(quads);
  }

  objects(subject: string | Term, predicate: string): Term[] {
    return this.store
      .match(
        typeof subject === "string" ? iri(subject) : subject,
        iri(predicate),
        null,
        null,
      )
      .map((q) => q.object);
  }

  subjects(predicate: string, object: string | Term): string[] {
    return this.store
      .match(
        null,
        iri(predicate),
        typeof object === "string" ? iri(object) : object,
        null,
      )
      .map((q) => q.subject.value);
  }

  one(subject: string | Term, predicate: string): Term | undefined {
    return this.objects(subject, predicate)[0];
  }

  value(subject: string | Term, predicate: string): string | undefined {
    return this.one(subject, predicate)?.value;
  }

  about(subject: string): Quad[] {
    return this.store.match(iri(subject), null, null, null);
  }
}
