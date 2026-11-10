import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import type { Build, Row } from "../src/builder.js";
import { Feed } from "../src/feed.js";
import {
  build,
  type BuildOptions,
  type Contract,
  readContract,
} from "../src/pipeline.js";
import { loadBuild, readSource, type Source } from "../src/source.js";
import { releaseFolder } from "./release-folder.js";

const ROOT = join(import.meta.dirname, "..", "..", "..");
const EXAMPLE = join(ROOT, "fixtures", "builder");

/**
 * `build()` runs a builder on a release, and for each series whose rows changed writes a rows file, a new version in
 * the feed and a GitHub release to hold them. These leaves are the situations no rule's example shows; the rules
 * themselves are under "Rules a host follows".
 */
describe("Building a version of a table · build(), Feed.rowsOf()", () => {
  let contract: Contract;
  let source: Source;
  let example: Build;
  let dir: string;
  let remove: () => Promise<void>;

  before(async () => {
    contract = await readContract(ROOT);
    source = await readSource(EXAMPLE);
    example = await loadBuild(ROOT, EXAMPLE);
    ({ folder: dir, remove } = await releaseFolder());
  });
  after(() => remove());

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

  describe("build()", () => {
    const tag = async (): Promise<string> =>
      (
        JSON.parse(
          await readFile(join(dir, "unchanged", "out", "release.json"), "utf8"),
        ) as { tag: string }
      ).tag;
    let firstTag: string;
    let secondTag: string;

    before(async () => {
      await build(
        contract,
        options("unchanged", "release", {
          modified: new Map([["codes.txt", "2026-09-01T00:00:00Z"]]),
        }),
      );
      firstTag = await tag();
      const names: Row = {
        series: "urn:uuid:6e9c1dc9-8c36-49a8-929c-cd9f6701076c",
        subject: "https://ns.cascadeprotocol.org/codes/cvx/88",
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
      secondTag = await tag();
    });

    it("writes a feed that conforms when a builder yields rows for one series of three", async () => {
      const feed = await Feed.read(join(dir, "unchanged", "feed", "feed.ttl"));
      assert.deepEqual(await contract.feedShapes.violations(feed.triples), []);
    });

    it("gives a second build of the same file, newly modified, a release tag of its own", () => {
      assert.notEqual(secondTag, firstTag);
    });

    it("finds the current versions' rows files beside the feed, so the next version revises them", async () => {
      const published = join(dir, "published", "feed");
      await build(contract, {
        ...options("published", "release"),
        out: published,
      });
      const [outcome] = await build(
        contract,
        options("published", "release-2"),
      );
      assert.ok(outcome?.previous, "the second release revised nothing");
    });

    it('throws "would not conform", and writes no rows file, when the feed it would write breaks a shape', async () => {
      const { feed, out } = options("broken", "release");
      await mkdir(join(dir, "broken", "feed"), { recursive: true });
      await writeFile(feed, "<> a <http://www.w3.org/ns/dcat#Catalog> .");
      await assert.rejects(
        build(contract, options("broken", "release")),
        /would not conform/,
      );
      assert.equal(existsSync(join(out, "rows")), false);
    });

    /** Rule H14 of `rules/publish.feature`, whose example does not check that the retired series is still in the feed. */
    it("keeps a series of a dropped table kind at its current version", async () => {
      await build(contract, {
        ...options("retired-kind", "release"),
        out: join(dir, "retired-kind", "feed"),
      });
      const retired = "urn:uuid:32deac38-90ec-4962-bb25-0f455f1cb3cf";
      await appendFile(
        options("retired-kind", "release").feed,
        await readFile(
          join(ROOT, "fixtures", "feeds", "retired-kind", "series.ttl"),
        ),
      );
      await build(contract, options("retired-kind", "release-2"));
      const feed = await Feed.read(options("retired-kind", "release").feed);
      assert.equal(
        feed.current(retired),
        "ni:///sha-256;QZHblAxd45Wnz4iCPrUDF4p4o6UfV-cMzRmiw2ZVUEQ",
      );
    });
  });

  describe("Feed.rowsOf()", () => {
    it("throws for a rows file whose address is not relative to the feed", () => {
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
  });
});
