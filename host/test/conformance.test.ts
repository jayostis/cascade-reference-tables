import assert from "node:assert/strict";
import { existsSync, readdirSync } from "node:fs";
import { cp, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { after, before, describe, test } from "node:test";
import { conformanceExamples, runConformance } from "../src/conformance.js";
import { type Contract, readContract } from "../src/pipeline.js";
import { resolveVocabulary } from "../src/vocabulary.js";

const ROOT = join(import.meta.dirname, "..", "..", "..");
const EXAMPLE = join(ROOT, "fixtures", "builder");
const contract = await readContract(ROOT);

const builders = [
  EXAMPLE,
  ...(existsSync(join(ROOT, "builders"))
    ? readdirSync(join(ROOT, "builders"), { withFileTypes: true })
    : []
  )
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(ROOT, "builders", entry.name)),
];

for (const folder of builders)
  describe(`builder/conformance.feature on ${folder.slice(ROOT.length + 1)}`, async () => {
    for (const ex of await conformanceExamples(ROOT))
      test(ex.name, () => runConformance(contract, folder, ex));
  });

describe("builder/conformance.feature on a builder whose rows differ from one build to the next", async () => {
  let outside: string;
  before(async () => {
    outside = await mkdtemp(join(tmpdir(), "unsteady-builder-"));
    await cp(EXAMPLE, outside, {
      recursive: true,
      filter: (path) => !path.endsWith(".ts"),
    });
    const compiled = pathToFileURL(
      join(ROOT, "dist", "fixtures", "builder", "build.js"),
    ).href;
    await writeFile(
      join(outside, "build.js"),
      [
        `import original from ${JSON.stringify(compiled)};`,
        "let builds = 0;",
        "export default async function* (release) {",
        "  builds += 1;",
        "  for await (const row of original(release))",
        "    yield row.prefLabel === undefined ? row : { ...row, prefLabel: row.prefLabel + builds };",
        "}",
        "",
      ].join("\n"),
    );
  });
  after(() => rm(outside, { recursive: true, force: true }));
  test("a build gives the same rows every time", async () => {
    const examples = await conformanceExamples(ROOT);
    const same = examples.find(
      (ex) => ex.name === "a build gives the same rows every time",
    )!;
    await assert.rejects(
      runConformance(contract, outside, same),
      /two builds differ/,
    );
  });
});

describe("builder/conformance.feature on a builder outside the repository, with the vocabulary given", async () => {
  let outside: string;
  let given: Contract;
  before(async () => {
    outside = await mkdtemp(join(tmpdir(), "outside-builder-"));
    await cp(EXAMPLE, outside, {
      recursive: true,
      filter: (path) => !path.endsWith(".ts"),
    });
    const compiled = pathToFileURL(
      join(ROOT, "dist", "fixtures", "builder", "build.js"),
    ).href;
    await writeFile(
      join(outside, "build.js"),
      `export { default } from ${JSON.stringify(compiled)};\n`,
    );
    given = await readContract(ROOT, (await resolveVocabulary(ROOT)).folder);
    assert.match(given.said, /as given$/);
  });
  after(() => rm(outside, { recursive: true, force: true }));
  for (const ex of await conformanceExamples(ROOT))
    test(ex.name, () => runConformance(given, outside, ex));
});
