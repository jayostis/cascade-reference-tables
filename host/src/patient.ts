import type { Fetch } from "./detection.js";

const DROPPED = Symbol("a response worth another attempt");

function why(error: unknown): string {
  const cause = (error as { cause?: { code?: string } }).cause;
  return cause?.code ?? (error as Error).message;
}

/**
 * A fetch that gives a whole body or an error: a dropped connection or a 5xx is tried again after `delayMs`, doubled
 * each time, up to `attempts` in all. Where the publisher names a version of the file (`ETag` or `Last-Modified`) and
 * sends it unencoded, the bytes already read are kept and the rest asked for with `Range` and `If-Range`; a publisher
 * that answers the whole file instead is read again from the start.
 */
export function patientFetch(
  fetchWith: Fetch = fetch,
  { attempts = 5, delayMs = 2000 } = {},
): Fetch {
  return async (input, init) => {
    const chunks: Uint8Array[] = [];
    let have = 0;
    let first: Response | undefined;
    let version: string | null = null;
    for (let attempt = 1; ; attempt += 1) {
      try {
        const headers = new Headers(init?.headers);
        if (have > 0 && version !== null) {
          headers.set("Range", `bytes=${have}-`);
          headers.set("If-Range", version);
        }
        const response = await fetchWith(input, { ...init, headers });
        if (response.status >= 500) throw DROPPED;
        if (first === undefined && (response.body === null || !response.ok))
          return response;
        if (!response.ok || response.body === null) {
          chunks.length = 0;
          have = 0;
          first = undefined;
          throw DROPPED;
        }
        const resumed =
          response.status === 206 &&
          new RegExp(`^bytes ${have}-`).test(
            response.headers.get("Content-Range") ?? "",
          );
        if (!resumed) {
          chunks.length = 0;
          have = 0;
          first = response;
          const encoded = response.headers.get("Content-Encoding");
          version =
            encoded !== null && encoded !== "identity"
              ? null
              : (response.headers.get("ETag") ??
                response.headers.get("Last-Modified"));
        }
        for await (const chunk of response.body) {
          chunks.push(chunk);
          have += chunk.length;
        }
        const headersOut = new Headers(first!.headers);
        headersOut.delete("Content-Encoding");
        headersOut.delete("Content-Length");
        headersOut.delete("Content-Range");
        return new Response(Buffer.concat(chunks), {
          status: 200,
          headers: headersOut,
        });
      } catch (error) {
        if (attempt === attempts)
          throw new Error(
            `${String(input)} could not be downloaded in ${attempts} attempts: ${error === DROPPED ? "the publisher answered with an error" : why(error)}`,
            { cause: error },
          );
        await new Promise((done) =>
          setTimeout(done, delayMs * 2 ** (attempt - 1)),
        );
      }
    }
  };
}
