import { analyseMap, type MapIssue, type MapPlan } from "./analyse.js";
import { createRegistry, type OperatorRegistry } from "./operators/registry.js";
import type { OperatorContext } from "./operators/types.js";
import { compare, isNumeric, toNumber, toText } from "./operators/coerce.js";
import { childPath, escapeKey, parsePath, resolveSchema } from "./paths.js";
import type { JsonValue, LinkSource, MapDocument, Schema } from "./types.js";
import { ABSENT, isAbsent, type Value } from "./value.js";

/** Thrown when a map has errors, with every error found. */
export class MapValidationError extends Error {
  override name = "MapValidationError";

  constructor(readonly issues: MapIssue[]) {
    super(`The map has ${issues.length} error${issues.length === 1 ? "" : "s"}:\n${issues.map((i) => `- ${i.message}`).join("\n")}`);
  }
}

/** Thrown when an operator fails while a map runs. */
export class MapRuntimeError extends Error {
  override name = "MapRuntimeError";

  constructor(
    message: string,
    readonly node: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
  }
}

/**
 * Caps on what a map may do, for maps you didn't write yourself, such as ones
 * users draw. Leave a limit out for no limit. See `limitsForUserMaps`.
 */
export interface RunLimits {
  /** The most operators a map may have. Checked when the transform is created. */
  maxNodes?: number;
  /** The most links a map may have. Checked when the transform is created. */
  maxLinks?: number;
  /** The most times operators may run in one run. Each runs once per item it's needed for. */
  maxOperatorRuns?: number;
  /** The most values one run may write to the output: every field, object and array item, not counting the root. */
  maxOutputValues?: number;
  /** The longest text an operator may produce, in UTF-16 code units. */
  maxTextLength?: number;
  /** The longest a run may take, in milliseconds. */
  timeout?: number;
}

/** Sensible limits for maps users draw: generous for real mappings, short of exhausting a server. */
export const limitsForUserMaps: Readonly<Required<RunLimits>> = Object.freeze({
  maxNodes: 500,
  maxLinks: 2000,
  maxOperatorRuns: 1_000_000,
  maxOutputValues: 1_000_000,
  maxTextLength: 1_000_000,
  timeout: 5000,
});

/** Thrown when a map or a run goes past one of its `RunLimits`. */
export class MapLimitError extends Error {
  override name = "MapLimitError";

  constructor(
    message: string,
    /** Which limit, such as `maxOperatorRuns`. */
    readonly limit: keyof RunLimits,
    /** The node that went past it, when there is one. */
    readonly node?: string,
  ) {
    super(message);
  }
}

export interface TransformOptions {
  /** Defaults to the built-in operators. */
  registry?: OperatorRegistry;
  /** Caps on the map and on each run. None by default. */
  limits?: RunLimits;
}

export interface AsyncTransformOptions extends TransformOptions {
  /** How many async operator calls one run may have waiting at once. Defaults to 8. */
  concurrency?: number;
}

export interface RunOptions {
  /** Cancels the run, such as `AbortSignal.timeout(5000)`. Async operators get it too. */
  signal?: AbortSignal;
}

export type Transform = (input: JsonValue) => JsonValue;
export type AsyncTransform = (input: JsonValue, options?: RunOptions) => Promise<JsonValue>;

function check(document: MapDocument, options: TransformOptions): MapPlan {
  // Size first, so an oversized map isn't analysed at all.
  const { maxNodes, maxLinks } = options.limits ?? {};
  if (maxNodes !== undefined && document.nodes.length > maxNodes) {
    throw new MapLimitError(`The map has ${document.nodes.length} operators, more than the ${maxNodes} allowed`, "maxNodes");
  }
  if (maxLinks !== undefined && document.links.length > maxLinks) {
    throw new MapLimitError(`The map has ${document.links.length} links, more than the ${maxLinks} allowed`, "maxLinks");
  }
  const { issues, plan } = analyseMap(document, options.registry ?? createRegistry());
  const errors = issues.filter((issue) => issue.severity === "error");
  if (errors.length > 0) throw new MapValidationError(errors);
  return plan;
}

/**
 * Checks a map once and returns a function that runs it. Throws a
 * `MapValidationError` when the map has errors; warnings don't stop it. A map
 * that uses async operators needs `createAsyncTransform` instead.
 */
export function createTransform(document: MapDocument, options: TransformOptions = {}): Transform {
  const plan = check(document, options);
  // Sub-maps count too: a map is async if anything it runs is.
  const waiting = [plan, ...plan.submaps.values()].flatMap((p) => [...p.nodes.values()]).filter(({ definition }) => definition.kind === "value" && definition.async);
  if (waiting.length > 0) {
    const names = waiting.map(({ node, definition }) => `"${node.id}" (${definition.label})`).join(", ");
    throw new TypeError(`This map uses async operators, so run it with createAsyncTransform: ${names}`);
  }
  const limits = options.limits ?? {};
  return (input) => run(plan, input, { limits }) as JsonValue;
}

/**
 * Like `createTransform`, for maps whose operators may have to wait, such as
 * lookups. Works for every map, async operators or not.
 */
export function createAsyncTransform(document: MapDocument, options: AsyncTransformOptions = {}): AsyncTransform {
  const plan = check(document, options);
  const concurrency = options.concurrency ?? 8;
  if (!Number.isInteger(concurrency) || concurrency < 1) throw new RangeError(`concurrency must be a whole number of at least 1, not ${concurrency}`);
  const limits = options.limits ?? {};
  return async (input, { signal } = {}) => {
    signal?.throwIfAborted();
    // A timeout also cancels waiting operators, not just the steps between them.
    const timedOut = limits.timeout !== undefined ? AbortSignal.timeout(limits.timeout) : undefined;
    const signals = [signal, timedOut].filter((s): s is AbortSignal => s !== undefined);
    const combined = signals.length > 1 ? AbortSignal.any(signals) : signals[0];
    try {
      return await run(plan, input, { signal: combined, limit: limiter(concurrency), limits });
    } catch (error) {
      if (timedOut?.aborted && !signal?.aborted && !(error instanceof MapLimitError)) throw timeoutError(limits.timeout!);
      throw error;
    }
  };
}

/** Runs a map against one input. Use `createTransform` to run it more than once. */
export function transform(document: MapDocument, input: JsonValue, options?: TransformOptions): JsonValue {
  return createTransform(document, options)(input);
}

// The evaluator works on values that may or may not be promises. It only waits
// when something is actually a promise, so a map with no async operators runs
// synchronously, and both kinds of run share the same rules.
type Maybe<T> = T | Promise<T>;

function isPromise<T>(value: Maybe<T>): value is Promise<T> {
  return typeof (value as { then?: unknown } | null)?.then === "function";
}

function then<T, U>(value: Maybe<T>, next: (value: T) => Maybe<U>): Maybe<U> {
  return isPromise(value) ? value.then(next) : next(value);
}

function all<T>(values: Maybe<T>[]): Maybe<T[]> {
  return values.some(isPromise) ? Promise.all(values) : (values as T[]);
}

/** Lets at most `max` tasks run at once; the rest wait their turn. */
function limiter(max: number) {
  let running = 0;
  const queue: (() => void)[] = [];
  return async <T>(task: () => Promise<T>): Promise<T> => {
    if (running >= max) await new Promise<void>((resolve) => queue.push(resolve));
    running++;
    try {
      return await task();
    } finally {
      running--;
      queue.shift()?.();
    }
  };
}

/** Sorts present values by `compare`, flipped for descending; missing values, absent or null, go last either way. */
function compareForSort(a: Value, b: Value, descending: boolean): number {
  const missingA = isAbsent(a) || a === null;
  const missingB = isAbsent(b) || b === null;
  if (missingA || missingB) return missingA === missingB ? 0 : missingA ? 1 : -1;
  const result = compare(a, b);
  return descending ? -result : result;
}

/** A group's key: values that compare equal share one, so "1" and 1 group together. */
function groupKey(value: Value): string {
  if (isAbsent(value)) return "absent";
  if (isNumeric(value)) return `number:${toNumber(value)}`;
  return `text:${toText(value)}`;
}

/** JSON with object keys sorted, so equal values have equal text whatever their key order. */
function canonical(value: JsonValue): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (typeof value === "object" && value !== null) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key]!)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

interface RunContext extends OperatorContext {
  limit?: <T>(task: () => Promise<T>) => Promise<T>;
  limits: RunLimits;
}

const timeoutError = (timeout: number) => new MapLimitError(`The run took longer than the ${timeout} ms allowed`, "timeout");

/** The index of the current item of each source array being repeated over. */
type Bindings = ReadonlyMap<string, number>;

/** What a run's map and its sub-maps share: the limits' counters, and the groups made so far. */
interface Shared {
  deadline: number | undefined;
  operatorRuns: number;
  outputValues: number;
  groupMembers: Map<number, number[]>;
}

function run(plan: MapPlan, input: JsonValue, context: RunContext): Maybe<JsonValue> {
  const deadline = context.limits.timeout !== undefined ? Date.now() + context.limits.timeout : undefined;
  return evaluatePlan(plan, input, context, { deadline, operatorRuns: 0, outputValues: 0, groupMembers: new Map() });
}

/** Builds a plan's target from an input: the map itself, or a sub-map on one record. */
function evaluatePlan(plan: MapPlan, input: JsonValue, context: RunContext, shared: Shared): Maybe<JsonValue> {
  const { signal, limit, limits } = context;
  const { deadline } = shared;

  // Groups made by grouped loops in this run, by id. A grouped item's bindings
  // carry its group's id under "<scope>#group", next to the index of its first item.
  const { groupMembers } = shared;
  const groupBinding = (scope: string) => `${scope}#group`;

  /** Counts a value written to the output. */
  const placed = () => {
    if (limits.maxOutputValues !== undefined && ++shared.outputValues > limits.maxOutputValues) {
      throw new MapLimitError(`The run wrote more than the ${limits.maxOutputValues} output values allowed`, "maxOutputValues");
    }
  };

  /** Checks an operator's text output against the limit. */
  const checkText = (value: Value, id: string): Value => {
    if (limits.maxTextLength !== undefined && typeof value === "string" && value.length > limits.maxTextLength) {
      throw new MapLimitError(`"${id}" produced ${value.length} characters of text, more than the ${limits.maxTextLength} allowed`, "maxTextLength", id);
    }
    return value;
  };
  const bind = (bindings: Bindings, scope: string, index: number): Bindings => new Map(bindings).set(scope, index);

  /** Reads a source path. With `whole`, a path ending in `[]` gives the whole array rather than the current item. */
  const read = (path: string, bindings: Bindings, whole = false): Value => {
    const segments = parsePath(path);
    let current: JsonValue = input;
    let prefix = "";
    for (const [position, segment] of segments.entries()) {
      if (typeof current !== "object" || current === null || Array.isArray(current)) return ABSENT;
      if (!Object.hasOwn(current, segment.key)) return ABSENT;
      const next: JsonValue | undefined = current[segment.key];
      if (next === undefined) return ABSENT;
      current = next;
      prefix = prefix === "" ? escapeKey(segment.key) : `${prefix}.${escapeKey(segment.key)}`;
      if (!segment.array) continue;
      prefix += "[]";
      if (!Array.isArray(current)) return ABSENT;
      if (whole && position === segments.length - 1) return current;
      const index = bindings.get(prefix);
      // analyseMap guarantees every array a read passes through has a current item.
      if (index === undefined) throw new Error(`No current item for "${prefix}"`);
      const item: JsonValue | undefined = current[index];
      if (item === undefined) return ABSENT;
      current = item;
    }
    return current;
  };

  // Each node's result for each item, so an operator that feeds several fields runs once
  // per item, not once per field: a lookup isn't repeated.
  const results = new Map<string, Maybe<Value>>();
  const remembered = (id: string, bindings: Bindings): Maybe<Value> => {
    const key = bindings.size === 0 ? id : `${id}|${[...bindings].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([scope, index]) => `${scope}=${index}`).join(";")}`;
    const known = results.get(key);
    if (known !== undefined) return known;
    const result = evaluateNode(id, bindings);
    results.set(key, result);
    return result;
  };

  const evaluate = (from: LinkSource, bindings: Bindings): Maybe<Value> =>
    "source" in from ? read(from.source, bindings) : remembered(from.node, bindings);

  const evaluateNode = (id: string, bindings: Bindings): Maybe<Value> => {
    const planned = plan.nodes.get(id);
    if (!planned) throw new Error(`Unknown node "${id}"`);
    const { definition } = planned;
    const input = (index: number, at: Bindings): Maybe<Value> => {
      const link = planned.inputs.get(index);
      if (link) return evaluate(link, at);
      // Not `??`: a constant of null is a value, not a missing one.
      return planned.constants.has(index) ? (planned.constants.get(index) as JsonValue) : ABSENT;
    };

    const fail = (cause: unknown): never => {
      if (cause instanceof MapRuntimeError || cause instanceof MapLimitError) throw cause;
      // A cancelled run stops with the signal's reason, not as the operator's fault.
      if (signal?.aborted) throw signal.reason;
      const reason = cause instanceof Error ? cause.message : String(cause);
      throw new MapRuntimeError(`"${id}" (${definition.label}) failed: ${reason}`, id, { cause });
    };

    const compute = (): Maybe<Value> => {
      if (limits.maxOperatorRuns !== undefined && ++shared.operatorRuns > limits.maxOperatorRuns) {
        throw new MapLimitError(`The run needed more than the ${limits.maxOperatorRuns} operator runs allowed`, "maxOperatorRuns", id);
      }
      if (deadline !== undefined && Date.now() > deadline) throw timeoutError(limits.timeout!);
      if (definition.kind === "aggregate") {
        const scope = planned.node.scope ?? "";
        const items = read(scope, bindings, true);
        // Inside a grouped loop over this array, an aggregate covers the current group.
        const group = bindings.get(groupBinding(scope));
        const members = group !== undefined ? groupMembers.get(group)! : Array.isArray(items) ? items.map((_, index) => index) : [];
        const each = Array.isArray(items) ? members.map((index) => input(0, bind(bindings, scope, index))) : [];
        return then(all(each), (values) => checkText(definition.reduce(values.filter((value): value is JsonValue => !isAbsent(value))), id));
      }
      const args = Array.from({ length: planned.inputCount }, (_, index) => input(index, bindings));
      return then(all(args), (values) => {
        if (!definition.handlesAbsent && values.some(isAbsent)) return ABSENT;
        if (!definition.async) return checkText(definition.run(values), id);
        const call = () => {
          signal?.throwIfAborted();
          return definition.run(values, { signal }).then((value) => checkText(value, id));
        };
        return limit ? limit(call) : call();
      });
    };

    try {
      const result = compute();
      return isPromise(result) ? result.catch(fail) : result;
    } catch (cause) {
      return fail(cause);
    }
  };

  /** Counts every value inside a record copied whole, as each is written to the output. */
  const placedWithin = (value: JsonValue) => {
    const children = Array.isArray(value) ? value : typeof value === "object" && value !== null ? Object.values(value) : [];
    for (const child of children) {
      placed();
      placedWithin(child);
    }
  };

  const build = (schema: Schema, path: string, bindings: Bindings): Maybe<Value> => {
    // A record link fills the whole target record: a copy of the source record, or a sub-map's output for it.
    // An array and its items share a path, so a record link applies at the record: each item, in a loop.
    const record = schema.type === "object" ? plan.recordLinks.get(path) : undefined;
    if (record) {
      const value = read(record.from, bindings);
      if (isAbsent(value)) return ABSENT;
      if (record.submap === undefined) {
        placedWithin(value);
        return structuredClone(value);
      }
      const output = evaluatePlan(plan.submaps.get(record.submap)!, value, context, shared);
      // An empty result is left out, like any object with nothing mapped into it.
      return then(output, (result) => (typeof result === "object" && result !== null && Object.keys(result).length === 0 ? ABSENT : result));
    }
    if (schema.type === "object") {
      const entries = Object.entries(schema.properties ?? {});
      const values = all(entries.map(([key, child]) => build(child, childPath(path, key, child), bindings)));
      return then(values, (resolved) => {
        const result: { [key: string]: JsonValue } = {};
        let empty = true;
        resolved.forEach((value, index) => {
          if (isAbsent(value)) return;
          placed();
          // defineProperty so a key such as "__proto__" stays an ordinary property.
          Object.defineProperty(result, entries[index]![0], { value, enumerable: true, writable: true, configurable: true });
          empty = false;
        });
        // An object with nothing mapped into it is left out, as is an array item,
        // so gating every field of an item filters it.
        return empty ? ABSENT : result;
      });
    }
    if (schema.type === "array") {
      const loop = plan.loopsByTarget.get(path);
      if (!loop || !schema.items) return ABSENT;
      const items = read(loop.source, bindings, true);
      if (!Array.isArray(items)) return ABSENT;
      const itemSchema = schema.items;
      const at = (index: number) => bind(bindings, loop.source, index);

      let order = items.map((_, index) => index);
      if (loop.sortBy?.length) {
        const keys = new Map(order.map((index) => [index, loop.sortBy!.map((key) => read(key.path, at(index)))]));
        order = [...order].sort((a, b) => {
          for (const [k, key] of loop.sortBy!.entries()) {
            const result = compareForSort(keys.get(a)![k]!, keys.get(b)![k]!, key.descending ?? false);
            if (result !== 0) return result;
          }
          return 0;
        });
      }

      let groups = order.map((index) => [index]);
      if (loop.groupBy !== undefined) {
        const byKey = new Map<string, number[]>();
        for (const index of order) {
          const key = groupKey(read(loop.groupBy, at(index)));
          byKey.set(key, [...(byKey.get(key) ?? []), index]);
        }
        groups = [...byKey.values()];
      }

      const values = all(
        groups.map((members) => {
          let itemBindings = at(members[0]!);
          if (loop.groupBy !== undefined) {
            const id = groupMembers.size;
            groupMembers.set(id, members);
            itemBindings = bind(itemBindings, groupBinding(loop.source), id);
          }
          return build(itemSchema, path, itemBindings);
        }),
      );
      return then(values, (resolved) => {
        let kept = resolved.filter((value): value is JsonValue => !isAbsent(value));
        if (loop.distinct) {
          const seen = new Set<string>();
          kept = kept.filter((value) => {
            const key = canonical(value);
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
          });
        }
        for (let i = 0; i < kept.length; i++) placed();
        return kept;
      });
    }
    const from = plan.targetLinks.get(path);
    return from ? evaluate(from, bindings) : ABSENT;
  };

  return then(build(resolveSchema(plan.document.target), "", new Map()), (output) => (isAbsent(output) ? {} : output));
}
