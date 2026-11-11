import { resolveSchema } from "./paths.js";
import type { FlatHint, JsonValue, Schema } from "./types.js";

/*
 * Flat files at the edges: CSV and fixed-width text. Crosswalk maps JSON, so
 * a file is read into JSON before a map runs and written back after:
 *
 * - The file is the root record, with one array field (the first in the root
 *   schema, or `rows`) holding a record for each line.
 * - The root schema's `flat` says how the file is laid out: `format`, and for
 *   CSV `delimiter`, `quote` and `header`, and `skip` and `lineEnding`.
 * - Each column is a field of the row record, in order. Its `flat` can give
 *   its header `name`, and for fixed-width files its `width`, `align`, `pad`
 *   and implied `decimals`.
 * - Values take the schema's type. An empty field is left out.
 * - A column that's an array is a repeating group: items one after another on
 *   the line, or, in CSV with a `delimiter` of its own, in one field.
 * - A column that's a record is its parts: one after another in fixed-width,
 *   and in CSV one field split by its `delimiter`, as HL7 splits with ^.
 */

const hintOf = (schema: Schema | undefined): FlatHint => schema?.flat ?? {};

const put = (record: Record<string, JsonValue>, name: string, value: JsonValue | undefined) => {
  if (value !== undefined) Object.defineProperty(record, name, { value, enumerable: true, writable: true, configurable: true });
};
const isRecord = (value: unknown): value is Record<string, JsonValue> => typeof value === "object" && value !== null && !Array.isArray(value);

/** The array field holding the rows, and the row schema, from a root schema. */
function rowsOf(schema: Schema | undefined): { key: string; row: Schema | undefined } {
  const entry = Object.entries(schema?.properties ?? {}).find(([, field]) => field.type === "array");
  return entry ? { key: entry[0], row: entry[1].items } : { key: "rows", row: undefined };
}

/**
 * Splits CSV text into lines of fields, as RFC 4180 has it: quoted fields may
 * hold the delimiter, quotes ("") and line breaks. With a terminator, as EDI
 * has, lines end there instead, and line breaks after it are skipped. A
 * release character keeps the one after it, still released, for the field's
 * reader to split by and then take as itself.
 */
function parseCsv(text: string, delimiter: string, quote: string, terminator?: string, release?: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let i = 0;
  const end = () => {
    row.push(field);
    field = "";
  };
  while (i < text.length) {
    const char = text[i]!;
    if (quoted) {
      if (char === quote && text[i + 1] === quote) {
        field += quote;
        i += 2;
      } else if (char === quote) {
        quoted = false;
        i++;
      } else {
        field += char;
        i++;
      }
    } else if (release && text.startsWith(release, i) && i + release.length < text.length) {
      field += text.slice(i, i + release.length + 1);
      i += release.length + 1;
    } else if (quote !== "" && char === quote && field === "") {
      quoted = true;
      i++;
    } else if (text.startsWith(delimiter, i)) {
      end();
      i += delimiter.length;
    } else if (terminator && text.startsWith(terminator, i)) {
      end();
      rows.push(row);
      row = [];
      i += terminator.length;
      while (text[i] === "\r" || text[i] === "\n") i++;
    } else if (!terminator && (char === "\r" || char === "\n")) {
      end();
      rows.push(row);
      row = [];
      i += char === "\r" && text[i + 1] === "\n" ? 2 : 1;
    } else {
      field += char;
      i++;
    }
  }
  if (quoted) throw new Error(`A quoted field isn't closed (line ${rows.length + 1})`);
  if (field !== "" || row.length > 0) {
    end();
    rows.push(row);
  }
  return rows;
}

/** A field's text as its schema's type says; text that doesn't read as that type stays text. Empty is left out. */
function typed(text: string, schema: Schema | undefined, fixed: boolean): JsonValue | undefined {
  const value = text.trim();
  if (value === "") return undefined;
  const hint = hintOf(schema);
  switch (schema?.type) {
    case "integer":
    case "number": {
      const number = Number(value);
      if (!Number.isFinite(number) || !/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(value)) return fixed ? value : text;
      return fixed && hint.decimals ? number / 10 ** hint.decimals : number;
    }
    case "boolean": {
      const lower = value.toLowerCase();
      return lower === "true" || lower === "1" ? true : lower === "false" || lower === "0" ? false : fixed ? value : text;
    }
    default:
      // Fixed-width fields are padded, so their text is trimmed; CSV keeps it as written.
      return fixed ? value : text;
  }
}

/**
 * Reads a CSV or fixed-width file into the JSON a map takes, following the
 * schema: `{ rows: [{ column: value, … }, …] }`, with the row field named as
 * the schema names it. Without a schema it reads CSV with a header row, every
 * value as text.
 */
export function readFlatFile(text: string, schema?: Schema): JsonValue {
  const resolved = schema ? resolveSchema(schema) : undefined;
  const hint = hintOf(resolved);
  const { key, row } = rowsOf(resolved);
  const columns = Object.entries(row?.properties ?? {});
  const fixed = hint.format === "fixed";
  const body = text.replace(/^﻿/, "");
  const records: JsonValue[] = [];
  const escapes: Escapes = { release: hint.release, specials: [] };
  // EDI has no quotes, so a file with a terminator or release character quotes nothing unless it says so.
  const quote = hint.quote ?? (hint.terminator !== undefined || hint.release !== undefined ? "" : '"');
  // A fixed-width file's lines: at its terminator, if it has one, else at line breaks.
  const fixedLines = () => (hint.terminator ? body.split(hint.terminator).map((line) => line.replace(/^[\r\n]+/, "")) : body.split(/\r?\n/));

  // A file with several kinds of line, each told apart by its tag.
  if (kindsOf(resolved).length > 0) {
    // Each line as its fields after the tag: for CSV the rest of its fields, for fixed-width the rest of its text.
    const lines: { number: number; starts: (tag: string) => boolean; fields: (record: Schema | undefined, tag: string) => Record<string, JsonValue> }[] = [];
    if (fixed) {
      fixedLines().forEach((line, index) => {
        if (index < (hint.skip ?? 0) || line.trim() === "") return;
        lines.push({
          number: index + 1,
          starts: (tag) => line.startsWith(tag),
          // The columns start after the tag.
          fields: (record, tag) => readFixed(line, tag.length, columnsOf(record)),
        });
      });
    } else {
      parseCsv(body, hint.delimiter ?? ",", quote, hint.terminator, hint.release).forEach((row, index) => {
        if (index < (hint.skip ?? 0) || (row.length === 1 && row[0]!.trim() === "")) return;
        lines.push({ number: index + 1, starts: (tag) => row[0]?.trim() === tag, fields: (record) => readCsv(row.slice(1), columnsOf(record), escapes) });
      });
    }
    let at = 0;
    // Reads the lines that belong to a record: those of its own kinds, each with the lines of its kinds after it.
    const readLevel = (record: Schema | undefined, into: Record<string, JsonValue>) => {
      while (at < lines.length) {
        const line = lines[at]!;
        const match = kindsOf(record).find(([, kind]) => line.starts(tagOf(kind)!));
        if (!match) return;
        const [name, kind] = match;
        // A second line of a single record belongs to the next record up.
        if (kind.type !== "array" && Object.hasOwn(into, name)) return;
        at++;
        const item = line.fields(recordOf(kind), tagOf(kind)!);
        readLevel(recordOf(kind), item);
        if (kind.type === "array") {
          const list = Object.hasOwn(into, name) ? (into[name] as JsonValue[]) : [];
          list.push(item);
          put(into, name, list);
        } else put(into, name, item);
      }
    };
    const root: Record<string, JsonValue> = {};
    readLevel(resolved, root);
    if (at < lines.length) throw new Error(`Line ${lines[at]!.number} isn't a kind of line this file has, or isn't where one belongs`);
    return root;
  }

  if (fixed) {
    const lines = fixedLines().slice(hint.skip ?? 0).slice(hint.header ? 1 : 0);
    for (const line of lines) if (line.trim() !== "") records.push(readFixed(line, 0, columns));
    return { [key]: records };
  }

  const delimiter = hint.delimiter ?? ",";
  const lines = parseCsv(body, delimiter, quote, hint.terminator, hint.release)
    .slice(hint.skip ?? 0)
    // A line with nothing on it isn't a record.
    .filter((line) => !(line.length === 1 && line[0]!.trim() === ""));
  const header = hint.header ?? true;
  const headings = header ? (lines.shift() ?? []).map((h) => h.trim()) : [];
  // Each column of the schema finds its field by its header name, or, without a header, by its place.
  if (columns.length > 0) {
    for (const line of lines) records.push(readCsv(line, columns, escapes, header ? headings : undefined));
    return { [key]: records };
  }
  const places = (header ? headings : (lines[0] ?? []).map((_, i) => `column${i + 1}`)).map((name, index) => ({ name, column: undefined, at: index }));
  for (const line of lines) {
    const record: Record<string, JsonValue> = {};
    for (const { name, column, at } of places) if (at >= 0) put(record, name, typed(line[at] ?? "", column, false));
    records.push(record);
  }
  return { [key]: records };
}

/** The tag a field's lines start with, if it's one of a file's kinds of line: on the field, or on an array's items. */
const tagOf = (field: Schema | undefined) => hintOf(field).tag ?? hintOf(field?.items).tag;
/** The record a kind of line holds. */
const recordOf = (field: Schema) => (field.type === "array" ? field.items : field);
/** A record's columns: its fields that aren't kinds of line of their own. */
const columnsOf = (record: Schema | undefined) => Object.entries(record?.properties ?? {}).filter(([, field]) => tagOf(field) === undefined);
/** The kinds of line a record holds. */
const kindsOf = (record: Schema | undefined) => Object.entries(record?.properties ?? {}).filter(([, field]) => tagOf(field) !== undefined);

/** A column that repeats within a line: an array that isn't a kind of line. */
const isGroup = (field: Schema | undefined) => field?.type === "array" && tagOf(field) === undefined;
/** A column that's a record of parts: an object that isn't a kind of line. */
const isComposite = (field: Schema | undefined) => field?.type === "object" && tagOf(field) === undefined && Object.keys(field.properties ?? {}).length > 0;
const widthOf = (name: string, column: Schema | undefined) => {
  const width = hintOf(column).width;
  if (!width) throw new Error(`Column "${name}" needs a width: a fixed-width file's columns each have flat.width`);
  return width;
};
/** The items of a group to write, nulls left out. */
const listOf = (value: JsonValue | undefined) => (Array.isArray(value) ? value.filter((item) => item !== null) : []);
const isEmpty = (value: JsonValue | undefined) => value === undefined || (isRecord(value) && Object.keys(value).length === 0);

/** How a CSV file's values are escaped: EDIFACT's release character, and the characters it releases. */
interface Escapes {
  release?: string | undefined;
  specials: string[];
}

/** Splits text at a separator, except where the release character comes before it. */
function splitAt(text: string, separator: string, release: string | undefined): string[] {
  if (!release) return text.split(separator);
  const pieces: string[] = [];
  let piece = "";
  for (let i = 0; i < text.length; i++) {
    if (text.startsWith(release, i) && i + release.length < text.length) {
      piece += text.slice(i, i + release.length + 1);
      i += release.length;
    } else if (text.startsWith(separator, i)) {
      pieces.push(piece);
      piece = "";
      i += separator.length - 1;
    } else piece += text[i];
  }
  pieces.push(piece);
  return pieces;
}

/** Text with each released character as itself. */
function unescape(text: string, release: string | undefined): string {
  if (!release) return text;
  let out = "";
  for (let i = 0; i < text.length; i++) {
    if (text.startsWith(release, i) && i + release.length < text.length) i += release.length;
    out += text[i];
  }
  return out;
}

/** Text with each separator in it released, so it reads back as itself. */
function escape(text: string, escapes: Escapes): string {
  if (!escapes.release) return text;
  let out = "";
  for (let i = 0; i < text.length; i++) {
    const special = escapes.specials.find((s) => text.startsWith(s, i));
    if (special) {
      out += escapes.release + special;
      i += special.length - 1;
    } else out += text[i];
  }
  return out;
}

/** Every separator a schema uses, for releasing in values. */
function separatorsOf(schema: Schema | undefined, into: Set<string>): Set<string> {
  const hint = hintOf(schema);
  for (const s of [hint.delimiter, hint.terminator, hint.release]) if (s) into.add(s);
  for (const inner of Object.values(schema?.properties ?? {})) separatorsOf(inner, into);
  if (schema?.items) separatorsOf(schema.items, into);
  return into;
}

/** What splits a field into a record's parts, or a group's items. */
function splitterOf(name: string, column: Schema): string {
  const separator = hintOf(column).delimiter;
  if (separator !== undefined) return separator;
  throw new Error(
    isGroup(column)
      ? `Repeating group "${name}" is inside a field, so it needs a flat.delimiter to split it into its items`
      : `Column "${name}" is a record, so it needs a flat.delimiter to split its field into its parts`,
  );
}

/** A value within one CSV field: a record split into its parts, a group into its items, each of those as deep as its schema goes. */
function readField(name: string, schema: Schema | undefined, text: string, escapes: Escapes): JsonValue | undefined {
  if (isComposite(schema)) {
    const pieces = splitAt(text, splitterOf(name, schema!), escapes.release);
    const record: Record<string, JsonValue> = {};
    Object.entries(schema!.properties!).forEach(([part, inner], index) => put(record, part, readField(part, inner, pieces[index] ?? "", escapes)));
    return Object.keys(record).length > 0 ? record : undefined;
  }
  if (isGroup(schema)) {
    const list = splitAt(text, splitterOf(name, schema!), escapes.release)
      .map((piece) => readField(name, schema!.items, piece, escapes))
      .filter((item) => !isEmpty(item)) as JsonValue[];
    return list.length > 0 ? list : undefined;
  }
  // A CSV value with a width is padded to it, as X12's envelope is, so it's trimmed as fixed-width values are.
  return typed(unescape(text, escapes.release), schema, hintOf(schema).width !== undefined);
}

/** A value within one CSV field as text, released where it holds a separator; empty when there's nothing in it. */
function writeField(name: string, schema: Schema | undefined, value: JsonValue | undefined, escapes: Escapes): string {
  if (isComposite(schema)) {
    const parts = Object.entries(schema!.properties!).map(([part, inner]) => writeField(part, inner, isRecord(value) ? value[part] : undefined, escapes));
    // Empty parts at the end are left off, as HL7 and EDI have it.
    return withoutTrailing(parts).join(splitterOf(name, schema!));
  }
  if (isGroup(schema)) {
    const separator = splitterOf(name, schema!);
    return listOf(value)
      .map((item) => writeField(name, schema!.items, item, escapes))
      .join(separator);
  }
  if (hintOf(schema).width !== undefined) return fixedCell(name, schema, typeof value === "string" ? escape(value, escapes) : (value ?? undefined));
  return value === undefined || value === null ? "" : escape(asText(value), escapes);
}

/** How many characters a fixed-width value takes: a column's width, a record's parts', or a group's slots. */
function fixedWidthOf(name: string, schema: Schema | undefined): number {
  if (isComposite(schema)) return Object.entries(schema!.properties!).reduce((sum, [part, inner]) => sum + fixedWidthOf(part, inner), 0);
  if (isGroup(schema)) {
    const count = hintOf(schema).count;
    if (count === undefined) throw new Error(`Repeating group "${name}" is inside another value, so it needs a flat.count: only a column can take the rest of the line`);
    return count * fixedWidthOf(name, schema!.items);
  }
  return widthOf(name, schema);
}

/** A fixed-width value at `at`: a column, a record's parts one after another, or a group's slots. */
function readFixedValue(name: string, schema: Schema | undefined, line: string, at: number): JsonValue | undefined {
  if (isComposite(schema)) {
    const record: Record<string, JsonValue> = {};
    for (const [part, inner] of Object.entries(schema!.properties!)) {
      put(record, part, readFixedValue(part, inner, line, at));
      at += fixedWidthOf(part, inner);
    }
    return Object.keys(record).length > 0 ? record : undefined;
  }
  if (isGroup(schema)) {
    const slot = fixedWidthOf(name, schema!.items);
    const list: JsonValue[] = [];
    for (let n = 0; n < hintOf(schema).count!; n++) {
      const item = readFixedValue(name, schema!.items, line, at + n * slot);
      if (!isEmpty(item)) list.push(item!);
    }
    return list.length > 0 ? list : undefined;
  }
  return typed(line.slice(at, at + widthOf(name, schema)), schema, true);
}

/** A fixed-width value as text: a column's cell, a record's parts, or a group's items then blank slots up to its count. */
function writeFixedValue(name: string, schema: Schema | undefined, value: JsonValue | undefined): string {
  if (isComposite(schema)) return Object.entries(schema!.properties!).map(([part, inner]) => writeFixedValue(part, inner, isRecord(value) ? value[part] : undefined)).join("");
  if (isGroup(schema)) {
    const list = listOf(value);
    const count = hintOf(schema).count;
    if (count !== undefined && list.length > count) throw new Error(`"${name}" has ${list.length} items, more than the ${count} its line has room for`);
    const blank = " ".repeat(fixedWidthOf(name, schema!.items));
    return list.map((item) => writeFixedValue(name, schema!.items, item)).join("") + blank.repeat(Math.max(0, (count ?? 0) - list.length));
  }
  return fixedCell(name, schema, value);
}

/** A group that takes the rest of the line has to come last. In CSV, one with a delimiter of its own takes one field, so can go anywhere. */
function checkGroups(columns: [string, Schema | undefined][], fixed: boolean) {
  columns.forEach(([name, column], index) => {
    const hint = hintOf(column);
    if (!isGroup(column) || hint.count !== undefined || (!fixed && hint.delimiter !== undefined) || index === columns.length - 1) return;
    throw new Error(`Repeating group "${name}" takes the rest of the line, so it has to be the last column, or have a flat.count`);
  });
}

/** A fixed-width line's columns, from `at`; a group without a count takes slots to the end of the line. */
function readFixed(line: string, at: number, columns: [string, Schema | undefined][]): Record<string, JsonValue> {
  checkGroups(columns, true);
  const record: Record<string, JsonValue> = {};
  for (const [name, column] of columns) {
    if (isGroup(column) && hintOf(column).count === undefined) {
      const slot = fixedWidthOf(name, column!.items);
      const list: JsonValue[] = [];
      for (; at < line.length; at += slot) {
        const item = readFixedValue(name, column!.items, line, at);
        if (!isEmpty(item)) list.push(item!);
      }
      if (list.length > 0) put(record, name, list);
      continue;
    }
    put(record, name, readFixedValue(name, column, line, at));
    at += fixedWidthOf(name, column);
  }
  return record;
}

/** The parts of a group's items, for a group spread over fields: their fields, or the item itself when it's a single value. */
const partsOfItem = (item: Schema | undefined): [string | undefined, Schema | undefined][] => {
  const parts = isComposite(item) && hintOf(item).delimiter === undefined ? Object.entries(item!.properties!) : [];
  return parts.length > 0 ? parts : [[undefined, item]];
};

/** A CSV line's columns: by heading where there's a header, otherwise by place, a group taking one field or the fields that follow. */
function readCsv(values: string[], columns: [string, Schema | undefined][], escapes: Escapes, headings?: string[]): Record<string, JsonValue> {
  checkGroups(columns, false);
  const record: Record<string, JsonValue> = {};
  let at = 0;
  for (const [name, column] of columns) {
    const hint = hintOf(column);
    const place = headings ? headings.indexOf(hint.name ?? name) : at;
    if (!isGroup(column) || hint.delimiter !== undefined) {
      at++;
      if (place >= 0) put(record, name, readField(name, column, values[place] ?? "", escapes));
      continue;
    }
    // Items in the fields that follow, each part of an item a field of its own.
    if (headings) throw new Error(`Repeating group "${name}" needs a flat.delimiter in a CSV file with a header, so its items share one field`);
    const parts = partsOfItem(column!.items);
    const list: JsonValue[] = [];
    for (let n = 0; hint.count === undefined ? at < values.length : n < hint.count; n++) {
      const fields = values.slice(at, (at += parts.length));
      let item: JsonValue | undefined;
      if (parts[0]![0] === undefined) item = readField(name, parts[0]![1], fields[0] ?? "", escapes);
      else {
        const inner: Record<string, JsonValue> = {};
        parts.forEach(([part, schema], index) => put(inner, part!, readField(part!, schema, fields[index] ?? "", escapes)));
        item = inner;
      }
      if (!isEmpty(item)) list.push(item!);
    }
    if (list.length > 0) put(record, name, list);
  }
  return record;
}

/** A fixed-width line's columns as text. */
function writeFixed(columns: [string, Schema | undefined][], item: Record<string, JsonValue>): string {
  checkGroups(columns, true);
  return columns.map(([name, column]) => writeFixedValue(name, column, item[name])).join("");
}

/** A CSV line's cells: each column's field, or a group's items in the fields that follow, empty ones up to its count. */
function writeCsv(columns: [string, Schema | undefined][], item: Record<string, JsonValue>, field: (text: string) => string, header: boolean, escapes: Escapes): string[] {
  checkGroups(columns, false);
  const cell = (text: string) => (text === "" ? "" : field(text));
  const cells: string[] = [];
  for (const [name, column] of columns) {
    const hint = hintOf(column);
    if (!isGroup(column) || hint.delimiter !== undefined) {
      cells.push(cell(writeField(name, column, item[name], escapes)));
      continue;
    }
    if (header) throw new Error(`Repeating group "${name}" needs a flat.delimiter in a CSV file with a header, so its items share one field`);
    const list = listOf(item[name]);
    if (hint.count !== undefined && list.length > hint.count) throw new Error(`"${name}" has ${list.length} items, more than the ${hint.count} its line has room for`);
    const parts = partsOfItem(column!.items);
    for (const entry of list) {
      for (const [part, schema] of parts) cells.push(cell(writeField(part ?? name, schema, part === undefined ? entry : isRecord(entry) ? entry[part] : undefined, escapes)));
    }
    for (let n = list.length; n < (hint.count ?? 0); n++) cells.push(...parts.map(() => ""));
  }
  return cells;
}

/** Values without the empty ones at the end. */
function withoutTrailing(values: string[]): string[] {
  let end = values.length;
  while (end > 0 && values[end - 1] === "") end--;
  return values.slice(0, end);
}

/** A value as text in a file: numbers as JavaScript writes them. */
const asText = (value: JsonValue): string => (typeof value === "string" ? value : typeof value === "number" ? String(value) : typeof value === "object" && value !== null ? JSON.stringify(value) : String(value));

/** A CSV field, quoted when it holds the delimiter, a quote or a line break, or starts or ends with a space. */
function csvField(text: string, delimiter: string, quote: string): string {
  if (quote === "") return text;
  return text.includes(delimiter) || text.includes(quote) || /[\r\n]/.test(text) || /^\s|\s$/.test(text) ? `${quote}${text.replaceAll(quote, quote + quote)}${quote}` : text;
}

/** A fixed-width cell: padded to its width, a number with implied decimals multiplied out, and too wide an error. */
function fixedCell(name: string, column: Schema | undefined, data: JsonValue | undefined): string {
  const flat = hintOf(column);
  const width = flat.width;
  if (!width) throw new Error(`Column "${name}" needs a width: a fixed-width file's columns each have flat.width`);
  const numeric = column?.type === "number" || column?.type === "integer";
  let text = "";
  if (data !== undefined && data !== null) {
    if (numeric && typeof data === "number" && flat.decimals) text = String(Math.round(data * 10 ** flat.decimals));
    else text = asText(data);
  }
  if (text.length > width) throw new Error(`"${text}" is too wide for column "${name}", which takes ${width}`);
  const pad = (flat.pad ?? " ").slice(0, 1) || " ";
  const right = (flat.align ?? (numeric ? "right" : "left")) === "right";
  // A zero-padded negative number keeps its sign in front.
  if (right && pad === "0" && text.startsWith("-")) return `-${text.slice(1).padStart(width - 1, "0")}`;
  return right ? text.padStart(width, pad) : text.padEnd(width, pad);
}

/**
 * Writes what a map made as a CSV or fixed-width file, following the target
 * schema: a line for each item of its row field, columns in the schema's
 * order, and for CSV a header row. A fixed-width value too wide for its
 * column is an error, rather than cut short.
 */
export function writeFlatFile(value: JsonValue, schema?: Schema): string {
  const resolved = schema ? resolveSchema(schema) : undefined;
  const hint = hintOf(resolved);
  const { key, row } = rowsOf(resolved);
  const records = (typeof value === "object" && value !== null && !Array.isArray(value) ? value[key] : undefined) ?? [];
  if (!Array.isArray(records)) throw new Error(`"${key}" should be an array of rows`);
  const items = records.filter((r): r is Record<string, JsonValue> => typeof r === "object" && r !== null && !Array.isArray(r));
  const known = Object.entries(row?.properties ?? {});
  // Without a schema, the columns are every field the rows have, in the order they first appear.
  const columns: [string, Schema | undefined][] = known.length > 0 ? known : [...new Set(items.flatMap((r) => Object.keys(r)))].map((name) => [name, undefined]);
  // Each line ends with the terminator, if there is one, then the line ending, which is none by default after a terminator.
  const newline = hint.terminator !== undefined ? hint.terminator + (hint.lineEnding ?? "") : (hint.lineEnding ?? "\n");
  const lines: string[] = [];

  const delimiter = hint.delimiter ?? ",";
  const quote = hint.quote ?? (hint.terminator !== undefined || hint.release !== undefined ? "" : '"');
  // With a release character, separators in values are released rather than quoted.
  const escapes: Escapes = { release: hint.release, specials: hint.release ? [hint.release, ...[...separatorsOf(resolved, new Set())].filter((s) => s !== hint.release)] : [] };
  const field = (text: string) => (hint.release ? text : csvField(text, delimiter, quote));
  // An EDI segment, ended by a terminator, leaves off empty fields at its end.
  const ends = (cells: string[]) => (hint.terminator !== undefined ? withoutTrailing(cells) : cells);

  // A file with several kinds of line: each record's line, then the lines of the kinds it holds, in the schema's order.
  if (kindsOf(resolved).length > 0) {
    const lineFor = (tag: string, record: Schema | undefined, item: Record<string, JsonValue>) => {
      const columns = columnsOf(record);
      return hint.format === "fixed" ? tag + writeFixed(columns, item) : [field(tag), ...ends(writeCsv(columns, item, field, false, escapes))].join(delimiter);
    };
    const writeLevel = (record: Schema | undefined, data: Record<string, JsonValue>) => {
      for (const [name, kind] of kindsOf(record)) {
        const inner = data[name];
        const items = Array.isArray(inner) ? inner : inner !== undefined && inner !== null ? [inner] : [];
        for (const item of items) {
          if (typeof item !== "object" || item === null || Array.isArray(item)) continue;
          lines.push(lineFor(tagOf(kind)!, recordOf(kind), item));
          writeLevel(recordOf(kind), item);
        }
      }
    };
    if (typeof value === "object" && value !== null && !Array.isArray(value)) writeLevel(resolved, value);
    return lines.length > 0 ? lines.join(newline) + newline : "";
  }

  if (hint.format === "fixed") {
    // Headings are text, left-aligned and padded with spaces, whatever their column holds; a group's spans its slots.
    const headingWidth = (name: string, column: Schema | undefined) =>
      isGroup(column) ? fixedWidthOf(name, column!.items) * (hintOf(column).count ?? 1) : isComposite(column) ? fixedWidthOf(name, column) : (hintOf(column).width ?? 0);
    if (hint.header) lines.push(columns.map(([name, column]) => fixedCell(name, { type: "string", flat: { width: headingWidth(name, column) } }, hintOf(column).name ?? name)).join(""));
    for (const item of items) lines.push(writeFixed(columns, item));
    return lines.length > 0 ? lines.join(newline) + newline : "";
  }

  const header = hint.header ?? true;
  if (header) lines.push(columns.map(([name, column]) => field(hintOf(column).name ?? name)).join(delimiter));
  for (const item of items) lines.push(ends(writeCsv(columns, item, field, header, escapes)).join(delimiter));
  return lines.length > 0 ? lines.join(newline) + newline : "";
}

/**
 * A schema from a sample CSV file: a column for each heading (or `column1`,
 * `column2`, … without a header), typed by what every value in it reads as.
 * Numbers with leading zeros, such as postcodes or account numbers, stay text.
 */
export function inferCsvSchema(text: string, options: Pick<FlatHint, "delimiter" | "quote" | "header" | "skip"> = {}): Schema {
  const delimiter = options.delimiter ?? guessDelimiter(text);
  const rows = (readFlatFile(text, { type: "object", flat: { ...options, delimiter } }) as { rows: Record<string, string>[] }).rows;
  const names = [...new Set(rows.flatMap((r) => Object.keys(r)))];
  const properties: Record<string, Schema> = {};
  for (const name of names) {
    const values = rows.map((r) => r[name]?.trim()).filter((v): v is string => v !== undefined && v !== "");
    const all = (pattern: RegExp) => values.length > 0 && values.every((v) => pattern.test(v));
    const type = all(/^-?(0|[1-9]\d*)$/) ? "integer" : all(/^-?(0|[1-9]\d*)(\.\d+)?$/) ? "number" : all(/^(true|false)$/i) ? "boolean" : "string";
    Object.defineProperty(properties, name, { value: { type }, enumerable: true, writable: true, configurable: true });
  }
  const flat: FlatHint = { format: "csv", ...(delimiter !== "," ? { delimiter } : {}), ...(options.header === false ? { header: false } : {}), ...(options.skip ? { skip: options.skip } : {}) };
  return { type: "object", flat, properties: { rows: { type: "array", items: { type: "object", properties } } } };
}

/** The likeliest delimiter of a CSV file: whichever of comma, semicolon, tab and pipe its first line has most of. */
function guessDelimiter(text: string): string {
  const first = text.replace(/^﻿/, "").split(/\r?\n/, 1)[0] ?? "";
  const counts = [",", ";", "\t", "|"].map((d) => [d, first.split(d).length - 1] as const);
  const best = counts.reduce((a, b) => (b[1] > a[1] ? b : a));
  return best[1] > 0 ? best[0] : ",";
}
