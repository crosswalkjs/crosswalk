import { builtinOperators } from "./builtins.js";
import { OperatorRegistry } from "./registry.js";
import { defineCategory, OperatorError, type OperatorDefinition } from "./types.js";

/**
 * Operators described as JSON, with no behaviour: what a runtime can run, for an
 * editor to offer. The .NET runtime's `OperatorRegistry.ToCatalog()` writes the
 * same shape.
 */
export interface OperatorCatalog {
  categories: { id: string; label: string; color?: string }[];
  operators: CatalogOperator[];
}

export interface CatalogOperator {
  id: string;
  kind: "value" | "aggregate";
  label: string;
  category: string;
  inputs: { min: number; max?: number; labels?: string[]; tables?: number[] };
  async?: boolean;
  handlesAbsent?: boolean;
  glyph?: string;
  description?: string;
}

/** Describes a registry's operators and categories as a catalogue. */
export function toCatalog(registry: OperatorRegistry): OperatorCatalog {
  return {
    categories: registry.categories().map(({ id, label, color }) => ({ id, label, ...(color ? { color } : {}) })),
    operators: registry.list().map((operator) => {
      const { min, max, labels, tables } = operator.inputs;
      return {
        id: operator.id,
        kind: operator.kind === "aggregate" ? "aggregate" : "value",
        label: operator.label,
        category: operator.category,
        inputs: { min, ...(max !== undefined ? { max } : {}), ...(labels ? { labels } : {}), ...(tables ? { tables } : {}) },
        ...(operator.kind === "value" && operator.async ? { async: true } : {}),
        ...(operator.kind === "value" && operator.handlesAbsent ? { handlesAbsent: true } : {}),
        ...(operator.glyph ? { glyph: operator.glyph } : {}),
        ...(operator.description ? { description: operator.description } : {}),
      };
    }),
  };
}

/**
 * A registry built from a runtime's catalogue, such as one a .NET server serves.
 * Operators this package also has, the built-ins and any you pass as `local`,
 * keep their implementations, since every runtime behaves the same. The rest
 * are `remote`: the editor offers them and maps using them are checked, but
 * they only run where they're implemented.
 */
export function registryFromCatalog(catalog: OperatorCatalog, options: { local?: Iterable<OperatorDefinition> } = {}): OperatorRegistry {
  const local = new Map<string, OperatorDefinition>();
  for (const operator of [...builtinOperators, ...(options.local ?? [])]) local.set(operator.id, operator);

  const registry = new OperatorRegistry();
  for (const category of catalog.categories) registry.registerCategory(defineCategory(category));
  for (const entry of catalog.operators) {
    const described = {
      id: entry.id,
      label: entry.label,
      category: entry.category,
      inputs: entry.inputs,
      ...(entry.glyph ? { glyph: entry.glyph } : {}),
      ...(entry.description ? { description: entry.description } : {}),
    };
    const implementation = local.get(entry.id);
    const asyncHere = implementation?.kind === "value" && implementation.async === true;
    if (implementation && implementation.kind === entry.kind && asyncHere === (entry.async ?? false)) {
      registry.register({ ...implementation, ...described } as OperatorDefinition);
      continue;
    }
    const elsewhere = () => new OperatorError(`"${entry.label}" (${entry.id}) runs on the server, so a map using it can only be run or previewed there`);
    registry.register(
      entry.kind === "aggregate"
        ? { ...described, kind: "aggregate", remote: true, reduce: () => { throw elsewhere(); } }
        : {
            ...described,
            kind: "value",
            async: true,
            remote: true,
            handlesAbsent: entry.handlesAbsent ?? false,
            run: () => Promise.reject(elsewhere()),
          },
    );
  }
  return registry;
}
