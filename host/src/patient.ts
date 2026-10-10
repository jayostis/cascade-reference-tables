import type { Fetch } from "./detection.js";

const RETRIED = new Set([408, 429]);

interface Version {
  readonly name: string;
  readonly value: string;
}

function why(error: unknown): string {
  const cause = (error as { cause?: { code?: string } }).cause;
  return cause?.code ?? (error as Error).message;
}

/** What `If-Range` can name: a strong `ETag`, else `Last-Modified`, of an unencoded answer. */
function versionOf(response: Response): Version | null {
  const encoded = response.headers.get("Content-Encoding");
  if (encoded !== null && encoded !== "identity") return null;
  const tag = response.headers.get("ETag");
  if (tag !== null && !tag.startsWith("W/"))
    return { name: "ETag", value: tag };
  const modified = response.headers.get("Last-Modified");
  return modified === null ? null : { name: "Last-Modified", value: modified };
}

/**
 * A fetch that gives a whole body or an error. A dropped connection, a 5xx, a 408 or a 429 is tried again after
 * `delayMs`, doubled for each attempt in a row that read no new bytes; `attempts` such attempts in a row end it. Where
 * the publisher names the file's version and sends it unencoded, the bytes already read are kept and the rest asked
 * for with `Range` and `If-Range`, and accepted only as the exact rest of that version. A publisher that answers the
 * whole file instead is read again from the start.
 */
export function patientFetch(
  fetchWith: Fetch = fetch,
  { attempts = 5, delayMs = 2000 } = {},
): Fetch {
  return async (input, init) => {
    const chunks: Uint8Array[] = [];
    let have = 0;
    let first: Response | undefined;
    let version: Version | null = null;
    let stalled = 0;
    const restart = () => {
      chunks.length = 0;
      have = 0;
      first = undefined;
      version = null;
    };
    for (;;) {
      const before = have;
      try {
        const headers = new Headers(init?.headers);
        if (have > 0 && version !== null) {
          headers.set("Range", `bytes=${have}-`);
          headers.set("If-Range", version.value);
          headers.set("Accept-Encoding", "identity");
        }
        const response = await fetchWith(input, { ...init, headers });
        const retried = response.status >= 500 || RETRIED.has(response.status);
        if (
          first === undefined &&
          !retried &&
          (!response.ok || response.body === null)
        )
          return response;
        if (retried || !response.ok || response.body === null) {
          await response.body?.cancel().catch(() => undefined);
          if (!retried) restart();
          throw new Error(`answered ${response.status}`);
        }
        let expected: number | undefined;
        if (response.status === 206) {
          const range = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(
            response.headers.get("Content-Range") ?? "",
          );
          const encoded = response.headers.get("Content-Encoding");
          if (
            first === undefined ||
            version === null ||
            range === null ||
            Number(range[1]) !== have ||
            Number(range[2]) + 1 !== Number(range[3]) ||
            (encoded !== null && encoded !== "identity") ||
            response.headers.get(version.name) !== version.value
          ) {
            await response.body.cancel().catch(() => undefined);
            restart();
            throw new Error("answered a partial body that is not the rest");
          }
          expected = Number(range[3]);
        } else {
          restart();
          first = response;
          version = versionOf(response);
          const length = response.headers.get("Content-Length");
          if (length !== null && version !== null) expected = Number(length);
        }
        for await (const chunk of response.body) {
          chunks.push(chunk);
          have += chunk.length;
        }
        if (expected !== undefined && have !== expected)
          throw new Error(`read ${have} of ${expected} bytes`);
        const out = new Headers(first!.headers);
        out.delete("Content-Encoding");
        out.delete("Content-Length");
        out.delete("Content-Range");
        return new Response(Buffer.concat(chunks), {
          status: 200,
          headers: out,
        });
      } catch (error) {
        stalled = have > before ? 0 : stalled + 1;
        if (stalled === attempts)
          throw new Error(
            `${String(input)} could not be downloaded: ${attempts} attempts in a row read nothing new, the last because ${why(error)}`,
            { cause: error },
          );
        await new Promise((done) =>
          setTimeout(done, delayMs * 2 ** Math.max(0, stalled - 1)),
        );
      }
    }
  };
}
