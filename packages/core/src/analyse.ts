import type { OperatorRegistry } from "./operators/registry.js";
import type { OperatorDefinition } from "./operators/types.js";
import { arrayScopes, childPath, isValueSchema, listFields, resolveSchema, schemaAt, unresolvedRefs } from "./paths.js";
import type { OperatorNode, JsonValue, LinkSource, Loop, MapDocument, Schema, SubMap } from "./types.js";

export type IssueCode =
  | "unsupported-version"
  | "root-not-object"
  | "duplicate-node"
  | "unknown-operator"
  | "unknown-node"
  | "unknown-source"
  | "unknown-target"
  | "not-a-value"
  | "duplicate-link"
  | "bad-input-index"
  | "constant-and-link"
  | "missing-input"
  | "input-count"
  | "cycle"
  | "scope-required"
  | "unknown-scope"
  | "unexpected-scope"
  | "scope-not-used"
  | "loop-source"
  | "loop-target"
  | "duplicate-loop"
  | "bad-loop-key"
  | "missing-loop"
  | "unbound-scope"
  | "unused-node"
  | "record-mismatch"
  | "conflicting-link"
  | "unknown-submap"
  | "submap-cycle"
  | "submap-mismatch"
  | "copy-mismatch"
  | "unknown-ref"
  | "required-unmapped";

export interface MapIssue {
  severity: "error" | "warning";
  code: IssueCode;
  message: string;
  /** The node the issue is about, when there is one. */
  node?: string;
  /** The index of the link the issue is about, when there is one. */
  link?: number;
  /** The field path the issue is about, when there is one. */
  path?: string;
  /** The sub-map the issue is in, when it's in one. */
  submap?: string;
}

/** A link that fills a target record from a source record, whole or through a sub-map. */
export interface RecordLink {
  from: string;
  submap?: string;
}

/** A node with its operator and inputs resolved. */
export interface PlannedNode {
  node: OperatorNode;
  definition: OperatorDefinition;
  inputs: Map<number, LinkSource>;
  constants: Map<number, JsonValue>;
  inputCount: number;
}

/** Everything the evaluator needs, looked up ahead of time. */
export interface MapPlan {
  document: MapDocument;
  nodes: Map<string, PlannedNode>;
  /** The incoming link of each mapped target field, by path. */
  targetLinks: Map<string, LinkSource>;
  loopsByTarget: Map<string, Loop>;
  /** The record link filling each target record, by path. */
  recordLinks: Map<string, RecordLink>;
  /** Plans for the document's sub-maps, by name, shared by the map and its sub-maps. */
  submaps: Map<string, MapPlan>;
}

export interface Analysis {
  issues: MapIssue[];
  plan: MapPlan;
}

/** Checks a map against its schemas and operators, and plans its evaluation. */
export function analyseMap(document: MapDocument, registry: OperatorRegistry): Analysis {
  return analyse(document, registry, { submaps: document.submaps ?? {}, plans: new Map(), reported: new Set(), stack: [] });
}

interface SubMapContext {
  /** The document's sub-maps, which every sub-map can use. */
  submaps: Record<string, SubMap>;
  plans: Map<string, MapPlan>;
  /** Sub-maps whose own issues have been reported, so each is reported once. */
  reported: Set<string>;
  /** The sub-maps being analysed, outermost first, to catch one that uses itself. */
  stack: string[];
}

/** The source and target paths a map reads and writes, to check a sub-map fits its records. */
function pathsUsed(map: Omit<SubMap, "title">): { reads: string[]; writes: string[] } {
  const reads: string[] = [];
  const writes: string[] = [];
  for (const link of map.links) {
    if ("source" in link.from) reads.push(link.from.source);
    if ("target" in link.to) writes.push(link.to.target);
  }
  for (const loop of map.loops ?? []) {
    reads.push(loop.source, ...(loop.sortBy ?? []).map((key) => key.path), ...(loop.groupBy !== undefined ? [loop.groupBy] : []));
    writes.push(loop.target);
  }
  for (const node of map.nodes) if (node.scope !== undefined) reads.push(node.scope);
  return { reads, writes };
}

/**
 * The fields of record `from` that record `to` has no place for, outermost
 * first. A record that declares no fields takes any.
 */
function missingFields(from: Schema, to: Schema, prefix = ""): string[] {
  if (to.properties === undefined || Object.keys(to.properties).length === 0) return [];
  const missing: string[] = [];
  for (const [name, child] of Object.entries(from.properties ?? {})) {
    const other = Object.hasOwn(to.properties, name) ? to.properties[name] : undefined;
    const path = `${prefix}${name}`;
    if (!other) {
      missing.push(path);
      continue;
    }
    const a = child.type === "array" ? child.items : child;
    const b = other.type === "array" ? other.items : other;
    if (child.type === other.type && a?.type === "object" && b?.type === "object") {
      missing.push(...missingFields(a, b, `${path}${child.type === "array" ? "[]" : ""}.`));
    }
  }
  return missing;
}

function analyse(document: MapDocument, registry: OperatorRegistry, context: SubMapContext): Analysis {
  const issues: MapIssue[] = [];
  const error = (code: IssueCode, message: string, about: Partial<MapIssue> = {}) =>
    issues.push({ severity: "error", code, message, ...about });
  const warn = (code: IssueCode, message: string, about: Partial<MapIssue> = {}) =>
    issues.push({ severity: "warning", code, message, ...about });

  const nodes = new Map<string, PlannedNode>();
  const targetLinks = new Map<string, LinkSource>();
  const loopsByTarget = new Map<string, Loop>();
  const recordLinks = new Map<string, RecordLink>();
  const recordLinkIndex = new Map<string, number>();
  const plan: MapPlan = { document, nodes, targetLinks, loopsByTarget, recordLinks, submaps: context.plans };

  if (document.version !== 1) error("unsupported-version", `Map version ${String(document.version)} isn't supported`);
  if (resolveSchema(document.source).type !== "object") error("root-not-object", "The source schema's root must be an object");
  if (resolveSchema(document.target).type !== "object") error("root-not-object", "The target schema's root must be an object");
  for (const [side, schema] of [["source", document.source], ["target", document.target]] as const) {
    for (const ref of unresolvedRefs(schema)) error("unknown-ref", `The ${side} schema refers to "${ref}", which it doesn't define`);
  }

  // Nodes declared in the map, including ones with an unknown operator, so a
  // link to one of those doesn't get reported a second time.
  const declared = new Set<string>();
  for (const node of document.nodes) {
    if (declared.has(node.id)) {
      error("duplicate-node", `More than one node has the id "${node.id}"`, { node: node.id });
      continue;
    }
    declared.add(node.id);
    const definition = registry.get(node.operator);
    if (!definition) {
      error("unknown-operator", `Node "${node.id}" uses "${node.operator}", which isn't a registered operator`, { node: node.id });
      continue;
    }
    const constants = new Map<number, JsonValue>();
    for (const [key, value] of Object.entries(node.constants ?? {})) {
      const index = Number(key);
      if (Number.isInteger(index) && index >= 0) constants.set(index, value);
      else error("bad-input-index", `Node "${node.id}" has a constant for "${key}", which isn't an input index`, { node: node.id });
    }
    nodes.set(node.id, { node, definition, inputs: new Map(), constants, inputCount: 0 });
  }

  document.links.forEach((link, index) => {
    const about = { link: index };
    // A link with a record at either end, or a sub-map, joins two records.
    if ("source" in link.from && "target" in link.to) {
      const from = link.from.source;
      const to = link.to.target;
      const fromSchema = schemaAt(document.source, from);
      const toSchema = schemaAt(document.target, to);
      if (fromSchema && toSchema && (!isValueSchema(fromSchema) || !isValueSchema(toSchema) || link.submap !== undefined)) {
        if (fromSchema.type !== "object" || toSchema.type !== "object") {
          return error("record-mismatch", `Link ${index} joins "${from}" and "${to}", but a record link needs a record at both ends`, { ...about, path: to });
        }
        if (recordLinks.has(to) || targetLinks.has(to)) return error("duplicate-link", `"${to}" has more than one incoming link`, { ...about, path: to });
        recordLinks.set(to, { from, ...(link.submap !== undefined ? { submap: link.submap } : {}) });
        recordLinkIndex.set(to, index);
        return;
      }
    }
    if ("source" in link.from) {
      const path = link.from.source;
      const schema = schemaAt(document.source, path);
      if (!schema) return error("unknown-source", `Link ${index} reads "${path}", which isn't in the source schema`, { ...about, path });
      if (!isValueSchema(schema)) return error("not-a-value", `Link ${index} reads "${path}", which is a ${schema.type}, not a value`, { ...about, path });
    } else if (!nodes.has(link.from.node)) {
      if (!declared.has(link.from.node)) error("unknown-node", `Link ${index} comes from node "${link.from.node}", which doesn't exist`, about);
      return;
    }

    if ("target" in link.to) {
      const path = link.to.target;
      const schema = schemaAt(document.target, path);
      if (!schema) return error("unknown-target", `Link ${index} writes "${path}", which isn't in the target schema`, { ...about, path });
      if (!isValueSchema(schema)) return error("not-a-value", `Link ${index} writes "${path}", which is a ${schema.type}, not a value`, { ...about, path });
      if (targetLinks.has(path) || recordLinks.has(path)) return error("duplicate-link", `"${path}" has more than one incoming link`, { ...about, path });
      targetLinks.set(path, link.from);
      return;
    }

    const planned = nodes.get(link.to.node);
    if (!planned) {
      if (!declared.has(link.to.node)) error("unknown-node", `Link ${index} goes to node "${link.to.node}", which doesn't exist`, about);
      return;
    }
    const input = link.to.input;
    if (!Number.isInteger(input) || input < 0) {
      return error("bad-input-index", `Link ${index} goes to input ${String(input)} of "${link.to.node}", which isn't an input index`, { ...about, node: link.to.node });
    }
    if (planned.inputs.has(input)) {
      return error("duplicate-link", `Input ${input} of "${link.to.node}" has more than one incoming link`, { ...about, node: link.to.node });
    }
    planned.inputs.set(input, link.from);
  });

  for (const planned of nodes.values()) {
    const { node, definition } = planned;
    for (const index of planned.constants.keys()) {
      if (planned.inputs.has(index)) {
        error("constant-and-link", `Input ${index} of "${node.id}" has both a constant and a link`, { node: node.id });
      }
    }
    const indices = [...planned.inputs.keys(), ...planned.constants.keys()];
    planned.inputCount = indices.length === 0 ? 0 : Math.max(...indices) + 1;
    for (let index = 0; index < planned.inputCount; index++) {
      if (!planned.inputs.has(index) && !planned.constants.has(index)) {
        error("missing-input", `Input ${index} of "${node.id}" has no link or constant`, { node: node.id });
      }
    }
    const { min, max } = definition.inputs;
    if (planned.inputCount < min || (max !== undefined && planned.inputCount > max)) {
      const expected = max === undefined ? `at least ${min}` : min === max ? `${min}` : `${min} to ${max}`;
      error("input-count", `"${node.id}" (${definition.label}) takes ${expected} input${min === 1 && (max === undefined || max === 1) ? "" : "s"} but has ${planned.inputCount}`, { node: node.id });
    }

    if (definition.kind === "aggregate") {
      if (node.scope === undefined) {
        error("scope-required", `"${node.id}" (${definition.label}) needs a scope: the source array it aggregates over`, { node: node.id });
      } else if (!node.scope.endsWith("[]") || !schemaAt(document.source, node.scope)) {
        error("unknown-scope", `"${node.id}" aggregates over "${node.scope}", which isn't an array in the source schema`, { node: node.id });
      }
    } else if (node.scope !== undefined) {
      error("unexpected-scope", `"${node.id}" (${definition.label}) isn't an aggregate, so it can't have a scope`, { node: node.id });
    }
  }

  // Scope checks walk node inputs recursively, so they only run on an acyclic graph.
  const done = new Set<string>();
  const stack: string[] = [];
  let cyclic = false;
  const visit = (id: string) => {
    const open = stack.indexOf(id);
    if (open >= 0) {
      const members = [...stack.slice(open), id];
      error("cycle", `${members.map((m) => `"${m}"`).join(" → ")} form a cycle`, { node: id });
      cyclic = true;
      return;
    }
    if (done.has(id)) return;
    stack.push(id);
    for (const from of nodes.get(id)?.inputs.values() ?? []) {
      if ("node" in from && nodes.has(from.node)) visit(from.node);
    }
    stack.pop();
    done.add(id);
  };
  for (const id of nodes.keys()) visit(id);
  if (cyclic) return { issues, plan };

  for (const loop of document.loops ?? []) {
    if (!loop.source.endsWith("[]") || !schemaAt(document.source, loop.source)) {
      error("loop-source", `A loop reads "${loop.source}", which isn't an array in the source schema`, { path: loop.source });
    } else if (!loop.target.endsWith("[]") || !schemaAt(document.target, loop.target)) {
      error("loop-target", `A loop writes "${loop.target}", which isn't an array in the target schema`, { path: loop.target });
    } else if (loopsByTarget.has(loop.target)) {
      error("duplicate-loop", `"${loop.target}" has more than one loop`, { path: loop.target });
    } else {
      loopsByTarget.set(loop.target, loop);
      // Sort and group keys are fields of the item being looped over, not of an array inside it.
      const keys = [...(loop.sortBy ?? []).map((key) => key.path), ...(loop.groupBy !== undefined ? [loop.groupBy] : [])];
      for (const key of keys) {
        const schema = schemaAt(document.source, key);
        const ownScopes = arrayScopes(key);
        const inside = key.startsWith(`${loop.source}.`) && ownScopes.length === arrayScopes(loop.source).length;
        if (!schema || !isValueSchema(schema) || !inside) {
          error("bad-loop-key", `The loop over "${loop.source}" sorts or groups by "${key}", which isn't a field of its items`, { path: key });
        }
      }
    }
  }

  // The source arrays that have a current item at a target path, one per enclosing target loop.
  const missingLoops = new Set<string>();
  const boundScopes = (targetScopes: string[]): Set<string> => {
    const bound = new Set<string>();
    for (const scope of targetScopes) {
      const loop = loopsByTarget.get(scope);
      if (loop) bound.add(loop.source);
      else missingLoops.add(scope);
    }
    return bound;
  };

  for (const loop of loopsByTarget.values()) {
    const bound = boundScopes(arrayScopes(loop.target).slice(0, -1));
    for (const scope of arrayScopes(loop.source).slice(0, -1)) {
      if (!bound.has(scope)) {
        error("unbound-scope", `The loop over "${loop.source}" is inside "${scope}", which no enclosing loop repeats over`, { path: loop.target });
      }
    }
  }

  // The source arrays a value reads from that need a current item.
  const required = new Map<string, Set<string>>();
  const requiredScopes = (from: LinkSource): Set<string> => {
    if ("source" in from) return new Set(arrayScopes(from.source));
    const cached = required.get(from.node);
    if (cached) return cached;
    const scopes = new Set<string>();
    const planned = nodes.get(from.node);
    if (planned) {
      for (const input of planned.inputs.values()) {
        for (const scope of requiredScopes(input)) scopes.add(scope);
      }
      const scope = planned.node.scope;
      if (planned.definition.kind === "aggregate" && scope !== undefined) {
        if (!scopes.has(scope)) {
          warn("scope-not-used", `"${from.node}" aggregates over "${scope}", but its input doesn't come from inside it`, { node: from.node });
        }
        // The node supplies the current item of its scope itself, but the
        // arrays its scope sits inside still need one.
        scopes.delete(scope);
        for (const outer of arrayScopes(scope).slice(0, -1)) scopes.add(outer);
      }
    }
    required.set(from.node, scopes);
    return scopes;
  };

  for (const [path, from] of targetLinks) {
    const bound = boundScopes(arrayScopes(path));
    for (const scope of requiredScopes(from)) {
      if (!bound.has(scope)) {
        error(
          "unbound-scope",
          `"${path}" reads from inside "${scope}", which repeats. Loop over it, or aggregate it with an aggregate operator.`,
          { path },
        );
      }
    }
  }
  for (const [to, { from, submap }] of recordLinks) {
    const link = recordLinkIndex.get(to)!;
    // A record link fills its target whole, so nothing else may write inside it.
    const inside = [...targetLinks.keys(), ...recordLinks.keys(), ...loopsByTarget.keys()].filter((path) => path.startsWith(`${to}.`));
    for (const path of inside) {
      error("conflicting-link", `"${path}" is inside "${to}", which a record link fills whole`, { path });
    }
    const bound = boundScopes(arrayScopes(to));
    for (const scope of arrayScopes(from)) {
      if (!bound.has(scope)) {
        error("unbound-scope", `"${to}" reads from inside "${scope}", which repeats. Loop over it first.`, { path: to, link });
      }
    }
    if (submap === undefined) {
      const missing = missingFields(schemaAt(document.source, from)!, schemaAt(document.target, to)!);
      if (missing.length > 0) {
        const names = missing.map((path) => `"${path}"`).join(", ");
        warn("copy-mismatch", `Link ${link} copies "${from}" as it is, but "${to}" has no ${names}. A sub-map can rename them.`, { path: to, link });
      }
      continue;
    }

    const definition = context.submaps[submap];
    if (!definition) {
      error("unknown-submap", `Link ${link} maps "${from}" with sub-map "${submap}", which the map doesn't have`, { path: to, link });
      continue;
    }
    if (context.stack.includes(submap)) {
      error("submap-cycle", `Sub-map "${submap}" uses itself, through ${[...context.stack, submap].map((name) => `"${name}"`).join(" → ")}`, { path: to, link });
      continue;
    }
    if (!context.plans.has(submap)) {
      const nested = analyse({ version: 1, ...definition }, registry, { ...context, stack: [...context.stack, submap] });
      context.plans.set(submap, nested.plan);
      if (!context.reported.has(submap)) {
        context.reported.add(submap);
        for (const issue of nested.issues) {
          issues.push({ ...issue, message: `In sub-map "${submap}": ${issue.message}`, submap: issue.submap ?? submap });
        }
      }
    }
    // The sub-map must fit the records it joins.
    const fromSchema = schemaAt(document.source, from)!;
    const toSchema = schemaAt(document.target, to)!;
    const { reads, writes } = pathsUsed(definition);
    for (const path of new Set(reads)) {
      if (!schemaAt(fromSchema, path)) error("submap-mismatch", `Sub-map "${submap}" reads "${path}", which "${from}" doesn't have`, { path: to, link });
    }
    for (const path of new Set(writes)) {
      if (!schemaAt(toSchema, path)) error("submap-mismatch", `Sub-map "${submap}" writes "${path}", which "${to}" doesn't have`, { path: to, link });
    }
  }

  // A required target field needs something mapped to it, wherever its record is being filled.
  const written = [...targetLinks.keys(), ...recordLinks.keys(), ...loopsByTarget.keys()];
  const fills = (path: string) => written.some((w) => w === path || w.startsWith(`${path}.`) || w.startsWith(`${path}[]`));
  const insideRecordLink = (path: string) => [...recordLinks.keys()].some((r) => path === r || path.startsWith(`${r}.`));
  const records: { path: string; schema: Schema }[] = [
    { path: "", schema: resolveSchema(document.target) },
    ...listFields(document.target).filter((f) => f.schema.type === "object").map((f) => ({ path: f.path, schema: f.schema })),
  ];
  for (const record of records) {
    if ((record.path !== "" && !fills(record.path)) || insideRecordLink(record.path)) continue;
    for (const key of record.schema.required ?? []) {
      const child = record.schema.properties?.[key];
      if (!child || !Object.hasOwn(record.schema.properties!, key)) continue;
      const path = childPath(record.path, key, child);
      if (!fills(path)) warn("required-unmapped", `"${path}" is required by the target schema, but nothing maps to it`, { path });
    }
  }

  for (const scope of missingLoops) {
    error("missing-loop", `"${scope}" has mapped fields, but no loop says which source array it repeats over`, { path: scope });
  }

  const used = new Set<string>();
  const markUsed = (from: LinkSource) => {
    if (!("node" in from) || used.has(from.node)) return;
    used.add(from.node);
    for (const input of nodes.get(from.node)?.inputs.values() ?? []) markUsed(input);
  };
  for (const from of targetLinks.values()) markUsed(from);
  for (const id of nodes.keys()) {
    if (!used.has(id)) warn("unused-node", `"${id}" doesn't feed any target field`, { node: id });
  }

  return { issues, plan };
}
