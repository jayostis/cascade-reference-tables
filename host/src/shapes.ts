import { readFile } from "node:fs/promises";
import SHACLValidator from "rdf-validate-shacl";
import factory from "rdf-validate-shacl/src/defaultEnv.js";
import type * as RDFJS from "@rdfjs/types";
import { parseTurtle, type Quad, SH, type Term, triple } from "./rdf.js";

function term(value: Term): RDFJS.Quad_Object {
  switch (value.termType) {
    case "NamedNode":
      return factory.namedNode(value.value);
    case "BlankNode":
      return factory.blankNode(value.value);
    case "Literal":
      return factory.literal(
        value.value,
        value.language || factory.namedNode(value.datatype.value),
      );
    default:
      throw new Error(
        `${(value as { termType: string }).termType} is not checked`,
      );
  }
}

function dataset(quads: readonly Quad[]): RDFJS.DatasetCore {
  return factory.dataset(
    quads.map((q) =>
      factory.quad(
        term(q.subject) as RDFJS.Quad_Subject,
        factory.namedNode(q.predicate.value),
        term(q.object),
      ),
    ),
  );
}

function said(
  report: Awaited<ReturnType<SHACLValidator["validate"]>>,
): string[] {
  return report.results
    .map(
      (result) =>
        `${result.focusNode?.value ?? ""}${result.path === null || result.path === undefined ? "" : ` ${result.path.value}`}: ${result.message.map(({ value }) => value).join(" ") || result.sourceConstraintComponent?.value}`,
    )
    .sort();
}

/** A shapes graph, and what it says of data. A check has a validator of its own: one keeps every result it found. */
export class Shapes {
  constructor(private readonly shapes: readonly Quad[]) {}

  static async read(...paths: string[]): Promise<Shapes> {
    const quads: Quad[] = [];
    for (const path of paths)
      quads.push(...parseTurtle(await readFile(path, "utf8"), "urn:shapes:"));
    return new Shapes(quads);
  }

  /** Every result of the shapes' targets on the data; none when it conforms. */
  async violations(data: readonly Quad[]): Promise<string[]> {
    return said(
      await new SHACLValidator(dataset(this.shapes)).validate(dataset(data)),
    );
  }

  /** Every result of the shape on each focus node; none when each conforms. */
  async violationsOf(
    data: readonly Quad[],
    focusNodes: Iterable<string>,
    shape: string,
  ): Promise<string[]> {
    const targets = [...focusNodes].map((focus) =>
      triple(shape, `${SH}targetNode`, focus),
    );
    return said(
      await new SHACLValidator(dataset([...this.shapes, ...targets])).validate(
        dataset(data),
      ),
    );
  }
}
