import { gunzipSync, gzipSync } from "node:zlib";
import { canonical, sha256 } from "./names.js";
import { iri, parseNQuads, quad, type Quad } from "./rdf.js";

const OS_UNKNOWN = 255;

/** Bytes gzipped with a fixed header: no time, no file name, the OS unknown, so every system writes the same. */
export function gzip(bytes: Uint8Array | string): Buffer {
  const zipped = gzipSync(bytes, { level: 9 });
  zipped.writeUInt32LE(0, 4);
  zipped[9] = OS_UNKNOWN;
  return zipped;
}

/** A version's rows file: its rows' canonical N-Quads in the graph named by the version, gzipped. */
export async function rowsFile(
  version: string,
  rows: readonly Quad[],
): Promise<{ bytes: Buffer; checksum: string; file: string }> {
  const graph = iri(version);
  const text = await canonical(
    rows.map((t) => quad(t.subject, t.predicate, t.object, graph)),
  );
  const bytes = gzip(text);
  const checksum = sha256(bytes).toString("hex");
  return { bytes, checksum, file: `rows/${checksum}.nq.gz` };
}

/** A rows file's triples, its graph dropped, once its bytes match the checksum. */
export function readRowsFile(bytes: Uint8Array, checksum: string): Quad[] {
  const found = sha256(bytes).toString("hex");
  if (found !== checksum)
    throw new Error(`a rows file's checksum is ${found}, not ${checksum}`);
  return parseNQuads(gunzipSync(bytes).toString("utf8")).map((q) =>
    quad(q.subject, q.predicate, q.object),
  );
}
