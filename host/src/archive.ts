import { createWriteStream } from "node:fs";
import { join } from "node:path";
import type { Readable } from "node:stream";
import { text } from "node:stream/consumers";
import { pipeline } from "node:stream/promises";
import yauzl from "yauzl";
import { Refusal } from "./builder.js";

/**
 * Hands `take` each entry of the zip that `pick` names, one at a time, with the name `pick` gives it; gives the paths
 * of the entries taken. A zip or an entry that cannot be read is refused.
 */
function eachEntry(
  zip: string,
  pick: (path: string) => string | undefined,
  take: (stream: Readable, name: string) => Promise<unknown>,
): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const notZip = (cause: Error) =>
      reject(new Refusal(`${zip} is not a zip: ${cause.message}`));
    yauzl.open(zip, { lazyEntries: true }, (error, archive) => {
      if (error !== null) {
        notZip(error);
        return;
      }
      const unreadable = (path: string, cause: Error) =>
        reject(
          new Refusal(`${zip}'s ${path} cannot be read: ${cause.message}`),
        );
      const found: string[] = [];
      archive.on("error", notZip);
      archive.on("entry", (entry: yauzl.Entry) => {
        const name = pick(entry.fileName);
        if (name === undefined) {
          archive.readEntry();
          return;
        }
        archive.openReadStream(entry, (failed, stream) => {
          if (failed !== null) {
            unreadable(entry.fileName, failed);
            return;
          }
          stream.on("error", (cause: Error) =>
            unreadable(entry.fileName, cause),
          );
          take(stream, name).then(() => {
            found.push(entry.fileName);
            archive.readEntry();
          }, reject);
        });
      });
      archive.on("end", () => resolve(found));
      archive.readEntry();
    });
  });
}

/**
 * Writes each entry of the zip that `pick` names into the folder, as the file it names; gives the paths of the entries
 * written.
 */
export function extract(
  zip: string,
  pick: (path: string) => string | undefined,
  folder: string,
): Promise<string[]> {
  return eachEntry(zip, pick, (stream, name) =>
    pipeline(stream, createWriteStream(join(folder, name))),
  );
}

/** The text of each entry of the zip that `wanted` names, by its path. */
export async function texts(
  zip: string,
  wanted: (path: string) => boolean,
): Promise<Map<string, string>> {
  const found = new Map<string, string>();
  await eachEntry(
    zip,
    (path) => (wanted(path) ? path : undefined),
    async (stream, path) => found.set(path, await text(stream)),
  );
  return found;
}

/**
 * Writes each named entry of the zip into the folder, as the file named by the map's key; an entry the zip lacks is
 * refused.
 */
export async function unzip(
  zip: string,
  entries: ReadonlyMap<string, string>,
  folder: string,
): Promise<void> {
  const wanted = new Map([...entries].map(([name, path]) => [path, name]));
  const found = new Set(await extract(zip, (path) => wanted.get(path), folder));
  const missing = [...wanted.keys()].filter((path) => !found.has(path));
  if (missing.length > 0)
    throw new Refusal(`the release's zip has no ${missing.join(", ")}`);
}
