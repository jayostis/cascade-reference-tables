import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { readRowsFile } from "./distribution.js";
import { Feed } from "./feed.js";
import { versionName } from "./names.js";
import { PROV, RDF, RDFS, REC } from "./rdf.js";
import type { RowsStore } from "./stores.js";

/** The last check of each source, by its IRI, as `checked.json` holds it. */
export interface Checked {
  readonly checked: Readonly<
    Record<
      string,
      { readonly label: string; readonly at: string; readonly found: string }
    >
  >;
}

/** The checks, the later of two for one source winning. */
export function mergeChecked(...files: readonly Checked[]): Checked {
  const merged: Record<string, Checked["checked"][string]> = {};
  for (const { checked } of files)
    for (const [source, entry] of Object.entries(checked))
      if (merged[source] === undefined || merged[source].at < entry.at)
        merged[source] = entry;
  return { checked: merged };
}

function page(feed: Feed): string {
  const graph = feed.graph;
  const items = graph
    .subjects(`${RDF}type`, `${REC}ReferenceSeries`)
    .sort()
    .map((series) => {
      const label = graph.value(series, `${RDFS}label`) ?? series;
      const current = feed.current(series) ?? "";
      return `<li>${html(label)}: <code>${html(current)}</code></li>`;
    });
  return `<!doctype html>
<html lang="en">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Cascade reference tables (DRAFT)</title>
<h1>Cascade reference tables</h1>
<p><strong>DRAFT: no compatibility is promised before a numbered v1.</strong></p>
<p>The feed: <a href="feed.ttl">feed.ttl</a>, a DCAT catalog. When each source was last checked: <a href="checked.json">checked.json</a>.</p>
<ul>
${items.join("\n")}
</ul>
`;
}

function html(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * Writes the site: the feed, each series' current version's rows file and the one it revises, each checked against its
 * checksum and its version's name before anything is written, the last checks, and a page saying the feed is a draft.
 */
export async function publish(options: {
  readonly feed: string;
  readonly site: string;
  readonly store: RowsStore;
  readonly checked: Checked;
}): Promise<string[]> {
  const feed = await Feed.read(options.feed);
  const graph = feed.graph;
  const files = new Map<string, Uint8Array>();
  for (const series of graph.subjects(`${RDF}type`, `${REC}ReferenceSeries`)) {
    const current = feed.current(series);
    if (current === undefined) continue;
    const previous = graph.value(current, `${PROV}wasRevisionOf`);
    for (const version of previous === undefined
      ? [current]
      : [current, previous]) {
      const { file, checksum } = feed.rowsOf(version);
      const bytes = await options.store.get(file);
      if (bytes === undefined)
        throw new Error(`${file}, the rows of ${version}, is in no release`);
      const revises = graph.value(version, `${PROV}wasRevisionOf`);
      const named = await versionName(
        series,
        revises,
        readRowsFile(bytes, checksum),
      );
      if (named !== version)
        throw new Error(`${file}'s rows are named ${named}, not ${version}`);
      files.set(file, bytes);
    }
  }
  await mkdir(join(options.site, "rows"), { recursive: true });
  await writeFile(join(options.site, "feed.ttl"), await readFile(options.feed));
  for (const [file, bytes] of files)
    await writeFile(join(options.site, file), bytes);
  await writeFile(
    join(options.site, "checked.json"),
    `${JSON.stringify(options.checked, null, 2)}\n`,
  );
  await writeFile(join(options.site, "index.html"), page(feed));
  return [...files.keys()].sort();
}
