import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { basename, join } from "node:path";

/** Where rows files are found by their name. */
export interface RowsStore {
  get(file: string): Promise<Uint8Array | undefined>;
}

/** Rows files in folders, each holding `rows/`. */
export function folderStore(folders: readonly string[]): RowsStore {
  return {
    async get(file) {
      for (const folder of folders) {
        const path = join(folder, file);
        if (existsSync(path)) return readFile(path);
      }
      return undefined;
    },
  };
}

/** Rows files among a GitHub repository's release assets, found by name. */
export function releaseStore(
  repository: string,
  token: string | undefined,
  fetchWith: typeof fetch = fetch,
): RowsStore {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    ...(token === undefined || token === ""
      ? {}
      : { Authorization: `Bearer ${token}` }),
  };
  let assets: Promise<Map<string, string>> | undefined;
  const list = async (): Promise<Map<string, string>> => {
    const found = new Map<string, string>();
    for (let page = 1; ; page += 1) {
      const response = await fetchWith(
        `https://api.github.com/repos/${repository}/releases?per_page=100&page=${page}`,
        { headers },
      );
      if (!response.ok)
        throw new Error(`${repository}'s releases answered ${response.status}`);
      const releases = (await response.json()) as {
        draft: boolean;
        assets: { name: string; url: string }[];
      }[];
      for (const release of releases)
        if (!release.draft)
          for (const asset of release.assets) found.set(asset.name, asset.url);
      if (releases.length < 100) return found;
    }
  };
  return {
    async get(file) {
      assets ??= list();
      const url = (await assets).get(basename(file));
      if (url === undefined) return undefined;
      const response = await fetchWith(url, {
        headers: { ...headers, Accept: "application/octet-stream" },
      });
      if (!response.ok) throw new Error(`${url} answered ${response.status}`);
      return new Uint8Array(await response.arrayBuffer());
    },
  };
}
