// A fixed-width line as a tree: columns, and nested rows that hold columns and nested rows of their own, to any
// depth. Each level is edited the same way: cut its columns, join them, move the edge between two, and group a run
// of fields as nested rows, or ungroup them again.
import {guessColumn, type Column} from './infer';

/** A fixed-width column: a column and how many characters it takes. */
export interface FixedColumn extends Column {
  width: number;
}

/** Nested rows: one row's fields, repeated `count` times, or, at the top of a line, to its end. */
export interface Rows {
  name: string;
  count: number | null;
  fields: Field[];
}

export type Field = FixedColumn | Rows;

export const isRows = (field: Field): field is Rows => 'fields' in field;

/** How many characters one row of nested rows takes. */
export const rowWidth = (fields: Field[]): number => fields.reduce((sum, field) => sum + widthOf(field), 0);

/** How many characters a field takes. Nested rows that run to the end of the line count as one row here. */
export const widthOf = (field: Field): number => (isRows(field) ? (field.count ?? 1) * rowWidth(field.fields) : field.width);

/** Where each field starts. */
export const startsOf = (fields: Field[]): number[] => {
  const starts: number[] = [];
  let at = 0;
  for (const field of fields) {
    starts.push(at);
    at += widthOf(field);
  }
  return starts;
};

/** Every instance of the level at a path, as text: the lines themselves, or every nested row there in every line. */
export function instancesAt(lines: string[], fields: Field[], path: number[]): {texts: string[]; fields: Field[]} {
  let texts = lines;
  let current = fields;
  for (const index of path) {
    const rows = current[index];
    if (!rows || !isRows(rows)) break;
    const start = startsOf(current)[index]!;
    const width = rowWidth(rows.fields);
    if (width <= 0) return {texts: [], fields: rows.fields};
    texts = texts.flatMap((text) => {
      const count = rows.count ?? Math.max(0, Math.ceil((text.length - start) / width));
      return Array.from({length: count}, (_, n) => text.slice(start + n * width, start + (n + 1) * width)).filter((row) => row.trim() !== '');
    });
    current = rows.fields;
  }
  return {texts, fields: current};
}

/** The fields with the level at a path replaced. */
export function replaceAt(fields: Field[], path: number[], next: Field[]): Field[] {
  if (path.length === 0) return next;
  return fields.map((field, i) => (i === path[0] && isRows(field) ? {...field, fields: replaceAt(field.fields, path.slice(1), next)} : field));
}

/** A name not yet taken at a level, or by the nested rows it's inside. */
function freeName(fields: Field[], base: string, outer: string[] = []): string {
  const taken = new Set([...fields.map((f) => f.name), ...outer]);
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) if (!taken.has(`${base}${n}`)) return `${base}${n}`;
}

/** A column over some characters of every instance, its type guessed from what's there. */
function columnOver(texts: string[], start: number, width: number, name: string, like?: FixedColumn): FixedColumn {
  const guessed = guessColumn(
    texts.map((t) => t.slice(start, start + width)),
    'fixed',
    name,
  );
  return {...guessed, ...(like ? {heading: like.heading} : {}), name, width};
}

/** The next free fieldN name. */
function nextFieldName(fields: Field[]): string {
  let n = fields.length + 1;
  const taken = new Set(fields.map((f) => f.name));
  while (taken.has(`field${n}`)) n++;
  return `field${n}`;
}

/** Cuts the column that holds a position in two. */
export function cut(fields: Field[], at: number, texts: string[]): Field[] {
  const starts = startsOf(fields);
  const index = fields.findIndex((field, i) => !isRows(field) && starts[i]! < at && at < starts[i]! + field.width);
  if (index === -1) return fields;
  const column = fields[index] as FixedColumn;
  const start = starts[index]!;
  const left = columnOver(texts, start, at - start, column.name, column);
  const right = columnOver(texts, at, start + column.width - at, nextFieldName(fields));
  return [...fields.slice(0, index), left, right, ...fields.slice(index + 1)];
}

/** Joins two columns side by side into one. */
export function join(fields: Field[], index: number, texts: string[]): Field[] {
  const left = fields[index];
  const right = fields[index + 1];
  if (!left || !right || isRows(left) || isRows(right)) return fields;
  const start = startsOf(fields)[index]!;
  return [...fields.slice(0, index), columnOver(texts, start, left.width + right.width, left.name, left), ...fields.slice(index + 2)];
}

/** Moves the edge between two columns, the one growing as the other shrinks. */
export function moveEdge(fields: Field[], index: number, to: number, texts: string[]): Field[] {
  const left = fields[index];
  const right = fields[index + 1];
  if (!left || !right || isRows(left) || isRows(right)) return fields;
  const start = startsOf(fields)[index]!;
  const end = start + left.width + right.width;
  if (to <= start || to >= end) return fields;
  return [
    ...fields.slice(0, index),
    columnOver(texts, start, to - start, left.name, left),
    columnOver(texts, to, end - to, right.name, right),
    ...fields.slice(index + 2),
  ];
}

/**
 * The fields after a point, refitted to start at a new end and stop at the level's length: those it overlaps are cut
 * short, nested rows it cuts through become a column, and a gap before them becomes a column too.
 */
function refit(after: {field: Field; start: number}[], from: number, length: number, texts: string[], others: Field[]): Field[] {
  const result: Field[] = [];
  let at = from;
  for (const {field, start} of after) {
    const end = start + widthOf(field);
    if (end <= at) continue;
    if (start > at) {
      result.push(columnOver(texts, at, start - at, nextFieldName([...others, ...result])));
      at = start;
    }
    if (start < at) {
      // Nested rows can't be cut short, so what's left of them becomes a column.
      result.push(columnOver(texts, at, end - at, isRows(field) ? nextFieldName([...others, ...result]) : field.name, isRows(field) ? undefined : field));
    } else result.push(field);
    at = end;
  }
  if (at < length) result.push(columnOver(texts, at, length - at, nextFieldName([...others, ...result])));
  return result;
}

/** The fields after one, with where each starts. */
const after = (fields: Field[], index: number) => {
  const starts = startsOf(fields);
  return fields.slice(index + 1).map((field, i) => ({field, start: starts[index + 1 + i]!}));
};

/**
 * Groups a run of fields as nested rows: they're one row, and the characters after them are more rows like it. At the
 * top of a line the rows run to its end; inside a nested row they repeat as many times as fit in it.
 */
export function group(fields: Field[], from: number, to: number, texts: string[], top: boolean, length: number, outer: string[] = []): Field[] {
  const row = fields.slice(from, to + 1);
  const width = rowWidth(row);
  if (width <= 0) return fields;
  const start = startsOf(fields)[from]!;
  const before = fields.slice(0, from);
  const rows: Rows = {name: freeName(fields, 'items', outer), count: top ? null : Math.max(1, Math.floor((length - start) / width)), fields: row};
  if (rows.count === null) return [...before, rows];
  const end = start + rows.count * width;
  return [...before, rows, ...refit(after(fields, to), end, length, texts, [...before, rows])];
}

/** Ungroups nested rows: the first row's fields take their place, and the characters of the rest become a column. */
export function ungroup(fields: Field[], index: number, texts: string[], length: number): Field[] {
  const rows = fields[index];
  if (!rows || !isRows(rows)) return fields;
  const start = startsOf(fields)[index]!;
  const before = fields.slice(0, index);
  const inner = rows.fields;
  const end = start + rowWidth(inner);
  const rest = rows.count === null ? [] : after(fields, index);
  return [...before, ...inner, ...refit(rest, end, length, texts, [...before, ...inner])];
}

/** Changes how many nested rows there are; the fields after them keep to the same characters where they can. */
export function setCount(fields: Field[], index: number, count: number | null, texts: string[], length: number): Field[] {
  const rows = fields[index];
  if (!rows || !isRows(rows)) return fields;
  const start = startsOf(fields)[index]!;
  const next: Rows = {...rows, count};
  const before = fields.slice(0, index);
  // To the end of the line takes everything after it.
  if (count === null) return [...before, next];
  const end = start + count * rowWidth(rows.fields);
  const rest = rows.count === null ? [] : after(fields, index);
  return [...before, next, ...refit(rest, end, length, texts, [...before, next])];
}

/** Changes one field at a level. */
export function update(fields: Field[], index: number, patch: Partial<FixedColumn> | Partial<Rows>): Field[] {
  return fields.map((field, i) => (i === index ? ({...field, ...patch} as Field) : field));
}

/** Fields from columns cut at the given places, with nested rows over a run of them, to the end of the line. */
export function fieldsFrom(columns: Column[], splits: number[], length: number, group?: {from: number; to: number; name: string}): Field[] {
  const starts = [0, ...splits];
  const widths = columns.map((_, i) => (starts[i + 1] ?? length) - starts[i]!);
  const all: FixedColumn[] = columns.map((c, i) => ({...c, width: widths[i]!}));
  if (!group || group.to >= all.length) return all;
  return [...all.slice(0, group.from), {name: group.name, count: null, fields: all.slice(group.from, group.to + 1)}];
}

/** How far a field reaches on a line of a given length, from where it starts: nested rows to the end reach the end. */
const reachOf = (field: Field, start: number, length: number) =>
  isRows(field) && field.count === null ? Math.max(rowWidth(field.fields), length - start) : widthOf(field);

/**
 * The deepest level a range of a line falls within, and the range there: inside one row of nested rows, a range is
 * that row's, so the same selection works at any depth.
 */
export function levelOf(fields: Field[], from: number, to: number, length: number): {path: number[]; from: number; to: number} {
  const path: number[] = [];
  let current = fields;
  let a = from;
  let b = to;
  let room = length;
  for (;;) {
    const starts = startsOf(current);
    const index = current.findIndex((field, i) => starts[i]! <= a && b <= starts[i]! + reachOf(field, starts[i]!, room));
    const rows = current[index];
    if (!rows || !isRows(rows)) return {path, from: a, to: b};
    const width = rowWidth(rows.fields);
    if (width <= 0) return {path, from: a, to: b};
    const row = Math.floor((a - starts[index]!) / width);
    if (Math.floor((b - 1 - starts[index]!) / width) !== row) return {path, from: a, to: b};
    path.push(index);
    a -= starts[index]! + row * width;
    b -= starts[index]! + row * width;
    room = width;
    current = rows.fields;
  }
}

/** The fields at a level cut so that a range starts and ends on their edges, and which run of them it covers. */
function covering(fields: Field[], from: number, to: number, texts: string[]): {fields: Field[]; first: number; last: number} | string {
  const cutFields = cut(cut(fields, from, texts), to, texts);
  const starts = startsOf(cutFields);
  const first = starts.indexOf(from);
  const last = cutFields.findIndex(
    (field, i) => starts[i]! + widthOf(field) === to || (isRows(field) && field.count === null && i === cutFields.length - 1 && to > starts[i]!),
  );
  if (first === -1 || last === -1 || last < first) return 'That cuts through nested rows: select inside one of their rows, or all of them.';
  return {fields: cutFields, first, last};
}

/** Names the characters in a range: one field over them, joining any columns there. */
export function nameRange(fields: Field[], from: number, to: number, texts: string[], name: string): Field[] | string {
  const found = covering(fields, from, to, texts);
  if (typeof found === 'string') return found;
  let {fields: next} = found;
  const {first, last} = found;
  const run = next.slice(first, last + 1);
  if (run.length > 1 && run.some(isRows)) return 'That holds nested rows, so it can’t be one field. Select inside them, or around them.';
  for (let n = first; n < last; n++) next = join(next, first, texts);
  return update(next, first, {name});
}

/** Makes the fields in a range repeat: they're one row, and the characters after them more rows like it. */
export function repeatRange(
  fields: Field[],
  from: number,
  to: number,
  texts: string[],
  top: boolean,
  length: number,
  outer: string[],
): {fields: Field[]; index: number} | string {
  const found = covering(fields, from, to, texts);
  if (typeof found === 'string') return found;
  return {fields: group(found.fields, found.first, found.last, texts, top, length, outer), index: found.first};
}

/** Where each field and row starts on a line, and how deep in nested rows each character is, for drawing. */
export function paint(fields: Field[], length: number): {depth: number[]; odd: boolean[]; edge: boolean[]; rowEdge: boolean[]} {
  const depth = new Array<number>(length).fill(0);
  // Whether a character is in an odd-numbered item of the innermost list it's in, so items alternate.
  const odd = new Array<boolean>(length).fill(false);
  const edge = new Array<boolean>(length + 1).fill(false);
  const rowEdge = new Array<boolean>(length + 1).fill(false);
  const walk = (level: Field[], base: number, level_: number) => {
    const starts = startsOf(level);
    level.forEach((field, i) => {
      const start = base + starts[i]!;
      if (start > 0 && start < length) edge[start] = true;
      if (!isRows(field)) return;
      const width = rowWidth(field.fields);
      if (width <= 0) return;
      const count = field.count ?? Math.max(1, Math.ceil((length - start) / width));
      for (let n = 0; n < count && start + n * width < length; n++) {
        const at = start + n * width;
        if (at > 0) rowEdge[at] = true;
        for (let k = at; k < Math.min(length, at + width); k++) {
          depth[k] = level_ + 1;
          odd[k] = n % 2 === 1;
        }
        walk(field.fields, at, level_ + 1);
      }
    });
  };
  walk(fields, 0, 0);
  return {depth, odd, edge, rowEdge};
}

/** Every place a field at a path appears on a line: once, or once in each nested row it's inside. */
export function spansOf(fields: Field[], path: number[], index: number, length: number): [number, number][] {
  let bases = [0];
  let current = fields;
  for (const i of path) {
    const rows = current[i];
    if (!rows || !isRows(rows)) return [];
    const start = startsOf(current)[i]!;
    const width = rowWidth(rows.fields);
    if (width <= 0) return [];
    bases = bases.flatMap((base) => {
      const count = rows.count ?? Math.max(1, Math.ceil((length - base - start) / width));
      return Array.from({length: count}, (_, n) => base + start + n * width);
    });
    current = rows.fields;
  }
  const field = current[index];
  if (!field) return [];
  const start = startsOf(current)[index]!;
  return bases.map((base) => [base + start, base + start + reachOf(field, base + start, length)]);
}

/** The deepest field holding a character, and the path to the level it's at. */
export function fieldAt(fields: Field[], at: number, length: number): {path: number[]; index: number} | undefined {
  const {path, from} = levelOf(fields, at, at + 1, length);
  let current = fields;
  for (const i of path) current = (current[i] as Rows).fields;
  const starts = startsOf(current);
  const index = current.findIndex((field, i) => starts[i]! <= from && from < starts[i]! + reachOf(field, starts[i]!, length));
  return index === -1 ? undefined : {path, index};
}

/** The fields at a path. */
export function fieldsAt(fields: Field[], path: number[]): Field[] {
  let current = fields;
  for (const i of path) current = (current[i] as Rows).fields;
  return current;
}

/** Where a character sits, in words: the lists and items it's in, then its field, such as "lines, item 2 › sku". */
export function describeAt(fields: Field[], at: number, length: number): string {
  const parts: string[] = [];
  let current = fields;
  let a = at;
  let room = length;
  for (;;) {
    const starts = startsOf(current);
    const index = current.findIndex((field, i) => starts[i]! <= a && a < starts[i]! + reachOf(field, starts[i]!, room));
    const field = current[index];
    if (!field) return parts.join(' › ');
    if (!isRows(field)) {
      parts.push(field.name);
      return parts.join(' › ');
    }
    const width = rowWidth(field.fields);
    if (width <= 0) return parts.join(' › ');
    const row = Math.floor((a - starts[index]!) / width);
    parts.push(`${field.name}, item ${row + 1}`);
    a -= starts[index]! + row * width;
    room = width;
    current = field.fields;
  }
}
