import { builtinCategories, builtinOperators } from "./builtins.js";
import { toCatalog, type OperatorCatalog } from "./catalog.js";
import { defineCategory, type CategoryDefinition, type OperatorDefinition } from "./types.js";

/** The operators a map can use, by id, and the categories that group them. */
export class OperatorRegistry {
  readonly #operators = new Map<string, OperatorDefinition>();
  readonly #categories = new Map<string, CategoryDefinition>();

  /** Adds a category, or replaces one with the same id, such as to relabel or recolour a built-in. */
  registerCategory(category: CategoryDefinition): this {
    this.#categories.set(category.id, defineCategory(category));
    return this;
  }

  /** Adds an operator. Its category is created, labelled with its id, if it isn't registered yet. */
  register(operator: OperatorDefinition): this {
    if (this.#operators.has(operator.id)) {
      throw new Error(`Operator "${operator.id}" is already registered`);
    }
    if (!this.#categories.has(operator.category)) this.registerCategory({ id: operator.category, label: operator.category });
    this.#operators.set(operator.id, operator);
    return this;
  }

  /** Removes an operator. Maps that use it then report it as unknown. */
  unregister(id: string): this {
    this.#operators.delete(id);
    return this;
  }

  get(id: string): OperatorDefinition | undefined {
    return this.#operators.get(id);
  }

  has(id: string): boolean {
    return this.#operators.has(id);
  }

  /** Every operator, in the order registered. */
  list(): OperatorDefinition[] {
    return [...this.#operators.values()];
  }

  getCategory(id: string): CategoryDefinition | undefined {
    return this.#categories.get(id);
  }

  /** Describes the operators as JSON for an editor, with no behaviour. See `registryFromCatalog`. */
  toCatalog(): OperatorCatalog {
    return toCatalog(this);
  }

  /** Every category with at least one operator, in the order registered. */
  categories(): CategoryDefinition[] {
    const used = new Set([...this.#operators.values()].map((operator) => operator.category));
    return [...this.#categories.values()].filter((category) => used.has(category.id));
  }
}

export interface RegistryOptions {
  /**
   * Which built-in operators to include: all of them (the default), none
   * (`false`), or those a filter keeps, such as
   * `(op) => op.category !== "math"`.
   */
  builtins?: boolean | ((operator: OperatorDefinition) => boolean);
  /** Your own operators, added after the built-ins. */
  operators?: Iterable<OperatorDefinition>;
  /** Your own categories, or replacements for built-in ones. */
  categories?: Iterable<CategoryDefinition>;
}

/** A registry of the built-in operators, or a subset of them, plus any of your own. */
export function createRegistry(options: RegistryOptions = {}): OperatorRegistry {
  const registry = new OperatorRegistry();
  for (const category of builtinCategories) registry.registerCategory(category);
  for (const category of options.categories ?? []) registry.registerCategory(category);
  const keep = options.builtins ?? true;
  for (const operator of builtinOperators) {
    if (keep === true || (typeof keep === "function" && keep(operator))) registry.register(operator);
  }
  for (const operator of options.operators ?? []) registry.register(operator);
  return registry;
}
