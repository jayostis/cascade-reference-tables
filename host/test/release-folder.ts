import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { Refusal } from "../src/builder.js";

/** A temporary folder holding the files given by their paths in it, and the call that removes it. */
export async function releaseFolder(
  files: Record<string, string | Buffer> = {},
): Promise<{ folder: string; remove: () => Promise<void> }> {
  const folder = await mkdtemp(join(tmpdir(), "tables-"));
  for (const [name, content] of Object.entries(files)) {
    await mkdir(dirname(join(folder, name)), { recursive: true });
    await writeFile(join(folder, name), content);
  }
  return {
    folder,
    remove: () => rm(folder, { recursive: true, force: true }),
  };
}

/** The message of the `Refusal` a promise rejects with; it fails when the promise resolves or rejects with anything else. */
export async function refusal(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    assert.ok(error instanceof Refusal, String(error));
    return error.message;
  }
  assert.fail("the promise was not refused");
}
