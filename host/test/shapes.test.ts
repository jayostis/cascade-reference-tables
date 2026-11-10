import assert from "node:assert/strict";
import { join } from "node:path";
import { before, describe, it } from "node:test";
import * as oxigraph from "oxigraph";
import { FEED_BASE, Feed } from "../src/feed.js";
import { fromOxigraph, PREFIXES, type Quad, toOxigraph } from "../src/rdf.js";
import { Shapes } from "../src/shapes.js";

const ROOT = join(import.meta.dirname, "..", "..", "..");

const prefixes = Object.entries(PREFIXES)
  .map(([prefix, space]) => `PREFIX ${prefix}: <${space}>`)
  .join("\n");

const broken: [update: string, message: string][] = [
  ["DELETE WHERE { <> dct:title ?t }", "The catalog has one title."],
  [
    "DELETE { ?s rdfs:label ?l } WHERE { ?s rdfs:label ?l ; a cascade:ReferenceSeries }",
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

/**
 * A feed is the published list of every series and its versions; its shapes (`shapes/feed.shapes.ttl`) say what it
 * must state, and each broken constraint gives a violation ending in the constraint's message. An app that reads a
 * feed can rely on what the shapes hold, and a host refuses to write a feed they do not.
 */
describe("Checking a feed against its shapes · Shapes.read(), shapes.violations(), feedViolations()", () => {
  let shapes: Shapes;
  let valid: readonly Quad[];

  before(async () => {
    shapes = await Shapes.read(join(ROOT, "shapes", "feed.shapes.ttl"));
    valid = (
      await Feed.read(join(ROOT, "fixtures", "feeds", "valid", "feed.ttl"))
    ).triples;
  });

  describe("given the valid feed of fixtures/feeds/valid", () => {
    it("returns no violation", async () => {
      assert.deepEqual(await shapes.violations(valid), []);
    });
  });

  describe("given that feed with one statement changed", () => {
    for (const [update, message] of broken)
      it(`returns a violation ending "${message}"`, async () => {
        const store = new oxigraph.Store(valid.map(toOxigraph));
        store.update(`${prefixes}\n${update}`, { base_iri: FEED_BASE });
        const found = await shapes.violations(
          store.match(null, null, null, null).map(fromOxigraph),
        );
        assert.ok(
          found.some((violation) => violation.endsWith(`: ${message}`)),
          `${update}\ngave:\n${found.join("\n")}`,
        );
      });
  });
});
