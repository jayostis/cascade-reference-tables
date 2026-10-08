import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Refusal } from "./builder.js";
import { type Example, readFeature, Steps } from "./features.js";
import { type Contract, declarationViolations, rowsOf } from "./pipeline.js";
import { parseTrig } from "./rdf.js";
import { keyed, type SeriesRows } from "./rows.js";
import { loadBuild, readSource, type Source } from "./source.js";

interface World {
  readonly contract: Contract;
  readonly source: Source;
  builds: Map<string, SeriesRows>[];
  refusal?: Error;
}

function sameRows(
  a: Map<string, SeriesRows>,
  b: Map<string, Map<string, string>>,
): string[] {
  const differing: string[] = [];
  for (const [series, rows] of a) {
    const mine = rows.byKey();
    const theirs = b.get(series) ?? new Map<string, string>();
    const keys = new Set([...mine.keys(), ...theirs.keys()]);
    for (const key of keys)
      if (mine.get(key) !== theirs.get(key))
        differing.push(`${series}: ${key}`);
  }
  return differing;
}

const steps = new Steps<World>()
  .define("its declarations conform", async ({ contract, source }) => {
    const found = await declarationViolations(contract, source);
    if (found.length > 0) throw new Error(found.join("\n"));
  })
  .define("it builds its fixture release( again)", async (world) => {
    try {
      const build = await loadBuild(world.contract.root, world.source.folder);
      world.builds.push(
        await rowsOf(
          world.contract,
          world.source,
          build,
          join(world.source.folder, "fixtures", "release"),
        ),
      );
    } catch (error) {
      if (!(error instanceof Refusal)) throw error;
      world.refusal = error;
    }
  })
  .define("it is not refused", ({ refusal }) => {
    if (refusal !== undefined) throw refusal;
  })
  .define(
    "each series' rows equal its expected rows",
    async ({ source, builds }) => {
      const expected = new Map<string, Map<string, string>>();
      const quads = parseTrig(
        await readFile(
          join(source.folder, "fixtures", "expected", "rows.trig"),
          "utf8",
        ),
      );
      for (const series of source.series)
        expected.set(
          series.iri,
          keyed(quads.filter((q) => q.graph.value === series.iri)),
        );
      const differing = sameRows(builds[0]!, expected);
      if (differing.length > 0)
        throw new Error(
          `rows differing from fixtures/expected:\n${differing.join("\n")}`,
        );
    },
  )
  .define("both builds give the same rows", ({ builds }) => {
    const [first, second] = builds;
    const differing = sameRows(
      first!,
      new Map([...second!].map(([series, rows]) => [series, rows.byKey()])),
    );
    if (differing.length > 0)
      throw new Error(`two builds differ:\n${differing.join("\n")}`);
  });

export async function conformanceExamples(root: string): Promise<Example[]> {
  return readFeature(join(root, "builder", "conformance.feature"));
}

/** Runs one example of `builder/conformance.feature` on the builder in the folder. */
export async function runConformance(
  contract: Contract,
  folder: string,
  example: Example,
): Promise<void> {
  await steps.run(example, {
    contract,
    source: await readSource(folder),
    builds: [],
  });
}
