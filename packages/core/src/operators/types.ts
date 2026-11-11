import type { JsonValue } from "../types.js";
import type { Value } from "../value.js";

/** A group of operators in the toolbox, such as `text` or `math`. */
export interface CategoryDefinition {
  /** Letters, digits, `-` and `_`, starting with a letter. Operators refer to it by this. */
  id: string;
  label: string;
  /**
   * The colour of the category's operators when the theme doesn't set one.
   * Built-in categories get theirs from the theme.
   */
  color?: string;
}

interface OperatorBase {
  /** A namespaced id, such as `text.concat`. Map documents refer to operators by it. */
  id: string;
  label: string;
  /** A short symbol drawn on the operator, such as `Σ`. Defaults to the first letters of the label. */
  glyph?: string | undefined;
  /** The id of a registered category. */
  category: string;
  description?: string;
  /**
   * How many inputs it takes. Leave `max` out for no limit. `tables` lists the
   * inputs that take a table of keys and values, such as Look up's, so the
   * editor offers a table there.
   */
  inputs: { min: number; max?: number; labels?: string[]; tables?: number[] };
  /**
   * Described by a catalogue but implemented elsewhere, such as in a .NET
   * runtime. Running it here fails, so a map that uses one previews on the server.
   */
  remote?: boolean;
}

/** Works out one value from its inputs. */
export interface ValueOperator extends OperatorBase {
  kind: "value";
  async?: false;
  /**
   * When false (the default) an absent input makes the output absent without
   * calling `run`. Set it for operators that test for absence.
   */
  handlesAbsent?: boolean;
  run(args: readonly Value[]): Value;
}

/** What an async operator gets besides its inputs. */
export interface OperatorContext {
  /** Aborted when the run is cancelled or times out. Pass it on to `fetch` and the like. */
  signal?: AbortSignal | undefined;
}

/**
 * Works out one value from its inputs, but has to wait for it, such as a
 * lookup in a database or another service. Maps that use one run with
 * `createAsyncTransform`.
 */
export interface AsyncValueOperator extends OperatorBase {
  kind: "value";
  async: true;
  /** As for `ValueOperator`. */
  handlesAbsent?: boolean;
  run(args: readonly Value[], context: OperatorContext): Promise<Value>;
}

/** Aggregates one input across every item of the node's scope, such as a sum. */
export interface AggregateOperator extends OperatorBase {
  kind: "aggregate";
  /** Gets the input's value for each item, with absent values already dropped. */
  reduce(values: readonly JsonValue[]): Value;
}

export type OperatorDefinition = ValueOperator | AsyncValueOperator | AggregateOperator;

/** Identity helper that type-checks an operator definition. */
// One overload per kind, so `run`'s arguments are typed from the kind written.
export function defineOperator(definition: ValueOperator): ValueOperator;
export function defineOperator(definition: AsyncValueOperator): AsyncValueOperator;
export function defineOperator(definition: AggregateOperator): AggregateOperator;
export function defineOperator(definition: OperatorDefinition): OperatorDefinition {
  return definition;
}

const CATEGORY_ID = /^[A-Za-z][\w-]*$/;

/** Checks a category definition and returns it. */
export function defineCategory(definition: CategoryDefinition): CategoryDefinition {
  if (!CATEGORY_ID.test(definition.id)) {
    throw new Error(`Category id "${definition.id}" must start with a letter and use only letters, digits, - and _`);
  }
  return definition;
}

/** Thrown by an operator when its inputs don't make sense, such as text where a number belongs. */
export class OperatorError extends Error {
  override name = "OperatorError";
}
