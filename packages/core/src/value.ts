import type { JsonValue } from "./types.js";

/**
 * Marks a value that isn't there: a missing source field, or the output of a
 * gate that didn't open. A target field whose value is absent is left out.
 * This is different from `null`, which is a real JSON value.
 */
export const ABSENT: unique symbol = Symbol("crosswalk.absent");
export type Absent = typeof ABSENT;

export type Value = JsonValue | Absent;

export function isAbsent(value: Value | undefined): value is Absent {
  return value === ABSENT;
}
