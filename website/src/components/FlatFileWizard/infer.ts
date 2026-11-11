// Works out a flat file's layout from a sample: whether it's CSV or fixed-width, which kinds of line it has and
// how they nest, and each kind's columns. Every guess can be changed in the wizard; this only gives it a start.
import type {Schema} from '@crosswalkjs/core';
import {fieldsFrom, isRows, type Field} from './fields';

export type Format = 'csv' | 'fixed';
export type ColumnType = 'string' | 'integer' | 'number' | 'boolean';

export interface Column {
  name: string;
  /** The heading it has in the file, where that isn't its name. */
  heading?: string;
  type: ColumnType;
  /** For a fixed-width number: implied decimal places. */
  decimals: number;
  /** For a fixed-width column: padded with zeros rather than spaces. */
  zeroPad: boolean;
  /** For a CSV column: the width it's padded to, as X12's envelope pads its fields. */
  width?: number;
  /** For a CSV column: what separates repeats within its field, such as HL7's ~. */
  repeatOn?: string;
  /** For a CSV column or part: what separates its parts, such as HL7's ^, or & within a part. */
  splitOn?: string;
  /** For a CSV column or part split into parts: the parts, each of which can have parts of its own. */
  parts?: Column[];
}

/** Columns of a line that repeat along it, as one item: from and to are column numbers, from 0. */
export interface Group {
  from: number;
  to: number;
  name: string;
  /** How many items the line has room for; null for as many as fit, to the end of the line. */
  count: number | null;
}

export interface Kind {
  /** What its lines start with; empty for a file with one kind of line. */
  tag: string;
  name: string;
  many: boolean;
  /** The tag of the kind it's inside, or null for the file itself. */
  parent: string | null;
  /** Fixed-width: where each column after the first starts, counted from after the tag. */
  splits: number[];
  /** Fixed-width: the longest line, after the tag. */
  length: number;
  columns: Column[];
  /** How many lines of it the sample has. */
  count: number;
  /** Columns that repeat along the line, in CSV. */
  group?: Group;
  /** Fixed-width: the line's fields, columns and nested rows, to any depth. */
  fields?: Field[];
}

/** How values are split within a CSV field: between repeats, between parts, and between a part's own parts. */
export interface Separators {
  repeat?: string;
  part?: string;
  subpart?: string;
}

export interface Layout {
  format: Format;
  delimiter: string;
  tagged: boolean;
  tagLength: number;
  /** A CSV file with one kind of line: whether the first line names the columns. */
  header: boolean;
  /** What ends each line, where it isn't a line break, as EDI has. */
  terminator?: string;
  /** What makes the character after it plain text, as EDIFACT's ? does. */
  release?: string;
  /** The line break the sample has, where it isn't the usual: after a terminator, or a carriage return alone as HL7 has. */
  lineEnding?: '\n' | '\r\n' | '\r';
  /** The separators within fields to look for. */
  separators: Separators;
  kinds: Kind[];
}

export type Base = Omit<Layout, 'kinds'>;

export const delimiters = [',', '|', ';', '\t', '*', '+'];

/** The sample's lines, without blank ones: at the terminator, where there is one, else at line breaks. */
export function linesOf(text: string, base?: Pick<Base, 'terminator' | 'release'>): string[] {
  const lines = base?.terminator ? splitAt(text, base.terminator, base.release).map((line) => line.replace(/^[\r\n]+/, '')) : text.split(/\r\n|\r|\n/);
  return lines.filter((line) => line.trim() !== '');
}

/** Splits text at a separator, except where the release character comes before it. */
export function splitAt(text: string, separator: string, release?: string): string[] {
  if (!release) return text.split(separator);
  const pieces: string[] = [];
  let piece = '';
  for (let i = 0; i < text.length; i++) {
    if (text.startsWith(release, i) && i + release.length < text.length) {
      piece += text.slice(i, i + release.length + 1);
      i += release.length;
    } else if (text.startsWith(separator, i)) {
      pieces.push(piece);
      piece = '';
      i += separator.length - 1;
    } else piece += text[i];
  }
  pieces.push(piece);
  return pieces;
}

/** A CSV line's fields. Samples are short, so a quoted field can't span lines here; EDI has no quotes at all. */
export function splitCsv(line: string, base: Pick<Base, 'delimiter'> & Partial<Pick<Base, 'release' | 'terminator'>>): string[] {
  if (base.release || base.terminator) return splitAt(line, base.delimiter, base.release);
  const fields: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!;
    if (quoted) {
      if (c !== '"') field += c;
      else if (line[i + 1] === '"') ((field += '"'), i++);
      else quoted = false;
    } else if (c === '"' && field === '') quoted = true;
    else if (line.startsWith(base.delimiter, i)) {
      fields.push(field);
      field = '';
      i += base.delimiter.length - 1;
    } else field += c;
  }
  fields.push(field);
  return fields;
}

const numeric = (text: string) => /^-?\d+(\.\d+)?$/.test(text.trim());
const plain = (c: string | undefined) => (c && !/[A-Za-z0-9 ]/.test(c) ? c : undefined);

const lineEndingAfter = (text: string, terminator: string): {lineEnding?: '\n' | '\r\n'} =>
  text.includes(`${terminator}\r\n`) ? {lineEnding: '\r\n'} : text.includes(`${terminator}\n`) ? {lineEnding: '\n'} : {};

/** An EDI file's separators, from its envelope: X12's ISA segment spells them out, EDIFACT's UNA too, or it uses the defaults. */
function ediLayout(text: string): Base | undefined {
  const start = text.trimStart();
  if (start.startsWith('ISA') && start.length > 106) {
    const element = start[3]!;
    const fields = start.split(element);
    // ISA16, the last field, is the part separator, and the character after it ends the segment.
    const last = fields[16] ?? '';
    const terminator = last[1];
    if (!terminator) return undefined;
    return {
      format: 'csv',
      delimiter: element,
      tagged: true,
      tagLength: 3,
      header: false,
      terminator,
      ...lineEndingAfter(text, terminator),
      // ISA11 is the repetition separator from version 00402 on; before that it's a letter.
      separators: {repeat: plain(fields[11]), part: plain(last[0])},
    };
  }
  if (start.startsWith('UNA') || start.startsWith('UNB') || start.startsWith('UNH')) {
    // UNA:+.? ' gives, in order, the part and field separators, the decimal mark, the release character, a space, and the terminator.
    const una = start.startsWith('UNA') ? start.slice(3, 9) : ":+.? '";
    return {
      format: 'csv',
      delimiter: una[1]!,
      tagged: true,
      tagLength: 3,
      header: false,
      terminator: una[5]!,
      release: una[3]!,
      ...lineEndingAfter(text, una[5]!),
      separators: {part: una[0]!},
    };
  }
  return undefined;
}

/** First guesses at how the file is laid out. */
export function guessLayout(text: string): Base {
  const edi = ediLayout(text);
  if (edi) return edi;
  const lines = linesOf(text);
  const candidates = [',', '|', ';', '\t'];
  const counts = candidates.map((d) => lines.filter((line) => line.includes(d)).length);
  const best = counts.indexOf(Math.max(...counts));
  const format: Format = lines.length > 0 && counts[best]! >= lines.length * 0.8 ? 'csv' : 'fixed';
  const delimiter = format === 'csv' ? candidates[best]! : ',';
  const tagLength = 2;
  const tags = lines.map((line) => (format === 'csv' ? splitCsv(line, {delimiter})[0]!.trim() : line.slice(0, tagLength)));
  const distinct = new Set(tags);
  const tagged = distinct.size >= 2 && distinct.size < lines.length && tags.every((tag) => /^[A-Za-z0-9]{1,4}$/.test(tag) && !/^\d+$/.test(tag));
  const first = format === 'csv' && lines[0] ? splitCsv(lines[0], {delimiter}) : [];
  const header = format === 'csv' && !tagged && first.every((cell) => cell.trim() !== '' && !numeric(cell));
  // HL7's MSH line names its separators right after the field separator: parts, repeats, escape, sub-parts.
  // Its segments are always told apart by their names, and end with a carriage return.
  const hl7 = format === 'csv' && lines[0]?.startsWith('MSH') && lines[0].length > 8;
  const separators: Separators = hl7 ? {part: lines[0]![4], repeat: lines[0]![5], subpart: lines[0]![7]} : {repeat: '~', part: '^', subpart: '&'};
  const lineEnding = /\r(?!\n)/.test(text) ? ({lineEnding: '\r'} as const) : {};
  return {format, delimiter, tagged: tagged || !!hl7, tagLength, header: header && !hl7, separators, ...lineEnding};
}

/** A tag or heading as a field name. */
function nameFrom(text: string, fallback: string): string {
  const words = text
    .trim()
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean);
  if (words.length === 0) return fallback;
  const name = words.map((w, i) => (i === 0 ? w.toLowerCase() : w[0]!.toUpperCase() + w.slice(1).toLowerCase())).join('');
  return /^\d/.test(name) ? `${fallback}${name}` : name;
}

/** The tag a line starts with. */
const tagOf = (line: string, layout: Base) =>
  !layout.tagged ? '' : layout.format === 'csv' ? splitCsv(line, layout)[0]!.trim() : line.slice(0, layout.tagLength);

/** The lines of one kind, after its tag: text for fixed-width, fields for CSV. */
export function linesOfKind(text: string, layout: Base, tag: string): string[] {
  let lines = linesOf(text, layout).filter((line) => tagOf(line, layout) === tag);
  if (layout.format === 'csv' && !layout.tagged && layout.header) lines = lines.slice(1);
  if (layout.format === 'fixed') return lines.map((line) => line.slice(tag.length));
  return lines;
}

/** Each line of a kind, as its cells. */
export function cellsOf(text: string, layout: Base, kind: Pick<Kind, 'tag' | 'splits' | 'length'>): string[][] {
  const lines = linesOfKind(text, layout, kind.tag);
  if (layout.format === 'csv') return lines.map((line) => splitCsv(line, layout).slice(layout.tagged ? 1 : 0));
  const starts = [0, ...kind.splits];
  return lines.map((line) => starts.map((start, i) => line.slice(start, starts[i + 1] ?? kind.length)));
}

const classOf = (c: string | undefined) => (c === undefined || c === ' ' ? 'space' : /\d/.test(c) ? 'digit' : 'other');

/** Where columns seem to start in fixed-width lines: where every line goes from a space, or between letters and digits. */
export function guessSplits(lines: string[]): number[] {
  const length = Math.max(0, ...lines.map((line) => line.length));
  const splits: number[] = [];
  for (let i = 1; i < length; i++) {
    const starts = lines.every((line) => {
      const before = classOf(line[i - 1]);
      const at = classOf(line[i]);
      return at !== 'space' && before !== at && line[i] !== undefined;
    });
    if (starts) splits.push(i);
  }
  return splits;
}

/**
 * Where a repeating row's columns seem to start: where every row goes from a space, or from digits to letters,
 * and where a zero-padded number ends every row after a code, as a quantity after A100 does. Letters then digits
 * isn't a split inside a row, since codes such as A100 mix them.
 */
export function guessItemSplits(slots: string[]): number[] {
  const width = Math.max(0, ...slots.map((slot) => slot.length));
  const splits = new Set<number>();
  for (let i = 1; i < width; i++) {
    const starts = slots.every((slot) => {
      const before = classOf(slot[i - 1]);
      const at = classOf(slot[i]);
      return slot[i] !== undefined && at !== 'space' && (before === 'space' || (before === 'digit' && at === 'other'));
    });
    if (starts) splits.add(i);
  }
  let padded = -1;
  for (let i = 1; i <= width - 2; i++)
    if (slots.every((slot) => slot[i] === '0' && /^\d+$/.test(slot.slice(i)) && /[A-Za-z]/.test(slot.slice(0, i)))) padded = i;
  if (padded > 0) splits.add(padded);
  return [...splits].sort((a, b) => a - b);
}

const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));

/** Each line's items, from where they start, a slot at a time. */
const slotsOf = (lines: string[], start: number, slot: number) =>
  lines.flatMap((line) => Array.from({length: Math.max(0, (line.length - start) / slot)}, (_, n) => line.slice(start + n * slot, start + (n + 1) * slot)));

/**
 * Items repeating along fixed-width lines, from how their lengths differ: lines a whole number of items longer
 * than each other, every item with letters, digits and spaces in the same places. The start is the earliest that
 * fits every line, so a line with one item has it in the group too.
 */
export function guessRepeats(lines: string[]): {start: number; slot: number} | undefined {
  const lengths = lines.map((line) => line.length);
  const shortest = Math.min(...lengths);
  const slot = lengths.reduce((g, length) => gcd(g, length - shortest), 0);
  if (slot < 2 || !lengths.some((length) => length - shortest >= slot)) return undefined;
  for (let start = shortest % slot || slot; start <= shortest; start += slot) {
    if (!lengths.some((length) => length - start >= 2 * slot)) continue;
    const slots = slotsOf(lines, start, slot);
    const alike = Array.from({length: slot}, (_, o) => new Set(slots.map((s) => classOf(s[o]))).size === 1).every(Boolean);
    if (alike && slots.some((s) => s.trim() !== '')) return {start, slot};
  }
  return undefined;
}

/** A column's type and padding, from its values. */
export function guessColumn(values: string[], format: Format, name: string, heading?: string): Column {
  const filled = values.map((v) => v.trim()).filter((v) => v !== '');
  const column: Column = {name, type: 'string', decimals: 0, zeroPad: false};
  if (heading !== undefined && heading !== name) column.heading = heading;
  if (filled.length === 0) return column;
  const leadingZero = filled.some((v) => /^-?0\d/.test(v));
  if (filled.every((v) => /^(true|false)$/i.test(v))) column.type = 'boolean';
  // Dates written as digits, such as 20260302, stay text.
  else if (filled.every((v) => /^(19|20)\d\d(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])$/.test(v))) column.type = 'string';
  // Digits too long for a number to hold exactly, such as several columns not yet split, stay text.
  else if (filled.some((v) => v.replace('-', '').length > 15)) column.type = 'string';
  else if (filled.every((v) => /^-?\d+$/.test(v))) {
    // In CSV a number with leading zeros is usually a code, such as an account number; in fixed-width, zero padding.
    if (format === 'fixed') ((column.type = 'integer'), (column.zeroPad = leadingZero));
    else if (!leadingZero) column.type = 'integer';
  }
  // A number that wouldn't be written back the same, such as a price of 19.50, stays text in CSV.
  else if (filled.every(numeric) && (format === 'fixed' || filled.every((v) => String(Number(v)) === v))) column.type = 'number';
  return column;
}

/** Values made only of separators, such as HL7's ^~\& or X12's : in its envelope, aren't repeats or parts. */
const separatorsOnly = /^[^A-Za-z0-9 ]{1,5}$/;

/**
 * A CSV column's repeats and parts, split by the given characters, then any part that holds a deeper
 * separator split again, as HL7 splits a part with &. Without them, a plain column.
 */
export function withSubfields(column: Column, values: string[], repeatOn?: string, splitOn?: string, deeper: string[] = [], release?: string): Column {
  const bare: Column = {...column, repeatOn: undefined, splitOn: undefined, parts: undefined};
  if (!repeatOn && !splitOn) return {...bare, type: guessColumn(values, 'csv', column.name).type};
  const real = values.filter((v) => !separatorsOnly.test(v.trim()));
  const items = real.flatMap((v) => (repeatOn ? splitAt(v, repeatOn, release) : [v]));
  if (!splitOn) return {...bare, repeatOn, type: guessColumn(items, 'csv', column.name).type};
  const split = items.map((item) => splitAt(item, splitOn, release));
  const count = Math.max(1, ...split.map((p) => p.length));
  const parts = Array.from({length: count}, (_, j) => {
    const partValues = split.map((p) => p[j] ?? '');
    const part = guessColumn(partValues, 'csv', `part${j + 1}`);
    const next = deeper[0];
    return next && partValues.some((v) => splitAt(v, next, release).length > 1)
      ? withSubfields(part, partValues, undefined, next, deeper.slice(1), release)
      : part;
  });
  return {...bare, repeatOn, splitOn, parts, type: 'string'};
}

/** Repeats and parts within a CSV field, by the separators the file uses. */
function guessSubfields(column: Column, values: string[], base: Base): Column {
  const real = values.filter((v) => !separatorsOnly.test(v.trim()));
  const has = (c: string | undefined) => (c && c !== base.delimiter && real.some((v) => splitAt(v, c, base.release).length > 1) ? c : undefined);
  const {repeat, part, subpart} = base.separators;
  if (!has(repeat) && !has(part)) return column;
  return withSubfields(column, values, has(repeat), has(part), subpart ? [subpart] : [], base.release);
}

/** A CSV column whose values are all padded with spaces to one length, as X12's envelope has, keeps that width. */
function padded(column: Column, values: string[]): Column {
  const given = values.filter((v) => v !== '');
  const lengths = new Set(given.map((v) => v.length));
  const spaced = given.some((v) => v !== v.trim());
  return lengths.size === 1 && spaced && !column.parts && !column.repeatOn ? {...column, width: [...lengths][0]} : column;
}

/** Which of a kind's columns are one of a group's repeats after its first item, so aren't columns of their own. */
export function repeatsOf(kind: Kind, format: Format): Set<number> {
  const repeats = new Set<number>();
  const g = kind.group;
  if (!g) return repeats;
  const starts = [0, ...kind.splits];
  kind.columns.forEach((_, i) => {
    if (i <= g.to) return;
    if (g.count === null) return repeats.add(i);
    if (format === 'fixed') {
      const end = starts[g.from]! + g.count * ((starts[g.to + 1] ?? kind.length) - starts[g.from]!);
      if ((starts[i + 1] ?? kind.length) <= end) repeats.add(i);
    } else if (i < g.from + g.count * (g.to - g.from + 1)) repeats.add(i);
  });
  return repeats;
}

/** Columns for a kind, from its cells; those already named keep their names where they still start at the same place. */
export function guessColumns(
  cells: string[][],
  format: Format,
  headings?: string[],
  previous?: {starts: number[]; columns: Column[]},
  starts?: number[],
): Column[] {
  const width = Math.max(0, ...cells.map((row) => row.length), headings?.length ?? 0);
  const taken = new Set<string>();
  return Array.from({length: width}, (_, i) => {
    const values = cells.map((row) => row[i] ?? '');
    const kept = previous && starts ? previous.columns[previous.starts.indexOf(starts[i]!)] : undefined;
    // Its values have changed, so its type is guessed again.
    if (kept) {
      taken.add(kept.name);
      return {...guessColumn(values, format, kept.name), heading: kept.heading};
    }
    let name = nameFrom(headings?.[i] ?? '', `field${i + 1}`);
    for (let n = 2; taken.has(name); n++) name = `${name}${n}`;
    taken.add(name);
    return guessColumn(values, format, name, headings?.[i]?.trim());
  });
}

/**
 * The kinds of line, in the order they first appear, with how they nest. A kind is inside another that repeats,
 * came first, and has it in more than one of its stretches (a stretch being from one of its lines to the next), so
 * a batch's entries go inside the batch, and a file trailer after the last batch doesn't. Of several, it's the one
 * with it in the largest share of its stretches, so a batch trailer goes in the batch rather than its last entry.
 * A kind repeats when there's more than one of it in the file, or in a stretch of what it's inside.
 */
export function guessKinds(text: string, base: Base): Kind[] {
  const all = linesOf(text, base);
  const lines = base.format === 'csv' && !base.tagged && base.header ? all.slice(1) : all;
  const tags = lines.map((line) => tagOf(line, base));
  const order = [...new Set(tags)];
  const stretches = (tag: string) => {
    const result: string[][] = [];
    tags.forEach((t) => (t === tag ? result.push([]) : result.at(-1)?.push(t)));
    return result;
  };
  const kinds: Kind[] = [];
  const names = new Set<string>();
  for (const tag of order) {
    const first = tags.indexOf(tag);
    const candidates = order
      .filter((p) => p !== tag && tags.indexOf(p) < first && tags.filter((t) => t === p).length > 1)
      .filter((p) => stretches(p).filter((s) => s.includes(tag)).length > 1);
    // The one with it in the largest share of its stretches, then the innermost: the one with the most lines.
    const share = (p: string) => stretches(p).filter((s) => s.includes(tag)).length / stretches(p).length;
    const count = (p: string) => tags.filter((t) => t === p).length;
    const parent = candidates.sort((a, b) => share(b) - share(a) || count(b) - count(a))[0] ?? null;
    const within = parent ? stretches(parent) : [tags];
    const many = within.some((s) => s.filter((t) => t === tag).length > 1);
    let name = base.tagged ? nameFrom(tag, 'line') : 'rows';
    for (let n = 2; names.has(name); n++) name = `${nameFrom(tag, 'line')}${n}`;
    names.add(name);
    const kind: Kind = {tag, name, many: base.tagged ? many : true, parent, splits: [], length: 0, columns: [], count: count(tag)};
    if (base.format === 'fixed') {
      const own = linesOfKind(text, base, tag);
      kind.length = Math.max(0, ...own.map((line) => line.length));
      kind.splits = guessSplits(own);
      // Items repeating along the line: the columns before them, then the first item's columns, then its repeats.
      const repeats = guessRepeats(own);
      if (repeats) {
        const {start, slot} = repeats;
        const before = guessSplits(own.map((line) => line.slice(0, start)));
        const inside = guessItemSplits(slotsOf(own, start, slot)).map((o) => start + o);
        kind.splits = [...new Set([...before, start, ...inside, start + slot])].filter((s) => s > 0 && s < kind.length).sort((a, b) => a - b);
        const starts = [0, ...kind.splits];
        const from = starts.indexOf(start);
        const end = starts.indexOf(start + slot);
        const to = (end === -1 ? starts.length : end) - 1;
        if (from >= 0 && to >= from) kind.group = {from, to, name: 'items', count: null};
      }
    }
    const headings = base.format === 'csv' && !base.tagged && base.header && all[0] ? splitCsv(all[0], base) : undefined;
    const cells = cellsOf(text, base, kind);
    kind.columns = guessColumns(cells, base.format, headings);
    if (base.format === 'fixed') kind.fields = fieldsFrom(kind.columns, kind.splits, kind.length, kind.group);
    if (base.format === 'csv')
      kind.columns = kind.columns.map((c, i) =>
        padded(
          guessSubfields(
            c,
            cells.map((row) => row[i] ?? ''),
            base,
          ),
          cells.map((row) => row[i] ?? ''),
        ),
      );
    kinds.push(kind);
  }
  return kinds;
}

/** The kinds inside a kind, at any depth, so it can't be put inside one of them. */
export function descendants(kinds: Kind[], tag: string): Set<string> {
  const found = new Set<string>();
  const walk = (t: string) => kinds.filter((k) => k.parent === t && !found.has(k.tag)).forEach((k) => (found.add(k.tag), walk(k.tag)));
  walk(tag);
  return found;
}

/** The schema the layout describes, ready for readFlatFile and a map. */
export function toSchema(layout: Layout): Schema {
  const fixed = layout.format === 'fixed';
  const column = (c: Column, width: number): Schema => {
    const flat: NonNullable<Schema['flat']> = {};
    if (c.heading) flat.name = c.heading;
    if (!fixed && c.width) flat.width = c.width;
    if (fixed) {
      flat.width = width;
      if (c.zeroPad) flat.pad = '0';
      if (c.type === 'number' && c.decimals > 0) flat.decimals = c.decimals;
    }
    return Object.keys(flat).length > 0 ? {type: c.type, flat} : {type: c.type};
  };
  const put = (properties: Record<string, Schema>, wanted: string, schema: Schema) => {
    let name = wanted;
    for (let n = 2; Object.hasOwn(properties, name); n++) name = `${wanted}${n}`;
    properties[name] = schema;
  };
  // A value within a CSV field: plain, or split into parts, each of which can be split again.
  const value = (c: Column): Schema => {
    const parts: Record<string, Schema> = {};
    for (const [j, part] of (c.splitOn ? (c.parts ?? []) : []).entries()) put(parts, part.name || `part${j + 1}`, value(part));
    return Object.keys(parts).length > 0 ? {type: 'object', flat: {delimiter: c.splitOn!}, properties: parts} : {type: c.type};
  };
  // A CSV column: a value, its parts, or repeats of either.
  const csvColumn = (c: Column): Schema => {
    const item = value(c);
    if (c.repeatOn) return {type: 'array', flat: {delimiter: c.repeatOn, ...(c.heading ? {name: c.heading} : {})}, items: item};
    if (item.type === 'object') return c.heading ? {...item, flat: {...item.flat, name: c.heading}} : item;
    return column(c, 0);
  };
  // A fixed-width line's fields: columns, and nested rows of fields, as deep as they go.
  const fixedFields = (fields: Field[]): Record<string, Schema> => {
    const properties: Record<string, Schema> = {};
    fields.forEach((field, i) => {
      if (isRows(field))
        put(properties, field.name || 'rows', {
          type: 'array',
          ...(field.count !== null ? {flat: {count: field.count}} : {}),
          items: {type: 'object', properties: fixedFields(field.fields)},
        });
      else put(properties, field.name || `field${i + 1}`, column(field, field.width));
    });
    return properties;
  };
  const record = (kind: Kind): Schema => {
    if (fixed && kind.fields) {
      const properties = fixedFields(kind.fields);
      for (const inner of layout.kinds.filter((k) => k.parent === kind.tag)) add(properties, inner);
      return {type: 'object', ...(layout.tagged ? {flat: {tag: kind.tag}} : {}), properties};
    }
    const properties: Record<string, Schema> = {};
    const starts = [0, ...kind.splits];
    const width = (i: number) => (starts[i + 1] ?? kind.length) - starts[i]!;
    const one = (c: Column, i: number, w = width(i)) => (fixed ? column(c, w) : csvColumn(c));
    const g = kind.group && kind.group.from <= kind.group.to && kind.group.to < kind.columns.length ? kind.group : undefined;
    const repeats = repeatsOf(kind, layout.format);
    // A fixed-width column after a group with a count starts where the group's slots end.
    let at = g && g.count !== null ? starts[g.from]! + g.count * ((starts[g.to + 1] ?? kind.length) - starts[g.from]!) : 0;
    kind.columns.forEach((c, i) => {
      if (g && i === g.from) {
        const items: Record<string, Schema> = {};
        kind.columns.slice(g.from, g.to + 1).forEach((member, j) => put(items, member.name || `field${j + 1}`, one(member, g.from + j)));
        put(properties, g.name || 'items', {type: 'array', ...(g.count !== null ? {flat: {count: g.count}} : {}), items: {type: 'object', properties: items}});
      }
      if (g && i >= g.from && i <= g.to) return;
      if (repeats.has(i)) return;
      if (g && i > g.to && fixed) {
        const end = starts[i + 1] ?? kind.length;
        put(properties, c.name || `field${i + 1}`, column(c, end - at));
        at = end;
        return;
      }
      put(properties, c.name || `field${i + 1}`, one(c, i));
    });
    for (const inner of layout.kinds.filter((k) => k.parent === kind.tag)) add(properties, inner);
    return {type: 'object', ...(layout.tagged ? {flat: {tag: kind.tag}} : {}), properties};
  };
  const add = (properties: Record<string, Schema>, kind: Kind) => {
    let name = kind.name || 'line';
    for (let n = 2; Object.hasOwn(properties, name); n++) name = `${kind.name}${n}`;
    properties[name] = kind.many ? {type: 'array', items: record(kind)} : record(kind);
  };
  const flat: NonNullable<Schema['flat']> = {format: layout.format};
  if (!fixed && layout.delimiter !== ',') flat.delimiter = layout.delimiter;
  if (!fixed && !layout.tagged && !layout.header) flat.header = false;
  if (layout.terminator) flat.terminator = layout.terminator;
  if (layout.release && !fixed) flat.release = layout.release;
  if (layout.lineEnding) flat.lineEnding = layout.lineEnding;
  const properties: Record<string, Schema> = {};
  for (const kind of layout.kinds.filter((k) => k.parent === null)) add(properties, kind);
  return {type: 'object', flat, properties};
}
