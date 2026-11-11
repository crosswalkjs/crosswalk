import { listFields, parsePath, type JsonValue, type LinkSource, type Loop, type MapDocument, type NoteAnchor, type OperatorRegistry, type Schema, type SubMap } from "@crosswalkjs/core";

// Every edit takes a document and returns a new one, so the editor can keep
// earlier documents for undo.

/** Where a link drag starts: a source tree row (a field or a record) or a node's output. */
export type DragOrigin =
  | { kind: "source"; path: string; repeating: boolean; value: boolean }
  | { kind: "node"; id: string };

/** Where a link drag can end: a node, or a target tree row. */
export type DropTarget = { kind: "node"; id: string } | { kind: "target"; path: string; repeating: boolean; value: boolean };

export interface Position {
  x: number;
  y: number;
}

/** The lowest input index of a node with no link or constant on it. */
export function nextFreeInput(document: MapDocument, id: string): number {
  const used = new Set<number>();
  for (const link of document.links) {
    if ("node" in link.to && link.to.node === id) used.add(link.to.input);
  }
  const node = document.nodes.find((n) => n.id === id);
  for (const key of Object.keys(node?.constants ?? {})) used.add(Number(key));
  let index = 0;
  while (used.has(index)) index++;
  return index;
}

/** True when `id` reads, directly or through other nodes, from `upstream`. */
function dependsOn(document: MapDocument, id: string, upstream: string, seen = new Set<string>()): boolean {
  if (id === upstream) return true;
  if (seen.has(id)) return false;
  seen.add(id);
  return document.links.some(
    (link) => "node" in link.to && link.to.node === id && "node" in link.from && dependsOn(document, link.from.node, upstream, seen),
  );
}

/**
 * Applies a drag from `origin` to `target`: a value
 * goes to the node's next free input or replaces a target field's link, a
 * repeating source record dropped on a repeating target record makes a loop,
 * and one dropped on an aggregate operator becomes its scope. Returns
 * undefined when the drop doesn't make sense.
 */
export function connect(
  document: MapDocument,
  origin: DragOrigin,
  target: DropTarget,
  registry: OperatorRegistry,
): MapDocument | undefined {
  if (origin.kind === "source" && origin.repeating) {
    if (target.kind === "target" && target.repeating) return setLoop(document, origin.path, target.path);
    if (target.kind === "node") {
      const node = document.nodes.find((n) => n.id === target.id);
      if (node && registry.get(node.operator)?.kind === "aggregate") {
        const scoped = setScope(document, target.id, origin.path);
        // An array of plain values is also what gets aggregated.
        return origin.value ? (link(scoped, { source: origin.path }, target.id, registry) ?? scoped) : scoped;
      }
    }
    if (!origin.value) return undefined;
  }
  // A record dropped on a record copies it across whole, until it's given a sub-map.
  if (origin.kind === "source" && !origin.value) {
    return target.kind === "target" && !target.value && !target.repeating ? setRecordLink(document, origin.path, target.path, undefined) : undefined;
  }

  const from: LinkSource = origin.kind === "source" ? { source: origin.path } : { node: origin.id };
  if (target.kind === "node") return link(document, from, target.id, registry);
  if (!target.value) return undefined;
  const next = structuredClone(document);
  next.links = next.links.filter((l) => !("target" in l.to && l.to.target === target.path));
  next.links.push({ from, to: { target: target.path } });
  return next;
}

function link(document: MapDocument, from: LinkSource, id: string, registry: OperatorRegistry): MapDocument | undefined {
  const node = document.nodes.find((n) => n.id === id);
  if (!node) return undefined;
  if ("node" in from && dependsOn(document, from.node, id)) return undefined;
  const input = nextFreeInput(document, id);
  const max = registry.get(node.operator)?.inputs.max;
  if (max !== undefined && input >= max) return undefined;
  const next = structuredClone(document);
  next.links.push({ from, to: { node: id, input } });
  return next;
}

export function addNode(document: MapDocument, operator: string, position: Position): { document: MapDocument; id: string } {
  const base = operator.split(".").pop() ?? "node";
  const taken = new Set(document.nodes.map((n) => n.id));
  let count = 1;
  while (taken.has(`${base}${count}`)) count++;
  const id = `${base}${count}`;
  const next = structuredClone(document);
  next.nodes.push({ id, operator, position: { x: Math.round(position.x), y: Math.round(position.y) } });
  return { document: next, id };
}

export function moveNode(document: MapDocument, id: string, position: Position): MapDocument {
  const next = structuredClone(document);
  const node = next.nodes.find((n) => n.id === id);
  if (node) node.position = { x: Math.round(position.x), y: Math.round(position.y) };
  return next;
}

/** Removes whatever is on one input of a node and moves the inputs after it down one. */
export function removeInput(document: MapDocument, id: string, index: number): MapDocument {
  const next = structuredClone(document);
  next.links = next.links.filter((l) => !("node" in l.to && l.to.node === id && l.to.input === index));
  for (const l of next.links) {
    if ("node" in l.to && l.to.node === id && l.to.input > index) l.to.input--;
  }
  const node = next.nodes.find((n) => n.id === id);
  if (node?.constants) {
    const constants: Record<number, JsonValue> = {};
    for (const [key, value] of Object.entries(node.constants)) {
      const i = Number(key);
      if (i !== index) constants[i > index ? i - 1 : i] = value;
    }
    if (Object.keys(constants).length > 0) node.constants = constants;
    else delete node.constants;
  }
  // A note on the removed input stays with the operator; ones on later inputs move up with them.
  for (const note of next.notes ?? []) {
    if (!note.on || !("node" in note.on) || note.on.node !== id || note.on.input === undefined) continue;
    if (note.on.input === index) note.on = { node: id };
    else if (note.on.input > index) note.on = { node: id, input: note.on.input - 1 };
  }
  return next;
}

/** Swaps what's on two inputs of a node, links and constants alike. */
export function swapInputs(document: MapDocument, id: string, a: number, b: number): MapDocument {
  const next = structuredClone(document);
  for (const l of next.links) {
    if (!("node" in l.to) || l.to.node !== id) continue;
    if (l.to.input === a) l.to.input = b;
    else if (l.to.input === b) l.to.input = a;
  }
  const node = next.nodes.find((n) => n.id === id);
  if (node?.constants) {
    const constants: Record<number, JsonValue> = {};
    for (const [key, value] of Object.entries(node.constants)) {
      const i = Number(key);
      constants[i === a ? b : i === b ? a : i] = value;
    }
    node.constants = constants;
  }
  for (const note of next.notes ?? []) {
    if (!note.on || !("node" in note.on) || note.on.node !== id || note.on.input === undefined) continue;
    if (note.on.input === a) note.on = { node: id, input: b };
    else if (note.on.input === b) note.on = { node: id, input: a };
  }
  return next;
}

/** Removes a node and its links. Nodes it fed lose that input. */
export function removeNode(document: MapDocument, id: string): MapDocument {
  let next = document;
  for (;;) {
    const fed = next.links.find((l) => "node" in l.from && l.from.node === id && "node" in l.to && l.to.node !== id);
    if (!fed || !("node" in fed.to)) break;
    next = removeInput(next, fed.to.node, fed.to.input);
  }
  next = structuredClone(next);
  // Notes about the operator outlive it, left where it was.
  const position = next.nodes.find((n) => n.id === id)?.position ?? { x: 0, y: 0 };
  for (const note of next.notes ?? []) {
    if (!note.on || !("node" in note.on) || note.on.node !== id) continue;
    delete note.on;
    note.position = { x: position.x + NOTE_ANCHOR_OFFSET + note.position.x, y: position.y + NOTE_ANCHOR_OFFSET + note.position.y };
  }
  next.nodes = next.nodes.filter((n) => n.id !== id);
  next.links = next.links.filter((l) => !("node" in l.from && l.from.node === id) && !("node" in l.to && l.to.node === id));
  return next;
}

export function removeLink(document: MapDocument, index: number): MapDocument {
  const target = document.links[index]?.to;
  if (!target) return document;
  if ("node" in target) return removeInput(document, target.node, target.input);
  const next = structuredClone(document);
  next.links.splice(index, 1);
  return next;
}

/**
 * Links a source field or another node's output to one input of a node,
 * replacing any link or constant there. Returns undefined if it would make
 * operators feed each other in a loop.
 */
export function setInputLink(document: MapDocument, id: string, index: number, from: LinkSource): MapDocument | undefined {
  if (!document.nodes.some((n) => n.id === id)) return undefined;
  if ("node" in from && (!document.nodes.some((n) => n.id === from.node) || dependsOn(document, from.node, id))) return undefined;
  const next = structuredClone(document);
  next.links = next.links.filter((l) => !("node" in l.to && l.to.node === id && l.to.input === index));
  next.links.push({ from, to: { node: id, input: index } });
  const node = next.nodes.find((n) => n.id === id)!;
  if (node.constants && Object.hasOwn(node.constants, index)) {
    const { [index]: _removed, ...rest } = node.constants;
    if (Object.keys(rest).length > 0) node.constants = rest;
    else delete node.constants;
  }
  return next;
}

/** Puts a constant on an input, replacing any link there. */
export function setConstant(document: MapDocument, id: string, index: number, value: JsonValue): MapDocument {
  const next = structuredClone(document);
  next.links = next.links.filter((l) => !("node" in l.to && l.to.node === id && l.to.input === index));
  const node = next.nodes.find((n) => n.id === id);
  if (node) node.constants = { ...node.constants, [index]: value };
  return next;
}

export function setScope(document: MapDocument, id: string, scope: string | undefined): MapDocument {
  const next = structuredClone(document);
  const node = next.nodes.find((n) => n.id === id);
  if (node) {
    if (scope === undefined) delete node.scope;
    else node.scope = scope;
  }
  return next;
}

/** Makes `target` repeat over `source`, replacing any loop it had. */
export function setLoop(document: MapDocument, source: string, target: string): MapDocument {
  const next = structuredClone(document);
  next.loops = [...(next.loops ?? []).filter((l) => l.target !== target), { source, target }];
  return next;
}

export function removeLoop(document: MapDocument, target: string): MapDocument {
  const next = structuredClone(document);
  const loop = next.loops?.find((l) => l.target === target);
  // The loop's items go with it, and so does how they were mapped.
  if (loop) next.links = next.links.filter((l) => !isRecordLink(l, loop.source, target));
  next.loops = (next.loops ?? []).filter((l) => l.target !== target);
  if (next.loops.length === 0) delete next.loops;
  return next;
}

/** Sets how a loop sorts, groups and de-duplicates its items. An undefined option is removed. */
export function setLoopOptions(document: MapDocument, target: string, options: { sortBy?: Loop["sortBy"] | undefined; groupBy?: string | undefined; distinct?: boolean | undefined }): MapDocument {
  const next = structuredClone(document);
  const loop = next.loops?.find((l) => l.target === target);
  if (!loop) return document;
  for (const [key, value] of Object.entries(options) as [keyof typeof options, unknown][]) {
    const empty = value === undefined || value === false || (Array.isArray(value) && value.length === 0);
    if (empty) delete loop[key];
    else Object.assign(loop, { [key]: value });
  }
  return next;
}

const isRecordLink = (link: MapDocument["links"][number], from: string, to: string) =>
  "source" in link.from && link.from.source === from && "target" in link.to && link.to.target === to;

/**
 * Fills the target record at `to` from the source record at `from`: copied as
 * it is, or mapped with a sub-map. Replaces anything else filling that record.
 */
export function setRecordLink(document: MapDocument, from: string, to: string, submap: string | undefined): MapDocument {
  const next = structuredClone(document);
  next.links = next.links.filter((l) => !("target" in l.to && l.to.target === to));
  next.links.push(submap === undefined ? { from: { source: from }, to: { target: to } } : { from: { source: from }, to: { target: to }, submap });
  return next;
}

export function removeRecordLink(document: MapDocument, from: string, to: string): MapDocument {
  const next = structuredClone(document);
  next.links = next.links.filter((l) => !isRecordLink(l, from, to));
  return next;
}

/** The record at `path`: the schema there, or its items' for a repeating record. */
export function recordSchema(schema: Schema, path: string): Schema | undefined {
  const field = listFields(schema).find((f) => f.path === path);
  const record = field?.schema.type === "array" ? field.schema.items : field?.schema;
  return record?.type === "object" ? record : undefined;
}

/**
 * Makes an empty sub-map between the records at `from` and `to`, named after
 * the target record, and maps the record link with it.
 */
export function createSubmap(document: MapDocument, from: string, to: string): { document: MapDocument; name: string } | undefined {
  const source = recordSchema(document.source, from);
  const target = recordSchema(document.target, to);
  if (!source || !target) return undefined;
  const nameOf = (path: string) => parsePath(path).at(-1)!.key;
  const base = nameOf(to);
  const taken = new Set(Object.keys(document.submaps ?? {}));
  let name = base;
  for (let count = 2; taken.has(name); count++) name = `${base}${count}`;
  const submap: SubMap = {
    source: { ...structuredClone(source), title: nameOf(from) },
    target: { ...structuredClone(target), title: base },
    nodes: [],
    links: [],
  };
  const next = setRecordLink(document, from, to, name);
  next.submaps = { ...next.submaps, [name]: submap };
  return { document: next, name };
}

/** Removes a sub-map. Record links that used it copy their records instead. */
export function removeSubmap(document: MapDocument, name: string): MapDocument {
  const next = structuredClone(document);
  delete next.submaps?.[name];
  if (next.submaps && Object.keys(next.submaps).length === 0) delete next.submaps;
  for (const map of [next, ...Object.values(next.submaps ?? {})]) {
    for (const link of map.links) if (link.submap === name) delete link.submap;
  }
  return next;
}

/** A note on an operator is placed from the operator's middle, this far in from its corner. */
export const NOTE_ANCHOR_OFFSET = 17;

export function addNote(document: MapDocument, position: Position, on?: NoteAnchor): { document: MapDocument; id: string } {
  const taken = new Set((document.notes ?? []).map((n) => n.id));
  let count = 1;
  while (taken.has(`note${count}`)) count++;
  const id = `note${count}`;
  const next = structuredClone(document);
  const note = { id, text: "", position: { x: Math.round(position.x), y: Math.round(position.y) } };
  next.notes = [...(next.notes ?? []), on ? { ...note, on } : note];
  return { document: next, id };
}

export function moveNote(document: MapDocument, id: string, position: Position): MapDocument {
  const next = structuredClone(document);
  const note = next.notes?.find((n) => n.id === id);
  if (note) note.position = { x: Math.round(position.x), y: Math.round(position.y) };
  return next;
}

/** Moves a note, and attaches it to `on` or, when that's undefined, to nothing. A note `on` something is positioned relative to it. */
export function placeNote(document: MapDocument, id: string, position: Position, on: NoteAnchor | undefined): MapDocument {
  const next = moveNote(document, id, position);
  const note = next.notes?.find((n) => n.id === id);
  if (note) {
    if (on) note.on = on;
    else delete note.on;
  }
  return next;
}

export function setNoteText(document: MapDocument, id: string, text: string): MapDocument {
  const next = structuredClone(document);
  const note = next.notes?.find((n) => n.id === id);
  if (note) note.text = text;
  return next;
}

export function removeNote(document: MapDocument, id: string): MapDocument {
  const next = structuredClone(document);
  next.notes = (next.notes ?? []).filter((n) => n.id !== id);
  if (next.notes.length === 0) delete next.notes;
  return next;
}

/** Moves several nodes at once, as one edit. */
export function moveNodes(document: MapDocument, positions: Map<string, Position>): MapDocument {
  const next = structuredClone(document);
  for (const node of next.nodes) {
    const position = positions.get(node.id);
    if (position) node.position = { x: Math.round(position.x), y: Math.round(position.y) };
  }
  return next;
}

/** Removes several nodes and their links, as one edit. */
export function removeNodes(document: MapDocument, ids: readonly string[]): MapDocument {
  return ids.reduce((next, id) => removeNode(next, id), document);
}

/**
 * Operators copied out of a map: the nodes, the links between them, and the
 * links into them from source fields. Links out to target fields aren't
 * copied, since a target field takes only one.
 */
export interface Fragment {
  crosswalk: "operators";
  nodes: MapDocument["nodes"];
  links: MapDocument["links"];
}

export function copyNodes(document: MapDocument, ids: readonly string[]): Fragment {
  const chosen = new Set(ids);
  return {
    crosswalk: "operators",
    nodes: structuredClone(document.nodes.filter((node) => chosen.has(node.id))),
    links: structuredClone(document.links.filter((link) => "node" in link.to && chosen.has(link.to.node) && ("source" in link.from || chosen.has(link.from.node)))),
  };
}

/** Reads a fragment back from the clipboard's text, or undefined if it isn't one. */
export function readFragment(text: string): Fragment | undefined {
  try {
    const value = JSON.parse(text) as Partial<Fragment>;
    return value.crosswalk === "operators" && Array.isArray(value.nodes) && Array.isArray(value.links) ? (value as Fragment) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Adds copied operators, with new ids, moved by `offset`. Links from source
 * fields this map doesn't have are left out, and so is a scope it doesn't have.
 */
export function pasteNodes(document: MapDocument, fragment: Fragment, offset: Position): { document: MapDocument; ids: string[] } {
  let next = document;
  const ids = new Map<string, string>();
  const fields = new Set(listFields(document.source).map((field) => field.path));
  for (const node of fragment.nodes) {
    const position = { x: (node.position?.x ?? 40) + offset.x, y: (node.position?.y ?? 40) + offset.y };
    const added = addNode(next, node.operator, position);
    ids.set(node.id, added.id);
    next = added.document;
    const copy = next.nodes.find((n) => n.id === added.id)!;
    if (node.constants) copy.constants = structuredClone(node.constants);
    if (node.scope !== undefined && fields.has(node.scope)) copy.scope = node.scope;
  }
  next = structuredClone(next);
  for (const link of fragment.links) {
    if (!("node" in link.to)) continue;
    const to = ids.get(link.to.node);
    const from = "node" in link.from ? ids.get(link.from.node) : fields.has(link.from.source) ? link.from.source : undefined;
    if (to === undefined || from === undefined) continue;
    next.links.push({ from: "node" in link.from ? { node: from } : { source: from }, to: { node: to, input: link.to.input } });
  }
  return { document: next, ids: [...ids.values()] };
}

/** Replaces the source or target schema. Links to fields it no longer has stay, as issues to fix. */
export function setSchema(document: MapDocument, side: "source" | "target", schema: Schema): MapDocument {
  return { ...structuredClone(document), [side]: structuredClone(schema) };
}

// ---- pages ----

/** The id of the page an operator or note is on: its own, if that's listed, or else the first. Undefined in a map without pages. */
export function pageOf(document: MapDocument, item: { page?: string }): string | undefined {
  const pages = document.pages ?? [];
  return pages.some((page) => page.id === item.page) ? item.page : pages[0]?.id;
}

/**
 * Adds a page at the end. A map without pages gets two: a first page that
 * keeps everything already there, and the new one.
 */
export function addPage(document: MapDocument, name?: string): { document: MapDocument; id: string } {
  const next = structuredClone(document);
  const pages = next.pages ?? [];
  if (pages.length === 0) pages.push({ id: "page1", name: "Page 1" });
  const taken = new Set(pages.map((page) => page.id));
  let count = pages.length + 1;
  while (taken.has(`page${count}`)) count++;
  const id = `page${count}`;
  pages.push({ id, name: name ?? `Page ${pages.length + 1}` });
  next.pages = pages;
  return { document: next, id };
}

export function renamePage(document: MapDocument, id: string, name: string): MapDocument {
  const next = structuredClone(document);
  const page = next.pages?.find((p) => p.id === id);
  if (page && name.trim() !== "") page.name = name.trim();
  return next;
}

/**
 * Removes a page. What was on it moves to the page before it, or, for the
 * first page, the one after.
 */
/** Everything that sits on a page: operators, notes, loops, and links (only those straight across use theirs). */
const onPages = (document: MapDocument): { page?: string }[] => [...document.nodes, ...(document.notes ?? []), ...document.links, ...(document.loops ?? [])];

export function removePage(document: MapDocument, id: string): MapDocument {
  const pages = document.pages ?? [];
  const index = pages.findIndex((page) => page.id === id);
  if (index === -1) return document;
  const heir = pages[index === 0 ? 1 : index - 1]?.id;
  const next = structuredClone(document);
  for (const item of onPages(next)) {
    if (pageOf(document, item) !== id) continue;
    if (heir === undefined) delete item.page;
    else item.page = heir;
  }
  next.pages = pages.filter((page) => page.id !== id);
  // On the one page left, everything is on it anyway. It keeps its name.
  if (next.pages.length <= 1) for (const item of onPages(next)) delete item.page;
  return next;
}

/** Moves operators, and notes, to a page. */
export function moveToPage(document: MapDocument, ids: readonly string[], page: string): MapDocument {
  if (!document.pages?.some((p) => p.id === page)) return document;
  const next = structuredClone(document);
  const moving = new Set(ids);
  for (const item of [...next.nodes, ...(next.notes ?? [])]) {
    if (moving.has(item.id)) item.page = page;
  }
  return next;
}

/** A line that can be moved to another page on its own: a link straight across, or a loop. */
export type PagedLine = { kind: "link"; index: number } | { kind: "loop"; target: string };

export function moveLineToPage(document: MapDocument, line: PagedLine, page: string): MapDocument {
  if (!document.pages?.some((p) => p.id === page)) return document;
  const next = structuredClone(document);
  const item = line.kind === "link" ? next.links[line.index] : next.loops?.find((l) => l.target === line.target);
  if (item) item.page = page;
  return next;
}

/** Puts links straight across, and loops, that an edit made on `page`. Lines to and from operators follow the operators. */
export function newLinesOnPage(before: MapDocument, after: MapDocument, page: string | undefined): MapDocument {
  if (page === undefined || page === after.pages?.[0]?.id) return after;
  const had = new Set([...before.links, ...(before.loops ?? [])].map((item) => JSON.stringify(item)));
  const next = structuredClone(after);
  for (const link of next.links) {
    if ("source" in link.from && "target" in link.to && !had.has(JSON.stringify(link))) link.page = page;
  }
  for (const loop of next.loops ?? []) if (!had.has(JSON.stringify(loop))) loop.page = page;
  return next;
}
