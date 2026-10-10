import { mkdir, rm, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { Refusal } from "./builder.js";
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
import { type Listing, matches, type Source } from "./source.js";

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
    ...Object.entries(seen.inputs),
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
 * every series has a version, one of them built by the builder at its present version, and every file answers 304, or
 * 200 with a checksum recorded. Otherwise every file is saved into the folder.
 */
export async function check(
  source: Source,
  feed: Feed,
  fetchWith: Fetch,
  folder: string,
  seen: Seen = { inputs: {} },
  now: string = new Date().toISOString(),
): Promise<Checked> {
  if (source.detectedBy === `${TABLES}ReleaseApi`)
    return checkReleaseApi(source, feed, fetchWith, folder, seen);
  if (source.detectedBy === `${TABLES}FolderListing`)
    return checkFolderListing(source, feed, fetchWith, folder, seen, now);
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
  const unbuilt = feed.unbuilt(
    source.series.map((series) => series.iri),
    source.builder.version,
    seen.builder,
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
  const unbuilt = feed.unbuilt(
    source.series.map((series) => series.iri),
    source.builder.version,
    seen.builder,
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

/** An entry of a folder listing: a folder or a file, and the time the listing gives it. */
interface Entry {
  readonly name: string;
  readonly url: string;
  readonly folder: boolean;
  readonly modified?: string;
}

/** A listing's time, `8/13/2026  2:25 PM` as IIS writes it, as an `xsd:dateTime`. */
function listedTime(text: string): string | undefined {
  const found =
    /(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})\s*([AP]M)/i.exec(text);
  if (found === null) return undefined;
  const [, month, day, year, hour, minute, half] = found;
  const hours = (Number(hour) % 12) + (half!.toUpperCase() === "PM" ? 12 : 0);
  const two = (n: string | number) => String(n).padStart(2, "0");
  return `${year}-${two(month!)}-${two(day!)}T${two(hours)}:${minute}:00Z`;
}

/** The links of an HTML folder listing below its own address, each with the text before it on its line as its time. */
async function listingOf(fetchWith: Fetch, url: string): Promise<Entry[]> {
  const response = await fetchWith(url);
  if (!response.ok) throw new Error(`${url} answered ${response.status}`);
  const html = await response.text();
  const entries: Entry[] = [];
  const link = /<a\s[^>]*href="([^"]+)"[^>]*>/gi;
  let previous = 0;
  for (let found = link.exec(html); found !== null; found = link.exec(html)) {
    const before = html
      .slice(previous, found.index)
      .split(/<br\s*\/?>|\n/i)
      .pop()!;
    previous = link.lastIndex;
    const target = new URL(found[1]!.replace(/&amp;/g, "&"), url).href;
    if (!target.startsWith(url) || target === url) continue;
    const folder = target.endsWith("/");
    const name = decodeURIComponent(
      target.slice(url.length).replace(/\/$/, ""),
    );
    if (name.includes("/")) continue;
    const modified = listedTime(before);
    entries.push({
      name,
      url: target,
      folder,
      ...(modified === undefined ? {} : { modified }),
    });
  }
  return entries;
}

/** The release folders in effect on the day, newest first, each with the date it took effect. */
function inEffect(
  listing: Listing,
  entries: readonly Entry[],
  day: string,
): { entry: Entry; effective: string }[] {
  return entries
    .filter((entry) => entry.folder)
    .flatMap((entry) =>
      listing.releaseFolders.flatMap((kind) => {
        const year = new RegExp(kind.namePattern, "i").exec(entry.name)?.[1];
        if (year === undefined) return [];
        const effective = `${Number(year) + kind.yearOffset}${kind.effectiveFrom.slice(1)}`;
        return effective <= day ? [{ entry, effective }] : [];
      }),
    )
    .sort(
      (a, b) =>
        b.effective.localeCompare(a.effective) ||
        b.entry.name.localeCompare(a.entry.name),
    );
}

/**
 * Reads the publisher's folder listing, and takes each file the source names from the newest release folder in effect
 * that has it: a file matching its name, or a zip matching its archive's. Nothing new when every series has a version
 * and the feed or the last check records every file taken with the time the listing gives it; otherwise they are
 * saved into the folder, labelled by the date the newest folder they came from took effect.
 */
async function checkFolderListing(
  source: Source,
  feed: Feed,
  fetchWith: Fetch,
  folder: string,
  seen: Seen,
  now: string,
): Promise<Checked> {
  const listing = source.listing!;
  const folders = inEffect(
    listing,
    await listingOf(fetchWith, listing.url),
    now.slice(0, 10),
  );
  const listed = new Map<string, Entry[]>();
  const taken = new Map<string, Entry>();
  let label = "";
  for (const [title, file] of listing.files) {
    let found = false;
    for (const { entry, effective } of folders) {
      if (!listed.has(entry.url))
        listed.set(entry.url, await listingOf(fetchWith, entry.url));
      const candidates = listed
        .get(entry.url)!
        .filter(
          (candidate) =>
            !candidate.folder &&
            (matches(file.namePattern, candidate.name) ||
              (file.archivePattern !== undefined &&
                /\.zip$/i.test(candidate.name) &&
                matches(file.archivePattern, candidate.name))),
        );
      if (candidates.length === 0) continue;
      for (const candidate of candidates) taken.set(candidate.name, candidate);
      if (effective > label) label = effective;
      found = true;
      break;
    }
    if (!found)
      throw new Error(
        `no release folder in effect at ${listing.url} has a file for ${title}`,
      );
  }
  const unbuilt = feed.unbuilt(
    source.series.map((series) => series.iri),
    source.builder.version,
    seen.builder,
  );
  const recorded = held(source, feed, seen);
  if (
    !unbuilt &&
    [...taken.values()].every(
      ({ name, modified }) =>
        modified !== undefined && recorded.get(name)?.modified === modified,
    )
  )
    return { found: "nothing new" };
  await rm(folder, { recursive: true, force: true });
  await mkdir(folder, { recursive: true });
  const modified = new Map<string, string>();
  for (const { name, url, modified: when } of taken.values()) {
    const response = await fetchWith(url);
    if (!response.ok) throw new Error(`${url} answered ${response.status}`);
    await writeFile(
      join(folder, name),
      Buffer.from(await response.arrayBuffer()),
    );
    if (when !== undefined) modified.set(name, when);
  }
  return { found: "new", folder, modified, label };
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
    options.now,
  ).catch(async (error: unknown) => {
    await writeChecked(
      options.out,
      options.source,
      options.now,
      {
        notChecked: error instanceof Error ? error.message : String(error),
      },
      options.seen,
    );
    throw error;
  });
  if (checked.found === "nothing new") {
    await writeChecked(
      options.out,
      options.source,
      options.now,
      "nothing new",
      {
        inputs: options.seen?.inputs ?? {},
        builder: options.source.builder.version,
      },
    );
    return "nothing new";
  }
  return build(contract, {
    ...options,
    release: checked.folder,
    label: checked.label,
    modified: checked.modified,
  }).catch(async (error: unknown) => {
    const reason = error instanceof Error ? error.message : String(error);
    await writeChecked(
      options.out,
      options.source,
      options.now,
      { notChecked: reason },
      options.seen,
    );
    const failed = `${options.source.label} could not be built: ${reason}`;
    throw error instanceof Refusal
      ? new Refusal(failed)
      : new Error(failed, { cause: error });
  });
}
