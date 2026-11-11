import { parsePath, type JsonValue, type LinkSource, type MapDocument, type OperatorRegistry } from "@crosswalkjs/core";
import * as edits from "./edits.js";

/*
 * A map read as recipes, for the phone view: what fills each target field, as
 * a tree of steps from the operator that writes it down to the source fields
 * and typed values it starts from. Edits to a recipe are made with the same
 * functions the canvas uses, so the map stays one map, whichever view drew it.
 */

/** One step of a recipe. An input nothing fills yet is `undefined`. */
export type Step =
  | { kind: "source"; path: string }
  | { kind: "constant"; value: JsonValue }
  | { kind: "node"; id: string; operator: string; scope: string | undefined; inputs: (Step | undefined)[] };

/** Where a step goes: a target field, or one input of an operator. */
export type Slot = { target: string } | { node: string; input: number };

/** The repeating source list a path is in, such as `PhoneCalls[]` for `PhoneCalls[].Cost`; the deepest one if it's in several. */
export function listOf(path: string): string | undefined {
  const end = path.lastIndexOf("[]");
  return end < 0 ? undefined : path.slice(0, end + 2);
}

/** What fills a target field, or `undefined` if nothing does. */
export function recipeOf(map: MapDocument, registry: OperatorRegistry, target: string): Step | undefined {
  const link = map.links.find((l) => "target" in l.to && l.to.target === target);
  return link ? stepFrom(map, registry, link.from, new Set()) : undefined;
}

function stepFrom(map: MapDocument, registry: OperatorRegistry, from: LinkSource, seen: Set<string>): Step | undefined {
  if ("source" in from) return { kind: "source", path: from.source };
  const node = map.nodes.find((n) => n.id === from.node);
  // A map that feeds an operator its own output isn't valid; the step stops there.
  if (!node || seen.has(node.id)) return undefined;
  const inside = new Set(seen).add(node.id);
  const links = map.links.filter((l) => "node" in l.to && l.to.node === node.id);
  const used = [...links.map((l) => ("node" in l.to ? l.to.input : 0)), ...Object.keys(node.constants ?? {}).map(Number)];
  const count = Math.max(registry.get(node.operator)?.inputs.min ?? 0, used.length > 0 ? Math.max(...used) + 1 : 0);
  const inputs = Array.from({ length: count }, (_, input): Step | undefined => {
    const link = links.find((l) => "node" in l.to && l.to.input === input);
    if (link) return stepFrom(map, registry, link.from, inside);
    if (node.constants && Object.hasOwn(node.constants, input)) return { kind: "constant", value: node.constants[input]! };
    return undefined;
  });
  return { kind: "node", id: node.id, operator: node.operator, scope: node.scope, inputs };
}

/** The operators a recipe goes through. */
export function nodesOf(step: Step | undefined, into = new Set<string>()): Set<string> {
  if (step?.kind === "node") {
    into.add(step.id);
    for (const input of step.inputs) nodesOf(input, into);
  }
  return into;
}

/** The source fields a recipe reads, in the order it reads them. */
export function sourcesOf(step: Step | undefined, into: string[] = []): string[] {
  if (step?.kind === "source" && !into.includes(step.path)) into.push(step.path);
  if (step?.kind === "node") for (const input of step.inputs) sourcesOf(input, into);
  return into;
}

/** The target fields each operator ends up in, for saying where else a shared one is used. */
export function targetsByNode(map: MapDocument, registry: OperatorRegistry): Map<string, string[]> {
  const found = new Map<string, string[]>();
  for (const link of map.links) {
    if (!("target" in link.to)) continue;
    for (const id of nodesOf(recipeOf(map, registry, link.to.target))) found.set(id, [...(found.get(id) ?? []), link.to.target]);
  }
  return found;
}

/**
 * The list a step's value repeats over: an operator reading a field inside a
 * list runs once for each item, until a total makes one value of them.
 */
export function repeatOf(map: MapDocument, registry: OperatorRegistry, from: LinkSource, memo = new Map<string, string | undefined>()): string | undefined {
  if ("source" in from) return listOf(from.source);
  if (memo.has(from.node)) return memo.get(from.node);
  memo.set(from.node, undefined);
  const node = map.nodes.find((n) => n.id === from.node);
  let deepest: string | undefined;
  if (node && registry.get(node.operator)?.kind !== "aggregate") {
    for (const link of map.links) {
      if (!("node" in link.to) || link.to.node !== node.id) continue;
      const list = repeatOf(map, registry, link.from, memo);
      if (list && (!deepest || list.length > deepest.length)) deepest = list;
    }
  }
  memo.set(from.node, deepest);
  return deepest;
}

// ---- Each step's value ----

const PROBE = "__cw_step_";

/**
 * The map, with every operator's value also written to an extra output field,
 * so one preview run gives the value at each step. An operator that runs once
 * for each item writes a list, one entry for each item, with "Exists" beside
 * each value so items it leaves out keep their place.
 */
export function probeMap(map: MapDocument, registry: OperatorRegistry): MapDocument {
  const properties = { ...(map.target.properties ?? {}) };
  const links = [...map.links];
  const loops = [...(map.loops ?? [])];
  const nodes = [...map.nodes];
  const memo = new Map<string, string | undefined>();
  const aligned = registry.has("logic.exists");
  for (const node of map.nodes) {
    const key = `${PROBE}${node.id}`;
    const list = repeatOf(map, registry, { node: node.id }, memo);
    if (!list) {
      properties[key] = { type: "string" };
      links.push({ from: { node: node.id }, to: { target: key } });
      continue;
    }
    // A list inside a list would need a loop for each level; those steps go without values.
    if (parsePath(list).filter((segment) => segment.array).length > 1) continue;
    loops.push({ source: list, target: `${key}[]` });
    if (!aligned) {
      properties[key] = { type: "array", items: { type: "string" } };
      links.push({ from: { node: node.id }, to: { target: `${key}[]` } });
      continue;
    }
    const exists = `${PROBE}exists_${node.id}`;
    properties[key] = { type: "array", items: { type: "object", properties: { e: { type: "boolean" }, v: { type: "string" } } } };
    nodes.push({ id: exists, operator: "logic.exists", position: { x: 0, y: 0 } });
    links.push({ from: { node: node.id }, to: { node: exists, input: 0 } });
    links.push({ from: { node: exists }, to: { target: `${key}[].e` } });
    links.push({ from: { node: node.id }, to: { target: `${key}[].v` } });
  }
  return { ...map, target: { ...map.target, type: "object", properties }, nodes, links, loops };
}

/** A step's value for the sample input: one value, or one for each item of the list it repeats over. */
export type StepValue = { value: JsonValue | undefined } | { each: (JsonValue | undefined)[] };

/** Splits a probe run's output into the map's own output and each operator's value. */
export function readProbe(output: JsonValue): { output: JsonValue; steps: Map<string, StepValue> } {
  const steps = new Map<string, StepValue>();
  if (typeof output !== "object" || output === null || Array.isArray(output)) return { output, steps };
  const own: Record<string, JsonValue> = {};
  for (const [key, value] of Object.entries(output)) {
    if (!key.startsWith(PROBE)) {
      own[key] = value;
      continue;
    }
    const id = key.slice(PROBE.length);
    if (!Array.isArray(value)) steps.set(id, { value });
    else steps.set(id, { each: value.map((item) => (item !== null && typeof item === "object" && !Array.isArray(item) && "e" in item ? (item.e === true ? item.v : undefined) : item)) });
  }
  return { output: own, steps };
}

/** The value at a path in some data: one value, or one for each item where the path goes through a list. */
export function valueAt(data: JsonValue | undefined, path: string): StepValue {
  let values: (JsonValue | undefined)[] = [data];
  let fanned = false;
  for (const segment of parsePath(path)) {
    values = values.map((v) => (v !== null && typeof v === "object" && !Array.isArray(v) ? v[segment.key] : undefined));
    if (!segment.array) continue;
    fanned = true;
    values = values.flatMap((v) => (Array.isArray(v) ? v : []));
  }
  return fanned ? { each: values } : { value: values[0] };
}

// ---- Typed values ----

/** Shows a constant as typed: plain text for strings, JSON for anything else. */
export function formatConstant(value: JsonValue): string {
  if (typeof value !== "string") return JSON.stringify(value);
  // Quote a string whose edges are spaces, such as " ", so it doesn't look empty.
  if (value === "" || value.trim() !== value) return JSON.stringify(value);
  try {
    // A string such as "4" would read back as a number, so it keeps its quotes.
    return typeof JSON.parse(value) === "string" ? value : JSON.stringify(value);
  } catch {
    return value;
  }
}

/** Reads a typed constant: numbers, booleans, null and quoted strings as JSON, anything else as text. */
export function parseConstant(text: string): JsonValue {
  try {
    const value = JSON.parse(text) as JsonValue;
    return typeof value === "object" && value !== null ? text : value;
  } catch {
    return text;
  }
}

// ---- Edits ----

/** What's in a slot now: a link, a typed value, or nothing. */
function contentOf(map: MapDocument, slot: Slot): { from: LinkSource } | { constant: JsonValue } | undefined {
  if ("target" in slot) {
    const link = map.links.find((l) => "target" in l.to && l.to.target === slot.target);
    return link ? { from: link.from } : undefined;
  }
  const link = map.links.find((l) => "node" in l.to && l.to.node === slot.node && l.to.input === slot.input);
  if (link) return { from: link.from };
  const node = map.nodes.find((n) => n.id === slot.node);
  return node?.constants && Object.hasOwn(node.constants, slot.input) ? { constant: node.constants[slot.input]! } : undefined;
}

/** The operators a slot's content goes through, which may be left feeding nothing once it's replaced. */
function nodesIn(map: MapDocument, registry: OperatorRegistry, slot: Slot): Set<string> {
  const content = contentOf(map, slot);
  return content && "from" in content ? nodesOf(stepFrom(map, registry, content.from, new Set())) : new Set();
}

/** Removes any of `candidates` that no longer feed anything, and then any they fed alone. */
function prune(map: MapDocument, candidates: Set<string>): MapDocument {
  let next = map;
  for (let removed = true; removed; ) {
    removed = false;
    for (const id of candidates) {
      if (!next.nodes.some((n) => n.id === id) || next.links.some((l) => "node" in l.from && l.from.node === id)) continue;
      next = edits.removeNode(next, id);
      removed = true;
    }
  }
  return next;
}

/** Fills a slot with a source field or an operator's value. Undefined if that would make operators feed each other. */
export function fill(map: MapDocument, registry: OperatorRegistry, slot: Slot, from: LinkSource): MapDocument | undefined {
  const old = nodesIn(map, registry, slot);
  let next: MapDocument | undefined;
  if ("target" in slot) {
    next = structuredClone(map);
    next.links = next.links.filter((l) => !("target" in l.to && l.to.target === slot.target));
    next.links.push({ from, to: { target: slot.target } });
  } else {
    next = edits.setInputLink(map, slot.node, slot.input, from);
    if (!next) return undefined;
    // A total over a list takes its list from the first field inside it it's given.
    const node = next.nodes.find((n) => n.id === slot.node);
    const list = "source" in from ? listOf(from.source) : undefined;
    if (node && !node.scope && list && registry.get(node.operator)?.kind === "aggregate") next = edits.setScope(next, node.id, list);
  }
  if ("node" in from) old.delete(from.node);
  return prune(next, old);
}

/** Puts a typed value on an operator's input. */
export function type(map: MapDocument, registry: OperatorRegistry, slot: { node: string; input: number }, value: JsonValue): MapDocument {
  const old = nodesIn(map, registry, slot);
  return prune(edits.setConstant(map, slot.node, slot.input, value), old);
}

/**
 * Empties a slot. An operator that takes any number of inputs loses the input
 * altogether, and the ones after it move up; one with a fixed set keeps an
 * empty input to fill.
 */
export function clear(map: MapDocument, registry: OperatorRegistry, slot: Slot): MapDocument {
  if ("target" in slot) return unmap(map, registry, slot.target);
  const old = nodesIn(map, registry, slot);
  const node = map.nodes.find((n) => n.id === slot.node);
  const definition = node && registry.get(node.operator);
  let next: MapDocument;
  if (definition && definition.inputs.max === undefined && slot.input >= (definition.inputs.min ?? 0)) next = edits.removeInput(map, slot.node, slot.input);
  else {
    next = structuredClone(map);
    next.links = next.links.filter((l) => !("node" in l.to && l.to.node === slot.node && l.to.input === slot.input));
    const kept = next.nodes.find((n) => n.id === slot.node);
    if (kept?.constants && Object.hasOwn(kept.constants, slot.input)) {
      const { [slot.input]: _removed, ...rest } = kept.constants;
      if (Object.keys(rest).length > 0) kept.constants = rest;
      else delete kept.constants;
    }
  }
  return prune(next, old);
}

/** Stops mapping a target field, removing the operators that only it used. */
export function unmap(map: MapDocument, registry: OperatorRegistry, target: string): MapDocument {
  const old = nodesIn(map, registry, { target });
  const next = structuredClone(map);
  next.links = next.links.filter((l) => !("target" in l.to && l.to.target === target));
  return prune(next, old);
}

/** Where a new operator goes on the canvas: just before the operator it feeds, or below the rest. */
function placeFor(map: MapDocument, slot: Slot): edits.Position {
  if ("node" in slot) {
    const feeds = map.nodes.find((n) => n.id === slot.node);
    if (feeds?.position) return { x: Math.max(0, feeds.position.x - 90), y: feeds.position.y + slot.input * 50 };
  }
  const positions = map.nodes.map((n) => n.position).filter((p): p is edits.Position => p !== undefined);
  return positions.length === 0 ? { x: 240, y: 40 } : { x: Math.max(...positions.map((p) => p.x)), y: Math.max(...positions.map((p) => p.y)) + 80 };
}

/**
 * Puts an operator in a slot. `as` says what happens to what's there:
 * `replace` swaps an operator for another, keeping its inputs where they fit;
 * `wrap` makes it the new operator's first input; `fresh` leaves it out.
 */
export function place(
  map: MapDocument,
  registry: OperatorRegistry,
  slot: Slot,
  operator: string,
  as: "fresh" | "wrap" | "replace",
): MapDocument | undefined {
  const content = contentOf(map, slot);
  const added = edits.addNode(map, operator, placeFor(map, slot));
  let next = added.document;
  const id = added.id;
  const definition = registry.get(operator);
  if (as === "wrap" && content) {
    next = "from" in content ? (edits.setInputLink(next, id, 0, content.from) ?? next) : edits.setConstant(next, id, 0, content.constant);
    // A total round something that runs for each item adds those items up.
    if (definition?.kind === "aggregate" && "from" in content) {
      const list = repeatOf(map, registry, content.from);
      if (list) next = edits.setScope(next, id, list);
    }
  }
  if (as === "replace" && content && "from" in content && "node" in content.from) {
    const old = content.from.node;
    const max = definition?.inputs.max ?? Infinity;
    const node = next.nodes.find((n) => n.id === old);
    for (const link of next.links.filter((l) => "node" in l.to && l.to.node === old && l.to.input < max)) {
      next = edits.setInputLink(next, id, "node" in link.to ? link.to.input : 0, link.from) ?? next;
    }
    for (const [key, value] of Object.entries(node?.constants ?? {})) if (Number(key) < max) next = edits.setConstant(next, id, Number(key), value);
    if (definition?.kind === "aggregate" && node?.scope) next = edits.setScope(next, id, node.scope);
    // Everything the old operator fed, the new one feeds instead.
    next = structuredClone(next);
    for (const link of next.links) if ("node" in link.from && link.from.node === old) link.from = { node: id };
    return edits.removeNode(next, old);
  }
  if ("target" in slot) {
    const linked = structuredClone(next);
    linked.links = linked.links.filter((l) => !("target" in l.to && l.to.target === slot.target));
    linked.links.push({ from: { node: id }, to: { target: slot.target } });
    return as === "wrap" ? linked : prune(linked, nodesIn(next, registry, slot));
  }
  const linked = edits.setInputLink(next, slot.node, slot.input, { node: id });
  if (!linked) return undefined;
  return as === "wrap" ? linked : prune(linked, nodesIn(next, registry, slot));
}
