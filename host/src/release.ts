import { existsSync } from "node:fs";
import { join } from "node:path";
import { Refusal, type Release, type ReleaseFile } from "./builder.js";
import {
  csv,
  delimited,
  fixedWidth,
  jsonLines,
  lines,
  xlsx,
  xmlElements,
} from "./readers.js";
import type { Vocabulary } from "./vocabulary.js";

/** What a source states beyond its files' names, and where a build's findings go. */
export interface ReleaseContext {
  /** The names of the files that are gzip. */
  readonly gzipped?: ReadonlySet<string>;
  /** The genes each series declares, by its IRI. */
  readonly genes?: ReadonlyMap<string, readonly string[]>;
  readonly finding?: (text: string) => void;
}

/** A release in a folder, whose files are those `owner` declares by name. */
export function releaseOf(
  vocabulary: Vocabulary,
  owner: string,
  declared: { has(name: string): boolean },
  folder: string,
  context: ReleaseContext = {},
): Release {
  return {
    file(name: string): ReleaseFile {
      if (!declared.has(name))
        throw new Error(`${owner} declares no file ${name}`);
      const path = join(folder, name);
      if (!existsSync(path)) throw new Refusal(`the release has no ${name}`);
      const gzip = context.gzipped?.has(name) ?? false;
      return {
        name,
        lines: () => lines(path, gzip),
        delimited: (delimiter) => delimited(path, delimiter, gzip),
        csv: (required) => csv(path, name, required, gzip),
        fixedWidth: (columns) => fixedWidth(path, columns, gzip),
        json: () => jsonLines(path, gzip),
        xlsx: () => xlsx(path),
        xml: (element) => xmlElements(path, element),
      };
    },
    codeIri: (system, code) => vocabulary.codeIri(system, code),
    concepts: (scheme) => vocabulary.concepts(scheme),
    genes: (series) => context.genes?.get(series) ?? [],
    finding: (text) => context.finding?.(text),
  };
}
