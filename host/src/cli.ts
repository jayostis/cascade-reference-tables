#!/usr/bin/env node
import { existsSync } from "node:fs";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { Refusal } from "./builder.js";
import { conformanceExamples, runConformance } from "./conformance.js";
import { buildLatest, check } from "./detection.js";
import { Feed } from "./feed.js";
import { build, readContract, type Seen } from "./pipeline.js";
import { type Checked, mergeChecked, publish } from "./publish.js";
import { patientFetch } from "./patient.js";
import { loadBuild, readSource, type Source, sourceFolder } from "./source.js";
import { folderStore, releaseStore } from "./stores.js";

const USAGE = `host check <source> [--feed <file>] [--checked <file>]
host build <source> [--release <folder> --label <text>] [--out <folder>] [--feed <file>] [--releases <owner/repo>] [--checked <file>]
host publish --site <folder> [--feed <file>] [--releases <owner/repo>] [--rows <folder>]... [<checked.json>...]
host test [<source>...]`;

function now(): string {
  return new Date().toISOString().replace(/\.\d+Z$/, "Z");
}

async function seenBy(
  file: string | undefined,
  source: Source,
): Promise<Seen | undefined> {
  if (file === undefined) return undefined;
  const { checked } = JSON.parse(await readFile(file, "utf8")) as Checked;
  return checked[source.iri]?.inputs;
}

async function checkCommand(root: string, args: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      feed: { type: "string", default: join(root, "feed", "feed.ttl") },
      checked: { type: "string" },
    },
  });
  const [name] = positionals;
  if (name === undefined) {
    console.error(USAGE);
    return 2;
  }
  const source = await readSource(sourceFolder(root, name));
  const feed = await Feed.readOrEmpty(values.feed);
  const folder = await mkdtemp(join(tmpdir(), "check-"));
  try {
    const seen = await seenBy(values.checked, source);
    console.log(
      (await check(source, feed, patientFetch(), folder, seen)).found,
    );
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
  return 0;
}

async function buildCommand(root: string, args: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      release: { type: "string" },
      label: { type: "string" },
      out: { type: "string", default: "build" },
      feed: { type: "string", default: join(root, "feed", "feed.ttl") },
      releases: { type: "string" },
      checked: { type: "string" },
    },
  });
  const [name] = positionals;
  if (
    name === undefined ||
    (values.release === undefined) !== (values.label === undefined)
  ) {
    console.error(USAGE);
    return 2;
  }
  const contract = await readContract(root);
  console.error(contract.said);
  const folder = sourceFolder(root, name);
  const source = await readSource(folder);
  const seen = await seenBy(values.checked, source);
  const options = {
    source,
    build: await loadBuild(root, folder),
    feed: resolve(values.feed),
    out: resolve(values.out),
    now: now(),
    ...(values.releases === undefined
      ? {}
      : { rows: releaseStore(values.releases, process.env.GITHUB_TOKEN) }),
  };
  const outcomes =
    values.release === undefined || values.label === undefined
      ? await buildLatest(contract, {
          ...options,
          fetch: patientFetch(),
          ...(seen === undefined ? {} : { seen }),
        })
      : await build(contract, {
          ...options,
          release: resolve(values.release),
          label: values.label,
        });
  if (outcomes === "nothing new") {
    console.log("nothing new");
    return 0;
  }
  for (const o of outcomes)
    console.log(
      o.version === undefined
        ? `${o.label}: nothing new`
        : `${o.label}: ${o.version}`,
    );
  return 0;
}

async function publishCommand(root: string, args: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      site: { type: "string" },
      feed: { type: "string", default: join(root, "feed", "feed.ttl") },
      releases: { type: "string" },
      rows: { type: "string", multiple: true, default: [] },
    },
  });
  if (values.site === undefined) {
    console.error(USAGE);
    return 2;
  }
  const checks: Checked[] = [];
  for (const path of positionals)
    checks.push(JSON.parse(await readFile(path, "utf8")) as Checked);
  const folders = folderStore(values.rows.map((folder) => resolve(folder)));
  const releases =
    values.releases === undefined
      ? undefined
      : releaseStore(values.releases, process.env.GITHUB_TOKEN);
  const placed = await publish({
    feed: resolve(values.feed),
    site: resolve(values.site),
    store: {
      async get(file) {
        return (await folders.get(file)) ?? (await releases?.get(file));
      },
    },
    checked: mergeChecked(...checks),
  });
  for (const file of placed) console.log(file);
  return 0;
}

async function testCommand(root: string, names: string[]): Promise<number> {
  const builders = join(root, "builders");
  const folders =
    names.length > 0
      ? names.map((name) => sourceFolder(root, name))
      : existsSync(builders)
        ? (await readdir(builders, { withFileTypes: true }))
            .filter((entry) => entry.isDirectory())
            .map((entry) => join(builders, entry.name))
        : [];
  if (folders.length === 0) {
    console.error(`no builder to test: ${builders} holds none`);
    return 1;
  }
  const contract = await readContract(root);
  console.error(contract.said);
  let failed = 0;
  for (const folder of folders)
    for (const example of await conformanceExamples(root)) {
      try {
        await runConformance(contract, folder, example);
        console.log(`ok ${folder}: ${example.name}`);
      } catch (error) {
        failed += 1;
        console.log(
          `not ok ${folder}: ${example.name}\n${(error as Error).message}`,
        );
      }
    }
  return failed === 0 ? 0 : 1;
}

async function main(argv: string[]): Promise<number> {
  const root = resolve(import.meta.dirname, "..", "..", "..");
  const [command, ...args] = argv;
  try {
    if (command === "check") return await checkCommand(root, args);
    if (command === "build") return await buildCommand(root, args);
    if (command === "publish") return await publishCommand(root, args);
    if (command === "test") return await testCommand(root, args);
  } catch (error) {
    if (!(error instanceof Refusal)) throw error;
    console.error(`refused: ${error.message}`);
    return 1;
  }
  console.error(USAGE);
  return 2;
}

process.exitCode = await main(process.argv.slice(2));
