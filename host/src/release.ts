import { existsSync } from "node:fs";
import { join } from "node:path";
import { Refusal, type Release, type ReleaseFile } from "./builder.js";
import { delimited, fixedWidth, jsonLines, xlsx } from "./readers.js";
import type { Vocabulary } from "./vocabulary.js";

/** A release in a folder, whose files are those `owner` declares by name. */
export function releaseOf(
  vocabulary: Vocabulary,
  owner: string,
  declared: { has(name: string): boolean },
  folder: string,
): Release {
  return {
    file(name: string): ReleaseFile {
      if (!declared.has(name))
        throw new Error(`${owner} declares no file ${name}`);
      const path = join(folder, name);
      if (!existsSync(path)) throw new Refusal(`the release has no ${name}`);
      return {
        name,
        delimited: (delimiter) => delimited(path, delimiter),
        fixedWidth: (columns) => fixedWidth(path, columns),
        json: () => jsonLines(path),
        xlsx: () => xlsx(path),
      };
    },
    codeIri: (system, code) => vocabulary.codeIri(system, code),
  };
}
