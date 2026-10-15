import { createReadStream } from "node:fs";
import { basename, posix } from "node:path";
import { pipeline, type Readable } from "node:stream";
import { StringDecoder } from "node:string_decoder";
import { createGunzip } from "node:zlib";
import { SaxesParser } from "saxes";
import { entryStream, texts } from "./archive.js";
import { Refusal } from "./builder.js";

interface XmlHandlers {
  open?: (name: string, attributes: Record<string, string>) => void;
  close?: (name: string) => void;
  text?: (text: string) => void;
}

/** A parser that calls `open` and `close` with each element's local name, and `text` with the text inside one. */
function xmlParser(handlers: XmlHandlers): SaxesParser {
  const parser = new SaxesParser({ xmlns: false });
  const local = (name: string) => name.slice(name.indexOf(":") + 1);
  parser.on("opentag", (tag) =>
    handlers.open?.(local(tag.name), tag.attributes as Record<string, string>),
  );
  parser.on("closetag", (tag) => handlers.close?.(local(tag.name)));
  parser.on("text", (text) => handlers.text?.(text));
  parser.on("cdata", (text) => handlers.text?.(text));
  return parser;
}

function parseXml(xml: string, handlers: XmlHandlers): void {
  xmlParser(handlers).write(xml).close();
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

/** An XML element: its local name, attributes, own text trimmed, and child elements. */
export interface XmlElement {
  readonly name: string;
  readonly attributes: Readonly<Record<string, string>>;
  readonly text: string;
  readonly children: readonly XmlElement[];
}

interface OpenElement {
  readonly name: string;
  readonly attributes: Record<string, string>;
  readonly parts: string[];
  readonly children: XmlElement[];
}

/**
 * Each element of that local name in an XML file, or in the one `.xml` entry of a zip, in document order and one at a
 * time as the file is read, so a file of any size is held no more than one element deep. An element inside one is
 * its child, not another. A file that is not well-formed is refused.
 */
export async function* xmlElements(
  path: string,
  element: string,
): AsyncIterable<XmlElement> {
  const input: Readable = /\.zip$/i.test(path)
    ? await entryStream(
        path,
        (entry) => /\.xml$/i.test(entry) && !entry.startsWith("__MACOSX/"),
      )
    : createReadStream(path, { highWaterMark: 1 << 20 });
  input.setEncoding("utf8");
  const open: OpenElement[] = [];
  let done: XmlElement[] = [];
  const parser = xmlParser({
    open: (name, attributes) => {
      if (open.length > 0 || name === element)
        open.push({
          name,
          attributes: { ...attributes },
          parts: [],
          children: [],
        });
    },
    text: (text) => open.at(-1)?.parts.push(text),
    close: () => {
      const closed = open.pop();
      if (closed === undefined) return;
      const finished: XmlElement = {
        name: closed.name,
        attributes: closed.attributes,
        text: closed.parts.join("").trim(),
        children: closed.children,
      };
      const parent = open.at(-1);
      if (parent === undefined) done.push(finished);
      else parent.children.push(finished);
    },
  });
  try {
    for await (const chunk of input) {
      parser.write(chunk as string);
      const ready = done;
      done = [];
      yield* ready;
    }
    parser.close();
    yield* done;
  } catch (error) {
    if (/^\d+:\d+: /.test((error as Error).message))
      throw new Refusal(
        `${basename(path)} is not well-formed XML: ${(error as Error).message}`,
      );
    throw error;
  } finally {
    input.destroy();
  }
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

/**
 * The file's non-empty lines as text, its byte order mark dropped, CRLF or LF; a gzip file is gunzipped as it is read,
 * and one that is not gzip is refused.
 */
export async function* lines(
  path: string,
  gzip = false,
): AsyncIterable<{ number: number; text: string }> {
  const file = createReadStream(path, { highWaterMark: 1 << 20 });
  const input = gzip
    ? pipeline(file, createGunzip({ chunkSize: 1 << 20 }), () => undefined)
    : file;
  const decoder = new StringDecoder("utf8");
  let number = 0;
  let rest = "";
  const whole = (
    read: string,
  ): { number: number; text: string } | undefined => {
    number += 1;
    const cut = read.endsWith("\r") ? read.slice(0, -1) : read;
    const text = number === 1 ? cut.replace(/^\uFEFF/, "") : cut;
    return text === "" ? undefined : { number, text };
  };
  try {
    for await (const chunk of input) {
      const text = rest + decoder.write(chunk as Buffer);
      let at = 0;
      for (
        let end = text.indexOf("\n");
        end >= 0;
        end = text.indexOf("\n", at)
      ) {
        const line = whole(text.slice(at, end));
        at = end + 1;
        if (line !== undefined) yield line;
      }
      rest = text.slice(at);
    }
  } catch (error) {
    const code = (error as { code?: unknown }).code;
    if (gzip && typeof code === "string" && code.startsWith("Z_"))
      throw new Refusal(
        `${basename(path)} is not a gzip file: ${(error as Error).message}`,
      );
    throw error;
  }
  rest += decoder.end();
  if (rest !== "") {
    const line = whole(rest);
    if (line !== undefined) yield line;
  }
}

/** Each line cut at the delimiter, fields kept as written. */
export async function* delimited(
  path: string,
  delimiter: string,
  gzip = false,
): AsyncIterable<Line> {
  for await (const { number, text } of lines(path, gzip))
    yield { number, fields: text.split(delimiter) };
}

/** Each line cut into the columns, each `[start, end)` counted in characters from 0. */
export async function* fixedWidth(
  path: string,
  columns: readonly (readonly [number, number])[],
  gzip = false,
): AsyncIterable<Line> {
  for await (const { number, text } of lines(path, gzip))
    yield {
      number,
      fields: columns.map(([start, end]) => text.slice(start, end)),
    };
}

/** Each line parsed as JSON. */
export async function* jsonLines(
  path: string,
  gzip = false,
): AsyncIterable<JsonLine> {
  for await (const { number, text } of lines(path, gzip))
    yield { number, value: JSON.parse(text) as unknown };
}
