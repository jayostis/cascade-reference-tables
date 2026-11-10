import assert from "node:assert/strict";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { before, describe, it } from "node:test";
import * as oxigraph from "oxigraph";
import {
  type Contract,
  declarationViolations,
  readContract,
} from "../src/pipeline.js";
import { fromOxigraph, PREFIXES, toOxigraph } from "../src/rdf.js";
import { readSource } from "../src/source.js";

const ROOT = join(import.meta.dirname, "..", "..", "..");

const prefixes = Object.entries(PREFIXES)
  .map(([prefix, space]) => `PREFIX ${prefix}: <${space}>`)
  .join("\n");

const UMLS =
  "https://www.nlm.nih.gov/research/umls/knowledge_sources/metathesaurus/release/license_agreement.html";
const LOINC = "https://loinc.org/license/";

const licensed = (licence: string): string =>
  `DELETE { ?s dct:license ?l } INSERT { ?s dct:license <${licence}> } WHERE { ?s dct:license ?l }`;

const FILES =
  "A source detected by its release API names that API and each file by its path in the release's zip; one detected by a folder listing names the listing, at least one kind of release folder, and each file by its name and a pattern for it; one detected by a dated address names at least one file by its name and its address with {month}, and its other files by their download URL; one detected by its announcement names the public page and a name pattern with one group, the version, and each file by its path in the release's folder, none archived; any other source names each file's one download URL.";
const COMPRESSION = "A file of a source is compressed, if at all, as gzip.";
const ARCHIVED =
  "A file of a source says once, as a boolean, whether the release archives it.";

/** A source's folder, the statement changed in its declarations, what the change is, and the violation it earns. */
const changes: [
  source: string,
  what: string,
  update: string,
  message: string,
][] = [
  [
    "builders/nlm-rxnorm-prescribable",
    "no release API",
    "DELETE WHERE { ?s tables:releaseApi ?a }",
    FILES,
  ],
  [
    "builders/nlm-rxnorm-prescribable",
    "a folder listing beside a release API",
    "INSERT { ?s tables:folderListing <https://publisher.example/releases/> } WHERE { ?s tables:releaseApi ?a }",
    FILES,
  ],
  [
    "builders/nlm-rxnorm-prescribable",
    "a file with a download URL in place of its path in the release",
    "DELETE { ?f dct:title ?t } INSERT { ?f dcat:downloadURL <https://download.nlm.nih.gov/rxnorm/RXNREL.RRF> } WHERE { ?f dct:title ?t }",
    FILES,
  ],
  [
    "builders/cdc-cvx",
    "VG.txt with no download URL",
    'DELETE { ?f dcat:downloadURL ?u } INSERT { ?f dct:title "VG.txt" } WHERE { ?f dcat:downloadURL ?u }',
    FILES,
  ],
  [
    "builders/cdc-icd-10-cm",
    "no folder listing",
    "DELETE WHERE { ?s tables:folderListing ?l }",
    FILES,
  ],
  [
    "builders/cdc-icd-10-cm",
    "a file with no name pattern",
    'DELETE { ?f tables:namePattern ?p } WHERE { ?f dct:title "conversion-table.xlsx" ; tables:namePattern ?p }',
    FILES,
  ],
  [
    "builders/ncbi-clinvar",
    "a file with no address template",
    "DELETE WHERE { ?f tables:urlTemplate ?t }",
    FILES,
  ],
  [
    "builders/regenstrief-loinc",
    "no announcement page",
    "DELETE WHERE { ?s tables:announcementPage ?p }",
    FILES,
  ],
  [
    "builders/regenstrief-loinc",
    "a name pattern with two groups",
    'DELETE { ?s tables:namePattern ?p } INSERT { ?s tables:namePattern "Loinc_(a)(b)" } WHERE { ?s tables:namePattern ?p }',
    FILES,
  ],
  [
    "builders/regenstrief-loinc",
    "a file archived under an announcement",
    "DELETE { ?f tables:archived false } INSERT { ?f tables:archived true } WHERE { ?f tables:archived false }",
    FILES,
  ],
  [
    "builders/ncbi-clinvar",
    "hgvs4variation.txt.gz with no download URL",
    'DELETE { ?f dcat:downloadURL ?u } INSERT { ?f dct:title "hgvs4variation.txt.gz" } WHERE { ?f dcat:downloadURL ?u }',
    FILES,
  ],
  [
    "builders/ncbi-clinvar",
    "a file with a download URL beside its address template",
    "INSERT { ?f dcat:downloadURL <https://publisher.example/variant_summary.txt.gz> } WHERE { ?f tables:urlTemplate ?t }",
    FILES,
  ],
  [
    "builders/ncbi-clinvar",
    "a file compressed as zip",
    "INSERT { ?f dcat:compressFormat <https://www.iana.org/assignments/media-types/application/zip> } WHERE { ?f tables:urlTemplate ?t }",
    COMPRESSION,
  ],
  [
    "builders/ncbi-clinvar",
    "archived written as text",
    'INSERT { ?f tables:archived "no" } WHERE { ?f tables:urlTemplate ?t }',
    ARCHIVED,
  ],
  [
    "builders/ncbi-clinvar",
    "archived stated twice",
    "INSERT { ?f tables:archived true } WHERE { ?f tables:urlTemplate ?t }",
    ARCHIVED,
  ],
  [
    "builders/ncbi-clinvar",
    "an announcement page on a source not detected by one",
    "INSERT { ?s tables:announcementPage <https://publisher.example/downloads/> } WHERE { ?s a tables:Source }",
    "Only a source detected by its announcement names an announcement page.",
  ],
  [
    "builders/ncbi-clinvar",
    "a gene written as a number",
    "INSERT { ?s cascade:coversGene 7 } WHERE { ?s cascade:coversGene 'MLH1' }",
    "A source fills at least one series, each a urn:uuid: with one name and one table kind.",
  ],
  [
    "builders/cdc-cvx",
    "a licence the tables do not list",
    licensed("https://publisher.example/licence"),
    "A source names its one licence, one the tables list.",
  ],
  [
    "builders/cdc-cvx",
    "the UMLS licence, whose policy publishes no rows",
    licensed(UMLS),
    "A source's licence's policy publishes the rows made from it.",
  ],
  [
    "builders/cdc-cvx",
    "a file marked archived under LOINC's licence, whose policy archives none",
    `${licensed(LOINC)} ;\nINSERT { ?f tables:archived true } WHERE { ?s dcat:distribution ?f }`,
    "A source whose licence's policy archives none of its publisher's files marks none archived.",
  ],
  [
    "builders/cdc-cvx",
    "a licence that permits derivative works",
    `${licensed(UMLS)} ;\nINSERT DATA { <${UMLS}> <http://creativecommons.org/ns#permits> <http://creativecommons.org/ns#DerivativeWorks> }`,
    "A source says nothing of a licence or a licence's policy.",
  ],
  [
    "builders/cdc-cvx",
    "a policy for a licence the source gives itself",
    `${licensed(UMLS)} ;\nINSERT DATA { [] tables:licencePolicyOf <${UMLS}> ; tables:publishesRows true ; tables:archivesPublisherFiles true }`,
    "A source says nothing of a licence or a licence's policy.",
  ],
  [
    "fixtures/carrying",
    "a code status series that carries rows forward",
    "INSERT { ?s tables:carriesForward true } WHERE { ?s cascade:tableKind cascade:RetiredCodes }",
    "A series carrying rows forward does not hold code status.",
  ],
  [
    "fixtures/carrying",
    "carries rows forward written as text",
    'DELETE { ?s tables:carriesForward ?c } INSERT { ?s tables:carriesForward "yes" } WHERE { ?s tables:carriesForward ?c ; cascade:tableKind cascade:CodeNames }',
    "A series says once, as a boolean, whether it carries rows forward.",
  ],
  [
    "fixtures/carrying",
    "a history lookup address with no {code}",
    'DELETE { ?l tables:urlTemplate ?u } INSERT { ?l tables:urlTemplate "https://publisher.example/history" } WHERE { ?l tables:urlTemplate ?u }',
    "A history lookup names one code system and one URL template, which holds {code}.",
  ],
  [
    "fixtures/carrying",
    "a second history lookup",
    "INSERT { ?s tables:historyLookup [ tables:codeSystem cascade:CVX ; tables:urlTemplate 'https://publisher.example/{code}' ] } WHERE { ?s a tables:Source }",
    "A source has at most one history lookup.",
  ],
  [
    "fixtures/carrying",
    "no code status series beside a history lookup",
    "DELETE { ?s cascade:tableKind cascade:RetiredCodes } INSERT { ?s cascade:tableKind cascade:CodeNames } WHERE { ?s cascade:tableKind cascade:RetiredCodes }",
    "A source with a history lookup fills exactly one code status series.",
  ],
  [
    "fixtures/carrying",
    "no series carrying rows forward beside a history lookup",
    "DELETE { ?s tables:carriesForward true } INSERT { ?s tables:carriesForward false } WHERE { ?s tables:carriesForward true }",
    "A source with a history lookup fills at least one series carrying rows forward.",
  ],
];

/** The first clause of a long message, so a case's title stays one line. */
const shortened = (message: string): string =>
  message.length > 120 ? `${message.split(";")[0]}…` : message;

const builders = existsSync(join(ROOT, "builders"))
  ? readdirSync(join(ROOT, "builders"), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => `builders/${entry.name}`)
  : [];

/**
 * A source is one publisher's release as the host is told of it in `source.ttl`: where it is, how a new release is
 * detected, its files, its licence and the series it fills. `shapes/source.shapes.ttl` holds the declaration to that,
 * and each broken constraint gives a violation ending in the constraint's message.
 */
describe("Declaring a source · readSource(), declarationViolations()", () => {
  let contract: Contract;

  before(async () => {
    contract = await readContract(ROOT);
  });

  /** The violations of a source's declarations once an update has changed them. */
  async function violationsAfter(
    folder: string,
    update?: string,
  ): Promise<string[]> {
    const source = await readSource(join(ROOT, ...folder.split("/")));
    if (update === undefined) return declarationViolations(contract, source);
    const store = new oxigraph.Store(source.declarations.map(toOxigraph));
    store.update(`${prefixes}\n${update}`);
    return declarationViolations(contract, {
      ...source,
      declarations: store.match(null, null, null, null).map(fromOxigraph),
    });
  }

  describe("given each source the repository declares", () => {
    for (const folder of [...builders, "fixtures/carrying"])
      it(`returns no violation for ${folder}`, async () => {
        assert.deepEqual(await violationsAfter(folder), []);
      });
  });

  describe("given a source with one statement changed", () => {
    for (const [source, what, update, message] of changes)
      it(`returns a violation ending "${shortened(message)}" for ${what}`, async () => {
        const found = await violationsAfter(source, update);
        assert.ok(
          found.some((violation) => violation.endsWith(`: ${message}`)),
          `${source}: ${update}\ngave:\n${found.join("\n")}`,
        );
      });
  });

  describe("given cdc-cvx declared under LOINC's licence, its files not archived", () => {
    it("returns no violation", async () => {
      assert.deepEqual(
        await violationsAfter("builders/cdc-cvx", licensed(LOINC)),
        [],
      );
    });
  });
});
