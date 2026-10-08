import { createHash } from "node:crypto";
import { canonize } from "rdf-canonize";
import { defaultGraph, PROV, type Quad, quad, triple } from "./rdf.js";

const NI = "ni:///sha-256;";
const RECORD_NAMESPACE = "90c60849-c5ef-4ca6-bfb8-8662bd07d2b5";

export const THIS_VERSION = "urn:cascade:this-version";

export function sha256(bytes: Uint8Array | string): Buffer {
  return createHash("sha256").update(bytes).digest();
}

/** A document's name from its bytes (cascade-vocabulary runtime/rules.md, N5). */
export function documentName(bytes: Uint8Array | string): string {
  return NI + sha256(bytes).toString("base64url");
}

/** A name from its inputs by the Bridge's record rule (N2). */
export function recordName(inputs: readonly string[]): string {
  const digest = sha256([RECORD_NAMESPACE, ...inputs].join("|"));
  digest[6] = (digest[6]! & 0x0f) | 0x80;
  digest[8] = (digest[8]! & 0x3f) | 0x80;
  const hex = digest.subarray(0, 16).toString("hex");
  return `urn:uuid:${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** The quads' canonical N-Quads by RDFC-1.0. */
export function canonical(quads: readonly Quad[]): Promise<string> {
  return canonize([...quads], { algorithm: "RDFC-1.0" });
}

/** A name from triples, by N3: their canonical form's document name. */
export async function contentName(triples: readonly Quad[]): Promise<string> {
  if (
    triples.some((t) =>
      [t.subject, t.object].some((term) => term.termType === "BlankNode"),
    )
  )
    throw new Error("content to be named holds a blank node");
  return documentName(
    await canonical(
      triples.map((t) =>
        quad(t.subject, t.predicate, t.object, defaultGraph()),
      ),
    ),
  );
}

/** A version's name by N12, from its series, the version it revises and its rows. */
export function versionName(
  series: string,
  previous: string | undefined,
  rows: readonly Quad[],
): Promise<string> {
  return contentName([
    triple(THIS_VERSION, `${PROV}specializationOf`, series),
    ...(previous === undefined
      ? []
      : [triple(THIS_VERSION, `${PROV}wasRevisionOf`, previous)]),
    ...rows,
  ]);
}
