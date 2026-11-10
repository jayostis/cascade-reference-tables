import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { before, describe, it } from "node:test";
import * as oxigraph from "oxigraph";
import { Feed } from "../src/feed.js";
import { feedViolations, readContract } from "../src/pipeline.js";
import { PREFIXES } from "../src/rdf.js";

const ROOT = join(import.meta.dirname, "..", "..", "..");

const prefixes = [
  ...Object.entries(PREFIXES).map(
    ([prefix, space]) => `PREFIX ${prefix}: <${space}>`,
  ),
  "PREFIX cc: <http://creativecommons.org/ns#>",
  "PREFIX sh: <http://www.w3.org/ns/shacl#>",
].join("\n");

/** `feed/feed.ttl` is the feed this repository publishes, checked in; it is held to the same shapes as any feed. */
describe("The published feed, held to its shapes · feed/feed.ttl", () => {
  it("returns no violation from feedViolations()", async () => {
    assert.deepEqual(
      await feedViolations(
        await readContract(ROOT),
        await Feed.read(join(ROOT, "feed", "feed.ttl")),
      ),
      [],
    );
  });
});

/** The source shape (`shapes/source.shapes.ttl`) and `vocab/licences.ttl` are two files that must name the same licences. */
describe("The licences the source shape lists, held to vocab/licences.ttl", () => {
  let store: oxigraph.Store;
  const values = (query: string): string[] =>
    (store.query(`${prefixes}\n${query}`) as Map<string, oxigraph.Term>[])
      .map((row) => row.get("l")!.value)
      .sort();
  const listed = () =>
    values(
      "SELECT ?l WHERE { ?p sh:path dct:license ; sh:in/rdf:rest*/rdf:first ?l }",
    );

  before(async () => {
    store = new oxigraph.Store();
    for (const file of ["shapes/source.shapes.ttl", "vocab/licences.ttl"])
      store.load(await readFile(join(ROOT, file), "utf8"), {
        format: "text/turtle",
        base_iri: "urn:x:",
      });
  });

  it("lists exactly the licences vocab/licences.ttl declares", () => {
    assert.deepEqual(listed(), values("SELECT ?l WHERE { ?l a cc:License }"));
  });

  it("finds exactly one policy for each, saying whether rows are published and files archived", () => {
    assert.deepEqual(
      listed(),
      values(
        `SELECT ?l WHERE { ?p tables:licencePolicyOf ?l ; tables:publishesRows ?r ; tables:archivesPublisherFiles ?a
          FILTER NOT EXISTS { ?q tables:licencePolicyOf ?l FILTER (?q != ?p) } }`,
      ),
    );
  });
});
