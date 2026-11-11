import { resolveSchema } from "./paths.js";
import type { JsonValue, Schema, XmlHint } from "./types.js";

/*
 * XML at the edges. Crosswalk maps JSON, so XML is read into JSON before a
 * map runs and written back out after, following the schema:
 *
 * - The root element is the map's root record. Its name, and namespace, are
 *   in the root schema's `xml`, for writing back.
 * - Child elements are fields, by their local names (prefixes dropped). An
 *   element the schema says repeats, or that repeats in the document, is an array.
 * - Attributes are fields too, marked `xml: { attribute: true }`.
 * - The text of an element that has attributes as well is in a `#text` field,
 *   marked `xml: { nodeType: "text" }`.
 * - Values take the schema's type: numbers, booleans, and text otherwise.
 *
 * This follows the `xml` object OpenAPI uses, so a schema from an OpenAPI
 * document with `xml` hints reads and writes the same way.
 */

/** A parsed element: its name with any prefix, local name, namespace, attributes and children. */
export interface XmlElement {
  name: string;
  local: string;
  namespace?: string;
  attributes: { name: string; local: string; namespace?: string; value: string }[];
  children: (XmlElement | string)[];
}

const ENTITIES: Record<string, string> = { lt: "<", gt: ">", amp: "&", quot: '"', apos: "'" };

function decode(text: string, at: () => string): string {
  return text.replace(/&(#x[0-9a-fA-F]+|#\d+|[A-Za-z][\w.-]*);/g, (_, entity: string) => {
    if (entity.startsWith("#x")) return String.fromCodePoint(Number.parseInt(entity.slice(2), 16));
    if (entity.startsWith("#")) return String.fromCodePoint(Number.parseInt(entity.slice(1), 10));
    if (Object.hasOwn(ENTITIES, entity)) return ENTITIES[entity]!;
    throw new Error(`Unknown entity &${entity}; ${at()}`);
  });
}

/**
 * Parses an XML document. It reads elements, attributes, text, CDATA and
 * namespaces, and skips comments, processing instructions and any DOCTYPE,
 * whose entities it never expands, so it's safe on documents from anywhere.
 */
export function parseXml(xml: string): XmlElement {
  let i = 0;
  const line = () => `(line ${xml.slice(0, i).split("\n").length})`;
  const fail = (message: string): never => {
    throw new Error(`${message} ${line()}`);
  };
  const skipSpace = () => {
    while (i < xml.length && /\s/.test(xml[i]!)) i++;
  };
  // Comments, processing instructions and a DOCTYPE, wherever they're allowed.
  const skipMarkup = (): boolean => {
    if (xml.startsWith("<!--", i)) {
      const end = xml.indexOf("-->", i + 4);
      if (end < 0) fail("A comment isn't closed");
      i = end + 3;
      return true;
    }
    if (xml.startsWith("<?", i)) {
      const end = xml.indexOf("?>", i + 2);
      if (end < 0) fail("A processing instruction isn't closed");
      i = end + 2;
      return true;
    }
    if (xml.startsWith("<!DOCTYPE", i)) {
      let depth = 0;
      for (; i < xml.length; i++) {
        if (xml[i] === "[") depth++;
        else if (xml[i] === "]") depth--;
        else if (xml[i] === ">" && depth === 0) break;
      }
      i++;
      return true;
    }
    return false;
  };
  const name = () => {
    const match = /^[A-Za-z_:][\w.:-]*/.exec(xml.slice(i, i + 200));
    if (!match) fail("Expected a name");
    i += match![0].length;
    return match![0];
  };
  const split = (qualified: string) => {
    const colon = qualified.indexOf(":");
    return colon < 0 ? { prefix: "", local: qualified } : { prefix: qualified.slice(0, colon), local: qualified.slice(colon + 1) };
  };

  const element = (scope: Map<string, string>): XmlElement => {
    i++; // <
    const qualified = name();
    const raw: { name: string; value: string }[] = [];
    for (;;) {
      skipSpace();
      if (xml.startsWith("/>", i) || xml[i] === ">") break;
      const attribute = name();
      skipSpace();
      if (xml[i] !== "=") fail(`Expected = after ${attribute}`);
      i++;
      skipSpace();
      const quote = xml[i];
      if (quote !== '"' && quote !== "'") fail(`Expected a quoted value for ${attribute}`);
      const end = xml.indexOf(quote!, i + 1);
      if (end < 0) fail(`The value of ${attribute} isn't closed`);
      raw.push({ name: attribute, value: decode(xml.slice(i + 1, end), line) });
      i = end + 1;
    }
    // Namespace declarations on this element apply to it and what's inside.
    const inner = new Map(scope);
    for (const { name: attribute, value } of raw) {
      if (attribute === "xmlns") inner.set("", value);
      else if (attribute.startsWith("xmlns:")) inner.set(attribute.slice(6), value);
    }
    const { prefix, local } = split(qualified);
    const namespace = inner.get(prefix);
    const node: XmlElement = {
      name: qualified,
      local,
      ...(namespace ? { namespace } : {}),
      attributes: raw
        .filter(({ name: attribute }) => attribute !== "xmlns" && !attribute.startsWith("xmlns:"))
        .map(({ name: attribute, value }) => {
          const parts = split(attribute);
          // Unprefixed attributes are in no namespace.
          const ns = parts.prefix ? inner.get(parts.prefix) : undefined;
          return { name: attribute, local: parts.local, ...(ns ? { namespace: ns } : {}), value };
        }),
      children: [],
    };
    if (xml.startsWith("/>", i)) {
      i += 2;
      return node;
    }
    i++; // >
    for (;;) {
      if (i >= xml.length) fail(`<${qualified}> isn't closed`);
      if (xml.startsWith("</", i)) {
        i += 2;
        const closing = name();
        if (closing !== qualified) fail(`Expected </${qualified}> but found </${closing}>`);
        skipSpace();
        if (xml[i] !== ">") fail(`Expected > to close </${closing}`);
        i++;
        return node;
      }
      if (xml.startsWith("<![CDATA[", i)) {
        const end = xml.indexOf("]]>", i);
        if (end < 0) fail("A CDATA section isn't closed");
        node.children.push(xml.slice(i + 9, end));
        i = end + 3;
        continue;
      }
      if (skipMarkup()) continue;
      if (xml[i] === "<") {
        node.children.push(element(inner));
        continue;
      }
      const next = xml.indexOf("<", i);
      const text = xml.slice(i, next < 0 ? xml.length : next);
      node.children.push(decode(text, line));
      i = next < 0 ? xml.length : next;
    }
  };

  for (;;) {
    skipSpace();
    if (i >= xml.length) fail("There's no root element");
    if (skipMarkup()) continue;
    if (xml[i] !== "<") fail("Expected the root element");
    const root = element(new Map([["xml", "http://www.w3.org/XML/1998/namespace"]]));
    skipSpace();
    while (i < xml.length && skipMarkup()) skipSpace();
    if (i < xml.length) fail("There's more after the root element");
    return root;
  }
}

/** The hint on a schema, read either way OpenAPI writes it. */
const hintOf = (schema: Schema | undefined): XmlHint => schema?.xml ?? {};
const isAttribute = (schema: Schema | undefined) => hintOf(schema).attribute === true || hintOf(schema).nodeType === "attribute";
const isText = (schema: Schema | undefined) => hintOf(schema).nodeType === "text" || hintOf(schema).nodeType === "cdata";

/** A field's text as the schema's type says; text it can't read as that type stays text. */
function typed(text: string, schema: Schema | undefined): JsonValue {
  const value = text.trim();
  switch (schema?.type) {
    case "integer":
    case "number": {
      const number = Number(value);
      return value !== "" && Number.isFinite(number) ? number : text;
    }
    case "boolean":
      return value === "true" || value === "1" ? true : value === "false" || value === "0" ? false : text;
    default:
      return text;
  }
}

const XSI = "http://www.w3.org/2001/XMLSchema-instance";
const elementsOf = (node: XmlElement) => node.children.filter((child): child is XmlElement => typeof child !== "string");
const textOf = (node: XmlElement) => node.children.filter((child): child is string => typeof child === "string").join("");

/**
 * Reads an XML document into the JSON a map takes, following the schema:
 * which fields are attributes, which repeat, and what type each is. Without a
 * schema, every value is text, and an element that repeats is an array.
 */
export function xmlToJson(xml: string | XmlElement, schema?: Schema): JsonValue {
  const root = typeof xml === "string" ? parseXml(xml) : xml;
  return readElement(root, schema ? resolveSchema(schema) : undefined);
}

function readElement(node: XmlElement, schema: Schema | undefined): JsonValue {
  if (node.attributes.some((a) => a.namespace === XSI && a.local === "nil" && a.value === "true")) return null;
  const properties = schema?.type === "object" ? (schema.properties ?? {}) : undefined;
  const children = elementsOf(node);
  const attributes = node.attributes.filter((a) => a.namespace !== XSI);
  // A value: no child elements or attributes, and the schema doesn't say it's a record.
  if (schema ? schema.type !== "object" : children.length === 0 && attributes.length === 0) return typed(textOf(node), schema);

  const result: Record<string, JsonValue> = {};
  const put = (key: string, value: JsonValue) => Object.defineProperty(result, key, { value, enumerable: true, writable: true, configurable: true });
  if (properties) {
    // By the schema: each field from its attribute, its element or elements, or the text.
    for (const [key, field] of Object.entries(properties)) {
      const hint = hintOf(field);
      const named = hint.name ?? key;
      if (isAttribute(field)) {
        const attribute = attributes.find((a) => a.local === named);
        if (attribute) put(key, typed(attribute.value, field));
      } else if (isText(field)) {
        const text = textOf(node);
        if (text.trim() !== "") put(key, typed(text, field));
      } else if (field.type === "array") {
        const itemName = hintOf(field.items).name ?? named;
        const holder = hint.wrapped ? children.find((c) => c.local === named) : node;
        if (!holder) continue;
        const items = elementsOf(holder).filter((c) => c.local === itemName);
        if (items.length > 0 || hint.wrapped) put(key, items.map((item) => readElement(item, field.items)));
      } else {
        const child = children.find((c) => c.local === named);
        if (child) put(key, readElement(child, field));
      }
    }
    return result;
  }
  // Without a schema: attributes, then elements, an element that repeats as an array, and any text.
  for (const attribute of attributes) put(attribute.local, attribute.value);
  const counts = new Map<string, number>();
  for (const child of children) counts.set(child.local, (counts.get(child.local) ?? 0) + 1);
  for (const [local, count] of counts) {
    const matching = children.filter((c) => c.local === local);
    put(local, count > 1 ? matching.map((c) => readElement(c, undefined)) : readElement(matching[0]!, undefined));
  }
  const text = textOf(node).trim();
  if (text !== "") put("#text", text);
  return result;
}

const escapeText = (text: string) => text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
const escapeAttribute = (text: string) => escapeText(text).replaceAll('"', "&quot;");
const asText = (value: JsonValue): string => (typeof value === "string" ? value : typeof value === "object" && value !== null ? JSON.stringify(value) : String(value));

export interface XmlWriteOptions {
  /** The root element's name, where the schema's `xml.name` doesn't give one. Defaults to the schema's title, or `root`. */
  root?: string;
  /** Spaces to indent by, or 0 for one line. Defaults to 2. */
  indent?: number;
  /** Starts with `<?xml version="1.0" encoding="UTF-8"?>`. Defaults to true. */
  declaration?: boolean;
}

/**
 * Writes what a map made as XML, following the target schema: attributes,
 * elements in the schema's order, repeated elements for arrays, and the
 * root's name and namespace from its `xml`. A field that's left out, or
 * null, writes nothing.
 */
export function jsonToXml(value: JsonValue, schema?: Schema, options: XmlWriteOptions = {}): string {
  const resolved = schema ? resolveSchema(schema) : undefined;
  const hint = hintOf(resolved);
  const rootName = hint.name ?? options.root ?? resolved?.title?.replace(/[^\w.-]/g, "") ?? "root";
  const indent = options.indent ?? 2;
  const lines: string[] = [];
  const pad = (depth: number) => (indent > 0 ? " ".repeat(indent * depth) : "");
  const newline = indent > 0 ? "\n" : "";
  const qualified = (name: string, field: Schema | undefined) => (hintOf(field).prefix ? `${hintOf(field).prefix}:${name}` : name);

  const write = (name: string, data: JsonValue, field: Schema | undefined, depth: number, declare = "") => {
    if (data === null || data === undefined) return;
    if (typeof data !== "object" || Array.isArray(data)) {
      if (Array.isArray(data)) {
        for (const item of data) write(name, item, field?.items, depth);
        return;
      }
      lines.push(`${pad(depth)}<${name}${declare}>${escapeText(asText(data))}</${name}>`);
      return;
    }
    const properties = field?.type === "object" ? (field.properties ?? {}) : {};
    const keys = [...Object.keys(properties).filter((k) => Object.hasOwn(data, k)), ...Object.keys(data).filter((k) => !Object.hasOwn(properties, k))];
    let attributes = "";
    let text: string | undefined;
    const elements: [string, JsonValue, Schema | undefined][] = [];
    for (const key of keys) {
      const inner = data[key]!;
      const sub = Object.hasOwn(properties, key) ? properties[key] : undefined;
      if (inner === null || inner === undefined) continue;
      if (isAttribute(sub) || (!sub && key.startsWith("@"))) attributes += ` ${qualified(hintOf(sub).name ?? key.replace(/^@/, ""), sub)}="${escapeAttribute(asText(inner))}"`;
      else if (isText(sub) || (!sub && key === "#text")) text = asText(inner);
      else elements.push([key, inner, sub]);
    }
    if (elements.length === 0) {
      lines.push(text === undefined ? `${pad(depth)}<${name}${declare}${attributes}/>` : `${pad(depth)}<${name}${declare}${attributes}>${escapeText(text)}</${name}>`);
      return;
    }
    lines.push(`${pad(depth)}<${name}${declare}${attributes}>${text === undefined ? "" : escapeText(text)}`);
    for (const [key, inner, sub] of elements) {
      const elementName = qualified(hintOf(sub).name ?? key, sub);
      if (Array.isArray(inner) && hintOf(sub).wrapped) {
        lines.push(`${pad(depth + 1)}<${elementName}>`);
        for (const item of inner) write(qualified(hintOf(sub?.items).name ?? key, sub?.items), item, sub?.items, depth + 2);
        lines.push(`${pad(depth + 1)}</${elementName}>`);
      } else if (Array.isArray(inner)) {
        for (const item of inner) write(qualified(hintOf(sub?.items).name ?? elementName, sub?.items), item, sub?.items, depth + 1);
      } else write(elementName, inner, sub, depth + 1);
    }
    lines.push(`${pad(depth)}</${name}>`);
  };

  const declare = hint.namespace ? (hint.prefix ? ` xmlns:${hint.prefix}="${escapeAttribute(hint.namespace)}"` : ` xmlns="${escapeAttribute(hint.namespace)}"`) : "";
  write(hint.prefix ? `${hint.prefix}:${rootName}` : rootName, value, resolved, 0, declare);
  return `${options.declaration === false ? "" : `<?xml version="1.0" encoding="UTF-8"?>${newline}`}${lines.join(newline)}${newline}`;
}

/**
 * A schema from a sample XML document: its attributes, elements and text,
 * with elements that repeat as arrays. Every value is text, since XML doesn't
 * say otherwise; an XSD gives types, if there is one.
 */
export function inferXmlSchema(xml: string | XmlElement): Schema {
  const root = typeof xml === "string" ? parseXml(xml) : xml;
  const shape = elementSchema(root);
  return { ...shape, type: "object", xml: { name: root.local, ...(root.namespace ? { namespace: root.namespace } : {}) } };
}

function elementSchema(node: XmlElement, merged?: Schema): Schema {
  const children = elementsOf(node);
  const attributes = node.attributes.filter((a) => a.namespace !== XSI);
  if (children.length === 0 && attributes.length === 0 && !merged?.properties) return merged?.type === "object" ? merged : { type: "string" };
  const properties: Record<string, Schema> = { ...(merged?.properties ?? {}) };
  const set = (key: string, schema: Schema) => Object.defineProperty(properties, key, { value: schema, enumerable: true, writable: true, configurable: true });
  for (const attribute of attributes) {
    if (!Object.hasOwn(properties, attribute.local)) set(attribute.local, { type: "string", xml: { attribute: true } });
  }
  const counts = new Map<string, XmlElement[]>();
  for (const child of children) counts.set(child.local, [...(counts.get(child.local) ?? []), child]);
  for (const [local, matching] of counts) {
    const existing = Object.hasOwn(properties, local) ? properties[local] : undefined;
    const before = existing?.type === "array" ? existing.items : existing;
    const item = matching.reduce<Schema | undefined>((schema, child) => elementSchema(child, schema), before);
    set(local, matching.length > 1 || existing?.type === "array" ? { type: "array", items: item! } : item!);
  }
  if (textOf(node).trim() !== "" && (attributes.length > 0 || children.length > 0)) set("#text", { type: "string", xml: { nodeType: "text" } });
  return { type: "object", properties };
}
