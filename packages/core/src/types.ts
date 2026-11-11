/** Any value that can appear in JSON. */
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

/** The subset of JSON Schema the mapper understands. */
export interface Schema {
  /**
   * Left out, it's read from the rest: a record if there are `properties`, an
   * array if there are `items`, or whatever a `$ref` or `allOf` gives. JSON
   * Schema's list of types, such as `["string", "null"]`, reads as its first
   * type that isn't `null`.
   */
  type?: "object" | "array" | "string" | "number" | "integer" | "boolean" | "null";
  title?: string;
  description?: string;
  format?: string;
  properties?: Record<string, Schema>;
  /** The properties a value must have. A required target field with nothing mapped to it is a warning. */
  required?: string[];
  items?: Schema;
  /**
   * A local reference, such as `#/$defs/Address`, to a schema under the root
   * schema's `$defs` or `definitions`. It stands for that schema, so `type`
   * can be left out beside it in JSON.
   */
  $ref?: string;
  $defs?: Record<string, Schema>;
  definitions?: Record<string, Schema>;
  /** Every one of these, merged: their fields together. */
  allOf?: Schema[];
  /**
   * One of these shapes. Read as one record with every alternative's fields,
   * each required only when every alternative requires it; `null` alternatives
   * are dropped, so `oneOf: [X, { type: "null" }]` is just X.
   */
  oneOf?: Schema[];
  /** Read as `oneOf` is. */
  anyOf?: Schema[];
  /** Where the field sits in XML, for reading and writing XML. See `xmlToJson`. */
  xml?: XmlHint;
  /** How a flat file is laid out, or where a column sits in one. See `readFlatFile`. */
  flat?: FlatHint;
  /** Read only for their type, where `type` is left out: `{ "const": "card" }` is a string. */
  const?: JsonValue;
  enum?: JsonValue[];
}

/**
 * How a flat file is laid out, on the root schema, and where each column
 * sits, on the fields of a row. See `readFlatFile`.
 */
export interface FlatHint {
  /** On the root: `csv` (delimited, the default) or `fixed` (fixed-width columns). */
  format?: "csv" | "fixed";
  /**
   * On the root, for CSV: what separates fields. Defaults to a comma. On a
   * repeating group in CSV: what separates its items within one field, such
   * as HL7's `~`; on that group's items, what separates each item's parts,
   * such as `^`. A group without one takes its items from the fields that
   * follow instead.
   */
  delimiter?: string;
  /** On the root, for CSV: what quotes a field. Defaults to `"`. */
  quote?: string;
  /** On the root: whether the first line names the columns. Defaults to true for CSV, false for fixed-width. */
  header?: boolean;
  /** On the root: lines to skip at the start, before any header. */
  skip?: number;
  /** On the root, for writing: `\n` (the default), `\r\n`, or `\r` as HL7 has. After a `terminator`, none by default. */
  lineEnding?: "\n" | "\r\n" | "\r";
  /**
   * On the root: what ends each line, where it isn't a line break, such as
   * X12's `~` or EDIFACT's `'`. Line breaks after it are skipped. A file with
   * one quotes nothing, unless it gives a `quote`.
   */
  terminator?: string;
  /**
   * On the root, for CSV: the character that makes the one after it plain
   * text, such as EDIFACT's `?`, so `?+` is a plus sign rather than a
   * separator. Writing releases every separator the schema uses.
   */
  release?: string;
  /**
   * On a kind of line, in a file with several: what its lines start with. In
   * CSV it's the first field, and in a fixed-width file the first characters.
   * A record field takes one such line, an array field every one; either can
   * hold kinds of line of its own, for the lines that follow it.
   */
  tag?: string;
  /** On a column: its name in the header, where it differs from the field's. */
  name?: string;
  /**
   * On a column of a fixed-width file: how many characters it takes. On a CSV
   * column, the width it's padded to when writing, as X12's envelope pads its
   * fields; its value is trimmed when reading.
   */
  width?: number;
  /** On a fixed-width column: where the value sits. Numbers default to the right, the rest to the left. */
  align?: "left" | "right";
  /** On a fixed-width column: what fills it out. Defaults to a space. */
  pad?: string;
  /** On a fixed-width number: how many decimal places are implied, so `000012345` with 2 is 123.45. */
  decimals?: number;
  /**
   * On a repeating group, an array field among a line's columns: how many
   * items the line has room for, blank ones skipped when reading and padded
   * when writing. Without it, the group takes the rest of the line, so it
   * comes last.
   */
  count?: number;
}

/** Where a field sits in XML, as OpenAPI's `xml` object says. */
export interface XmlHint {
  /** The element or attribute name, where it differs from the field's. */
  name?: string;
  namespace?: string;
  prefix?: string;
  /** An attribute rather than an element. */
  attribute?: boolean;
  /** OpenAPI 3.2's way of saying the same, and `text` for an element's own text. */
  nodeType?: "element" | "attribute" | "text" | "cdata" | "none";
  /** For an array: its items sit inside an element of the array's name, rather than straight in the parent. */
  wrapped?: boolean;
}

/**
 * A map from one JSON shape to another.
 *
 * Fields are addressed by path. Object keys are joined with `.` and a repeating
 * field is written with `[]`, so `PhoneCalls[].Cost` is the `Cost` of each item
 * in `PhoneCalls`.
 */
export interface MapDocument {
  version: 1;
  source: Schema;
  target: Schema;
  nodes: OperatorNode[];
  links: Link[];
  /** Which source array each target array repeats over. */
  loops?: Loop[];
  /**
   * Reusable maps for records, by name. A record link names one to map a source
   * record into a target record, such as the same address mapping in several places.
   */
  submaps?: Record<string, SubMap>;
  /** Notes for people reading the map. Runtimes ignore them. */
  notes?: Note[];
  /** Pages the editor splits a busy map's operators across, first page first. Runtimes ignore them. */
  pages?: Page[];
}

/**
 * One page of a map in the editor, shown as a tab on its grid. Each operator,
 * note, loop and link straight across says which page it's on; one that
 * doesn't, or names a page that isn't listed, is on the first.
 */
export interface Page {
  id: string;
  name: string;
}

/** A map for one record, used by record links. It can use the other sub-maps in its document. */
export interface SubMap {
  title?: string;
  source: Schema;
  target: Schema;
  nodes: OperatorNode[];
  links: Link[];
  loops?: Loop[];
  notes?: Note[];
  pages?: Page[];
}

/** A note on the editor's grid. */
export interface Note {
  id: string;
  text: string;
  /** Where the note sits: on the grid, or, for a note `on` something, relative to it. */
  position: { x: number; y: number };
  /** What the note is about, so it stays beside it. */
  on?: NoteAnchor;
  /** The id of the page the note is on, unless it's on an operator, when it's on that operator's page. */
  page?: string;
}

/**
 * Something a note can be attached to: an operator, one of an operator's
 * inputs (and the line into it), a target field (and the line or loop into
 * it), or a source field.
 */
export type NoteAnchor = { node: string; input?: number } | { target: string } | { source: string };

export interface OperatorNode {
  id: string;
  /** The id of an operator in the registry, such as `text.concat`. */
  operator: string;
  /** Fixed values for inputs that are not linked, keyed by input index. */
  constants?: Record<number, JsonValue>;
  /** For an aggregate operator: the source array it aggregates over, such as `PhoneCalls[]`. */
  scope?: string;
  /** Where the canvas draws the node. The evaluator ignores it. */
  position?: { x: number; y: number };
  /** The id of the page the canvas draws the node on. The evaluator ignores it. */
  page?: string;
}

export type LinkSource = { source: string } | { node: string };
export type LinkTarget = { target: string } | { node: string; input: number };

/**
 * A line from a source field or a node, to a target field or a node's input. A link
 * between two records copies the source record whole, or maps it with a sub-map.
 */
export interface Link {
  from: LinkSource;
  to: LinkTarget;
  /** For a link between records: the name of the sub-map to map it with. */
  submap?: string;
  /**
   * For a link straight from a source field to a target field: the id of the
   * page the canvas draws it on. A link to or from a node is on the node's page.
   */
  page?: string;
}

/**
 * Repeats a target array once per item of a source array: sorted, grouped and
 * de-duplicated on the way, in that order, when asked.
 */
export interface Loop {
  source: string;
  target: string;
  /** Orders the source items by these fields, first key first. The sort is stable and missing values go last. */
  sortBy?: SortKey[];
  /**
   * Makes one target item per distinct value of this field, in the order each
   * first appears. Inside the group, a field reads from the group's first item,
   * and an aggregate over the loop's source array covers the group's items.
   */
  groupBy?: string;
  /** Leaves out a target item identical to an earlier one. */
  distinct?: boolean;
  /** The id of the page the canvas draws the loop on. The evaluator ignores it. */
  page?: string;
}

export interface SortKey {
  /** A field of the loop's source item, such as `Lines[].Date`. */
  path: string;
  descending?: boolean;
}
