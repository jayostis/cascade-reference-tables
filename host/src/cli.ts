#!/usr/bin/env node
import { existsSync } from "node:fs";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { Refusal } from "./builder.js";
import { conformanceExamples, runConformance } from "./conformance.js";
import { buildLatest, check } from "./detection.js";
import { emptyFeed, Feed } from "./feed.js";
import { build, readContract } from "./pipeline.js";
import { loadBuild, readSource, sourceFolder } from "./source.js";

const USAGE = `host check <source> [--feed <file>]
host build <source> [--release <folder> --label <text>] [--out <folder>] [--feed <file>]
host test [<source>...]`;

function now(): string {
  return new Date().toISOString().replace(/\.\d+Z$/, "Z");
}

async function checkCommand(root: string, args: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      feed: { type: "string", default: join(root, "feed", "feed.ttl") },
    },
  });
  const [name] = positionals;
  if (name === undefined) {
    console.error(USAGE);
    return 2;
  }
  const source = await readSource(sourceFolder(root, name));
  const feed = existsSync(values.feed)
    ? await Feed.read(values.feed)
    : emptyFeed();
  const folder = await mkdtemp(join(tmpdir(), "check-"));
  try {
    console.log((await check(source, feed, fetch, folder)).found);
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
  const options = {
    source: await readSource(folder),
    build: await loadBuild(root, folder),
    feed: resolve(values.feed),
    out: resolve(values.out),
    now: now(),
  };
  const outcomes =
    values.release === undefined || values.label === undefined
      ? await buildLatest(contract, { ...options, fetch })
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
