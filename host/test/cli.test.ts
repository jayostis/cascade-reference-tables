import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { promisify } from "node:util";

const CLI = join(import.meta.dirname, "..", "src", "cli.js");

type Run = { code: number; stdout: string; stderr: string };

/** The host's entry point as a process, with no token in its environment. */
async function host(...args: string[]): Promise<Run> {
  const environment = { ...process.env };
  delete environment.GITHUB_TOKEN;
  try {
    const { stdout, stderr } = await promisify(execFile)(
      process.execPath,
      [CLI, ...args],
      { env: environment },
    );
    return { code: 0, stdout, stderr };
  } catch (error) {
    const failed = error as { code: number; stdout: string; stderr: string };
    return { code: failed.code, stdout: failed.stdout, stderr: failed.stderr };
  }
}

describe("Running the host from the command line · host/src/cli.ts", () => {
  describe("given no command", () => {
    it("prints the usage and exits 2", async () => {
      const run = await host();
      assert.equal(run.code, 2);
      assert.match(run.stderr, /^host check /);
    });
  });

  describe("given a command the host does not have", () => {
    it("prints the usage and exits 2", async () => {
      const run = await host("frobnicate");
      assert.equal(run.code, 2);
      assert.match(run.stderr, /^host check /);
    });
  });

  describe("given a command without what it needs", () => {
    for (const args of [["check"], ["build"], ["publish"]])
      it(`prints the usage for \`${args.join(" ")}\` and exits 2`, async () => {
        const run = await host(...args);
        assert.equal(run.code, 2);
        assert.match(run.stderr, /^host check /);
      });
  });

  describe("given a release without a label, or a label without a release", () => {
    for (const args of [
      ["--release", "somewhere"],
      ["--label", "a release"],
    ])
      it(`prints the usage for \`build cdc-cvx ${args[0]}\` and exits 2`, async () => {
        const run = await host("build", "cdc-cvx", ...args);
        assert.equal(run.code, 2);
        assert.match(run.stderr, /^host check /);
      });
  });

  describe("given a release the builder cannot read", () => {
    it("says it refuses and exits 1", async () => {
      const empty = await mkdtemp(join(tmpdir(), "cli-"));
      try {
        const run = await host(
          "build",
          "cdc-cvx",
          "--release",
          empty,
          "--label",
          "empty",
          "--out",
          join(empty, "out"),
        );
        assert.equal(run.code, 1);
        assert.match(run.stderr, /^refused: /m);
      } finally {
        await rm(empty, { recursive: true });
      }
    });
  });
});
