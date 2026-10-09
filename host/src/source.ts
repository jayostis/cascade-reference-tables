import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import type { Build } from "./builder.js";
import type { SeriesDescription } from "./feed.js";
import {
  DCAT,
  DCT,
  Graph,
  parseTurtle,
  type Quad,
  type Term,
  RDF,
  RDFS,
  REC,
  TABLES,
} from "./rdf.js";

/** A kind of release folder: the folders whose name matches, dated by the one year the pattern's group gives. */
export interface ReleaseFolder {
  readonly namePattern: string;
  /** The day of the year it takes effect, as `xsd:gMonthDay` writes it: `--10-01`. */
  readonly effectiveFrom: string;
  readonly yearOffset: number;
}

/** A file of a release found in a folder listing: its name pattern, and the pattern of the zips that may hold it. */
export interface ListedFile {
  readonly namePattern: string;
  readonly archivePattern?: string;
}

/** A source detected by its folder listing: the listing, its kinds of release folder, and each file by its name. */
export interface Listing {
  readonly url: string;
  readonly releaseFolders: readonly ReleaseFolder[];
  readonly files: ReadonlyMap<string, ListedFile>;
}

/** A source folder: its declaration (`source.ttl`), its builder's (`builder.ttl`), and its code (`build.ts`). */
export interface Source {
  readonly folder: string;
  readonly iri: string;
  readonly label: string;
  readonly detectedBy: string;
  /** The publisher's list of releases, for a source detected by its release API. */
  readonly releaseApi?: string;
  /** The publisher's folder of release folders, for a source detected by its folder listing. */
  readonly listing?: Listing;
  /**
   * Each file of a release by its name, the last segment of where it is: its download URL, or, for a source detected
   * by its release API, its path in the release's zip.
   */
  readonly files: ReadonlyMap<string, string>;
  readonly series: readonly SeriesDescription[];
  readonly builder: {
    readonly iri: string;
    readonly label: string;
    readonly version: string;
  };
  /** `source.ttl`'s and `builder.ttl`'s triples, for the shapes. */
  readonly declarations: readonly Quad[];
}

/** The folder a source names: a folder under `builders/`, or a path. */
export function sourceFolder(root: string, name: string): string {
  const under = join(root, "builders", name);
  return existsSync(under) ? under : resolve(name);
}

function only(found: readonly string[], what: string, folder: string): string {
  if (found.length !== 1)
    throw new Error(`${folder} declares ${found.length} ${what}, not one`);
  return found[0]!;
}

export async function readSource(folder: string): Promise<Source> {
  const read = async (file: string): Promise<Quad[]> =>
    parseTurtle(
      await readFile(join(folder, file), "utf8"),
      pathToFileURL(join(folder, file)).href,
    );
  const declarations = [
    ...(await read("source.ttl")),
    ...(await read("builder.ttl")),
  ];
  const graph = new Graph(declarations);
  const iri = only(
    graph.subjects(`${RDF}type`, `${TABLES}Source`),
    "sources",
    folder,
  );
  const builder = only(
    graph.subjects(`${RDF}type`, `${TABLES}Builder`),
    "builders",
    folder,
  );
  const value = (subject: string | Term, predicate: string): string =>
    graph.value(subject, predicate) ?? "";
  const files = new Map<string, string>();
  for (const distribution of graph.objects(iri, `${DCAT}distribution`)) {
    const where =
      graph.value(distribution, `${DCAT}downloadURL`) ??
      graph.value(distribution, `${DCT}title`) ??
      "";
    files.set(decodeURIComponent(where.split("/").pop() ?? ""), where);
  }
  const releaseApi = graph.value(iri, `${TABLES}releaseApi`);
  const listingUrl = graph.value(iri, `${TABLES}folderListing`);
  const listing =
    listingUrl === undefined
      ? undefined
      : {
          url: listingUrl,
          releaseFolders: graph
            .objects(iri, `${TABLES}releaseFolder`)
            .map((folder) => ({
              namePattern: value(folder, `${TABLES}namePattern`),
              effectiveFrom: value(folder, `${TABLES}effectiveFrom`),
              yearOffset: Number(value(folder, `${TABLES}yearOffset`)),
            })),
          files: new Map(
            graph.objects(iri, `${DCAT}distribution`).map((file) => {
              const archivePattern = graph.value(
                file,
                `${TABLES}archivePattern`,
              );
              return [
                value(file, `${DCT}title`),
                {
                  namePattern: value(file, `${TABLES}namePattern`),
                  ...(archivePattern === undefined ? {} : { archivePattern }),
                },
              ];
            }),
          ),
        };
  return {
    folder,
    iri,
    label: value(iri, `${RDFS}label`),
    detectedBy: value(iri, `${TABLES}detectedBy`),
    ...(releaseApi === undefined ? {} : { releaseApi }),
    ...(listing === undefined ? {} : { listing }),
    files,
    series: graph
      .subjects(`${DCT}source`, iri)
      .sort()
      .map((series) => ({
        iri: series,
        label: value(series, `${RDFS}label`),
        kind: value(series, `${REC}tableKind`),
        source: iri,
        license: value(iri, `${DCT}license`),
        publisher: value(iri, `${DCT}publisher`),
        credit: value(iri, `${DCT}bibliographicCitation`),
      })),
    builder: {
      iri: builder,
      label: value(builder, `${RDFS}label`),
      version: value(builder, `${TABLES}builderVersion`),
    },
    declarations,
  };
}

/** The builder's code: as `tsc` compiled it under `dist/` for a folder in `root`, else the folder's own `build.js`. */
export async function loadBuild(root: string, folder: string): Promise<Build> {
  const inside = relative(resolve(root), resolve(folder));
  const outside =
    inside === ".." || inside.startsWith(`..${sep}`) || isAbsolute(inside);
  const compiled = outside
    ? join(folder, "build.js")
    : join(root, "dist", inside, "build.js");
  if (!existsSync(compiled))
    throw new Error(
      outside
        ? `${compiled} does not exist; a builder outside the repository provides its compiled build.js beside its source.ttl`
        : `${compiled} is not built; run npm run build`,
    );
  const module = (await import(pathToFileURL(compiled).href)) as {
    default: Build;
  };
  return module.default;
}
