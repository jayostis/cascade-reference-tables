import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import {
  ADMS,
  blankNode,
  DCAT,
  DCT,
  Graph,
  literal,
  PAV,
  parseTurtle,
  PROV,
  type Quad,
  RDF,
  RDFS,
  sameQuad,
  REC,
  SPDX,
  SSSOM,
  TABLES,
  triple,
  XSD,
} from "./rdf.js";
import { writeTurtle } from "./turtle.js";

/** The base the feed is read with in the host; it never reaches a file, which holds relative IRIs only. */
export const FEED_BASE = "https://feed.invalid/";

const N_QUADS =
  "https://www.iana.org/assignments/media-types/application/n-quads";
const GZIP = "https://www.iana.org/assignments/media-types/application/gzip";

/** A series as its source declares it, with what the feed states of it. */
export interface SeriesDescription {
  readonly iri: string;
  readonly label: string;
  readonly kind: string;
  readonly source: string;
  readonly license: string;
  readonly publisher: string;
  readonly credit: string;
}

/** A file the version was built from, named by its content. */
export interface Input {
  readonly name: string;
  readonly title: string;
  readonly checksum: string;
  readonly modified?: string;
}

/** A new version, as the feed records it. */
export interface NewVersion {
  readonly series: SeriesDescription;
  readonly iri: string;
  readonly label: string;
  readonly previous: string | undefined;
  readonly notes: string;
  readonly issued: string;
  readonly inputs: readonly Input[];
  readonly builder: {
    readonly iri: string;
    readonly label: string;
    readonly version: string;
  };
  /** The rows file, relative to the feed. */
  readonly rowsFile: string;
  readonly checksum: string;
  readonly mapping: boolean;
}

function checksum(subject: string, hex: string): Quad[] {
  const node = blankNode();
  return [
    triple(subject, `${SPDX}checksum`, node),
    triple(node, `${RDF}type`, `${SPDX}Checksum`),
    triple(node, `${SPDX}algorithm`, `${SPDX}checksumAlgorithm_sha256`),
    triple(node, `${SPDX}checksumValue`, literal(hex)),
  ];
}

/** The catalog: every series, every version, and where each version's rows are. */
export class Feed {
  private quads: Quad[];

  private constructor(quads: readonly Quad[]) {
    this.quads = [...quads];
  }

  static parse(text: string): Feed {
    return new Feed(parseTurtle(text, FEED_BASE));
  }

  static async read(path: string): Promise<Feed> {
    return Feed.parse(await readFile(path, "utf8"));
  }

  static async readOrEmpty(path: string): Promise<Feed> {
    return existsSync(path) ? Feed.read(path) : emptyFeed();
  }

  get graph(): Graph {
    return new Graph(this.quads);
  }

  get triples(): readonly Quad[] {
    return this.quads;
  }

  current(series: string): string | undefined {
    return this.graph.value(series, `${DCAT}hasCurrentVersion`);
  }

  /** The rows file of a version, relative to the feed, and its checksum. */
  rowsOf(version: string): { file: string; checksum: string } {
    const graph = this.graph;
    const distribution = graph.value(version, `${DCAT}distribution`);
    const url = distribution && graph.value(distribution, `${DCAT}downloadURL`);
    const sum = distribution && graph.one(distribution, `${SPDX}checksum`);
    const hex = sum && graph.value(sum, `${SPDX}checksumValue`);
    if (url === undefined || hex === undefined || url === "" || hex === "")
      throw new Error(`the feed gives no rows file for ${version}`);
    if (!url.startsWith(FEED_BASE))
      throw new Error(
        `${version}'s rows file ${url} is not relative to the feed`,
      );
    return { file: url.slice(FEED_BASE.length), checksum: hex };
  }

  /** The current versions' input files, by title. */
  inputsOf(series: string): Map<string, Input> {
    const found = new Map<string, Input>();
    const version = this.current(series);
    if (version === undefined) return found;
    const graph = this.graph;
    for (const input of graph.objects(version, `${PROV}wasDerivedFrom`)) {
      const title = graph.value(input, `${DCT}title`) ?? "";
      const sum = graph.one(input, `${SPDX}checksum`);
      const modified = graph.value(input, `${DCT}modified`);
      found.set(title, {
        name: input.value,
        title,
        checksum: (sum && graph.value(sum, `${SPDX}checksumValue`)) ?? "",
        ...(modified === undefined ? {} : { modified }),
      });
    }
    return found;
  }

  /** Adds the version, which becomes its series' current one; nothing already stated is changed but that. */
  add(version: NewVersion, now: string): void {
    const { series } = version;
    const catalog = FEED_BASE;
    const has = (subject: string, predicate: string): boolean =>
      this.quads.some(
        (q) => q.subject.value === subject && q.predicate.value === predicate,
      );
    const add = (...quads: Quad[]): void => {
      for (const q of quads)
        if (!this.quads.some((held) => sameQuad(held, q))) this.quads.push(q);
    };
    const drop = (subject: string, predicate: string): void => {
      this.quads = this.quads.filter(
        (q) =>
          !(q.subject.value === subject && q.predicate.value === predicate),
      );
    };
    drop(catalog, `${DCT}modified`);
    add(
      triple(catalog, `${DCT}modified`, literal(now, `${XSD}dateTime`)),
      triple(catalog, `${DCAT}dataset`, series.iri),
    );
    if (!has(series.iri, `${RDFS}label`))
      add(
        triple(series.iri, `${RDF}type`, `${DCAT}Dataset`),
        triple(series.iri, `${RDF}type`, `${REC}ReferenceSeries`),
        triple(series.iri, `${RDFS}label`, literal(series.label)),
        triple(series.iri, `${REC}tableKind`, series.kind),
        triple(series.iri, `${DCT}source`, series.source),
        triple(series.iri, `${DCT}license`, series.license),
        triple(series.iri, `${DCT}publisher`, series.publisher),
        triple(
          series.iri,
          `${DCT}bibliographicCitation`,
          literal(series.credit),
        ),
      );
    drop(series.iri, `${DCAT}hasCurrentVersion`);
    const v = version.iri;
    const distribution = FEED_BASE + version.rowsFile;
    const label = literal(version.label);
    add(
      triple(series.iri, `${DCAT}hasVersion`, v),
      triple(series.iri, `${DCAT}hasCurrentVersion`, v),
      triple(v, `${RDF}type`, `${DCAT}Dataset`),
      triple(v, `${RDF}type`, `${PROV}Entity`),
      triple(v, `${PROV}specializationOf`, series.iri),
      triple(v, `${DCAT}version`, label),
      triple(v, `${PAV}version`, label),
      ...(version.previous === undefined
        ? []
        : [triple(v, `${PROV}wasRevisionOf`, version.previous)]),
      triple(v, `${ADMS}versionNotes`, literal(version.notes)),
      triple(v, `${DCT}issued`, literal(version.issued, `${XSD}dateTime`)),
      triple(v, `${PROV}wasAttributedTo`, version.builder.iri),
      triple(v, `${TABLES}builderVersion`, literal(version.builder.version)),
      triple(v, `${DCAT}distribution`, distribution),
      triple(distribution, `${RDF}type`, `${DCAT}Distribution`),
      triple(distribution, `${DCAT}downloadURL`, distribution),
      triple(distribution, `${DCAT}mediaType`, N_QUADS),
      triple(distribution, `${DCAT}compressFormat`, GZIP),
      triple(version.builder.iri, `${RDF}type`, `${TABLES}Builder`),
      triple(
        version.builder.iri,
        `${RDFS}label`,
        literal(version.builder.label),
      ),
    );
    if (!has(distribution, `${SPDX}checksum`))
      add(...checksum(distribution, version.checksum));
    for (const input of version.inputs) {
      add(triple(v, `${PROV}wasDerivedFrom`, input.name));
      if (has(input.name, `${DCT}title`)) continue;
      add(
        triple(input.name, `${RDF}type`, `${PROV}Entity`),
        triple(input.name, `${DCT}title`, literal(input.title)),
        ...(input.modified === undefined
          ? []
          : [
              triple(
                input.name,
                `${DCT}modified`,
                literal(input.modified, `${XSD}dateTime`),
              ),
            ]),
        ...checksum(input.name, input.checksum),
      );
    }
    if (version.mapping)
      add(
        triple(v, `${RDF}type`, `${SSSOM}MappingSet`),
        triple(v, `${SSSOM}mapping_set_version`, label),
        triple(v, `${SSSOM}subject_source_version`, label),
        triple(v, `${SSSOM}license`, series.license),
        triple(v, `${SSSOM}mapping_tool`, literal(version.builder.label)),
        triple(
          v,
          `${SSSOM}mapping_tool_version`,
          literal(version.builder.version),
        ),
      );
  }

  toTurtle(): string {
    return writeTurtle(this.quads, FEED_BASE);
  }

  async write(path: string): Promise<void> {
    await writeFile(path, this.toTurtle());
  }
}

/** The catalog with no series yet. */
export function emptyFeed(): Feed {
  return Feed.parse(`
    @prefix adms: <${ADMS}> .
    @prefix dcat: <${DCAT}> .
    @prefix dct: <${DCT}> .
    <> a dcat:Catalog ;
      dct:title "Cascade reference tables (DRAFT)" ;
      adms:status <http://purl.org/adms/status/UnderDevelopment> .
  `);
}
