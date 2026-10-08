import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";

/** One line of a release file, numbered from 1, cut into its fields. */
export interface Line {
  readonly number: number;
  readonly fields: readonly string[];
}

/** One line of a JSON Lines file, numbered from 1, parsed. */
export interface JsonLine {
  readonly number: number;
  readonly value: unknown;
}

/** The file's non-empty lines as text, its byte order mark dropped, CRLF or LF. */
export async function* lines(
  path: string,
): AsyncIterable<{ number: number; text: string }> {
  const reader = createInterface({
    input: createReadStream(path, { encoding: "utf8" }),
    crlfDelay: Infinity,
  });
  let number = 0;
  for await (const read of reader) {
    number += 1;
    const text = number === 1 ? read.replace(/^\uFEFF/, "") : read;
    if (text !== "") yield { number, text };
  }
}

/** Each line cut at the delimiter, fields kept as written. */
export async function* delimited(
  path: string,
  delimiter: string,
): AsyncIterable<Line> {
  for await (const { number, text } of lines(path))
    yield { number, fields: text.split(delimiter) };
}

/** Each line cut into the columns, each `[start, end)` counted in characters from 0. */
export async function* fixedWidth(
  path: string,
  columns: readonly (readonly [number, number])[],
): AsyncIterable<Line> {
  for await (const { number, text } of lines(path))
    yield {
      number,
      fields: columns.map(([start, end]) => text.slice(start, end)),
    };
}

/** Each line parsed as JSON. */
export async function* jsonLines(path: string): AsyncIterable<JsonLine> {
  for await (const { number, text } of lines(path))
    yield { number, value: JSON.parse(text) as unknown };
}
