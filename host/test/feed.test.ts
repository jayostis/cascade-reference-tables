import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import type { Build, Row } from "../src/builder.js";
import { Feed } from "../src/feed.js";
import { build, type BuildOptions, readContract } from "../src/pipeline.js";
import { loadBuild, readSource } from "../src/source.js";

const ROOT = join(import.meta.dirname, "..", "..", "..");
const EXAMPLE = join(ROOT, "fixtures", "builder");
const contract = await readContract(ROOT);
const source = await readSource(EXAMPLE);
const example = await loadBuild(ROOT, EXAMPLE);
let dir: string;

before(async () => {
  dir = await mkdtemp(join(tmpdir(), "tables-"));
});
after(() => rm(dir, { recursive: true, force: true }));

function options(
  folder: string,
  release: string,
  overrides: Partial<BuildOptions> = {},
): BuildOptions {
  return {
    source,
    build: example,
    release: join(EXAMPLE, "fixtures", release),
    label: release,
    feed: join(dir, folder, "feed", "feed.ttl"),
    out: join(dir, folder, "out"),
    now: "2026-10-01T00:00:00Z",
    ...overrides,
  };
}

test("an unchanged file newly modified, and two series with no rows, give a conforming feed and a release of its own", async () => {
  const tag = async (): Promise<string> =>
    (
      JSON.parse(
        await readFile(join(dir, "unchanged", "out", "release.json"), "utf8"),
      ) as { tag: string }
    ).tag;
  await build(
    contract,
    options("unchanged", "release", {
      modified: new Map([["codes.txt", "2026-09-01T00:00:00Z"]]),
    }),
  );
  const first = await tag();
  const names: Row = {
    series: "urn:uuid:6e9c1dc9-8c36-49a8-929c-cd9f6701076c",
    subject: "http://hl7.org/fhir/sid/cvx/88",
    prefLabel: "flu",
    notation: "88",
  };
  const onlyNames: Build = async function* () {
    yield names;
  };
  await build(
    contract,
    options("unchanged", "release", {
      build: onlyNames,
      now: "2026-10-02T00:00:00Z",
      modified: new Map([["codes.txt", "2026-09-02T00:00:00Z"]]),
    }),
  );
  const feed = await Feed.read(join(dir, "unchanged", "feed", "feed.ttl"));
  assert.deepEqual(await contract.feedShapes.violations(feed.triples), []);
  assert.notEqual(await tag(), first);
});

test("the current versions' rows files are found beside the feed", async () => {
  const published = join(dir, "published", "feed");
  await build(contract, { ...options("published", "release"), out: published });
  const [outcome] = await build(contract, options("published", "release-2"));
  assert.ok(outcome?.previous, "the second release revised nothing");
});

test("a build whose feed would not conform writes no rows file", async () => {
  const { feed, out } = options("broken", "release");
  await mkdir(join(dir, "broken", "feed"), { recursive: true });
  await writeFile(feed, "<> a <http://www.w3.org/ns/dcat#Catalog> .");
  await assert.rejects(
    build(contract, options("broken", "release")),
    /would not conform/,
  );
  assert.equal(existsSync(join(out, "rows")), false);
});

test("a rows file not relative to the feed is not read as one", () => {
  const feed = Feed.parse(`
    @prefix dcat: <http://www.w3.org/ns/dcat#> .
    @prefix spdx: <http://spdx.org/rdf/terms#> .
    <urn:x:v> dcat:distribution <https://elsewhere.example/rows/a.nq.gz> .
    <https://elsewhere.example/rows/a.nq.gz>
      dcat:downloadURL <https://elsewhere.example/rows/a.nq.gz> ;
      spdx:checksum [ spdx:checksumValue "ab" ] .
  `);
  assert.throws(() => feed.rowsOf("urn:x:v"), /not relative to the feed/);
});
