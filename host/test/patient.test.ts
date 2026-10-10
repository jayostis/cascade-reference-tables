import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { Ajv2020 } from "ajv/dist/2020.js";
import { buildLatest } from "../src/detection.js";
import { patientFetch } from "../src/patient.js";
import { readContract } from "../src/pipeline.js";
import { loadBuild, readSource } from "../src/source.js";

const ROOT = join(import.meta.dirname, "..", "..", "..");
const BODY = Buffer.from("0123456789".repeat(100));
const FAST = { attempts: 3, delayMs: 0 };

/** A publisher whose first answers to a file are cut off or refused, and whose later ones are whole. */
async function publisher(
  behaviour: (
    request: IncomingMessage,
    answer: number,
  ) => "cut" | "error" | "serve",
  ranges: boolean,
): Promise<{ server: Server; url: string; seen: (string | undefined)[] }> {
  const seen: (string | undefined)[] = [];
  const server = createServer((request, response) => {
    seen.push(request.headers.range);
    const how = behaviour(request, seen.length);
    if (how === "error") {
      response.writeHead(503).end();
      return;
    }
    const from = /^bytes=(\d+)-$/.exec(request.headers.range ?? "")?.[1];
    const start = ranges && from !== undefined ? Number(from) : 0;
    const body = BODY.subarray(start);
    response.writeHead(start > 0 ? 206 : 200, {
      ETag: '"v1"',
      "Content-Length": body.length,
      ...(start > 0
        ? {
            "Content-Range": `bytes ${start}-${BODY.length - 1}/${BODY.length}`,
          }
        : {}),
    });
    if (how === "cut") {
      response.write(body.subarray(0, 300));
      setTimeout(() => response.destroy(), 20);
      return;
    }
    response.end(body);
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  return {
    server,
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/file`,
    seen,
  };
}

test("a download cut off mid-body or refused is tried again, resumed where the publisher allows, and given up after its attempts", async () => {
  const cases: [
    string,
    boolean,
    (a: number) => "cut" | "error" | "serve",
    boolean,
  ][] = [
    ["resumed by Range", true, (a) => (a === 1 ? "cut" : "serve"), true],
    [
      "read again where Range is ignored",
      false,
      (a) => (a === 1 ? "cut" : "serve"),
      true,
    ],
    ["after a server error", true, (a) => (a === 1 ? "error" : "serve"), false],
  ];
  for (const [name, ranges, behaviour, asksForRest] of cases) {
    const { server, url, seen } = await publisher(
      (_, a) => behaviour(a),
      ranges,
    );
    try {
      const response = await patientFetch(fetch, FAST)(url);
      assert.deepEqual(Buffer.from(await response.arrayBuffer()), BODY, name);
      assert.equal(/^bytes=[1-9]\d*-$/.test(seen[1] ?? ""), asksForRest, name);
      assert.equal(seen.length, 2, name);
    } finally {
      server.close();
    }
  }
  const { server, url } = await publisher(() => "cut", true);
  try {
    await assert.rejects(
      patientFetch(fetch, FAST)(url),
      /could not be downloaded in 3 attempts/,
    );
  } finally {
    server.close();
  }
});

test("a source whose publisher cannot be reached is written as not checked, with the reason and what the last check saw", async () => {
  const folder = join(ROOT, "fixtures", "builder");
  const source = await readSource(folder);
  const out = await mkdtemp(join(tmpdir(), "not-checked-"));
  const seen = { "codes.txt": { checksum: "a".repeat(64) } };
  try {
    await assert.rejects(
      buildLatest(await readContract(ROOT), {
        source,
        build: await loadBuild(ROOT, folder),
        feed: join(out, "feed.ttl"),
        out,
        now: "2026-10-08T06:23:00Z",
        fetch: async () => {
          throw new Error("the publisher is slow");
        },
        seen,
      }),
      /the publisher is slow/,
    );
    const written = JSON.parse(
      await readFile(join(out, "checked.json"), "utf8"),
    ) as { checked: Record<string, unknown> };
    const schema = JSON.parse(
      await readFile(join(ROOT, "shapes", "checked.schema.json"), "utf8"),
    ) as object;
    assert.ok(new Ajv2020().compile(schema)(written));
    assert.deepEqual(written.checked[source.iri], {
      label: source.label,
      at: "2026-10-08T06:23:00Z",
      found: "not checked",
      reason: "the publisher is slow",
      inputs: seen,
    });
  } finally {
    await rm(out, { recursive: true, force: true });
  }
});
