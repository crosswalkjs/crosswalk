import type { MapIssue, OperatorDefinition } from "@crosswalkjs/core";

/**
 * Every piece of wording in the editor, so a host can translate it or use its
 * own terms. Pass the ones to change as the `labels` option; the rest stay in
 * English. Wording with something in it, such as a count or a name, is a
 * function, so a translation can put the words in its own order.
 */
export interface Labels {
  // The grid
  emptyReadOnly: string;
  emptyHint: [string, string];
  zoomOut: string;
  zoomIn: string;
  zoomReset: string;
  fitInView: string;
  // The toolbox
  operators: string;
  findOperator: string;
  toolboxHint: string;
  showOperators: string;
  hideOperators: string;
  notes: string;
  noteChip: string;
  /** A toolbox chip's tooltip. */
  addOperatorHint: (operator: string) => string;
  /** A group of operators in the toolbox, by its category. The default is the category's own label. */
  category: (category: { id: string; label: string }) => string;
  // The trees
  input: string;
  output: string;
  findField: (side: "source" | "target") => string;
  fold: (field: string) => string;
  foldOrUnfold: string;
  repeating: string;
  required: string;
  noFieldsMatch: string;
  /** The button that replaces a tree's schema, and the form it opens. */
  replaceSchema: (side: "source" | "target") => string;
  fromSample: string;
  fromJsonSchema: string;
  fromOpenApi: string;
  fromXmlSample: string;
  fromXsd: string;
  fromCsvSample: string;
  pasteHere: (kind: "sample" | "schema" | "openapi" | "xml" | "xsd" | "csv") => string;
  whichSchema: string;
  useSchema: string;
  cancel: string;
  notJson: (message: string) => string;
  notRecord: string;
  noSchemasInOpenApi: string;
  noElementsInXsd: string;
  // Pages
  pages: string;
  firstPage: string;
  anotherPage: string;
  pageName: string;
  renamePage: (name: string) => string;
  deletePage: (name: string) => string;
  deletePageHint: (name: string) => string;
  addPage: string;
  addPageHint: string;
  goToPage: string;
  allPages: string;
  carriesOn: (direction: "to" | "from", page: string) => string;
  carriesOnHint: (direction: "to" | "from", page: string) => string;
  tracedOperators: (count: number) => string;
  // Notes
  note: string;
  writeNote: string;
  noteGrip: string;
  pinnedTo: (thing: string) => string;
  unpinFrom: (thing: string) => string;
  deleteNote: string;
  /** What a note is pinned to: an operator, one of its inputs, or a field. */
  noteOn: (anchor: { node: string; input?: number } | { field: string }) => string;
  // Lines
  copy: string;
  copied: string;
  mappedWith: (submap: string) => string;
  // The inspector
  close: string;
  inputs: string;
  inputLabel: (index: number) => string;
  inputPlaceholder: string;
  /** An operator's output, offered as an input to another. */
  outputOf: (operator: string) => string;
  inputHint: (index: number) => string;
  tableHint: (index: number) => string;
  tableOf: (count: number) => string;
  moveInputUp: (index: number) => string;
  useTable: (index: number) => string;
  removeInput: (index: number) => string;
  aggregatesOver: string;
  chooseRepeating: string;
  deleteOperator: string;
  page: string;
  recordLink: string;
  mapWith: string;
  fieldByField: string;
  copyAsItIs: string;
  subMap: (name: string) => string;
  newSubMap: string;
  subMapErrors: (count: number) => string;
  open: (name: string) => string;
  deleteLink: string;
  loop: string;
  sortBy: string;
  sortKey: (index: number) => string;
  chooseField: string;
  removeSortKey: (index: number) => string;
  ascending: string;
  descending: string;
  ascendingHint: string;
  descendingHint: string;
  addSortKey: string;
  thenBy: string;
  keepOrder: string;
  groupBy: string;
  oneEach: string;
  leaveOutRepeats: string;
  mapEachItem: string;
  deleteLoop: string;
  // Sub-maps
  showing: string;
  mainMap: string;
  subMapNote: (source: string, target: string, uses: number) => string;
  record: string;
  deleteSubMap: string;
  // The live preview
  leftOut: string;
  leftOutHint: string;
  items: (count: number) => string;
  firstItemValue: (value: string) => string;
  previewNeedsRunner: (operators: string[]) => string;
  previewFailed: (message: string) => string;
  serverCantRun: (message: string) => string;
  /** An issue's message. The default is the analyser's own, in English; switch on `issue.code` to word them yourself. */
  issue: (issue: MapIssue) => string;
  /** An operator's name, description and input labels, by its id. The default is the operator's own. */
  operator: (definition: OperatorDefinition) => { label: string; description?: string; inputs?: readonly string[] };
}

const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;

/** The editor's own wording. */
export const englishLabels: Labels = {
  emptyReadOnly: "Nothing is mapped yet.",
  emptyHint: ["Drag a source field onto a target field to copy it across,", "or drag an operator here from the toolbox to transform it on the way."],
  zoomOut: "Zoom out",
  zoomIn: "Zoom in",
  zoomReset: "Back to 100%",
  fitInView: "Fit everything in view",
  operators: "Operators",
  findOperator: "Find an operator",
  toolboxHint: "Drag an operator onto the grid, or click it. Drag fields onto it, then its dot onto a target field. Drag a record onto a record to map it whole.",
  showOperators: "Show operators",
  hideOperators: "Hide operators",
  notes: "Notes",
  noteChip: "A note. Drag onto the grid, or click to add.",
  addOperatorHint: (operator) => `${operator}. Drag onto the grid, or click to add.`,
  category: (category) => category.label,
  input: "Input",
  output: "Output",
  findField: (side) => `Find a ${side} field`,
  fold: (field) => `Fold ${field}`,
  foldOrUnfold: "Fold or unfold",
  repeating: "repeating",
  required: "Required by the target schema",
  noFieldsMatch: "No fields match.",
  replaceSchema: (side) => `Replace the ${side} schema`,
  fromSample: "A sample",
  fromJsonSchema: "JSON Schema",
  fromOpenApi: "OpenAPI",
  fromXmlSample: "An XML sample",
  fromXsd: "XSD",
  fromCsvSample: "A CSV sample",
  pasteHere: (kind) =>
    ({
      sample: "Paste an example of the data, as JSON",
      schema: "Paste a JSON Schema",
      openapi: "Paste an OpenAPI document, as JSON",
      xml: "Paste an example of the data, as XML",
      xsd: "Paste an XSD",
      csv: "Paste a few lines of the CSV file, with its header",
    })[kind],
  whichSchema: "Which schema",
  useSchema: "Use it",
  cancel: "Cancel",
  notJson: (message) => `That isn't JSON: ${message}`,
  notRecord: "A map's source and target are records: the top level needs to be an object.",
  noSchemasInOpenApi: "This OpenAPI document doesn't describe any JSON bodies or schemas.",
  noElementsInXsd: "This XSD doesn't declare any elements at the top level.",
  pages: "Pages",
  firstPage: "Page 1",
  anotherPage: "another page",
  pageName: "Page name",
  renamePage: (name) => `${name}. Double-click to rename.`,
  deletePage: (name) => `Delete ${name}`,
  deletePageHint: (name) => `Delete ${name}. What's on it moves to the next page along.`,
  addPage: "Add a page",
  addPageHint: "Add a page. Drop operators here to move them to a new page.",
  goToPage: "Go to page",
  allPages: "All pages",
  carriesOn: (direction, page) => `${direction} ${page}`,
  carriesOnHint: (direction, page) => `Carries on ${direction} ${page}. Click to go there.`,
  tracedOperators: (count) => `${count} of the traced field's operators`,
  note: "Note",
  writeNote: "Write a note",
  noteGrip: "Drag to move. Drop it on an operator, line or field to pin it there.",
  pinnedTo: (thing) => `Pinned ${thing}`,
  unpinFrom: (thing) => `Unpin from ${thing.replace(/^on /, "")}`,
  deleteNote: "Delete note",
  noteOn: (anchor) => ("node" in anchor ? `on ${anchor.node}${anchor.input === undefined ? "" : ` input ${anchor.input + 1}`}` : `on ${anchor.field}`),
  copy: "copy",
  copied: "Copied as it is",
  mappedWith: (submap) => `Mapped with sub-map ${submap}. Double-click to open it.`,
  close: "Close",
  inputs: "Inputs",
  inputLabel: (index) => `Input ${index + 1}`,
  inputPlaceholder: "field or value",
  outputOf: (operator) => `${operator}'s output`,
  inputHint: (index) => `Input ${index + 1}: a source field, another operator, or a constant`,
  tableHint: (index) => `Table for input ${index + 1}, one key = value per line`,
  tableOf: (count) => `table of ${count}`,
  moveInputUp: (index) => `Move input ${index + 1} up`,
  useTable: (index) => `Use a table for input ${index + 1}`,
  removeInput: (index) => `Remove input ${index + 1}`,
  aggregatesOver: "Aggregates over",
  chooseRepeating: "Choose a repeating record…",
  deleteOperator: "Delete operator",
  page: "Page",
  recordLink: "Record link",
  mapWith: "Map with",
  fieldByField: "Field by field",
  copyAsItIs: "Copy as it is",
  subMap: (name) => `Sub-map: ${name}`,
  newSubMap: "New sub-map…",
  subMapErrors: (count) => `The sub-map has ${plural(count, "error")}.`,
  open: (name) => `Open ${name}`,
  deleteLink: "Delete link",
  loop: "Loop",
  sortBy: "Sort by",
  sortKey: (index) => `Sort key ${index + 1}`,
  chooseField: "Choose a field…",
  removeSortKey: (index) => `Remove sort key ${index + 1}`,
  ascending: "A → Z",
  descending: "Z → A",
  ascendingHint: "Smallest first. Click for largest first.",
  descendingHint: "Largest first. Click for smallest first.",
  addSortKey: "Add a sort key",
  thenBy: "Then by…",
  keepOrder: "Keep their order",
  groupBy: "Group by",
  oneEach: "One item each",
  leaveOutRepeats: "Leave out repeated items",
  mapEachItem: "Map each item",
  deleteLoop: "Delete loop",
  showing: "Showing",
  mainMap: "Main map",
  subMapNote: (source, target, uses) => `Maps one ${source} to one ${target}. Used by ${plural(uses, "link")}.`,
  record: "record",
  deleteSubMap: "Delete sub-map",
  leftOut: "left out",
  leftOutHint: "Not in the output for the sample input",
  items: (count) => plural(count, "item"),
  firstItemValue: (value) => `The first item's value: ${value}`,
  previewNeedsRunner: (operators) =>
    `No preview: ${operators.join(", ")} only run${operators.length === 1 ? "s" : ""} on the server, so the editor needs a preview runner.`,
  previewFailed: (message) => `The preview couldn't run: ${message}`,
  serverCantRun: (message) => `The server can't run this map: ${message}`,
  issue: (issue) => issue.message,
  operator: (definition) => ({ label: definition.label, ...(definition.description ? { description: definition.description } : {}), ...(definition.inputs.labels ? { inputs: definition.inputs.labels } : {}) }),
};
