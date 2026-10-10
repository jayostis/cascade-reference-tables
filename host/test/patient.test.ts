import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import { patientFetch } from "../src/patient.js";

const BODY = Buffer.from("0123456789".repeat(100));
const CUT = 300;

type Answer =
  "cut" | "error" | "serve" | "short" | "offset" | "other version" | "untagged";

/** A publisher that answers the file's requests, in order, as `answers` say, and then whole. */
async function publisher(
  answers: readonly Answer[],
  ranges: boolean,
): Promise<{ server: Server; url: string; seen: (string | undefined)[] }> {
  const seen: (string | undefined)[] = [];
  const server = createServer((request, response) => {
    const how = answers[seen.length] ?? "serve";
    seen.push(request.headers.range);
    if (how === "error") {
      response.writeHead(503).end();
      return;
    }
    const from = /^bytes=(\d+)-$/.exec(request.headers.range ?? "")?.[1];
    const start = ranges && from !== undefined ? Number(from) : 0;
    const [first, last] =
      how === "short"
        ? [start, start + 99]
        : how === "offset"
          ? [start + 100, BODY.length - 1]
          : [start, BODY.length - 1];
    const body = BODY.subarray(first, last + 1);
    response.writeHead(start > 0 ? 206 : 200, {
      ...(how === "untagged"
        ? {}
        : { ETag: how === "other version" ? '"v2"' : '"v1"' }),
      "Content-Length": body.length,
      ...(start > 0
        ? { "Content-Range": `bytes ${first}-${last}/${BODY.length}` }
        : {}),
    });
    if (how === "cut") {
      response.write(body.subarray(0, CUT));
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

test("a download cut off, refused or answered wrongly is tried again, resumed only as the exact rest of the same version, and given whole", async () => {
  const cases: [string, Answer[], boolean, number, number][] = [
    ["resumed by Range", ["cut"], true, 2, 1],
    ["read again where Range is ignored", ["cut"], false, 2, 1],
    ["after a server error", ["error"], true, 2, 0],
    ["a partial answer that stops short", ["cut", "short"], true, 3, 1],
    ["a partial answer at another offset", ["cut", "offset"], true, 3, 1],
    [
      "a partial answer of another version",
      ["cut", "other version"],
      true,
      3,
      1,
    ],
    [
      "cuts that each add bytes, more than the attempts",
      ["cut", "cut", "cut"],
      true,
      4,
      3,
    ],
  ];
  for (const [name, answers, ranges, requests, resumes] of cases) {
    const { server, url, seen } = await publisher(answers, ranges);
    try {
      const response = await patientFetch(fetch, { attempts: 2, delayMs: 0 })(
        url,
      );
      assert.deepEqual(Buffer.from(await response.arrayBuffer()), BODY, name);
      assert.equal(response.status, 200, name);
      assert.equal(seen.length, requests, name);
      assert.equal(
        seen.filter((range) => /^bytes=[1-9]\d*-$/.test(range ?? "")).length,
        resumes,
        name,
      );
    } finally {
      server.close();
    }
  }
});

test("a download is given up after attempts in a row that read nothing new, saying what the publisher answered", async () => {
  const { server, url } = await publisher(Array(20).fill("error"), true);
  try {
    await assert.rejects(
      patientFetch(fetch, { attempts: 3, delayMs: 0 })(url),
      /3 attempts in a row.*answered 503/,
    );
  } finally {
    server.close();
  }
});

test("a download whose resume is always refused and whose full read is always cut at the same point is given up, not looped", async () => {
  const cases: [string, Answer[]][] = [
    ["a partial answer that always stops short", ["cut", "short"]],
    ["a partial answer that never names its version", ["cut", "untagged"]],
  ];
  for (const [name, pattern] of cases) {
    const { server, url, seen } = await publisher(
      Array.from({ length: 100 }, (_, i) => pattern[i % 2]!),
      true,
    );
    try {
      await assert.rejects(
        patientFetch(fetch, { attempts: 3, delayMs: 0 })(url),
        /3 attempts in a row/,
        name,
      );
      assert.ok(seen.length < 10, name);
    } finally {
      server.close();
    }
  }
});
