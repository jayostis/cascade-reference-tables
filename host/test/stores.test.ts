import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { releaseStore } from "../src/stores.js";

const asset = (name: string) => ({
  name,
  url: `https://api.github.com/assets/${name}`,
});

/** A GitHub that lists a draft release first and, on a second page, the release holding `released.nq.gz`. */
function github(): {
  store: ReturnType<typeof releaseStore>;
  accepted: (string | null)[];
} {
  const pages = [
    [
      { draft: true, assets: [asset("drafted.nq.gz")] },
      ...Array.from({ length: 99 }, () => ({ draft: false, assets: [] })),
    ],
    [{ draft: false, assets: [asset("released.nq.gz")] }],
  ];
  const accepted: (string | null)[] = [];
  const fake: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/releases"))
      return Response.json(pages[Number(url.searchParams.get("page")) - 1]);
    accepted.push(new Headers(init?.headers).get("Accept"));
    return new Response(url.pathname.split("/").pop());
  };
  return { store: releaseStore("owner/tables", "token", fake), accepted };
}

/**
 * Every version's rows file is kept as an asset of a GitHub release. `releaseStore()` gives a host a store that finds one
 * by its file name, which is how a publish fetches the rows the site serves.
 */
describe("Finding a rows file in GitHub releases · releaseStore()", () => {
  describe("store.get()", () => {
    it("returns the bytes of an asset found on a later page of releases", async () => {
      const { store } = github();
      assert.equal(
        new TextDecoder().decode(await store.get("rows/released.nq.gz")),
        "released.nq.gz",
      );
    });

    it("asks for the asset as application/octet-stream", async () => {
      const { store, accepted } = github();
      await store.get("rows/released.nq.gz");
      assert.deepEqual(accepted, ["application/octet-stream"]);
    });

    it("returns undefined for a file only a draft release holds", async () => {
      const { store } = github();
      assert.equal(await store.get("rows/drafted.nq.gz"), undefined);
    });
  });
});
