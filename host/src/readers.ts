import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { posix } from "node:path";
import { SaxesParser } from "saxes";
import { texts } from "./archive.js";
import { Refusal } from "./builder.js";

/** Calls `open` and `close` with each element's local name and attributes, and `text` with the text inside one. */
function parseXml(
  xml: string,
  handlers: {
    open?: (name: string, attributes: Record<string, string>) => void;
    close?: (name: string) => void;
    text?: (text: string) => void;
  },
): void {
  const parser = new SaxesParser({ xmlns: false });
  const local = (name: string) => name.slice(name.indexOf(":") + 1);
  parser.on("opentag", (tag) =>
    handlers.open?.(local(tag.name), tag.attributes as Record<string, string>),
  );
  parser.on("closetag", (tag) => handlers.close?.(local(tag.name)));
  parser.on("text", (text) => handlers.text?.(text));
  parser.on("cdata", (text) => handlers.text?.(text));
  parser.write(xml).close();
}

/** The column's number from 0, from a cell reference such as `C12`. */
function columnOf(reference: string): number {
  let column = 0;
  for (const letter of /^[A-Z]+/.exec(reference)?.[0] ?? "")
    column = column * 26 + letter.charCodeAt(0) - 64;
  return column - 1;
}

/** The text of each shared string, its runs joined and its phonetic readings left out. */
function sharedStrings(xml: string | undefined): string[] {
  const strings: string[] = [];
  if (xml === undefined) return strings;
  let current: string[] | undefined;
  let inText = false;
  let phonetic = false;
  parseXml(xml, {
    open: (name) => {
      if (name === "si") current = [];
      if (name === "rPh") phonetic = true;
      if (name === "t") inText = !phonetic;
    },
    close: (name) => {
      if (name === "si") strings.push(current!.join(""));
      if (name === "rPh") phonetic = false;
      if (name === "t") inText = false;
    },
    text: (text) => {
      if (inText) current?.push(text);
    },
  });
  return strings;
}

/** The path of the workbook's first sheet, from the workbook and its relationships. */
function firstSheet(entries: ReadonlyMap<string, string>): string {
  let id: string | undefined;
  parseXml(entries.get("xl/workbook.xml") ?? "", {
    open: (name, attributes) => {
      if (name === "sheet" && id === undefined)
        id = Object.entries(attributes).find(([key]) =>
          /(^|:)id$/.test(key),
        )?.[1];
    },
  });
  let target: string | undefined;
  parseXml(entries.get("xl/_rels/workbook.xml.rels") ?? "", {
    open: (name, attributes) => {
      if (name === "Relationship" && attributes.Id === id)
        target = attributes.Target;
    },
  });
  if (target === undefined) throw new Refusal("the xlsx names no first sheet");
  return target.startsWith("/")
    ? target.slice(1)
    : posix.normalize(posix.join("xl", target));
}

/**
 * The first sheet's rows, numbered by the sheet's row numbers, each field a column's text from A: a shared, inline or
 * rich-text string, or a number or other value as written; an empty cell is "".
 */
export async function* xlsx(path: string): AsyncIterable<Line> {
  const parts = await texts(path, (entry) =>
    /^xl\/(workbook\.xml|_rels\/workbook\.xml\.rels|sharedStrings\.xml)$/.test(
      entry,
    ),
  );
  const sheet = firstSheet(parts);
  const sheetXml = (await texts(path, (entry) => entry === sheet)).get(sheet);
  if (sheetXml === undefined) throw new Refusal(`the xlsx has no ${sheet}`);
  const strings = sharedStrings(parts.get("xl/sharedStrings.xml"));
  const rows: Line[] = [];
  let number = 0;
  let fields: string[] = [];
  let column = 0;
  let type = "";
  let value: string[] = [];
  let reading: "v" | "t" | undefined;
  parseXml(sheetXml, {
    open: (name, attributes) => {
      if (name === "row") {
        number = Number(attributes.r ?? number + 1);
        fields = [];
        column = 0;
      } else if (name === "c") {
        if (attributes.r !== undefined) column = columnOf(attributes.r);
        type = attributes.t ?? "n";
        value = [];
      } else if (name === "v" || name === "t") reading = name;
    },
    close: (name) => {
      if (name === "v" || name === "t") reading = undefined;
      else if (name === "c") {
        const text = value.join("");
        while (fields.length < column) fields.push("");
        fields[column] = type === "s" ? (strings[Number(text)] ?? "") : text;
        column += 1;
      } else if (name === "row") rows.push({ number, fields });
    },
    text: (text) => {
      if (reading !== undefined) value.push(text);
    },
  });
  yield* rows;
}

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
