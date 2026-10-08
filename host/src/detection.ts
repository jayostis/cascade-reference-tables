import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { emptyFeed, Feed } from "./feed.js";
import { sha256 } from "./names.js";
import {
  build,
  type BuildOptions,
  type Contract,
  type Outcome,
} from "./pipeline.js";
import { TABLES } from "./rdf.js";
import type { Source } from "./source.js";

export type Fetch = typeof fetch;

/** What a check found: nothing new, or a release saved into a folder with each file's `Last-Modified`. */
export type Checked =
  | { readonly found: "nothing new" }
  | {
      readonly found: "new";
      readonly folder: string;
      readonly modified: ReadonlyMap<string, string>;
      /** The date of the newest `Last-Modified`, the publisher giving no release label. */
      readonly label: string;
    };

/** Each file's checksum and `Last-Modified` as the feed's current versions of the source's series record them. */
function held(
  source: Source,
  feed: Feed,
): Map<string, { checksum: string; modified?: string }> {
  const found = new Map<string, { checksum: string; modified?: string }>();
  for (const series of source.series)
    for (const [title, input] of feed.inputsOf(series.iri)) {
      const before = found.get(title);
      if (
        before === undefined ||
        (input.modified ?? "") > (before.modified ?? "")
      )
        found.set(title, input);
    }
  return found;
}

function xsdDateTime(httpDate: string | null): string | undefined {
  return httpDate === null
    ? undefined
    : new Date(httpDate).toISOString().replace(/\.000Z$/, "Z");
}

/**
 * A conditional GET of each file of the source: `If-Modified-Since` its recorded `Last-Modified`. Nothing new when
 * every file answers 304, or 200 with the checksum recorded. Otherwise every file is saved into the folder.
 */
export async function check(
  source: Source,
  feed: Feed,
  fetchWith: Fetch,
  folder: string,
): Promise<Checked> {
  if (source.detectedBy !== `${TABLES}ConditionalGet`)
    throw new Error(
      `the host cannot yet detect a release by ${source.detectedBy}`,
    );
  const recorded = held(source, feed);
  const answers = new Map<string, { bytes?: Buffer; modified?: string }>();
  for (const [name, url] of source.files) {
    const since = recorded.get(name)?.modified;
    const response = await fetchWith(url, {
      headers:
        since === undefined
          ? {}
          : { "If-Modified-Since": new Date(since).toUTCString() },
    });
    if (response.status === 304) {
      answers.set(name, {});
      continue;
    }
    if (!response.ok) throw new Error(`${url} answered ${response.status}`);
    const modified = xsdDateTime(response.headers.get("Last-Modified"));
    answers.set(name, {
      bytes: Buffer.from(await response.arrayBuffer()),
      ...(modified === undefined ? {} : { modified }),
    });
  }
  const changed = [...answers].some(
    ([name, { bytes }]) =>
      bytes !== undefined &&
      sha256(bytes).toString("hex") !== recorded.get(name)?.checksum,
  );
  if (!changed) return { found: "nothing new" };
  await mkdir(folder, { recursive: true });
  const modified = new Map<string, string>();
  for (const [name, url] of source.files) {
    let { bytes, modified: when } = answers.get(name)!;
    if (bytes === undefined) {
      const response = await fetchWith(url);
      if (!response.ok) throw new Error(`${url} answered ${response.status}`);
      bytes = Buffer.from(await response.arrayBuffer());
      when = xsdDateTime(response.headers.get("Last-Modified"));
    }
    await writeFile(join(folder, name), bytes);
    if (when !== undefined) modified.set(name, when);
  }
  const newest = [...modified.values()].sort().at(-1);
  return {
    found: "new",
    folder,
    modified,
    label: newest === undefined ? "unlabelled" : newest.slice(0, 10),
  };
}

/** Checks the source, and builds what the publisher has when it is new: the release is saved under `<out>/release/`. */
export async function buildLatest(
  contract: Contract,
  options: Omit<BuildOptions, "release" | "label" | "modified"> & {
    readonly fetch: Fetch;
  },
): Promise<Outcome[] | "nothing new"> {
  const feed = existsSync(options.feed)
    ? await Feed.read(options.feed)
    : emptyFeed();
  const checked = await check(
    options.source,
    feed,
    options.fetch,
    join(options.out, "release"),
  );
  if (checked.found === "nothing new") return "nothing new";
  return build(contract, {
    ...options,
    release: checked.folder,
    label: checked.label,
    modified: checked.modified,
  });
}
