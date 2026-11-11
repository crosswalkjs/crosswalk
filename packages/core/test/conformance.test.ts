// Runs the shared conformance suite in /conformance, which every Crosswalk
// runtime must pass, through both createTransform and createAsyncTransform.
// See conformance/README.md for the format.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  analyseMap,
  createAsyncTransform,
  createRegistry,
  createTransform,
  MapLimitError,
  MapRuntimeError,
  jsonToXml,
  readFlatFile,
  writeFlatFile,
  xmlToJson,
  type JsonValue,
  type Schema,
  type Link,
  type MapDocument,
  type MapIssue,
  type RunLimits,
  toText,
} from "../src/index.js";

const root = fileURLToPath(new URL("../../../conformance/", import.meta.url));
const read = (path: string): JsonValue => JSON.parse(readFileSync(path, "utf8")) as JsonValue;
const registry = createRegistry();

type Expected = JsonValue;
const marker = (value: JsonValue, name: string) =>
  typeof value === "object" && value !== null && !Array.isArray(value) && value[name] === true;
const absent = (value: JsonValue) => marker(value, "$absent");
const failure = (value: JsonValue) => marker(value, "$error");

/** Deep equality, with numbers equal to within 1e-9, as the suite's README defines. */
function same(actual: JsonValue | undefined, expected: JsonValue): boolean {
  if (typeof actual === "number" && typeof expected === "number") {
    return Math.abs(actual - expected) <= 1e-9 * Math.max(1, Math.abs(expected));
  }
  if (Array.isArray(expected)) {
    return Array.isArray(actual) && actual.length === expected.length && expected.every((item, i) => same(actual[i], item));
  }
  if (typeof expected === "object" && expected !== null) {
    if (typeof actual !== "object" || actual === null || Array.isArray(actual)) return false;
    const keys = Object.keys(expected);
    return keys.length === Object.keys(actual).length && keys.every((key) => key in actual && same(actual[key], expected[key] as JsonValue));
  }
  return actual === expected;
}

/** Runs a map both ways, sync and async: each must give the same result. */
async function bothWays(map: MapDocument, input: JsonValue, limits: RunLimits = {}): Promise<{ outputs: JsonValue[]; errors: unknown[] }> {
  const outputs: JsonValue[] = [];
  const errors: unknown[] = [];
  try {
    outputs.push(createTransform(map, { registry, limits })(input));
  } catch (error) {
    errors.push(error);
  }
  try {
    outputs.push(await createAsyncTransform(map, { registry, limits })(input));
  } catch (error) {
    errors.push(error);
  }
  return { outputs, errors };
}

/** Runs a one-operator map whose output field is `out`, and checks it against `expected`. */
async function check(map: MapDocument, input: JsonValue, expected: Expected) {
  expect(analyseMap(map, registry).issues.filter((issue) => issue.severity === "error")).toEqual([]);
  const { outputs, errors } = await bothWays(map, input);
  if (failure(expected)) {
    expect(errors).toHaveLength(2);
    for (const error of errors) expect(error).toBeInstanceOf(MapRuntimeError);
    return;
  }
  expect(errors).toEqual([]);
  for (const output of outputs as Record<string, JsonValue>[]) {
    if (absent(expected)) expect(output).toEqual({});
    else expect(same(output.out, expected), `got ${JSON.stringify(output.out)}`).toBe(true);
  }
}

const operators = read(join(root, "operators.json")) as {
  value: { operator: string; inputs: JsonValue[]; expected: Expected }[];
  aggregate: { operator: string; values: JsonValue[]; expected: Expected }[];
};
const out = { type: "object" as const, properties: { out: { type: "string" as const } } };

describe("conformance: value operators", () => {
  for (const { operator, inputs, expected } of operators.value) {
    it(`${operator}(${inputs.map((input) => JSON.stringify(input)).join(", ")})`, async () => {
      // An absent input is a link from a source field the input doesn't have.
      const constants: Record<number, JsonValue> = {};
      const links: Link[] = [{ from: { node: "op" }, to: { target: "out" } }];
      inputs.forEach((input, index) => {
        if (absent(input)) links.push({ from: { source: "missing" }, to: { node: "op", input: index } });
        else constants[index] = input;
      });
      const map: MapDocument = {
        version: 1,
        source: { type: "object", properties: { missing: { type: "string" } } },
        target: out,
        nodes: [{ id: "op", operator, constants }],
        links,
      };
      await check(map, {}, expected);
    });
  }
});

describe("conformance: aggregate operators", () => {
  for (const { operator, values, expected } of operators.aggregate) {
    it(`${operator}(${values.map((value) => JSON.stringify(value)).join(", ")})`, async () => {
      const map: MapDocument = {
        version: 1,
        source: {
          type: "object",
          properties: { items: { type: "array", items: { type: "object", properties: { v: { type: "string" } } } } },
        },
        target: out,
        nodes: [{ id: "op", operator, scope: "items[]" }],
        links: [
          { from: { source: "items[].v" }, to: { node: "op", input: 0 } },
          { from: { node: "op" }, to: { target: "out" } },
        ],
      };
      // An absent value is an item without `v`.
      await check(map, { items: values.map((value) => (absent(value) ? {} : { v: value })) }, expected);
    });
  }
});

describe("conformance: text of a number", () => {
  const { cases } = read(join(root, "number-text.json")) as { cases: [number, string][] };
  it(`matches all ${cases.length} pairs`, () => {
    const wrong = cases.filter(([number, text]) => toText(number) !== text).map(([number, text]) => `${number}: want "${text}", got "${toText(number)}"`);
    expect(wrong).toEqual([]);
  });
});

describe("conformance: catalogue", () => {
  it("describes the built-ins as every runtime must", () => {
    expect(createRegistry().toCatalog()).toEqual(read(join(root, "catalog.json")));
  });
});

describe("conformance: maps", () => {
  const cases = join(root, "maps");
  for (const name of readdirSync(cases).sort()) {
    const dir = join(cases, name);
    const file = (part: string) => join(dir, part);
    const { description } = read(file("case.json")) as { description: string };

    it(`${name}: ${description}`, async () => {
      const map = read(file("map.json")) as unknown as MapDocument;
      const issues = analyseMap(map, registry).issues;

      if (existsSync(file("expected-issues.json"))) {
        const expected = read(file("expected-issues.json")) as unknown as Partial<MapIssue>[];
        // Each expected issue must match one reported issue on the fields it gives; messages aren't compared.
        const unmatched = [...issues];
        for (const want of expected) {
          const at = unmatched.findIndex(
            (issue) =>
              issue.severity === want.severity &&
              issue.code === want.code &&
              (want.node === undefined || issue.node === want.node) &&
              (want.path === undefined || issue.path === want.path) &&
              (want.submap === undefined || issue.submap === want.submap),
          );
          expect(at, `expected ${JSON.stringify(want)} in ${JSON.stringify(issues)}`).toBeGreaterThanOrEqual(0);
          unmatched.splice(at, 1);
        }
        expect(unmatched, "issues the case doesn't expect").toEqual([]);
        return;
      }

      expect(issues.filter((issue) => issue.severity === "error")).toEqual([]);
      const limits = existsSync(file("limits.json")) ? (read(file("limits.json")) as RunLimits) : {};
      const { outputs, errors } = await bothWays(map, read(file("input.json")), limits);
      if (existsSync(file("expected-limit.json"))) {
        const { limit, node } = read(file("expected-limit.json")) as { limit: string; node?: string };
        expect(errors).toHaveLength(2);
        for (const error of errors) {
          expect(error).toBeInstanceOf(MapLimitError);
          expect((error as MapLimitError).limit).toBe(limit);
          if (node !== undefined) expect((error as MapLimitError).node).toBe(node);
        }
        return;
      }
      if (existsSync(file("expected-error.json"))) {
        const { node } = read(file("expected-error.json")) as { node: string };
        expect(errors).toHaveLength(2);
        for (const error of errors) {
          expect(error).toBeInstanceOf(MapRuntimeError);
          expect((error as MapRuntimeError).node).toBe(node);
        }
        return;
      }
      expect(errors).toEqual([]);
      const expected = read(file("expected.json"));
      for (const output of outputs) expect(same(output, expected), `got ${JSON.stringify(output)}`).toBe(true);
    });
  }
});

// XML read into JSON, compared as JSON; and JSON written as XML, compared as text.
describe("xml", () => {
  const dir = join(root, "xml");
  for (const name of readdirSync(dir).sort()) {
    const at = (file: string) => join(dir, name, file);
    const schema = existsSync(at("schema.json")) ? (read(at("schema.json")) as unknown as Schema) : undefined;
    it(name, () => {
      if (existsSync(at("input.xml"))) {
        const expected = read(at("expected.json"));
        const input = readFileSync(at("input.xml"), "utf8");
        if (failure(expected)) expect(() => xmlToJson(input, schema)).toThrow();
        else expect(same(xmlToJson(input, schema), expected)).toBe(true);
      } else {
        expect(jsonToXml(read(at("input.json")), schema)).toBe(readFileSync(at("expected.xml"), "utf8"));
      }
    });
  }
});

// Flat files read into JSON, compared as JSON; and JSON written as a flat file, compared as text.
describe("flat", () => {
  const dir = join(root, "flat");
  for (const name of readdirSync(dir).sort()) {
    const at = (file: string) => join(dir, name, file);
    const schema = existsSync(at("schema.json")) ? (read(at("schema.json")) as unknown as Schema) : undefined;
    it(name, () => {
      if (existsSync(at("input.txt"))) {
        const expected = read(at("expected.json"));
        const input = readFileSync(at("input.txt"), "utf8");
        if (failure(expected)) expect(() => readFlatFile(input, schema)).toThrow();
        else expect(same(readFlatFile(input, schema), expected)).toBe(true);
      } else if (existsSync(at("expected.txt"))) {
        expect(writeFlatFile(read(at("input.json")), schema)).toBe(readFileSync(at("expected.txt"), "utf8"));
      } else {
        expect(() => writeFlatFile(read(at("input.json")), schema)).toThrow();
      }
    });
  }
});
