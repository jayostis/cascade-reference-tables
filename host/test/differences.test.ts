import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Row } from "../src/builder.js";
import { differenceLines } from "../src/difference-lines.js";
import { differences, markdown, type Outcome } from "../src/pipeline.js";
import { keyed, toRdf } from "../src/rows.js";

const CVX = "https://ns.cascadeprotocol.org/codes/cvx/";
const MEMBER_OF = "http://purl.obolibrary.org/obo/RO_0002350";
const SERIES = "urn:uuid:f71f6797-48ec-4875-9b87-4cb1be1d9be0";

function quadsOf(rows: readonly Row[]) {
  return rows.flatMap((row) => toRdf(row).triples);
}

function outcomeOf(earlier: readonly Row[], later: readonly Row[]): Outcome {
  const found = differences(keyed(quadsOf(earlier)), keyed(quadsOf(later)));
  return {
    series: SERIES,
    label: "Example",
    version: "ni:///sha-256;abc",
    differences: found,
    described: differenceLines(quadsOf(earlier), quadsOf(later), found),
  };
}

/** The lines of a version's differences, `added`, `removed` and `changed`, as a reviewer reads them. */
const linesOf = (earlier: readonly Row[], later: readonly Row[]) =>
  outcomeOf(earlier, later).described;

const name = (code: string, prefLabel: string): Row => ({
  series: SERIES,
  subject: `${CVX}${code}`,
  prefLabel,
  notation: code,
});
const mapping = (
  from: string,
  to: string,
  justification = "ManualMappingCuration",
): Row => ({
  series: SERIES,
  subject_id: `${CVX}${from}`,
  predicate_id: MEMBER_OF,
  object_id: `${CVX}${to}`,
  mapping_justification: `https://w3id.org/semapv/vocab/${justification}`,
});
const retired = (code: string, replacedBy: string[] = []): Row => ({
  series: SERIES,
  subject: `${CVX}${code}`,
  replacedBy: replacedBy.map((c) => `${CVX}${c}`),
});

const rows = (n: number) =>
  Array.from({ length: n }, (_, i) =>
    name(String(i), `label ${i} ${"x".repeat(80)}`),
  );

/**
 * Each new version goes to a person as a pull request listing the rows added, removed and changed. `differences()`
 * finds them, `differenceLines()` writes each as a line a reviewer can read, and `markdown()` lays the lines out as the
 * pull request's body.
 */
describe("Describing what a version changed · differences(), differenceLines(), markdown()", () => {
  describe("differenceLines()", () => {
    it("writes a name row as its code and label", () => {
      assert.deepEqual(linesOf([name("9", "nine")], [name("10", "ten")]), {
        added: ["`10`: ten"],
        removed: ["`9`: nine"],
        changed: [],
      });
    });

    it("writes a mapping row as its two codes and the property between them", () => {
      assert.deepEqual(
        linesOf(
          [mapping("77", "222")],
          [mapping("88", "88"), mapping("8", "88")],
        ),
        {
          added: ["`8` → `88` (RO_0002350)", "`88` → `88` (RO_0002350)"],
          removed: ["`77` → `222` (RO_0002350)"],
          changed: [],
        },
      );
    });

    it('writes a status row as its code, "retired" and the codes that replace it', () => {
      assert.deepEqual(
        linesOf([], [retired("57"), retired("17", ["45", "88"])]),
        {
          added: ["`17`: retired, replaced by `45`, `88`", "`57`: retired"],
          removed: [],
          changed: [],
        },
      );
    });

    it("writes a classification row as its variation, its classes by label, its review status, its day and its count of expressions", () => {
      const CASCADE = "https://ns.cascadeprotocol.org/cascade#";
      const row = (classes: string[], hgvs: string[]): Row => ({
        series: SERIES,
        variation: "https://identifiers.org/clinvar:90011",
        hgvs: hgvs.map((h) => `https://ns.cascadeprotocol.org/codes/hgvs/${h}`),
        classification: classes.map((c) => `${CASCADE}${c}`),
        reviewStatus: `${CASCADE}ClinVarExpertPanel`,
        lastEvaluated: "2024-12-11",
        contributingSubmitterCount: 5,
      });
      const labels = new Map([
        [`${CASCADE}Pathogenic`, "Pathogenic"],
        [`${CASCADE}LikelyPathogenic`, "Likely pathogenic"],
        [`${CASCADE}ClinVarExpertPanel`, "reviewed by expert panel"],
      ]);
      const earlier = quadsOf([row(["Pathogenic"], ["NM_1.1%3Ac.1A%3EG"])]);
      const later = quadsOf([
        row(
          ["Pathogenic", "LikelyPathogenic"],
          ["NM_1.1%3Ac.1A%3EG", "NM_1.2%3Ac.1A%3EG"],
        ),
      ]);
      const found = differences(keyed(earlier), keyed(later));
      assert.deepEqual(
        differenceLines(earlier, later, found, (iri) => labels.get(iri))
          .changed,
        [
          "`90011`: Likely pathogenic, Pathogenic (reviewed by expert panel), 2024-12-11, 2 expressions (was `90011`: Pathogenic (reviewed by expert panel), 2024-12-11, 1 expression)",
        ],
      );
    });

    it("shows what a changed row was", () => {
      assert.deepEqual(
        linesOf([name("45", "old <label>")], [name("45", "new label")]).changed,
        ["`45`: new label (was `45`: old \\<label\\>)"],
      );
    });

    it("shows a part a line otherwise omits when that part is what changed", () => {
      assert.deepEqual(
        linesOf(
          [
            { ...name("45", "Hep B"), altLabel: ["hepatitis B"] },
            mapping("1", "2"),
          ],
          [
            { ...name("45", "Hep B"), altLabel: ["hepatitis B vaccine"] },
            mapping("1", "2", "LexicalMatching"),
          ],
        ).changed,
        [
          "`1` → `2` (RO_0002350, justified by LexicalMatching) (was `1` → `2` (RO_0002350, justified by ManualMappingCuration))",
          "`45`: Hep B, also called hepatitis B vaccine (was `45`: Hep B, also called hepatitis B)",
        ],
      );
    });

    it("sorts each list by code, 9 before 10", () => {
      assert.deepEqual(
        linesOf(
          [],
          [name("10", "ten"), name("45", "forty-five"), name("9", "nine")],
        ).added,
        ["`9`: nine", "`10`: ten", "`45`: forty-five"],
      );
    });

    it("escapes a label GitHub would read as a mention, an issue link, crossed-out text or HTML", () => {
      assert.deepEqual(
        linesOf([], [name("a1", "@octocat ~~fixes~~ #12"), name("a2", "<b>")])
          .added,
        ["`a1`: \\@octocat \\~\\~fixes\\~\\~ \\#12", "`a2`: \\<b\\>"],
      );
    });

    it("writes a code holding a percent sign as it is", () => {
      assert.deepEqual(linesOf([], [name("a%zz", "plain")]).added, [
        "`a%zz`: plain",
      ]);
    });
  });

  describe("markdown()", () => {
    const body = (n: number) => markdown([outcomeOf([], rows(n))]);

    it("lists three rows under their count, unfolded", () => {
      const short = body(3);
      assert.match(short, /Added \(3\):\n\n- `0`: label 0/);
      assert.doesNotMatch(short, /<details>/);
    });

    it("folds a list of twelve after its count", () => {
      assert.match(
        body(12),
        /<details><summary>Added \(12\)<\/summary>\n\n- `0`: label 0/,
      );
    });

    it("never shows a series' urn:uuid:", () => {
      assert.doesNotMatch(body(12), /urn:uuid/);
    });

    it("cuts a list of 2,000 to under 65,536 characters, saying how many more there are", () => {
      const huge = body(2000);
      assert.ok(huge.length < 65536);
      assert.match(
        huge,
        /- and \d+ more; the complete rows are in the release/,
      );
    });

    it("leaves a short list's unused share to a long one", () => {
      const lopsided = markdown([outcomeOf(rows(3), rows(2000).slice(3))]);
      assert.ok(lopsided.length < 65536);
      assert.ok(
        (lopsided.match(/^- `/gm) ?? []).length > 450,
        "the short removed list leaves its share to the long one added",
      );
    });
  });
});
