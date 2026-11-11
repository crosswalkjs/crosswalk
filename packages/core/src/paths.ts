import type { JsonValue, Schema } from "./types.js";

export interface PathSegment {
  key: string;
  /** True when the segment is written `key[]`, meaning one item of the array. */
  array: boolean;
}

const parsed = new Map<string, PathSegment[]>();

/** A key as it's written in a path, with `.`, `[`, `]` and `\` escaped by a `\`, so `unit.price` is `unit\.price`. */
export function escapeKey(key: string): string {
  return key.replace(/[\\.[\]]/g, (character) => `\\${character}`);
}

/**
 * Splits a path such as `PhoneCalls[].Cost` into segments. Keys are joined
 * with `.`, an array is written `key[]`, and a `\` escapes the next character,
 * for keys that contain `.`, `[` or `]`.
 */
export function parsePath(path: string): PathSegment[] {
  const cached = parsed.get(path);
  if (cached) return cached;
  const invalid = () => new Error(`Invalid path "${path}"`);
  const segments: PathSegment[] = [];
  let key = "";
  let array = false;
  const end = () => {
    if (key === "") throw invalid();
    segments.push({ key, array });
    key = "";
    array = false;
  };
  for (let i = 0; path !== "" && i <= path.length; i++) {
    const character = path[i];
    if (character === undefined || character === ".") {
      end();
    } else if (array) {
      // Only a `.` or the end may follow `[]`.
      throw invalid();
    } else if (character === "\\") {
      const escaped = path[++i];
      if (escaped === undefined) throw invalid();
      key += escaped;
    } else if (character === "[") {
      if (path[++i] !== "]") throw invalid();
      array = true;
    } else if (character === "]") {
      throw invalid();
    } else {
      key += character;
    }
  }
  parsed.set(path, segments);
  return segments;
}

/** The path of a property, with `[]` added when the property is an array. */
export function childPath(parent: string, key: string, schema: Schema): string {
  const base = parent === "" ? escapeKey(key) : `${parent}.${escapeKey(key)}`;
  return schema.type === "array" ? `${base}[]` : base;
}

/** The repeating fields a path passes through, outermost first: `A[].B[].c` gives `A[]` and `A[].B[]`. */
export function arrayScopes(path: string): string[] {
  const scopes: string[] = [];
  let prefix = "";
  for (const segment of parsePath(path)) {
    prefix = prefix === "" ? escapeKey(segment.key) : `${prefix}.${escapeKey(segment.key)}`;
    if (segment.array) {
      prefix += "[]";
      scopes.push(prefix);
    }
  }
  return scopes;
}

const LOCAL_REF = /^#\/(\$defs|definitions)\/(.+)$/;

/** The schema a local `$ref` points at, or undefined when the root doesn't define it. */
function lookUp(root: Schema, ref: string): { name: string; schema: Schema } | undefined {
  const found = LOCAL_REF.exec(ref);
  if (!found) return undefined;
  // A JSON pointer escapes "/" as "~1" and "~" as "~0".
  const name = decodeURIComponent(found[2]!).replaceAll("~1", "/").replaceAll("~0", "~");
  const definitions = found[1] === "$defs" ? root.$defs : root.definitions;
  const schema = definitions && Object.hasOwn(definitions, name) ? definitions[name] : undefined;
  return schema ? { name: `${found[1]}/${name}`, schema } : undefined;
}


/**
 * The type a schema gives, as one type: JSON Schema allows a list, such as
 * `["string", "null"]`, which reads as its first type that isn't `null`. A
 * schema without one is an object if it has properties, an array if it has items.
 */
function typeOf(schema: Schema): Schema["type"] | undefined {
  const type = schema.type as Schema["type"] | Schema["type"][] | undefined;
  if (Array.isArray(type)) return type.find((t) => t !== "null") ?? (type.length > 0 ? "null" : undefined);
  if (type) return type;
  if (schema.properties) return "object";
  if (schema.items) return "array";
  // A const or enum says what its values are.
  const value = schema.const !== undefined ? schema.const : schema.enum?.find((v) => v !== null);
  if (value === undefined) return undefined;
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (typeof value === "number") return Number.isInteger(value) ? "integer" : "number";
  return typeof value === "object" ? "object" : typeof value === "string" ? "string" : "boolean";
}

/**
 * Two shapes as one. Records keep the first's fields in order, then the
 * second's new ones, merging fields both have. `required` is everything
 * either requires, or, for alternatives, only what both require. Shapes of
 * different types can't be merged, so the first is kept.
 */
function combine(a: Schema, b: Schema, alternatives: boolean): Schema {
  const type = typeOf(a) ?? typeOf(b);
  if (typeOf(a) !== undefined && typeOf(b) !== undefined && typeOf(a) !== typeOf(b)) return a;
  const result: Schema = { ...b, ...a, type: type ?? "object" };
  if (type === "object") {
    const properties: Record<string, Schema> = { ...a.properties };
    for (const [key, schema] of Object.entries(b.properties ?? {})) {
      const existing = Object.hasOwn(properties, key) ? properties[key] : undefined;
      Object.defineProperty(properties, key, { value: existing ? combine(existing, schema, alternatives) : schema, enumerable: true, writable: true, configurable: true });
    }
    if (a.properties || b.properties) result.properties = properties;
    const required = alternatives
      ? (a.required ?? []).filter((name) => (b.required ?? []).includes(name))
      : [...new Set([...(a.required ?? []), ...(b.required ?? [])])];
    if (required.length > 0) result.required = required;
    else delete result.required;
  }
  if (type === "array" && a.items && b.items) result.items = combine(a.items, b.items, alternatives);
  return result;
}

const resolved = new WeakMap<Schema, Schema>();

/**
 * The schema as one plain shape: its local `$ref`s replaced by what they
 * point at, `allOf` merged in, `oneOf` and `anyOf` read as one record with
 * every alternative's fields, and `type` a single type. A reference back to a
 * schema it's already inside, such as a category of categories, stops there as
 * a record with no fields listed, which can still be copied whole. A reference
 * the root doesn't define stays a record with no fields; `unresolvedRefs` lists those.
 */
export function resolveSchema(root: Schema): Schema {
  const cached = resolved.get(root);
  if (cached) return cached;
  const expand = (schema: Schema, inside: string[]): Schema => {
    const { $ref, $defs: _defs, definitions: _definitions, allOf, oneOf, anyOf, ...rest } = schema;
    if ($ref !== undefined) {
      const target = lookUp(root, $ref);
      if (!target || inside.includes(target.name)) {
        return { type: (target && typeOf(target.schema)) ?? "object", ...(target?.schema.title ? { title: target.schema.title } : {}), ...(rest.title ? { title: rest.title } : {}) };
      }
      // Anything written beside the $ref, such as a title, adds to what it points at.
      return expand({ ...target.schema, ...rest, ...(allOf ? { allOf } : {}), ...(oneOf ? { oneOf } : {}), ...(anyOf ? { anyOf } : {}) }, [...inside, target.name]);
    }
    let result: Schema = { ...rest };
    const type = typeOf(rest);
    if (type) result.type = type;
    else delete (result as Partial<Schema>).type;
    if (rest.properties) result.properties = Object.fromEntries(Object.entries(rest.properties).map(([key, child]) => [key, expand(child, inside)]));
    if (rest.items) result.items = expand(rest.items, inside);
    for (const part of allOf ?? []) result = combine(result, expand(part, inside), false);
    const either = (oneOf ?? anyOf ?? []).map((alternative) => expand(alternative, inside)).filter((alternative) => alternative.type !== "null");
    if (either.length > 0) result = combine(result, either.slice(1).reduce((a, b) => combine(a, b, true), either[0]!), false);
    result.type ??= "object";
    return result;
  };
  const result = expand(root, []);
  resolved.set(root, result);
  resolved.set(result, result);
  return result;
}

/** The `$ref`s, reached from the root, that don't point at anything the schema defines. */
export function unresolvedRefs(root: Schema): string[] {
  const missing = new Set<string>();
  const visit = (schema: Schema | undefined, inside: string[]) => {
    if (!schema) return;
    if (schema.$ref !== undefined) {
      const target = lookUp(root, schema.$ref);
      if (!target) missing.add(schema.$ref);
      else if (!inside.includes(target.name)) visit(target.schema, [...inside, target.name]);
    }
    for (const child of Object.values(schema.properties ?? {})) visit(child, inside);
    visit(schema.items, inside);
    for (const part of [...(schema.allOf ?? []), ...(schema.oneOf ?? []), ...(schema.anyOf ?? [])]) visit(part, inside);
  };
  visit(root, []);
  return [...missing];
}

/** The schema at a path, or undefined when the path isn't in the schema. `X[]` gives the item schema. */
export function schemaAt(root: Schema, path: string): Schema | undefined {
  let current: Schema | undefined = resolveSchema(root);
  for (const segment of parsePath(path)) {
    const properties: Record<string, Schema> | undefined =
      current?.type === "object" ? current.properties : undefined;
    if (!properties || !Object.hasOwn(properties, segment.key)) return undefined;
    current = properties[segment.key];
    if (!current) return undefined;
    if (segment.array !== (current.type === "array")) return undefined;
    if (segment.array) current = current.items;
  }
  return current;
}

/** True for a schema holding a single value rather than an object or array. */
export function isValueSchema(schema: Schema): boolean {
  return schema.type !== "object" && schema.type !== "array";
}

/** One row of a schema tree, as the canvas draws it. */
export interface Field {
  path: string;
  name: string;
  depth: number;
  /** For a repeating field, the schema of one item. */
  schema: Schema;
  repeating: boolean;
  /** True when the record it's in lists it as required. */
  required: boolean;
}

/** Flattens a schema into tree rows, depth first in property order. */
export function listFields(root: Schema): Field[] {
  const fields: Field[] = [];
  const walk = (schema: Schema, path: string, depth: number) => {
    if (schema.type !== "object") return;
    for (const [name, child] of Object.entries(schema.properties ?? {})) {
      const repeating = child.type === "array";
      const shape = repeating ? child.items : child;
      if (!shape) continue;
      const fieldPath = childPath(path, name, child);
      fields.push({ path: fieldPath, name, depth, schema: shape, repeating, required: schema.required?.includes(name) ?? false });
      walk(shape, fieldPath, depth + 1);
    }
  };
  walk(resolveSchema(root), "", 0);
  return fields;
}

/** Builds a schema from a sample document, merging the items of each array. */
export function inferSchema(sample: JsonValue): Schema {
  if (Array.isArray(sample)) {
    let items: Schema | undefined;
    for (const item of sample) {
      const schema = inferSchema(item);
      items = items ? mergeSchemas(items, schema) : schema;
    }
    return items ? { type: "array", items } : { type: "array" };
  }
  if (sample === null) return { type: "null" };
  if (typeof sample === "object") {
    const properties: Record<string, Schema> = {};
    for (const [key, value] of Object.entries(sample)) {
      Object.defineProperty(properties, key, { value: inferSchema(value), enumerable: true, writable: true, configurable: true });
    }
    return { type: "object", properties };
  }
  if (typeof sample === "number") return { type: Number.isInteger(sample) ? "integer" : "number" };
  return { type: typeof sample === "string" ? "string" : "boolean" };
}

function mergeSchemas(a: Schema, b: Schema): Schema {
  if (a.type === "null") return b;
  if (b.type === "null") return a;
  if (a.type === "object" && b.type === "object") {
    const properties = { ...a.properties };
    for (const [key, schema] of Object.entries(b.properties ?? {})) {
      const existing = Object.hasOwn(properties, key) ? properties[key] : undefined;
      Object.defineProperty(properties, key, {
        value: existing ? mergeSchemas(existing, schema) : schema,
        enumerable: true,
        writable: true,
        configurable: true,
      });
    }
    return { type: "object", properties };
  }
  if (a.type === "array" && b.type === "array") {
    if (!a.items) return b;
    if (!b.items) return a;
    return { type: "array", items: mergeSchemas(a.items, b.items) };
  }
  const numeric = (s: Schema) => s.type === "number" || s.type === "integer";
  if (numeric(a) && numeric(b)) return { type: a.type === "integer" && b.type === "integer" ? "integer" : "number" };
  // Conflicting types: the first one seen wins.
  return a;
}
