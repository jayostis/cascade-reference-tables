import { readFile } from "node:fs/promises";
import {
  CucumberExpression,
  ParameterTypeRegistry,
} from "@cucumber/cucumber-expressions";
import {
  AstBuilder,
  compile,
  GherkinClassicTokenMatcher,
  Parser,
} from "@cucumber/gherkin";
import { IdGenerator } from "@cucumber/messages";

/** One step as an example states it: its text, and the table or the text beneath it. */
export interface StatedStep {
  readonly text: string;
  readonly table?: readonly (readonly string[])[];
  readonly docString?: string;
}

/** One example of a feature file, its background's steps first. */
export interface Example {
  readonly feature: string;
  readonly name: string;
  readonly steps: readonly StatedStep[];
}

/** A feature file's examples, as Gherkin compiles them. */
export async function readFeature(path: string): Promise<Example[]> {
  const newId = IdGenerator.incrementing();
  const document = new Parser(
    new AstBuilder(newId),
    new GherkinClassicTokenMatcher(),
  ).parse(await readFile(path, "utf8"));
  return compile(document, path, newId).map((pickle) => ({
    feature: path,
    name: pickle.name,
    steps: pickle.steps.map((step) => {
      const table = step.argument?.dataTable?.rows.map((row) =>
        row.cells.map((cell) => cell.value),
      );
      const docString = step.argument?.docString?.content;
      return {
        text: step.text,
        ...(table === undefined ? {} : { table }),
        ...(docString === undefined ? {} : { docString }),
      };
    }),
  }));
}

/** A step's implementation: its expression's arguments, then the step as stated. */
export type StepFunction<World> = (
  world: World,
  args: readonly unknown[],
  step: StatedStep,
) => Promise<void> | void;

/** Steps by their Cucumber Expressions; an example runs each of its steps through the one that matches. */
export class Steps<World> {
  private readonly registry = new ParameterTypeRegistry();
  private readonly steps: {
    expression: CucumberExpression;
    run: StepFunction<World>;
  }[] = [];

  define(expression: string, run: StepFunction<World>): this {
    this.steps.push({
      expression: new CucumberExpression(expression, this.registry),
      run,
    });
    return this;
  }

  async run(example: Example, world: World): Promise<void> {
    for (const step of example.steps) {
      const matched = this.steps.flatMap(({ expression, run }) => {
        const args = expression.match(step.text);
        return args === null
          ? []
          : [{ run, args: args.map((a) => a.getValue(world)) }];
      });
      if (matched.length !== 1)
        throw new Error(
          `${matched.length === 0 ? "no step matches" : "several steps match"} "${step.text}" in ${example.feature}`,
        );
      await matched[0]!.run(world, matched[0]!.args, step);
    }
  }
}
