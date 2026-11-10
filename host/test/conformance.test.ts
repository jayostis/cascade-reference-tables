import assert from "node:assert/strict";
import { existsSync, readdirSync } from "node:fs";
import { cp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { after, before, describe, it } from "node:test";
import { conformanceExamples, runConformance } from "../src/conformance.js";
import { type Contract, readContract } from "../src/pipeline.js";
import { resolveVocabulary } from "../src/vocabulary.js";
import { releaseFolder } from "./release-folder.js";

const ROOT = join(import.meta.dirname, "..", "..", "..");
const EXAMPLE = join(ROOT, "fixtures", "builder");
const examples = await conformanceExamples(ROOT);

/** The folders of the repository's builders, from the root with `/`: the example builder and each of `builders/`. */
const folders = [
  "fixtures/builder",
  ...(existsSync(join(ROOT, "builders"))
    ? readdirSync(join(ROOT, "builders"), { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => `builders/${entry.name}`)
    : []),
];

let contract: Contract;

/** A copy of the example builder outside the repository, its `build.js` as given. */
async function outsideBuilder(
  buildJs: (compiled: string) => string,
): Promise<{ folder: string; remove: () => Promise<void> }> {
  const { folder, remove } = await releaseFolder();
  await cp(EXAMPLE, folder, {
    recursive: true,
    filter: (path) => !path.endsWith(".ts"),
  });
  const compiled = pathToFileURL(
    join(ROOT, "dist", "fixtures", "builder", "build.js"),
  ).href;
  await writeFile(join(folder, "build.js"), buildJs(JSON.stringify(compiled)));
  return { folder, remove };
}

/**
 * `builder/conformance.feature` holds the three examples every builder passes on its own fixture release: its
 * declarations conform, its release gives its expected rows, and two builds give the same rows. `conformanceExamples()`
 * reads them and `runConformance()` runs one on a builder's folder, as `npm run host -- test` does.
 */
describe("Checking that a builder conforms · conformanceExamples(), runConformance()", () => {
  before(async () => {
    contract = await readContract(ROOT);
  });

  for (const folder of folders)
    describe(`given \`${folder}\``, () => {
      for (const ex of examples)
        it(`runs the example: ${ex.name}`, () =>
          runConformance(contract, join(ROOT, ...folder.split("/")), ex));
    });

  describe("given a builder whose rows differ from one build to the next", () => {
    let outside: string;
    let remove: () => Promise<void>;

    before(async () => {
      ({ folder: outside, remove } = await outsideBuilder((compiled) =>
        [
          `import original from ${compiled};`,
          "let builds = 0;",
          "export default async function* (release) {",
          "  builds += 1;",
          "  for await (const row of original(release))",
          "    yield row.prefLabel === undefined ? row : { ...row, prefLabel: row.prefLabel + builds };",
          "}",
          "",
        ].join("\n"),
      ));
    });
    after(() => remove());

    it('fails the example "a build gives the same rows every time", saying two builds differ', async () => {
      const same = examples.find(
        (ex) => ex.name === "a build gives the same rows every time",
      )!;
      await assert.rejects(
        runConformance(contract, outside, same),
        /two builds differ/,
      );
    });
  });

  describe("given a builder outside the repository, with the vocabulary's folder given", () => {
    let outside: string;
    let remove: () => Promise<void>;
    let given: Contract;

    before(async () => {
      ({ folder: outside, remove } = await outsideBuilder(
        (compiled) => `export { default } from ${compiled};\n`,
      ));
      given = await readContract(ROOT, (await resolveVocabulary(ROOT)).folder);
    });
    after(() => remove());

    it('says the vocabulary is "as given"', () => {
      assert.match(given.said, /as given$/);
    });

    for (const ex of examples)
      it(`runs the example: ${ex.name}`, () =>
        runConformance(given, outside, ex));
  });
});
