import type { JsonValue } from "../types.js";
import { ABSENT, isAbsent, type Value } from "../value.js";
import { compare, isNumeric, toBoolean, toNumber, toText } from "./coerce.js";
import { defineCategory, defineOperator, OperatorError, type CategoryDefinition, type OperatorDefinition } from "./types.js";
import { dateOperators } from "./dates.js";

export const builtinCategories: readonly CategoryDefinition[] = [
  defineCategory({ id: "text", label: "Text" }),
  defineCategory({ id: "math", label: "Math" }),
  defineCategory({ id: "logic", label: "Logic" }),
  defineCategory({ id: "date", label: "Date" }),
  defineCategory({ id: "convert", label: "Convert" }),
  defineCategory({ id: "flow", label: "Flow" }),
  defineCategory({ id: "aggregate", label: "Aggregate" }),
  defineCategory({ id: "custom", label: "Custom" }),
];

// Inputs are checked against `inputs` before `run` is called, so reading a
// required argument with `arg` never sees a missing one.
// Not `??`: an argument of null is a value, not a missing one.
const arg = (args: readonly Value[], index: number): Value => (index < args.length ? (args[index] as Value) : ABSENT);

function unary(id: string, label: string, glyph: string, category: string, run: (value: Value) => Value) {
  return defineOperator({ kind: "value", id, label, glyph, category, inputs: { min: 1, max: 1 }, run: (args) => run(arg(args, 0)) });
}

function binary(id: string, label: string, glyph: string, category: string, run: (a: Value, b: Value) => Value) {
  return defineOperator({
    kind: "value",
    id,
    label,
    glyph,
    category,
    inputs: { min: 2, max: 2 },
    run: (args) => run(arg(args, 0), arg(args, 1)),
  });
}

function aggregate(id: string, label: string, glyph: string, reduce: (values: readonly JsonValue[]) => Value) {
  return defineOperator({ kind: "aggregate", id, label, glyph, category: "aggregate", inputs: { min: 1, max: 1 }, reduce });
}

/**
 * Rounds the decimal value as written, not its binary approximation: shifting
 * through the exponent keeps 1.005 as 100.5, where 1.005 * 100 is 100.49999…
 */
function roundHalfAwayFromZero(value: number, decimals: number): number {
  const shift = (n: number, by: number) => {
    const [mantissa, exponent = "0"] = String(n).split("e");
    return Number(`${mantissa}e${Number(exponent) + by}`);
  };
  return Math.sign(value) * shift(Math.round(shift(Math.abs(value), decimals)), -decimals) || 0;
}

const text: OperatorDefinition[] = [
  defineOperator({
    kind: "value",
    id: "text.concat",
    label: "Concatenate",
    glyph: "ab+",
    category: "text",
    inputs: { min: 1 },
    run: (args) => args.map(toText).join(""),
  }),
  unary("text.upper", "Uppercase", "AB", "text", (v) => toText(v).toUpperCase()),
  unary("text.lower", "Lowercase", "ab", "text", (v) => toText(v).toLowerCase()),
  unary("text.trim", "Trim", "⎵", "text", (v) => toText(v).trim()),
  unary("text.length", "Length", "len", "text", (v) => toText(v).length),
  defineOperator({
    kind: "value",
    id: "text.left",
    label: "Left",
    glyph: "◧",
    category: "text",
    description: "The first `count` characters.",
    inputs: { min: 2, max: 2, labels: ["text", "count"] },
    run: (args) => toText(arg(args, 0)).slice(0, Math.max(0, toNumber(arg(args, 1)))),
  }),
  defineOperator({
    kind: "value",
    id: "text.right",
    label: "Right",
    glyph: "◨",
    category: "text",
    description: "The last `count` characters.",
    inputs: { min: 2, max: 2, labels: ["text", "count"] },
    run: (args) => {
      const value = toText(arg(args, 0));
      return value.slice(Math.max(0, value.length - toNumber(arg(args, 1))));
    },
  }),
  defineOperator({
    kind: "value",
    id: "text.substring",
    label: "Substring",
    glyph: "sub",
    category: "text",
    description: "Takes `length` characters from a 0-based `start`, or the rest of the text when `length` is left out.",
    inputs: { min: 2, max: 3, labels: ["text", "start", "length"] },
    run: (args) => {
      const value = toText(arg(args, 0));
      const start = toNumber(arg(args, 1));
      return args.length > 2 ? value.slice(start, start + toNumber(arg(args, 2))) : value.slice(start);
    },
  }),
  defineOperator({
    kind: "value",
    id: "text.replace",
    label: "Replace",
    glyph: "⇄",
    category: "text",
    inputs: { min: 3, max: 3, labels: ["text", "find", "replace with"] },
    description: "Replaces every occurrence of `find` with `replace with`. An empty `find` leaves the text as it is.",
    run: (args) => {
      const find = toText(arg(args, 1));
      return find === "" ? toText(arg(args, 0)) : toText(arg(args, 0)).replaceAll(find, toText(arg(args, 2)));
    },
  }),
];

const math: OperatorDefinition[] = [
  defineOperator({
    kind: "value",
    id: "math.add",
    label: "Add",
    glyph: "+",
    category: "math",
    inputs: { min: 2 },
    run: (args) => args.reduce<number>((sum, v) => sum + toNumber(v), 0),
  }),
  binary("math.subtract", "Subtract", "−", "math", (a, b) => toNumber(a) - toNumber(b)),
  defineOperator({
    kind: "value",
    id: "math.multiply",
    label: "Multiply",
    glyph: "×",
    category: "math",
    inputs: { min: 2 },
    run: (args) => args.reduce<number>((product, v) => product * toNumber(v), 1),
  }),
  binary("math.divide", "Divide", "÷", "math", (a, b) => {
    const divisor = toNumber(b);
    if (divisor === 0) throw new OperatorError("Can't divide by zero");
    return toNumber(a) / divisor;
  }),
  binary("math.modulo", "Remainder", "%", "math", (a, b) => toNumber(a) % toNumber(b)),
  defineOperator({
    kind: "value",
    id: "math.round",
    label: "Round",
    glyph: "≈",
    category: "math",
    inputs: { min: 1, max: 2, labels: ["value", "decimals"] },
    description: "Rounds to `decimals` places (0 if left out), with halves rounded away from zero: 2.5 gives 3 and -2.5 gives -3.",
    run: (args) => {
      const decimals = args.length > 1 ? toNumber(arg(args, 1)) : 0;
      if (!Number.isInteger(decimals)) throw new OperatorError(`Decimals must be a whole number, not ${decimals}`);
      return roundHalfAwayFromZero(toNumber(arg(args, 0)), decimals);
    },
  }),
  unary("math.abs", "Absolute", "|x|", "math", (v) => Math.abs(toNumber(v))),
  defineOperator({
    kind: "value",
    id: "math.min",
    label: "Smallest",
    glyph: "min",
    category: "math",
    inputs: { min: 2 },
    run: (args) => Math.min(...args.map(toNumber)),
  }),
  defineOperator({
    kind: "value",
    id: "math.max",
    label: "Largest",
    glyph: "max",
    category: "math",
    inputs: { min: 2 },
    run: (args) => Math.max(...args.map(toNumber)),
  }),
];

const logic: OperatorDefinition[] = [
  binary("logic.equal", "Equals", "=", "logic", (a, b) => compare(a, b) === 0),
  binary("logic.notEqual", "Not equal", "≠", "logic", (a, b) => compare(a, b) !== 0),
  binary("logic.greaterThan", "Greater than", ">", "logic", (a, b) => compare(a, b) > 0),
  binary("logic.greaterOrEqual", "At least", "≥", "logic", (a, b) => compare(a, b) >= 0),
  binary("logic.lessThan", "Less than", "<", "logic", (a, b) => compare(a, b) < 0),
  binary("logic.lessOrEqual", "At most", "≤", "logic", (a, b) => compare(a, b) <= 0),
  defineOperator({
    kind: "value",
    id: "logic.and",
    label: "And",
    glyph: "∧",
    category: "logic",
    inputs: { min: 2 },
    run: (args) => args.every(toBoolean),
  }),
  defineOperator({
    kind: "value",
    id: "logic.or",
    label: "Or",
    glyph: "∨",
    category: "logic",
    inputs: { min: 2 },
    run: (args) => args.some(toBoolean),
  }),
  unary("logic.not", "Not", "!", "logic", (v) => !toBoolean(v)),
  unary("logic.isNumber", "Is a number", "1?", "logic", isNumeric),
  defineOperator({
    kind: "value",
    id: "logic.exists",
    label: "Exists",
    glyph: "∃",
    category: "logic",
    description: "True when the input has a value. `null` counts as a value.",
    inputs: { min: 1, max: 1 },
    handlesAbsent: true,
    run: (args) => !isAbsent(arg(args, 0)),
  }),
];

const convert: OperatorDefinition[] = [
  unary("convert.toNumber", "To number", "→1", "convert", toNumber),
  unary("convert.toText", "To text", "→a", "convert", toText),
  unary("convert.toBoolean", "To true/false", "→?", "convert", toBoolean),
  defineOperator({
    kind: "value",
    id: "convert.lookup",
    label: "Look up",
    glyph: "tbl",
    category: "convert",
    description: "Finds the value in a table, such as `{ \"M\": \"Male\" }`, and gives what it maps to. With no match it gives `if not found`, or leaves the field out.",
    inputs: { min: 2, max: 3, labels: ["value", "table", "if not found"], tables: [1] },
    handlesAbsent: true,
    run: (args) => {
      const value = arg(args, 0);
      const table = arg(args, 1);
      // A missing value is no value, not a value missing from the table.
      if (isAbsent(value) || isAbsent(table)) return ABSENT;
      if (typeof table !== "object" || table === null || Array.isArray(table)) throw new OperatorError("The table must be an object of keys and values");
      const key = toText(value);
      if (Object.hasOwn(table, key)) return table[key]!;
      return arg(args, 2);
    },
  }),
];

const flow: OperatorDefinition[] = [
  defineOperator({
    kind: "value",
    id: "flow.onlyIf",
    label: "Only if",
    glyph: "⇥",
    category: "flow",
    description: "Passes the value through when the condition is true; otherwise the output is left out.",
    inputs: { min: 2, max: 2, labels: ["condition", "value"] },
    run: (args) => (toBoolean(arg(args, 0)) ? arg(args, 1) : ABSENT),
  }),
  defineOperator({
    kind: "value",
    id: "flow.ifElse",
    label: "If / else",
    glyph: "?:",
    category: "flow",
    inputs: { min: 3, max: 3, labels: ["condition", "then", "else"] },
    handlesAbsent: true,
    run: (args) => {
      const condition = arg(args, 0);
      if (isAbsent(condition)) return ABSENT;
      return toBoolean(condition) ? arg(args, 1) : arg(args, 2);
    },
  }),
  defineOperator({
    kind: "value",
    id: "flow.firstOf",
    label: "First of",
    glyph: "??",
    category: "flow",
    description: "The first input that has a value and isn't `null`.",
    inputs: { min: 1 },
    handlesAbsent: true,
    run: (args) => args.find((v) => !isAbsent(v) && v !== null) ?? ABSENT,
  }),
];

const aggregates: OperatorDefinition[] = [
  aggregate("aggregate.sum", "Sum", "Σ", (values) => values.reduce<number>((sum, v) => sum + toNumber(v), 0)),
  aggregate("aggregate.count", "Count", "#", (values) => values.length),
  aggregate("aggregate.average", "Average", "x̄", (values) =>
    values.length === 0 ? ABSENT : values.reduce<number>((sum, v) => sum + toNumber(v), 0) / values.length,
  ),
  aggregate("aggregate.min", "Minimum", "↓", (values) => (values.length === 0 ? ABSENT : Math.min(...values.map(toNumber)))),
  aggregate("aggregate.max", "Maximum", "↑", (values) => (values.length === 0 ? ABSENT : Math.max(...values.map(toNumber)))),
  aggregate("aggregate.join", "Join", "Σab", (values) => values.map(toText).join("")),
];

export const builtinOperators: readonly OperatorDefinition[] = [...text, ...math, ...logic, ...dateOperators, ...convert, ...flow, ...aggregates];
