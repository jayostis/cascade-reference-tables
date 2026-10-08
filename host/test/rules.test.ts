import assert from "node:assert/strict";
import { existsSync, readdirSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { before, describe, test } from "node:test";
import { gunzipSync } from "node:zlib";
import { type Build, Refusal, type Row } from "../src/builder.js";
import { conformanceExamples, runConformance } from "../src/conformance.js";
import { Feed } from "../src/feed.js";
import { readFeature, Steps } from "../src/features.js";
import { sha256, versionName } from "../src/names.js";
import {
  build,
  type Contract,
  type Outcome,
  readContract,
} from "../src/pipeline.js";
import {
  DCAT,
  DCT,
  ntLine,
  parseNQuads,
  parseTrig,
  parseTurtle,
  PREFIXES,
  type Quad,
  quad,
} from "../src/rdf.js";
import { keyed } from "../src/rows.js";
import { loadBuild, readSource, type Source } from "../src/source.js";

const ROOT = join(import.meta.dirname, "..", "..", "..");
const EXAMPLE = join(ROOT, "fixtures", "builder");

interface World {
  readonly dir: string;
  readonly feed: string;
  readonly out: string;
  readonly feeds: string[];
  readonly builds: Outcome[][];
  refusal?: Error;
}

let contract: Contract;
let example: Source;

function seriesNamed(label: string): string {
  const found = example.series.find((s) => s.label === label);
  assert.ok(found, `no series is labelled ${label}`);
  return found.iri;
}

function lastBuild(world: World): Outcome[] {
  const last = world.builds.at(-1);
  assert.ok(last, "nothing was built");
  return last;
}

async function feedOf(world: World): Promise<Feed> {
  return Feed.read(world.feed);
}

function versionLabelled(feed: Feed, series: string, label: string): string {
  const graph = feed.graph;
  const found = graph
    .objects(series, `${DCAT}hasVersion`)
    .filter((v) => graph.value(v, `${DCAT}version`) === label);
  assert.equal(
    found.length,
    1,
    `${series} has ${found.length} versions labelled ${label}`,
  );
  return found[0]!.value;
}

async function runBuild(
  world: World,
  release: string,
  label: string,
  code?: Build,
): Promise<void> {
  const outcomes = await build(contract, {
    source: example,
    build: code ?? (await loadBuild(ROOT, EXAMPLE)),
    release: join(EXAMPLE, "fixtures", release),
    label,
    feed: world.feed,
    out: world.out,
    now: `2026-10-0${world.builds.length + 1}T00:00:00Z`,
  });
  world.builds.push(outcomes);
  world.feeds.push(await readFile(world.feed, "utf8").catch(() => ""));
}

function rowsFiles(world: World): string[] {
  return readdirSync(join(world.out, "rows")).map((file) =>
    join(world.out, "rows", file),
  );
}

const steps = new Steps<World>()
  .define(
    "the example builder's release {string} is built as {string}",
    (world, [release, label]) =>
      runBuild(world, release as string, label as string),
  )
  .define("the example builder yields {}", async (world, [rows]) => {
    const yielded = JSON.parse(rows as string) as Row[];
    const code: Build = async function* () {
      yield* yielded;
    };
    try {
      await runBuild(world, "release", "refused", code);
    } catch (error) {
      if (!(error instanceof Refusal)) throw error;
      world.refusal = error;
    }
  })
  .define("the build is refused, saying {string}", ({ refusal }, [reason]) => {
    assert.ok(refusal, "the build was not refused");
    assert.ok(refusal.message.includes(reason as string), refusal.message);
  })
  .define("nothing was written", ({ feed, out }) => {
    assert.equal(existsSync(feed), false);
    assert.equal(existsSync(join(out, "rows")), false);
  })
  .define(
    "each case of the vocabulary's tests\\/table-versions\\/cases.json has its name",
    async () => {
      const folder = join(
        contract.vocabulary.folder,
        "tests",
        "table-versions",
      );
      const cases = JSON.parse(
        await readFile(join(folder, "cases.json"), "utf8"),
      ) as {
        series: string;
        revises: string | null;
        rows: string | null;
        name: string;
      }[];
      assert.ok(cases.length >= 3);
      for (const c of cases) {
        const rows =
          c.rows === null
            ? []
            : parseTurtle(
                await readFile(join(folder, c.rows), "utf8"),
                "urn:x:",
              );
        assert.equal(
          await versionName(c.series, c.revises ?? undefined, rows),
          c.name,
          c.rows ?? c.series,
        );
      }
    },
  )
  .define("{string} is at {string}", async (world, [label, name]) => {
    assert.equal(
      (await feedOf(world)).current(seriesNamed(label as string)),
      name,
    );
  })
  .define(
    "{string} holds the row {string}:",
    async (world, [label, key], step) => {
      const feed = await feedOf(world);
      const version = feed.current(seriesNamed(label as string))!;
      const { file, checksum } = feed.rowsOf(version);
      const bytes = await readFile(join(world.out, file));
      assert.equal(sha256(bytes).toString("hex"), checksum);
      const held = keyed(
        parseNQuads(gunzipSync(bytes).toString("utf8")).map(dropGraph),
      );
      const prefixes = Object.entries(PREFIXES)
        .map(([prefix, space]) => `@prefix ${prefix}: <${space}> .`)
        .join("\n");
      const expected = keyed(
        parseTurtle(`${prefixes}\n${step.docString}`, "urn:x:"),
      );
      assert.equal(held.get(key as string), expected.get(key as string));
    },
  )
  .define("the last build made no version", (world) => {
    assert.deepEqual(
      lastBuild(world)
        .filter((o) => o.version !== undefined)
        .map((o) => o.label),
      [],
    );
  })
  .define("the last build made these versions:", async (world, _, step) => {
    const feed = await feedOf(world);
    const outcomes = lastBuild(world);
    for (const [label, revises, notes] of step.table!.slice(1)) {
      const series = seriesNamed(label!);
      const outcome = outcomes.find((o) => o.series === series);
      assert.ok(outcome?.version, `${label} has no new version`);
      assert.equal(outcome.previous, versionLabelled(feed, series, revises!));
      assert.equal(
        feed.graph.value(
          outcome.version,
          "http://www.w3.org/ns/adms#versionNotes",
        ),
        notes,
      );
    }
  })
  .define("the last build's differences list these keys:", (world, _, step) => {
    const outcomes = lastBuild(world);
    for (const [label, added, removed, changed] of step.table!.slice(1)) {
      const { differences } = outcomes.find(
        (o) => o.series === seriesNamed(label!),
      )!;
      const listed = (cell: string): string[] =>
        cell === "" ? [] : cell.split(", ");
      assert.deepEqual(differences.added, listed(added!), `${label} added`);
      assert.deepEqual(
        differences.removed,
        listed(removed!),
        `${label} removed`,
      );
      assert.deepEqual(
        differences.changed,
        listed(changed!),
        `${label} changed`,
      );
    }
  })
  .define(
    "each series has the versions {string} and {string}, and {string} is current",
    async (world, [first, second, current]) => {
      const feed = await feedOf(world);
      for (const { iri } of example.series) {
        const versions = feed.graph
          .objects(iri, `${DCAT}hasVersion`)
          .map((v) => v.value);
        assert.deepEqual(
          versions.sort(),
          [
            versionLabelled(feed, iri, first as string),
            versionLabelled(feed, iri, second as string),
          ].sort(),
        );
        assert.equal(
          feed.current(iri),
          versionLabelled(feed, iri, current as string),
        );
      }
    },
  )
  .define(
    "what the feed stated of each version {string} is unchanged",
    (world, [label]) => {
      const [then, now] = [world.feeds[0]!, world.feeds.at(-1)!].map((text) =>
        Feed.parse(text),
      );
      for (const { iri } of example.series) {
        const version = versionLabelled(then!, iri, label as string);
        const stated = (feed: Feed): string[] => {
          const distribution = feed.graph.value(
            version,
            `${DCAT}distribution`,
          )!;
          return [
            ...feed.graph.about(version),
            ...feed.graph.about(distribution),
          ]
            .filter((q) => q.object.termType !== "BlankNode")
            .map(ntLine)
            .sort();
        };
        assert.deepEqual(stated(now!), stated(then!));
      }
    },
  )
  .define("the catalog was modified at {word}", async (world, [time]) => {
    const catalogs = (await feedOf(world)).graph.subjects(
      "http://www.w3.org/1999/02/22-rdf-syntax-ns#type",
      `${DCAT}Catalog`,
    );
    assert.equal(
      (await feedOf(world)).graph.value(catalogs[0]!, `${DCT}modified`),
      time,
    );
  })
  .define("the feed conforms to its shapes", async (world) => {
    assert.deepEqual(
      await contract.feedShapes.violations((await feedOf(world)).triples),
      [],
    );
  })
  .define(
    "each version's rows file is named rows\\/<its SHA-256 in hex>.nq.gz, and its checksum is that hex",
    async (world) => {
      const feed = await feedOf(world);
      for (const outcome of lastBuild(world)) {
        const { file, checksum } = feed.rowsOf(outcome.version!);
        const bytes = await readFile(join(world.out, file));
        assert.equal(file, `rows/${sha256(bytes).toString("hex")}.nq.gz`);
        assert.equal(checksum, sha256(bytes).toString("hex"));
      }
    },
  )
  .define(
    "each rows file's gzip header has no time and the OS byte 255",
    async (world) => {
      for (const path of rowsFiles(world)) {
        const bytes = await readFile(path);
        assert.equal(bytes.readUInt32LE(4), 0);
        assert.equal(bytes[9], 255);
      }
    },
  )
  .define(
    "each rows file holds its version's rows in the graph named by the version, and nothing else",
    async (world) => {
      const feed = await feedOf(world);
      const expected = parseTrig(
        await readFile(
          join(EXAMPLE, "fixtures", "expected", "rows.trig"),
          "utf8",
        ),
      );
      for (const outcome of lastBuild(world)) {
        const { file } = feed.rowsOf(outcome.version!);
        const quads = parseNQuads(
          gunzipSync(await readFile(join(world.out, file))).toString("utf8"),
        );
        assert.deepEqual(
          [...new Set(quads.map((q) => q.graph.value))],
          quads.length === 0 ? [] : [outcome.version],
        );
        assert.deepEqual(
          keyed(quads.map(dropGraph)),
          keyed(
            expected
              .filter((q) => q.graph.value === outcome.series)
              .map(dropGraph),
          ),
        );
      }
    },
  );

function dropGraph(q: Quad): Quad {
  return quad(q.subject, q.predicate, q.object);
}

before(async () => {
  contract = await readContract(ROOT);
  example = await readSource(EXAMPLE);
});

const rules = readdirSync(join(ROOT, "rules")).filter((file) =>
  file.endsWith(".feature"),
);

for (const file of rules) {
  const examples = await readFeature(join(ROOT, "rules", file));
  describe(`rules/${file}`, () => {
    for (const ex of examples)
      test(ex.name, async () => {
        const dir = await mkdtemp(join(tmpdir(), "tables-"));
        try {
          await steps.run(ex, {
            dir,
            feed: join(dir, "feed.ttl"),
            out: join(dir, "out"),
            feeds: [],
            builds: [],
          });
        } finally {
          await rm(dir, { recursive: true, force: true });
        }
      });
  });
}

const builders = [
  EXAMPLE,
  ...(existsSync(join(ROOT, "builders"))
    ? readdirSync(join(ROOT, "builders"), { withFileTypes: true })
    : []
  )
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(ROOT, "builders", entry.name)),
];

for (const folder of builders)
  describe(`builder/conformance.feature on ${folder.slice(ROOT.length + 1)}`, async () => {
    for (const ex of await conformanceExamples(ROOT))
      test(ex.name, () => runConformance(contract, folder, ex));
  });
