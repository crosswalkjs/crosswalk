import { ABSENT, type Value } from "../value.js";
import { OperatorError } from "./types.js";

function describe(value: Value): string {
  if (value === ABSENT) return "nothing";
  return typeof value === "string" ? `"${value}"` : JSON.stringify(value);
}

/** Reads a value as text. `null` and absent read as an empty string. */
export function toText(value: Value): string {
  if (value === null || value === ABSENT) return "";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

// A plain decimal number: an optional sign, digits with an optional fraction,
// and an optional exponent. Unlike JavaScript's Number(), this rejects hex and
// binary such as "0x10", so every runtime agrees on what counts as a number.
const DECIMAL = /^[+-]?([0-9]+(\.[0-9]*)?|\.[0-9]+)([eE][+-]?[0-9]+)?$/;

/** True for a finite number, or a string holding a plain decimal number (surrounding spaces allowed). */
export function isNumeric(value: Value): boolean {
  if (typeof value === "number") return Number.isFinite(value);
  return typeof value === "string" && DECIMAL.test(value.trim()) && Number.isFinite(Number(value));
}

/** Reads a value as a number, or throws a `OperatorError`. */
export function toNumber(value: Value): number {
  if (isNumeric(value)) return Number(value);
  if (typeof value === "boolean") return value ? 1 : 0;
  throw new OperatorError(`Expected a number but got ${describe(value)}`);
}

/** Reads a value as a boolean: `true`, `false`, their strings, or a number. */
export function toBoolean(value: Value): boolean {
  if (typeof value === "boolean") return value;
  if (value === "true") return true;
  if (value === "false") return false;
  if (typeof value === "number") return value !== 0;
  throw new OperatorError(`Expected true or false but got ${describe(value)}`);
}

/** Compares two values: as numbers when both are numeric, otherwise as text. */
export function compare(a: Value, b: Value): number {
  if (isNumeric(a) && isNumeric(b)) return Number(a) - Number(b);
  const x = toText(a);
  const y = toText(b);
  return x < y ? -1 : x > y ? 1 : 0;
}
