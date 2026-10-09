import { createWriteStream } from "node:fs";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import yauzl from "yauzl";
import { Refusal } from "./builder.js";

/**
 * Writes each named entry of the zip into the folder, as the file named by the map's key; an entry the zip lacks is
 * refused.
 */
export function unzip(
  zip: string,
  entries: ReadonlyMap<string, string>,
  folder: string,
): Promise<void> {
  const wanted = new Map([...entries].map(([name, path]) => [path, name]));
  return new Promise((resolve, reject) => {
    yauzl.open(zip, { lazyEntries: true }, (error, archive) => {
      if (error !== null) {
        reject(new Refusal(`${zip} is not a zip: ${error.message}`));
        return;
      }
      const found = new Set<string>();
      archive.on("error", reject);
      archive.on("entry", (entry: yauzl.Entry) => {
        const name = wanted.get(entry.fileName);
        if (name === undefined) {
          archive.readEntry();
          return;
        }
        archive.openReadStream(entry, (failed, stream) => {
          if (failed !== null) {
            reject(failed);
            return;
          }
          pipeline(stream, createWriteStream(join(folder, name))).then(() => {
            found.add(entry.fileName);
            archive.readEntry();
          }, reject);
        });
      });
      archive.on("end", () => {
        const missing = [...wanted.keys()].filter((path) => !found.has(path));
        if (missing.length > 0)
          reject(new Refusal(`the release's zip has no ${missing.join(", ")}`));
        else resolve();
      });
      archive.readEntry();
    });
  });
}
