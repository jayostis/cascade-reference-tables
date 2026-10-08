import assert from "node:assert/strict";
import { test } from "node:test";
import { releaseStore } from "../src/stores.js";

test("a release store finds a rows file by its name across pages of releases, never in a draft", async () => {
  const asset = (name: string) => ({
    name,
    url: `https://api.github.com/assets/${name}`,
  });
  const pages = [
    [
      { draft: true, assets: [asset("drafted.nq.gz")] },
      ...Array.from({ length: 99 }, () => ({ draft: false, assets: [] })),
    ],
    [{ draft: false, assets: [asset("released.nq.gz")] }],
  ];
  const fake: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/releases"))
      return Response.json(pages[Number(url.searchParams.get("page")) - 1]);
    assert.equal(
      new Headers(init?.headers).get("Accept"),
      "application/octet-stream",
    );
    return new Response(url.pathname.split("/").pop());
  };
  const store = releaseStore("owner/tables", "token", fake);
  assert.equal(
    new TextDecoder().decode(await store.get("rows/released.nq.gz")),
    "released.nq.gz",
  );
  assert.equal(await store.get("rows/drafted.nq.gz"), undefined);
});
