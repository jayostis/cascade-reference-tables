import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { describe, it } from "node:test";
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

/** Asks for the file of a publisher answering as `answers` say, two attempts allowed, and checks what came of it. */
async function givesWhole(
  answers: Answer[],
  ranges: boolean,
  requests: number,
  resumes: number,
): Promise<void> {
  const { server, url, seen } = await publisher(answers, ranges);
  try {
    const response = await patientFetch(fetch, { attempts: 2, delayMs: 0 })(
      url,
    );
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), BODY);
    assert.equal(response.status, 200);
    assert.equal(seen.length, requests, "requests");
    assert.equal(
      seen.filter((range) => /^bytes=[1-9]\d*-$/.test(range ?? "")).length,
      resumes,
      "resumes",
    );
  } finally {
    server.close();
  }
}

/** Asks for the file of a publisher answering as `answers` say and expects it given up, in fewer than `most` requests. */
async function givesUp(
  answers: Answer[],
  reason: RegExp,
  most = Infinity,
): Promise<void> {
  const { server, url, seen } = await publisher(answers, true);
  try {
    await assert.rejects(
      patientFetch(fetch, { attempts: 3, delayMs: 0 })(url),
      reason,
    );
    assert.ok(seen.length < most, `${seen.length} requests`);
  } finally {
    server.close();
  }
}

/**
 * `patientFetch()` wraps `fetch` for a publisher's large files: a download that is cut off is asked for again from
 * where it stopped, and the caller gets one whole answer or an error. It resumes only when the publisher answers with
 * the exact rest of the same version of the file.
 */
describe("Downloading a publisher's file patiently · patientFetch()", () => {
  describe("when a download is cut off", () => {
    it("resumes with a Range request and returns the file whole", () =>
      givesWhole(["cut"], true, 2, 1));

    it("reads the file again from its start when the publisher ignores Range", () =>
      givesWhole(["cut"], false, 2, 1));

    it("resumes after each cut that added bytes, beyond the attempts allowed", () =>
      givesWhole(["cut", "cut", "cut"], true, 4, 3));
  });

  describe("when the publisher answers a resume wrongly", () => {
    it("reads the file again when the partial answer stops short", () =>
      givesWhole(["cut", "short"], true, 3, 1));

    it("reads the file again when the partial answer starts at another offset", () =>
      givesWhole(["cut", "offset"], true, 3, 1));

    it("reads the file again when the partial answer is of another version", () =>
      givesWhole(["cut", "other version"], true, 3, 1));
  });

  describe("when the publisher answers with an error", () => {
    it("asks again and returns the file whole", () =>
      givesWhole(["error"], true, 2, 0));

    it("throws after the attempts allowed in a row, saying what the publisher answered", async () => {
      const { server, url, seen } = await publisher(
        Array(20).fill("error"),
        true,
      );
      try {
        await assert.rejects(
          patientFetch(fetch, { attempts: 3, delayMs: 0 })(url),
          /3 attempts in a row.*answered 503/,
        );
        assert.equal(seen.length, 3);
      } finally {
        server.close();
      }
    });
  });

  describe("when no attempt reads anything new", () => {
    const alternating = (second: Answer): Answer[] =>
      Array.from({ length: 100 }, (_, i) => (i % 2 === 0 ? "cut" : second));

    it("throws when every resume stops short and every full read is cut at the same point", () =>
      givesUp(alternating("short"), /3 attempts in a row/, 10));

    it("throws when no partial answer names its version", () =>
      givesUp(alternating("untagged"), /3 attempts in a row/, 10));
  });
});
