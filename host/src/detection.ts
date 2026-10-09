import { mkdir, rm, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { Feed } from "./feed.js";
import { sha256 } from "./names.js";
import {
  build,
  type BuildOptions,
  type Contract,
  type Outcome,
  type Seen,
  writeChecked,
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

/**
 * Each file's checksums and newest `Last-Modified` as the feed's current versions of the source's series record them,
 * and as the last check saw them.
 */
function held(
  source: Source,
  feed: Feed,
  seen: Seen,
): Map<string, { checksums: Set<string>; modified?: string }> {
  const found = new Map<
    string,
    { checksums: Set<string>; modified?: string }
  >();
  const inputs = [
    ...source.series.flatMap((series) => [...feed.inputsOf(series.iri)]),
    ...Object.entries(seen),
  ];
  for (const [title, input] of inputs) {
    const before = found.get(title) ?? { checksums: new Set<string>() };
    before.checksums.add(input.checksum);
    if ((input.modified ?? "") > (before.modified ?? ""))
      before.modified = input.modified;
    found.set(title, before);
  }
  return found;
}

function xsdDateTime(httpDate: string | null): string | undefined {
  const time = Date.parse(httpDate ?? "");
  return Number.isNaN(time)
    ? undefined
    : new Date(time).toISOString().replace(/\.000Z$/, "Z");
}

/**
 * A conditional GET of each file of the source: `If-Modified-Since` its recorded `Last-Modified`. Nothing new when
 * every series has a version and every file answers 304, or 200 with a checksum recorded. Otherwise every file is
 * saved into the folder.
 */
export async function check(
  source: Source,
  feed: Feed,
  fetchWith: Fetch,
  folder: string,
  seen: Seen = {},
): Promise<Checked> {
  if (source.detectedBy === `${TABLES}ReleaseApi`)
    return checkReleaseApi(source, feed, fetchWith, folder, seen);
  if (source.detectedBy !== `${TABLES}ConditionalGet`)
    throw new Error(
      `the host cannot yet detect a release by ${source.detectedBy}`,
    );
  const recorded = held(source, feed, seen);
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
      !recorded.get(name)?.checksums.has(sha256(bytes).toString("hex")),
  );
  const unbuilt = source.series.some(
    (series) => feed.current(series.iri) === undefined,
  );
  if (!changed && !unbuilt) return { found: "nothing new" };
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

/** A release as the publisher's API lists it. */
interface Listed {
  readonly fileName: string;
  readonly releaseVersion: string;
  readonly downloadUrl: string;
}

function listed(entry: unknown): entry is Listed & { current: true } {
  const { fileName, releaseVersion, downloadUrl, current } = (entry ??
    {}) as Record<string, unknown>;
  return (
    current === true &&
    [fileName, releaseVersion, downloadUrl].every(
      (field) => typeof field === "string" && field !== "",
    )
  );
}

/**
 * Asks the publisher's API for its releases and takes the one it marks current. Nothing new when every series has a
 * version and the feed or the last check records that release's file; otherwise its zip is saved into the folder,
 * labelled by its release version.
 */
async function checkReleaseApi(
  source: Source,
  feed: Feed,
  fetchWith: Fetch,
  folder: string,
  seen: Seen,
): Promise<Checked> {
  const api = source.releaseApi ?? "";
  const response = await fetchWith(api);
  if (!response.ok) throw new Error(`${api} answered ${response.status}`);
  const answer = (await response.json()) as unknown;
  const current = Array.isArray(answer) ? answer.filter(listed) : [];
  if (current.length !== 1)
    throw new Error(
      `${api} lists ${current.length} current releases with a file, a version and a download URL, not one`,
    );
  const release = current[0]!;
  const unbuilt = source.series.some(
    (series) => feed.current(series.iri) === undefined,
  );
  if (!unbuilt && held(source, feed, seen).has(release.fileName))
    return { found: "nothing new" };
  const download = await fetchWith(release.downloadUrl);
  if (!download.ok)
    throw new Error(`${release.downloadUrl} answered ${download.status}`);
  await rm(folder, { recursive: true, force: true });
  await mkdir(folder, { recursive: true });
  await writeFile(
    join(folder, basename(release.fileName)),
    Buffer.from(await download.arrayBuffer()),
  );
  return {
    found: "new",
    folder,
    modified: new Map(),
    label: release.releaseVersion,
  };
}

/** Checks the source, and builds what the publisher has when it is new: the release is saved under `<out>/release/`. */
export async function buildLatest(
  contract: Contract,
  options: Omit<BuildOptions, "release" | "label" | "modified"> & {
    readonly fetch: Fetch;
    readonly seen?: Seen;
  },
): Promise<Outcome[] | "nothing new"> {
  const feed = await Feed.readOrEmpty(options.feed);
  const checked = await check(
    options.source,
    feed,
    options.fetch,
    join(options.out, "release"),
    options.seen,
  );
  if (checked.found === "nothing new") {
    await writeChecked(
      options.out,
      options.source,
      options.now,
      "nothing new",
      options.seen,
    );
    return "nothing new";
  }
  return build(contract, {
    ...options,
    release: checked.folder,
    label: checked.label,
    modified: checked.modified,
  });
}
