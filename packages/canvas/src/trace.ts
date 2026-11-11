import type { MapDocument } from "@crosswalkjs/core";

/** Everything a traced field or operator is part of: the operators, and the source and target fields, of its chain. */
export interface Chain {
  nodes: Set<string>;
  sources: Set<string>;
  targets: Set<string>;
}

export type TraceFrom = { kind: "source" | "target"; path: string } | { kind: "node"; id: string };

/** True when `outer` is `path` or a record it's inside. */
const holds = (outer: string, path: string) => outer === path || path.startsWith(`${outer}.`);

/**
 * The chain through a field or an operator. For a target field: every
 * operator and source field its value is made from, through any record link
 * or loop it's inside. For a source field: every operator and target field
 * it ends up in. For an operator: both, through it.
 */
export function traceChain(map: MapDocument, from: TraceFrom): Chain {
  const chain: Chain = { nodes: new Set(), sources: new Set(), targets: new Set() };
  const upstream = (id: string) => {
    if (chain.nodes.has(id)) return;
    chain.nodes.add(id);
    const scope = map.nodes.find((n) => n.id === id)?.scope;
    if (scope) chain.sources.add(scope);
    for (const link of map.links) {
      if (!("node" in link.to) || link.to.node !== id) continue;
      if ("source" in link.from) chain.sources.add(link.from.source);
      else upstream(link.from.node);
    }
  };
  const downstream = (id: string) => {
    for (const link of map.links) {
      if (!("node" in link.from) || link.from.node !== id) continue;
      if ("target" in link.to) chain.targets.add(link.to.target);
      else if (!chain.nodes.has(link.to.node)) {
        chain.nodes.add(link.to.node);
        downstream(link.to.node);
      }
    }
  };

  if (from.kind === "node") {
    upstream(from.id);
    downstream(from.id);
    return chain;
  }

  if (from.kind === "target") {
    chain.targets.add(from.path);
    for (const link of map.links) {
      // Its own line, or the record link that fills the record it's in.
      if (!("target" in link.to) || !holds(link.to.target, from.path)) continue;
      chain.targets.add(link.to.target);
      if ("source" in link.from) chain.sources.add(link.from.source);
      else upstream(link.from.node);
    }
    for (const loop of map.loops ?? []) {
      if (!holds(loop.target, from.path)) continue;
      chain.targets.add(loop.target);
      chain.sources.add(loop.source);
    }
    return chain;
  }

  chain.sources.add(from.path);
  for (const link of map.links) {
    // Its own lines, and record links that copy the record it's in.
    if (!("source" in link.from) || !holds(link.from.source, from.path)) continue;
    chain.sources.add(link.from.source);
    if ("target" in link.to) chain.targets.add(link.to.target);
    else if (!chain.nodes.has(link.to.node)) {
      chain.nodes.add(link.to.node);
      downstream(link.to.node);
    }
  }
  for (const loop of map.loops ?? []) {
    if (!holds(loop.source, from.path)) continue;
    chain.sources.add(loop.source);
    chain.targets.add(loop.target);
  }
  // An aggregate over it.
  for (const node of map.nodes) {
    if (node.scope !== from.path || chain.nodes.has(node.id)) continue;
    chain.nodes.add(node.id);
    downstream(node.id);
  }
  return chain;
}

/** A path and every record it's inside. */
const withRecords = (paths: Iterable<string>) => {
  const all = new Set<string>();
  for (const path of paths) {
    all.add(path);
    for (const match of path.matchAll(/\./g)) all.add(path.slice(0, match.index));
  }
  return all;
};

/**
 * The chain from many fields of one side at once, in one pass over the links:
 * forward from source fields, or back from target fields. For narrowing the
 * lines to a search, where traceChain once per match would be slow.
 */
export function traceFields(map: MapDocument, side: "source" | "target", paths: Iterable<string>): Chain {
  const fields = new Set(paths);
  const chain: Chain = { nodes: new Set(), sources: new Set(), targets: new Set() };
  // A field's own lines, and record links and loops that carry the record it's in.
  const reached = withRecords(fields);
  const next = new Map<string, string[]>();
  const queue: string[] = [];
  const visit = (id: string) => {
    if (chain.nodes.has(id)) return;
    chain.nodes.add(id);
    queue.push(id);
  };
  if (side === "source") {
    for (const path of fields) chain.sources.add(path);
    for (const link of map.links) {
      if ("node" in link.from) next.set(link.from.node, [...(next.get(link.from.node) ?? []), "node" in link.to ? link.to.node : `\n${link.to.target}`]);
      else if (reached.has(link.from.source)) {
        chain.sources.add(link.from.source);
        if ("target" in link.to) chain.targets.add(link.to.target);
        else visit(link.to.node);
      }
    }
    for (const loop of map.loops ?? []) {
      if (!reached.has(loop.source)) continue;
      chain.sources.add(loop.source);
      chain.targets.add(loop.target);
    }
    for (const node of map.nodes) if (node.scope && fields.has(node.scope)) visit(node.id);
  } else {
    for (const path of fields) chain.targets.add(path);
    for (const link of map.links) {
      if ("node" in link.to) next.set(link.to.node, [...(next.get(link.to.node) ?? []), "node" in link.from ? link.from.node : `\n${link.from.source}`]);
      else if (reached.has(link.to.target)) {
        chain.targets.add(link.to.target);
        if ("source" in link.from) chain.sources.add(link.from.source);
        else visit(link.from.node);
      }
    }
    for (const loop of map.loops ?? []) {
      if (!reached.has(loop.target)) continue;
      chain.sources.add(loop.source);
      chain.targets.add(loop.target);
    }
  }
  // Out along the operators, collecting the fields at the far end; a leading newline marks a field.
  const scopes = new Map(map.nodes.flatMap((n) => (n.scope ? [[n.id, n.scope] as const] : [])));
  while (queue.length > 0) {
    const id = queue.pop()!;
    if (side === "target" && scopes.has(id)) chain.sources.add(scopes.get(id)!);
    for (const step of next.get(id) ?? []) {
      if (!step.startsWith("\n")) visit(step);
      else (side === "source" ? chain.targets : chain.sources).add(step.slice(1));
    }
  }
  return chain;
}
