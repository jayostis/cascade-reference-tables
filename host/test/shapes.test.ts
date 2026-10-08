import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";
import * as oxigraph from "oxigraph";
import { FEED_BASE, Feed } from "../src/feed.js";
import { PREFIXES, type Quad } from "../src/rdf.js";
import { Shapes } from "../src/shapes.js";

const ROOT = join(import.meta.dirname, "..", "..", "..");
const shapes = await Shapes.read(join(ROOT, "shapes", "feed.shapes.ttl"));
const valid = (
  await Feed.read(join(ROOT, "fixtures", "feeds", "valid", "feed.ttl"))
).triples;

const prefixes = Object.entries(PREFIXES)
  .map(([prefix, space]) => `PREFIX ${prefix}: <${space}>`)
  .join("\n");

function changed(update: string): Quad[] {
  const store = new oxigraph.Store(valid);
  store.update(`${prefixes}\n${update}`, { base_iri: FEED_BASE });
  return store.match(null, null, null, null);
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

test("a build's checked.json conforms to its schema", async () => {
  const { Ajv2020 } = await import("ajv/dist/2020.js");
  const { readFile } = await import("node:fs/promises");
  const schema = JSON.parse(
    await readFile(join(ROOT, "shapes", "checked.schema.json"), "utf8"),
  ) as object;
  const validate = new Ajv2020().compile(schema);
  const cases: [unknown, boolean][] = [
    [
      {
        checked: {
          "urn:uuid:17cec5a9-071a-4179-9403-5c1e3886fb7d": {
            label: "CDC CVX",
            at: "2026-10-08T06:23:00Z",
            found: "nothing new",
          },
        },
      },
      true,
    ],
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
  ];
  for (const [checked, valid] of cases)
    assert.equal(validate(checked), valid, JSON.stringify(checked));
});
