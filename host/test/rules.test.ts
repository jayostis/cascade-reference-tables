import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { after, before, describe, test } from "node:test";
import { crc32, gunzipSync } from "node:zlib";
import { type Build, Refusal, type Row } from "../src/builder.js";
import { conformanceExamples, runConformance } from "../src/conformance.js";
import {
  buildLatest,
  check,
  type Checked,
  type Fetch,
} from "../src/detection.js";
import { Feed } from "../src/feed.js";
import { readFeature, Steps } from "../src/features.js";
import { sha256, versionName } from "../src/names.js";
import {
  build,
  type BuildOptions,
  type Contract,
  type Outcome,
  readContract,
  type Seen,
  type SeenInputs,
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
  REC,
} from "../src/rdf.js";
import {
  type Checked as SiteChecks,
  mergeChecked,
  publish,
} from "../src/publish.js";
import { keyed } from "../src/rows.js";
import { folderStore } from "../src/stores.js";
import {
  loadBuild,
  loadHistory,
  readSource,
  type Source,
} from "../src/source.js";
import { resolveVocabulary } from "../src/vocabulary.js";

const ROOT = join(import.meta.dirname, "..", "..", "..");
const EXAMPLE = join(ROOT, "fixtures", "builder");

interface World {
  readonly dir: string;
  readonly feed: string;
  readonly out: string;
  readonly feeds: string[];
  readonly builds: Outcome[][];
  refusal?: Error;
  publisher?: { release: string; modified: string; ignoresSince: boolean };
  /** Each request's `If-Modified-Since`, in order. */
  readonly asked: (string | undefined)[];
  checked?: Checked;
  siteChecks?: SiteChecks;
  site?: string;
  stopped?: Error;
  /** The release the publisher's API marks current, with its version, and the path its zip lacks; none for none. */
  api?: { release?: string; version?: string; lacking?: string };
  failure?: Error;
  /** The error every request to the publisher fails with. */
  unreachable?: string;
  /** The time the publisher's folders list each file at, and whether their zips lack the codes. */
  listed?: { at: string; lacking: boolean };
  /** Each address the publisher was asked for, in order. */
  fetched?: string[];
  /** What the publisher's history says of each code, and the codes the last build asked it for. */
  history?: Map<string, { status: string; replacedBy: string[] }>;
  askedHistory: string[];
  /** The contract of the builds that follow a vocabulary moving a code system's space. */
  moved?: Contract;
}

let contract: Contract;
let example: Source;
let byReleaseApi: Source;
let byFolderListing: Source;
let carrying: Source;
const RELEASES = "https://publisher.example/releases";
const FOLDERS = "https://publisher.example/releases/";

/** A zip of the files, stored without compression. */
function zipOf(files: readonly (readonly [string, Buffer])[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const [name, bytes] of files) {
    const path = Buffer.from(name);
    const crc = crc32(bytes);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(bytes.length, 18);
    local.writeUInt32LE(bytes.length, 22);
    local.writeUInt16LE(path.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(bytes.length, 20);
    central.writeUInt32LE(bytes.length, 24);
    central.writeUInt16LE(path.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, path, bytes);
    centrals.push(central, path);
    offset += local.length + path.length + bytes.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

/** The publisher's release API and its zips, as the world says. */
function releaseApi(world: World): Fetch {
  return async (input) => {
    const { release, version, lacking } = world.api!;
    const url = String(input);
    const download = `https://publisher.example/downloads/${release}.zip`;
    if (url === RELEASES)
      return Response.json([
        {
          fileName: "older.zip",
          releaseVersion: "2026-01-01",
          downloadUrl: "https://publisher.example/downloads/older.zip",
        },
        ...(release === undefined
          ? []
          : [
              {
                fileName: `${release}.zip`,
                releaseVersion: version,
                downloadUrl: download,
                current: true,
              },
            ]),
      ]);
    if (url !== download) return new Response(null, { status: 404 });
    const codes = await readFile(
      join(EXAMPLE, "fixtures", release!, "codes.txt"),
    );
    const path = "release/codes.txt";
    return new Response(
      new Uint8Array(
        zipOf([[path === lacking ? "release/other.txt" : path, codes]]),
      ),
    );
  };
}

/** Each release folder of the publisher's listing: its files, by name, and the example release whose codes it holds. */
const LISTED: Record<string, Record<string, string>> = {
  "2026": { "codes-2026.zip": "release", "notes-2026.txt": "release" },
  "2026-update": { "codes-april-2026.zip": "release-2" },
  "2027": { "codes-2027.zip": "release-3", "notes-2027.txt": "release-3" },
};

/** An IIS listing of the links, each at the time. */
function listingHtml(links: readonly string[], at: string): string {
  return `<html><body><pre>${links
    .map(
      (link) =>
        ` ${at}  ${link.endsWith("/") ? "&lt;dir&gt;" : "123"} <A HREF="${link}">${link}</A><br>`,
    )
    .join("")}</pre></body></html>`;
}

/** The publisher's folder listing and its files, as the world says, recording each address asked for. */
function folderListing(world: World): Fetch {
  return async (input) => {
    const url = String(input);
    (world.fetched ??= []).push(url);
    const { at, lacking } = world.listed!;
    if (url === FOLDERS)
      return new Response(
        listingHtml(
          [
            ...Object.keys(LISTED).map((folder) => `${folder}/`),
            "CM- Committee/",
          ],
          at,
        ),
      );
    const [folder, name] = url.slice(FOLDERS.length).split("/");
    const files = LISTED[folder!];
    if (files === undefined) return new Response(null, { status: 404 });
    if (name === "") return new Response(listingHtml(Object.keys(files), at));
    const release = files[name!];
    if (release === undefined) return new Response(null, { status: 404 });
    const codes = await readFile(
      join(EXAMPLE, "fixtures", release, "codes.txt"),
    );
    if (!name!.endsWith(".zip")) return new Response(new Uint8Array(codes));
    const stem = name!.replace(/\.zip$/, "");
    const entry = `${stem}/${lacking ? "other.txt" : `${stem}.txt`}`;
    return new Response(
      new Uint8Array(
        zipOf([
          [entry, codes],
          [`${stem}/notes-${stem}.txt`, codes],
        ]),
      ),
    );
  };
}

const HISTORY = "https://publisher.example/history/";

/** The publisher's history of a code, as the world says; any other address is not found. */
function historyOf(world: World): Fetch {
  return async (input) => {
    const url = String(input);
    const answer = url.startsWith(HISTORY)
      ? world.history?.get(url.slice(HISTORY.length))
      : undefined;
    if (answer === undefined) return new Response(null, { status: 404 });
    world.askedHistory.push(url.slice(HISTORY.length));
    return Response.json({
      status: answer.status,
      ...(answer.replacedBy.length === 0
        ? {}
        : { replacedBy: answer.replacedBy }),
    });
  };
}

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
  carried?: Partial<BuildOptions>,
): Promise<void> {
  world.askedHistory = [];
  const outcomes = await build(world.moved ?? contract, {
    source: example,
    build: code ?? (await loadBuild(ROOT, EXAMPLE)),
    release: join(EXAMPLE, "fixtures", release),
    label,
    feed: world.feed,
    out: world.out,
    now: `2026-10-0${world.builds.length + 1}T00:00:00Z`,
    ...carried,
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
  .define(
    "the example builder at version {string} builds the release {string} as {string}",
    (world, [version, release, label]) =>
      runBuild(world, release as string, label as string, undefined, {
        source: {
          ...example,
          builder: { ...example.builder, version: version as string },
        },
      }),
  )
  .define(
    "the example builder, given the release {string}, yields {}",
    async (world, [release, rows]) => {
      const yielded = JSON.parse(rows as string) as Row[];
      const code: Build = async function* () {
        yield* yielded;
      };
      try {
        await runBuild(world, release as string, "refused", code);
      } catch (error) {
        if (!(error instanceof Refusal)) throw error;
        world.refusal = error;
      }
    },
  )
  .define(
    "the vocabulary moves CVX's space to {string}",
    async (world, [space]) => {
      const folder = join(world.dir, "moved-vocabulary");
      const records = join("ontologies", "records", "v1-draft");
      await cp(
        join(contract.vocabulary.folder, records),
        join(folder, records),
        { recursive: true },
      );
      const old = contract.vocabulary.codeIri(`${REC}CVX`, "");
      const turtle = (stem: string): string => stem.replaceAll(".", "\\\\.");
      for (const [file, from, to] of [
        ["records.ttl", old, space as string],
        ["records.shapes.ttl", turtle(old), turtle(space as string)],
      ] as const) {
        const path = join(folder, records, file);
        const text = await readFile(path, "utf8");
        assert.equal(text.split(from).length, 2, `${file} lacks ${from}`);
        await writeFile(path, text.replace(from, to));
      }
      world.moved = await readContract(ROOT, folder);
    },
  )
  .define("the history answers:", (world, _, step) => {
    world.history = new Map(
      step.table!.slice(1).map(([code, status, replacedBy]) => [
        code!,
        {
          status: status!,
          replacedBy: replacedBy === "" ? [] : replacedBy!.split(", "),
        },
      ]),
    );
  })
  .define(
    "the carrying example's release {string} is built as {string}",
    async (world, [release, label]) => {
      try {
        await runBuild(world, release as string, label as string, undefined, {
          source: carrying,
          history: await loadHistory(ROOT, EXAMPLE),
          fetch: historyOf(world),
        });
      } catch (error) {
        if (!(error instanceof Refusal)) throw error;
        world.refusal = error;
      }
    },
  )
  .define("the last build asked the history for {string}", (world, [codes]) => {
    assert.deepEqual(
      [...world.askedHistory].sort(),
      (codes as string).split(", "),
    );
  })
  .define("the last build did not ask the history", (world) => {
    assert.deepEqual(world.askedHistory, []);
  })
  .define(
    "each version of the last build records {string} among its inputs",
    async (world, [title]) => {
      const feed = await feedOf(world);
      const made = lastBuild(world).filter((o) => o.version !== undefined);
      assert.ok(made.length > 0, "the last build made no version");
      for (const { series, label } of made)
        assert.ok(
          feed.inputsOf(series).has(title as string),
          `${label} does not record ${title as string}`,
        );
    },
  )
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
    assert.deepEqual(
      outcomes
        .filter((o) => o.version !== undefined)
        .map((o) => o.label)
        .sort(),
      step
        .table!.slice(1)
        .map(([label]) => label)
        .sort(),
    );
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
  )
  .define(
    "the publisher serves {string}, last modified {string}",
    (world, [release, modified]) => {
      world.publisher = {
        release: release as string,
        modified: modified as string,
        ignoresSince: false,
      };
    },
  )
  .define(
    "the publisher serves {string}, last modified {string}, ignoring If-Modified-Since",
    (world, [release, modified]) => {
      world.publisher = {
        release: release as string,
        modified: modified as string,
        ignoresSince: true,
      };
    },
  )
  .define("the example source is checked", async (world) => {
    world.checked = await check(
      example,
      await Feed.readOrEmpty(world.feed),
      publisher(world),
      join(world.dir, "checked"),
      lastSeen(world),
    );
  })
  .define(
    "the example source, with a series added, is checked",
    async (world) => {
      const added = {
        ...example.series[0]!,
        iri: "urn:uuid:3f0c1a52-7d4e-4b8a-9c61-2e5d8f0b7a14",
      };
      world.checked = await check(
        { ...example, series: [...example.series, added] },
        await Feed.read(world.feed),
        publisher(world),
        join(world.dir, "checked"),
      );
    },
  )
  .define(
    "the example source, with its builder at version {string}, is checked",
    async (world, [version]) => {
      world.checked = await check(
        {
          ...example,
          builder: { ...example.builder, version: version as string },
        },
        await Feed.read(world.feed),
        publisher(world),
        join(world.dir, "checked"),
        lastSeen(world),
      );
    },
  )
  .define(
    "the example source, with its builder at version {string}, is built from the publisher",
    async (world, [version]) => {
      await builtFromPublisher(world, {
        ...example,
        builder: { ...example.builder, version: version as string },
      });
    },
  )
  .define("the example source is built from the publisher", (world) =>
    builtFromPublisher(world, example),
  )
  .define(
    "the publisher cannot be reached, saying {string}",
    (world, [why]) => {
      world.unreachable = why as string;
    },
  )
  .define(
    "the example source is built from the publisher, and the build fails",
    async (world) => {
      try {
        await buildLatest(contract, {
          source: example,
          build: await loadBuild(ROOT, EXAMPLE),
          feed: world.feed,
          out: world.out,
          now: `2026-10-0${world.builds.length + 1}T00:00:00Z`,
          fetch: publisher(world),
          seen: lastSeen(world),
        });
      } catch (error) {
        world.failure = error as Error;
      }
    },
  )
  .define(
    "the example source is built from the publisher by a builder that fails, saying {string}, and the build fails",
    async (world, [reason]) => {
      try {
        await buildLatest(contract, {
          source: example,
          build: () => {
            throw new Error(reason as string);
          },
          feed: world.feed,
          out: world.out,
          now: "2026-10-01T00:00:00Z",
          fetch: publisher(world),
        });
      } catch (error) {
        world.failure = error as Error;
      }
    },
  )
  .define("the build fails, saying {string}", ({ failure }, [reason]) => {
    assert.ok(failure, "the build did not fail");
    assert.ok(failure.message.includes(reason as string), failure.message);
  })
  .define(
    "the build records the source as not checked, saying {string}",
    ({ out }, [reason]) => {
      const entry = recordOf(out);
      assert.equal(entry.found, "not checked");
      assert.ok(entry.reason?.includes(reason as string), entry.reason);
    },
  )
  .define(
    "the build's record keeps {string} among what the last check saw",
    ({ out }, [file]) => {
      assert.ok(recordOf(out).inputs?.[file as string]);
    },
  )
  .define(
    "the publisher's release API marks {string} current as {string}",
    (world, [release, version]) => {
      world.api = { release: release as string, version: version as string };
    },
  )
  .define(
    "the publisher's release API marks {string} current as {string}, its zip lacking {string}",
    (world, [release, version, lacking]) => {
      world.api = {
        release: release as string,
        version: version as string,
        lacking: lacking as string,
      };
    },
  )
  .define(
    "the publisher's folders list each file at {string}",
    (world, [at]) => {
      world.listed = { at: at as string, lacking: false };
    },
  )
  .define(
    "the publisher's folders list each file at {string}, their zips lacking the codes",
    (world, [at]) => {
      world.listed = { at: at as string, lacking: true };
    },
  )
  .define(
    "the example source, detected by its folder listing, is checked on {string}",
    async (world, [day]) => {
      world.fetched = [];
      try {
        world.checked = await check(
          byFolderListing,
          await Feed.readOrEmpty(world.feed),
          folderListing(world),
          join(world.dir, "checked"),
          lastSeen(world),
          `${day as string}T00:00:00Z`,
        );
      } catch (error) {
        world.failure = error as Error;
      }
    },
  )
  .define(
    "the example source, detected by its folder listing, is built from the publisher on {string}",
    async (world, [day]) => {
      try {
        const outcomes = await buildLatest(contract, {
          source: byFolderListing,
          build: await loadBuild(ROOT, EXAMPLE),
          feed: world.feed,
          out: world.out,
          now: `${day as string}T00:00:00Z`,
          fetch: folderListing(world),
          seen: lastSeen(world),
        });
        world.builds.push(outcomes === "nothing new" ? [] : outcomes);
        world.feeds.push(await readFile(world.feed, "utf8").catch(() => ""));
      } catch (error) {
        if (!(error instanceof Refusal)) throw error;
        world.refusal = error;
      }
    },
  )
  .define("the check took {string}", ({ checked }, [names]) => {
    assert.equal(checked?.found, "new");
    assert.deepEqual(
      readdirSync(checked.folder).sort(),
      (names as string).split(", ").sort(),
    );
  })
  .define("the check downloaded nothing", ({ fetched }) => {
    assert.deepEqual(
      (fetched ?? []).filter((url) => !url.endsWith("/")),
      [],
    );
  })
  .define("the publisher's release API marks no release current", (world) => {
    world.api = {};
  })
  .define(
    "the example source, detected by its release API, is checked",
    async (world) => {
      try {
        world.checked = await check(
          byReleaseApi,
          await Feed.readOrEmpty(world.feed),
          releaseApi(world),
          join(world.dir, "checked"),
          lastSeen(world),
        );
      } catch (error) {
        world.failure = error as Error;
      }
    },
  )
  .define(
    "the example source, detected by its release API, is built from the publisher",
    async (world) => {
      try {
        const outcomes = await buildLatest(contract, {
          source: byReleaseApi,
          build: await loadBuild(ROOT, EXAMPLE),
          feed: world.feed,
          out: world.out,
          now: `2026-10-0${world.builds.length + 1}T00:00:00Z`,
          fetch: releaseApi(world),
          seen: lastSeen(world),
        });
        world.builds.push(outcomes === "nothing new" ? [] : outcomes);
        world.feeds.push(await readFile(world.feed, "utf8").catch(() => ""));
      } catch (error) {
        if (!(error instanceof Refusal)) throw error;
        world.refusal = error;
      }
    },
  )
  .define("the check fails, saying {string}", ({ failure }, [reason]) => {
    assert.ok(failure, "the check did not fail");
    assert.ok(failure.message.includes(reason as string), failure.message);
  })
  .define("the check finds nothing new", ({ checked }) => {
    assert.equal(checked?.found, "nothing new");
  })
  .define(
    "the check finds a new release labelled {string}",
    ({ checked }, [label]) => {
      assert.equal(checked?.found, "new");
      assert.equal(checked.label, label);
    },
  )
  .define(
    "the publisher was last asked with no If-Modified-Since",
    ({ asked }) => {
      assert.ok(asked.length > 0);
      assert.equal(asked.at(-1), undefined);
    },
  )
  .define(
    "the publisher was last asked with If-Modified-Since {string}",
    ({ asked }, [since]) => {
      assert.equal(asked.at(-1), since);
    },
  )
  .define("the site's checks are:", (world, _, step) => {
    const wanted = checksOf(step.table!);
    if (world.site === undefined) {
      world.siteChecks = wanted;
      return;
    }
    assert.equal(world.stopped, undefined);
    const held = JSON.parse(
      readFileSync(join(world.site, "checked.json"), "utf8"),
    ) as SiteChecks;
    assert.deepEqual(held, wanted);
  })
  .define("the site is published", async (world) => {
    world.site = join(world.dir, "site");
    try {
      await publish({
        feed: world.feed,
        site: world.site,
        store: folderStore([world.out]),
        checked: mergeChecked(
          world.siteChecks ?? { checked: {} },
          JSON.parse(
            await readFile(join(world.out, "checked.json"), "utf8"),
          ) as SiteChecks,
        ),
      });
    } catch (error) {
      world.stopped = error as Error;
    }
  })
  .define(
    "the site holds the rows files of these versions of {string}: {string}, {string}",
    async (world, [label, ...labels]) => {
      assert.equal(world.stopped, undefined);
      const feed = await feedOf(world);
      const series = seriesNamed(label as string);
      const wanted = (labels as string[]).map(
        (l) => feed.rowsOf(versionLabelled(feed, series, l)).file,
      );
      for (const version of feed.graph.objects(series, `${DCAT}hasVersion`)) {
        const { file } = feed.rowsOf(version.value);
        assert.equal(
          existsSync(join(world.site!, file)),
          wanted.includes(file),
          file,
        );
      }
    },
  )
  .define(
    "a byte of the rows file of {string} {string} is changed",
    async (world, [label, version]) => {
      const feed = await feedOf(world);
      const { file } = feed.rowsOf(
        versionLabelled(feed, seriesNamed(label as string), version as string),
      );
      const bytes = await readFile(join(world.out, file));
      bytes[bytes.length - 1] = bytes[bytes.length - 1]! ^ 1;
      await writeFile(join(world.out, file), bytes);
    },
  )
  .define(
    "the rows file of {string} {string} holds the rows of {string} {string}, and the feed its checksum",
    async (world, [label, version, otherLabel, otherVersion]) => {
      const feed = await feedOf(world);
      const to = feed.rowsOf(
        versionLabelled(feed, seriesNamed(label as string), version as string),
      );
      const from = feed.rowsOf(
        versionLabelled(
          feed,
          seriesNamed(otherLabel as string),
          otherVersion as string,
        ),
      );
      await writeFile(
        join(world.out, to.file),
        await readFile(join(world.out, from.file)),
      );
      const text = await readFile(world.feed, "utf8");
      assert.ok(text.includes(to.checksum));
      await writeFile(world.feed, text.split(to.checksum).join(from.checksum));
    },
  )
  .define(
    "the rows file of {string} {string} is in no release",
    async (world, [label, version]) => {
      const feed = await feedOf(world);
      const { file } = feed.rowsOf(
        versionLabelled(feed, seriesNamed(label as string), version as string),
      );
      await rm(join(world.out, file));
    },
  )
  .define(
    "the publish is stopped, saying {string}",
    ({ stopped }, [reason]) => {
      assert.ok(stopped, "the publish was not stopped");
      assert.ok(stopped.message.includes(reason as string), stopped.message);
    },
  )
  .define("the site holds nothing", ({ site }) => {
    assert.equal(existsSync(site!), false);
  });

function checksOf(table: readonly (readonly string[])[]): SiteChecks {
  return {
    checked: Object.fromEntries(
      table
        .slice(1)
        .map(([source, label, at, found]) => [
          source!,
          { label: label!, at: at!, found: found! },
        ]),
    ),
  };
}

function recordOf(out: string): {
  found: string;
  reason?: string;
  inputs?: SeenInputs;
  builder?: string;
} {
  const { checked } = JSON.parse(
    readFileSync(join(out, "checked.json"), "utf8"),
  ) as SiteChecks;
  return checked[example.iri]!;
}

async function builtFromPublisher(world: World, source: Source): Promise<void> {
  const outcomes = await buildLatest(contract, {
    source,
    build: await loadBuild(ROOT, EXAMPLE),
    feed: world.feed,
    out: world.out,
    now: `2026-10-0${world.builds.length + 1}T00:00:00Z`,
    fetch: publisher(world),
    seen: lastSeen(world),
  });
  world.builds.push(outcomes === "nothing new" ? [] : outcomes);
  world.feeds.push(await readFile(world.feed, "utf8").catch(() => ""));
}

function lastSeen(world: World): Seen {
  const file = join(world.out, "checked.json");
  if (!existsSync(file)) return { inputs: {} };
  const { checked } = JSON.parse(readFileSync(file, "utf8")) as SiteChecks;
  const last = checked[example.iri];
  return {
    inputs: last?.inputs ?? {},
    ...(last?.builder === undefined ? {} : { builder: last.builder }),
  };
}

/** A publisher serving the example builder's files from a release folder, answering a conditional GET as CDC does. */
function publisher(world: World): Fetch {
  return async (input, init) => {
    if (world.unreachable !== undefined) throw new Error(world.unreachable);
    const { release, modified, ignoresSince } = world.publisher!;
    const since =
      new Headers(init?.headers).get("If-Modified-Since") ?? undefined;
    world.asked.push(since);
    if (
      since !== undefined &&
      !ignoresSince &&
      Date.parse(since) >= Date.parse(modified)
    )
      return new Response(null, { status: 304 });
    const name = String(input).split("/").pop()!;
    return new Response(
      await readFile(join(EXAMPLE, "fixtures", release, name)),
      { status: 200, headers: { "Last-Modified": modified } },
    );
  };
}

function dropGraph(q: Quad): Quad {
  return quad(q.subject, q.predicate, q.object);
}

before(async () => {
  contract = await readContract(ROOT);
  example = await readSource(EXAMPLE);
  byReleaseApi = await readSource(join(ROOT, "fixtures", "release-api"));
  byFolderListing = await readSource(join(ROOT, "fixtures", "folder-listing"));
  carrying = await readSource(join(ROOT, "fixtures", "carrying"));
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
            asked: [],
            askedHistory: [],
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

describe("builder/conformance.feature on a builder outside the repository, with the vocabulary given", async () => {
  let outside: string;
  let given: Contract;
  before(async () => {
    outside = await mkdtemp(join(tmpdir(), "outside-builder-"));
    await cp(EXAMPLE, outside, {
      recursive: true,
      filter: (path) => !path.endsWith(".ts"),
    });
    const compiled = pathToFileURL(
      join(ROOT, "dist", "fixtures", "builder", "build.js"),
    ).href;
    await writeFile(
      join(outside, "build.js"),
      `export { default } from ${JSON.stringify(compiled)};\n`,
    );
    given = await readContract(ROOT, (await resolveVocabulary(ROOT)).folder);
    assert.match(given.said, /as given$/);
  });
  after(() => rm(outside, { recursive: true, force: true }));
  for (const ex of await conformanceExamples(ROOT))
    test(ex.name, () => runConformance(given, outside, ex));
});
