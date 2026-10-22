import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { Ajv2020 } from "ajv/dist/2020.js";
import * as oxigraph from "oxigraph";
import { FEED_BASE, Feed } from "../src/feed.js";
import {
  build,
  type Contract,
  declarationViolations,
  readContract,
} from "../src/pipeline.js";
import { type Checked, mergeChecked, publish } from "../src/publish.js";
import { fromOxigraph, PREFIXES, type Quad, toOxigraph } from "../src/rdf.js";
import { Shapes } from "../src/shapes.js";
import { loadBuild, readSource } from "../src/source.js";
import { folderStore } from "../src/stores.js";

const ROOT = join(import.meta.dirname, "..", "..", "..");
const shapes = await Shapes.read(join(ROOT, "shapes", "feed.shapes.ttl"));
const valid = (
  await Feed.read(join(ROOT, "fixtures", "feeds", "valid", "feed.ttl"))
).triples;

const prefixes = Object.entries(PREFIXES)
  .map(([prefix, space]) => `PREFIX ${prefix}: <${space}>`)
  .join("\n");

function changed(update: string): Quad[] {
  const store = new oxigraph.Store(valid.map(toOxigraph));
  store.update(`${prefixes}\n${update}`, { base_iri: FEED_BASE });
  return store.match(null, null, null, null).map(fromOxigraph);
}

test("the valid feed fixture and feed/feed.ttl conform", async () => {
  assert.deepEqual(await shapes.violations(valid), []);
  assert.deepEqual(
    await shapes.violations(
      (await Feed.read(join(ROOT, "feed", "feed.ttl"))).triples,
    ),
    [],
  );
});

test("a feed breaking one constraint is refused with its message", async () => {
  const cases: [string, string][] = [
    ["DELETE WHERE { <> dct:title ?t }", "The catalog has one title."],
    [
      "DELETE { ?s rdfs:label ?l } WHERE { ?s rdfs:label ?l ; a rec:ReferenceSeries }",
      "A series has one name.",
    ],
    ["DELETE WHERE { ?s dct:license ?l }", "A series names its one licence."],
    [
      "INSERT { ?s dcat:hasCurrentVersion ?v } WHERE { ?s dcat:hasVersion ?v }",
      "A series has one current version.",
    ],
    [
      "DELETE { ?v dcat:version ?l } WHERE { ?v dcat:version ?l ; sssom:mapping_set_version ?l }",
      "A version has its publisher's one release label.",
    ],
    [
      'DELETE { ?v pav:version ?l } INSERT { ?v pav:version "other" } WHERE { ?v pav:version ?l }',
      "A version's pav:version is its dcat:version.",
    ],
    [
      'DELETE { ?v adms:versionNotes ?n } INSERT { ?v adms:versionNotes "some rows" } WHERE { ?v adms:versionNotes ?n }',
      "A version's notes count the rows it added, removed and changed.",
    ],
    [
      "DELETE WHERE { ?v prov:wasAttributedTo ?b }",
      "A version names its one builder.",
    ],
    [
      "DELETE { ?i spdx:checksum ?c } WHERE { ?v prov:wasDerivedFrom ?i . ?i spdx:checksum ?c }",
      "A version names the files it was built from, each by its content, with its one title and checksum.",
    ],
    [
      'DELETE { ?c spdx:checksumValue ?x } INSERT { ?c spdx:checksumValue "ABC" } WHERE { ?d dcat:downloadURL ?u ; spdx:checksum ?c . ?c spdx:checksumValue ?x }',
      "A version has one distribution, its rows file: a gzipped N-Quads file with one download URL and one SHA-256 checksum.",
    ],
    [
      "DELETE { ?v ?p ?o } INSERT { <urn:uuid:00000000-0000-4000-8000-000000000000> ?p ?o } WHERE { ?v a sssom:MappingSet ; ?p ?o }",
      "A version is named by its content, an ni:///sha-256; name.",
    ],
    [
      "DELETE WHERE { ?v sssom:mapping_tool ?t }",
      "A mapping set names its builder as its mapping tool.",
    ],
  ];
  for (const [update, message] of cases) {
    const found = await shapes.violations(changed(update));
    assert.ok(
      found.some((violation) => violation.endsWith(`: ${message}`)),
      `${update}\ngave:\n${found.join("\n")}`,
    );
  }
});

test("the checked.json a build and a publish write conforms to its schema", async () => {
  const schema = JSON.parse(
    await readFile(join(ROOT, "shapes", "checked.schema.json"), "utf8"),
  ) as object;
  const validate = new Ajv2020().compile(schema);
  const example = join(ROOT, "fixtures", "builder");
  const dir = await mkdtemp(join(tmpdir(), "tables-"));
  try {
    const feed = join(dir, "feed.ttl");
    const out = join(dir, "out");
    await build(await readContract(ROOT), {
      source: await readSource(example),
      build: await loadBuild(ROOT, example),
      release: join(example, "fixtures", "release"),
      label: "1",
      feed,
      out,
      now: "2026-10-08T06:23:00Z",
    });
    const built = JSON.parse(
      await readFile(join(out, "checked.json"), "utf8"),
    ) as Checked;
    await publish({
      feed,
      site: join(dir, "site"),
      store: folderStore([out]),
      checked: mergeChecked(built, {
        checked: {
          "urn:uuid:17cec5a9-071a-4179-9403-5c1e3886fb7d": {
            label: "CDC CVX",
            at: "2026-10-07T06:23:00Z",
            found: "nothing new",
            inputs: {
              "CVX.txt": {
                checksum: "0".repeat(64),
                modified: "2026-10-06T21:01:41Z",
              },
            },
          },
          "urn:uuid:5b1d3c52-7d4e-4b8a-9c61-2e5d8f0b7a14": {
            label: "CDC ICD-10-CM",
            at: "2026-10-07T06:23:00Z",
            found: "not checked",
            reason: "ETIMEDOUT",
          },
        },
      }),
    });
    const published = JSON.parse(
      await readFile(join(dir, "site", "checked.json"), "utf8"),
    ) as Checked;
    assert.equal(Object.keys(published.checked).length, 3);
    for (const written of [built, published])
      assert.ok(validate(written), JSON.stringify(validate.errors));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
  const cases: [unknown, boolean][] = [
    [
      {
        checked: {
          "CDC CVX": {
            label: "CDC CVX",
            at: "2026-10-08T06:23:00Z",
            found: "new",
          },
        },
      },
      false,
    ],
    [{ checked: {}, extra: 1 }, false],
    ...(["new", "not checked"] as const).flatMap(
      (found): [unknown, boolean][] =>
        [undefined, "ETIMEDOUT"].map((reason) => [
          {
            checked: {
              "urn:uuid:5b1d3c52-7d4e-4b8a-9c61-2e5d8f0b7a14": {
                label: "CDC ICD-10-CM",
                at: "2026-10-08T06:23:00Z",
                found,
                ...(reason === undefined ? {} : { reason }),
              },
            },
          },
          (found === "not checked") === (reason !== undefined),
        ]),
    ),
  ];
  for (const [checked, valid] of cases)
    assert.equal(validate(checked), valid, JSON.stringify(checked));
});

test("a source names its files as its detection method needs them, or its declarations are refused with the message", async () => {
  const contract = await readContract(ROOT);
  const message =
    "A source detected by its release API names that API and each file by its path in the release's zip; one detected by a folder listing names the listing, at least one kind of release folder, and each file by its name and a pattern for it; one detected by a dated address names at least one file by its name and its address with {month}, and its other files by their download URL; one detected by its announcement names the public page and a name pattern with one group, the version, and each file by its path in the release's folder, none archived; any other source names each file's one download URL.";
  const cases: [string, string][] = [
    ["nlm-rxnorm-prescribable", "DELETE WHERE { ?s tables:releaseApi ?a }"],
    [
      "nlm-rxnorm-prescribable",
      "INSERT { ?s tables:folderListing <https://publisher.example/releases/> } WHERE { ?s tables:releaseApi ?a }",
    ],
    [
      "nlm-rxnorm-prescribable",
      "DELETE { ?f dct:title ?t } INSERT { ?f dcat:downloadURL <https://download.nlm.nih.gov/rxnorm/RXNREL.RRF> } WHERE { ?f dct:title ?t }",
    ],
    [
      "cdc-cvx",
      'DELETE { ?f dcat:downloadURL ?u } INSERT { ?f dct:title "VG.txt" } WHERE { ?f dcat:downloadURL ?u }',
    ],
    ["cdc-icd-10-cm", "DELETE WHERE { ?s tables:folderListing ?l }"],
    [
      "cdc-icd-10-cm",
      'DELETE { ?f tables:namePattern ?p } WHERE { ?f dct:title "conversion-table.xlsx" ; tables:namePattern ?p }',
    ],
    ["ncbi-clinvar", "DELETE WHERE { ?f tables:urlTemplate ?t }"],
    ["regenstrief-loinc", "DELETE WHERE { ?s tables:announcementPage ?p }"],
    [
      "regenstrief-loinc",
      'DELETE { ?s tables:namePattern ?p } INSERT { ?s tables:namePattern "Loinc_(a)(b)" } WHERE { ?s tables:namePattern ?p }',
    ],
    [
      "regenstrief-loinc",
      "DELETE { ?f tables:archived false } INSERT { ?f tables:archived true } WHERE { ?f tables:archived false }",
    ],
    [
      "ncbi-clinvar",
      'DELETE { ?f dcat:downloadURL ?u } INSERT { ?f dct:title "hgvs4variation.txt.gz" } WHERE { ?f dcat:downloadURL ?u }',
    ],
    [
      "ncbi-clinvar",
      "INSERT { ?f dcat:downloadURL <https://publisher.example/variant_summary.txt.gz> } WHERE { ?f tables:urlTemplate ?t }",
    ],
  ];
  for (const [builder, update] of cases) {
    const found = await violationsAfter(contract, builder, update);
    assert.ok(
      found.some((violation) => violation.endsWith(`: ${message}`)),
      `${builder}: ${update}\ngave:\n${found.join("\n")}`,
    );
  }
});

async function violationsAfter(
  contract: Contract,
  builder: string,
  update: string,
): Promise<string[]> {
  const source = await readSource(join(ROOT, "builders", builder));
  const store = new oxigraph.Store(source.declarations.map(toOxigraph));
  store.update(`${prefixes}\n${update}`);
  return declarationViolations(contract, {
    ...source,
    declarations: store.match(null, null, null, null).map(fromOxigraph),
  });
}

test("a source states a file's compression as gzip and whether it is archived once, or its declarations are refused with the message", async () => {
  const contract = await readContract(ROOT);
  const cases: [string, string][] = [
    [
      "INSERT { ?f dcat:compressFormat <https://www.iana.org/assignments/media-types/application/zip> } WHERE { ?f tables:urlTemplate ?t }",
      "A file of a source is compressed, if at all, as gzip.",
    ],
    [
      'INSERT { ?f tables:archived "no" } WHERE { ?f tables:urlTemplate ?t }',
      "A file of a source says once, as a boolean, whether the release archives it.",
    ],
    [
      "INSERT { ?f tables:archived true } WHERE { ?f tables:urlTemplate ?t }",
      "A file of a source says once, as a boolean, whether the release archives it.",
    ],
    [
      "INSERT { ?s tables:announcementPage <https://publisher.example/downloads/> } WHERE { ?s a tables:Source }",
      "Only a source detected by its announcement names an announcement page.",
    ],
    [
      "INSERT { ?s rec:coversGene 7 } WHERE { ?s rec:coversGene 'MLH1' }",
      "A source fills at least one series, each a urn:uuid: with one name and one table kind.",
    ],
  ];
  assert.deepEqual(
    await violationsAfter(
      contract,
      "ncbi-clinvar",
      "DELETE WHERE { ?s a tables:Nothing }",
    ),
    [],
  );
  for (const [update, message] of cases) {
    const found = await violationsAfter(contract, "ncbi-clinvar", update);
    assert.ok(
      found.some((violation) => violation.endsWith(`: ${message}`)),
      `${update}\ngave:\n${found.join("\n")}`,
    );
  }
});

const UMLS =
  "https://www.nlm.nih.gov/research/umls/knowledge_sources/metathesaurus/release/license_agreement.html";

const licensed = (licence: string): string =>
  `DELETE { ?s dct:license ?l } INSERT { ?s dct:license <${licence}> } WHERE { ?s dct:license ?l }`;

test("a source names a licence the tables list, under whose policy they publish its rows, and marks no file archived where that policy archives none, or its declarations are refused with the message", async () => {
  const contract = await readContract(ROOT);
  const cases: [string, string][] = [
    [
      licensed("https://publisher.example/licence"),
      "A source names its one licence, one the tables list.",
    ],
    [
      licensed(UMLS),
      "A source's licence's policy publishes the rows made from it.",
    ],
    [
      `${licensed("https://loinc.org/license/")} ;\nINSERT { ?f tables:archived true } WHERE { ?s dcat:distribution ?f }`,
      "A source whose licence's policy archives none of its publisher's files marks none archived.",
    ],
  ];
  for (const [update, message] of cases) {
    const found = await violationsAfter(contract, "cdc-cvx", update);
    assert.ok(
      found.some((violation) => violation.endsWith(`: ${message}`)),
      `${update}\ngave:\n${found.join("\n")}`,
    );
  }
  assert.deepEqual(
    await violationsAfter(
      contract,
      "cdc-cvx",
      licensed("https://loinc.org/license/"),
    ),
    [],
  );
});

test("a source saying anything of a licence or a licence's policy is refused with the message", async () => {
  const contract = await readContract(ROOT);
  for (const grant of [
    `INSERT DATA { <${UMLS}> <http://creativecommons.org/ns#permits> <http://creativecommons.org/ns#DerivativeWorks> }`,
    `INSERT DATA { [] tables:licencePolicyOf <${UMLS}> ; tables:publishesRows true ; tables:archivesPublisherFiles true }`,
  ]) {
    const found = await violationsAfter(
      contract,
      "cdc-cvx",
      `${licensed(UMLS)} ;\n${grant}`,
    );
    assert.ok(
      found.some((violation) =>
        violation.endsWith(
          ": A source says nothing of a licence or a licence's policy.",
        ),
      ),
      `${grant}\ngave:\n${found.join("\n")}`,
    );
  }
});

test("the source shape lists exactly the licences of vocab/licences.ttl, each with one policy saying whether rows are published and files archived", async () => {
  const store = new oxigraph.Store();
  for (const file of ["shapes/source.shapes.ttl", "vocab/licences.ttl"])
    store.load(await readFile(join(ROOT, file), "utf8"), {
      format: "text/turtle",
      base_iri: "urn:x:",
    });
  const values = (query: string): string[] =>
    (
      store.query(
        `${prefixes}\nPREFIX cc: <http://creativecommons.org/ns#>\nPREFIX sh: <http://www.w3.org/ns/shacl#>\n${query}`,
      ) as Map<string, oxigraph.Term>[]
    )
      .map((row) => row.get("l")!.value)
      .sort();
  const listed = values(
    "SELECT ?l WHERE { ?p sh:path dct:license ; sh:in/rdf:rest*/rdf:first ?l }",
  );
  assert.deepEqual(listed, values("SELECT ?l WHERE { ?l a cc:License }"));
  assert.deepEqual(
    listed,
    values(
      `SELECT ?l WHERE { ?p tables:licencePolicyOf ?l ; tables:publishesRows ?r ; tables:archivesPublisherFiles ?a ; rdfs:comment ?c
        FILTER NOT EXISTS { ?q tables:licencePolicyOf ?l FILTER (?q != ?p) } }`,
    ),
  );
});

test("a source carrying rows forward and looking up their history declares what that needs, or its declarations are refused with the message", async () => {
  const contract = await readContract(ROOT);
  const source = await readSource(join(ROOT, "fixtures", "carrying"));
  assert.deepEqual(await declarationViolations(contract, source), []);
  const cases: [string, string][] = [
    [
      "INSERT { ?s tables:carriesForward true } WHERE { ?s rec:tableKind rec:CodeStatus }",
      "A series carrying rows forward does not hold code status.",
    ],
    [
      'DELETE { ?s tables:carriesForward ?c } INSERT { ?s tables:carriesForward "yes" } WHERE { ?s tables:carriesForward ?c ; rec:tableKind rec:CodeNames }',
      "A series says once, as a boolean, whether it carries rows forward.",
    ],
    [
      'DELETE { ?l tables:urlTemplate ?u } INSERT { ?l tables:urlTemplate "https://publisher.example/history" } WHERE { ?l tables:urlTemplate ?u }',
      "A history lookup names one code system and one URL template, which holds {code}.",
    ],
    [
      "INSERT { ?s tables:historyLookup [ tables:codeSystem rec:CVX ; tables:urlTemplate 'https://publisher.example/{code}' ] } WHERE { ?s a tables:Source }",
      "A source has at most one history lookup.",
    ],
    [
      "DELETE { ?s rec:tableKind rec:CodeStatus } INSERT { ?s rec:tableKind rec:CodeNames } WHERE { ?s rec:tableKind rec:CodeStatus }",
      "A source with a history lookup fills exactly one code status series.",
    ],
    [
      "DELETE { ?s tables:carriesForward true } INSERT { ?s tables:carriesForward false } WHERE { ?s tables:carriesForward true }",
      "A source with a history lookup fills at least one series carrying rows forward.",
    ],
  ];
  for (const [update, message] of cases) {
    const store = new oxigraph.Store(source.declarations.map(toOxigraph));
    store.update(`${prefixes}\n${update}`);
    const found = await declarationViolations(contract, {
      ...source,
      declarations: store.match(null, null, null, null).map(fromOxigraph),
    });
    assert.ok(
      found.some((violation) => violation.endsWith(`: ${message}`)),
      `${update}\ngave:\n${found.join("\n")}`,
    );
  }
});
