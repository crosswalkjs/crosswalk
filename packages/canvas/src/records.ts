import { listFields, isValueSchema, type LinkSource, type MapDocument, type Schema } from "@crosswalkjs/core";
import { recordSchema } from "./edits.js";

type Map = Pick<MapDocument, "source" | "target" | "nodes" | "links" | "submaps">;
type Link = MapDocument["links"][number];

/** One field reaching another inside a record link. */
export interface FieldMapping {
  source: string;
  target: string;
  /** True when operators sit between the two. */
  through: boolean;
}

/** The source fields a value comes from, through any operators, including what aggregates run over. */
export function sourcesOf(map: Pick<Map, "nodes" | "links">, from: LinkSource, seen = new Set<string>()): string[] {
  if ("source" in from) return [from.source];
  if (seen.has(from.node)) return [];
  seen.add(from.node);
  const scope = map.nodes.find((n) => n.id === from.node)?.scope;
  const inputs = map.links.filter((l) => "node" in l.to && l.to.node === from.node).flatMap((l) => sourcesOf(map, l.from, seen));
  return [...new Set([...inputs, ...(scope && !inputs.some((i) => i.startsWith(scope)) ? [scope] : [])])];
}

/** The source and target records a link joins, when it joins records rather than values. */
export function recordEnds(map: Pick<Map, "source" | "target">, link: Link): { from: string; to: string } | undefined {
  if (!("source" in link.from) || !("target" in link.to)) return undefined;
  const { source: from } = link.from;
  const { target: to } = link.to;
  return recordSchema(map.source, from) && recordSchema(map.target, to) ? { from, to } : undefined;
}

const join = (prefix: string, path: string) => `${prefix}.${path}`;

const valuePaths = (schema: Schema) => new Set(listFields(schema).filter((f) => isValueSchema(f.schema)).map((f) => f.path));

/**
 * The fields a record link maps, in the map's own paths: through its sub-map
 * and any sub-maps inside that, or, for a copy, between fields of the same
 * name. A sub-map that uses itself is followed once. Only fields both records
 * have are included.
 */
export function recordMappings(map: Map, link: Link): FieldMapping[] {
  const ends = recordEnds(map, link);
  if (!ends) return [];
  const mappings: FieldMapping[] = [];
  const walk = (submap: string | undefined, from: string, to: string, fromRecord: Schema, toRecord: Schema, seen: Set<string>) => {
    if (submap === undefined) {
      const targets = valuePaths(toRecord);
      for (const path of valuePaths(fromRecord)) {
        if (targets.has(path)) mappings.push({ source: join(from, path), target: join(to, path), through: false });
      }
      return;
    }
    const inner = map.submaps?.[submap];
    if (!inner || seen.has(submap)) return;
    const visited = new Set([...seen, submap]);
    for (const innerLink of inner.links) {
      if (!("target" in innerLink.to)) continue;
      const record = recordEnds(inner, innerLink);
      if (record) {
        walk(innerLink.submap, join(from, record.from), join(to, record.to), recordSchema(inner.source, record.from)!, recordSchema(inner.target, record.to)!, visited);
        continue;
      }
      for (const source of sourcesOf(inner, innerLink.from)) {
        mappings.push({ source: join(from, source), target: join(to, innerLink.to.target), through: "node" in innerLink.from });
      }
    }
  };
  walk(link.submap, ends.from, ends.to, recordSchema(map.source, ends.from)!, recordSchema(map.target, ends.to)!, new Set());
  // A sub-map that doesn't fit its records can name fields they don't have; those are left out.
  const sources = valuePaths(map.source);
  const targets = valuePaths(map.target);
  return mappings.filter((mapping) => sources.has(mapping.source) && targets.has(mapping.target));
}
