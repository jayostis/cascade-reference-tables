import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { Ajv2020 } from "ajv/dist/2020.js";
import { build, readContract } from "../src/pipeline.js";
import { type Checked, mergeChecked, publish } from "../src/publish.js";
import { loadBuild, readSource } from "../src/source.js";
import { folderStore } from "../src/stores.js";
import { releaseFolder } from "./release-folder.js";

const ROOT = join(import.meta.dirname, "..", "..", "..");
const KEY = "urn:uuid:5b1d3c52-7d4e-4b8a-9c61-2e5d8f0b7a14";

/**
 * `checked.json`, published beside the feed, says for each source when it was last checked and what the check found:
 * `new`, `nothing new`, or `not checked` with a reason. `shapes/checked.schema.json` is its schema.
 */
describe("Recording when each source was last checked · checked.json, mergeChecked()", () => {
  let validate: ReturnType<Ajv2020["compile"]>;

  before(async () => {
    validate = new Ajv2020().compile(
      JSON.parse(
        await readFile(join(ROOT, "shapes", "checked.schema.json"), "utf8"),
      ) as object,
    );
  });

  describe("given the checked.json a build writes and the one a publish writes", () => {
    let built: Checked;
    let published: Checked;
    let remove: () => Promise<void>;

    before(async () => {
      const contract = await readContract(ROOT);
      const example = join(ROOT, "fixtures", "builder");
      let dir: string;
      ({ folder: dir, remove } = await releaseFolder());
      const feed = join(dir, "feed.ttl");
      const out = join(dir, "out");
      await build(contract, {
        source: await readSource(example),
        build: await loadBuild(ROOT, example),
        release: join(example, "fixtures", "release"),
        label: "1",
        feed,
        out,
        now: "2026-10-08T06:23:00Z",
      });
      built = JSON.parse(
        await readFile(join(out, "checked.json"), "utf8"),
      ) as Checked;
      await publish({
        feed,
        site: join(dir, "site"),
        store: folderStore([out]),
        vocabulary: contract.vocabulary,
        repository: "example-org/example-tables",
        checked: mergeChecked(built, {
          checked: {
            "urn:uuid:17cec5a9-071a-4179-9403-5c1e3886fb7d": {
              label: "CDC CVX",
              at: "2026-10-07T06:23:00Z",
              found: "nothing new",
              inputs: {
                "CVX.txt": {
                  checksum: "0".repeat(64),
                  modified: "2026-10-06T21:01:41Z",
                },
              },
            },
            [KEY]: {
              label: "CDC ICD-10-CM",
              at: "2026-10-07T06:23:00Z",
              found: "not checked",
              reason: "ETIMEDOUT",
            },
          },
        }),
      });
      published = JSON.parse(
        await readFile(join(dir, "site", "checked.json"), "utf8"),
      ) as Checked;
    });
    after(() => remove());

    it("conforms to the schema", () => {
      for (const written of [built, published])
        assert.ok(validate(written), JSON.stringify(validate.errors));
    });

    it("keeps every source's last check when two files are merged", () => {
      assert.equal(Object.keys(published.checked).length, 3);
    });
  });

  describe("given a checked.json written by hand", () => {
    const checking = (found: string, reason?: string) => ({
      checked: {
        [KEY]: {
          label: "CDC ICD-10-CM",
          at: "2026-10-08T06:23:00Z",
          found,
          ...(reason === undefined ? {} : { reason }),
        },
      },
    });

    it("refuses a source keyed by its label and not its series' urn:uuid:", () => {
      assert.equal(
        validate({
          checked: {
            "CDC CVX": {
              label: "CDC CVX",
              at: "2026-10-08T06:23:00Z",
              found: "new",
            },
          },
        }),
        false,
      );
    });

    it("refuses a property the schema does not name", () => {
      assert.equal(validate({ checked: {}, extra: 1 }), false);
    });

    it("requires a reason with `not checked`, and refuses one with any other finding", () => {
      for (const found of ["new", "not checked"])
        for (const reason of [undefined, "ETIMEDOUT"])
          assert.equal(
            validate(checking(found, reason)),
            (found === "not checked") === (reason !== undefined),
            JSON.stringify(checking(found, reason)),
          );
    });
  });
});
