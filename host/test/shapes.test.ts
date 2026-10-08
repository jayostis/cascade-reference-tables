import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { Ajv2020 } from "ajv/dist/2020.js";
import * as oxigraph from "oxigraph";
import { FEED_BASE, Feed } from "../src/feed.js";
import { build, readContract } from "../src/pipeline.js";
import { type Checked, mergeChecked, publish } from "../src/publish.js";
import { PREFIXES, type Quad } from "../src/rdf.js";
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
        },
      }),
    });
    const published = JSON.parse(
      await readFile(join(dir, "site", "checked.json"), "utf8"),
    ) as Checked;
    assert.equal(Object.keys(published.checked).length, 2);
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
  ];
  for (const [checked, valid] of cases)
    assert.equal(validate(checked), valid, JSON.stringify(checked));
});
