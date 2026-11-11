import type { Schema } from "./types.js";
import { parseXml, type XmlElement } from "./xml.js";

const XS = "http://www.w3.org/2001/XMLSchema";

/** A schema for one of the elements an XSD declares at the top level, ready to map from or to. */
export interface XsdSchema {
  /** The element's name. */
  name: string;
  /** The element's documentation, if it has any. */
  description?: string;
  /** Self-contained: the XSD's named complex types come along as `$defs`, and its `xml` names the root element and namespace. */
  schema: Schema;
}

/** XSD's built-in types, by local name, as JSON Schema types and formats. */
const BUILT_IN: Record<string, Schema> = {
  boolean: { type: "boolean" },
  decimal: { type: "number" },
  float: { type: "number" },
  double: { type: "number" },
  date: { type: "string", format: "date" },
  dateTime: { type: "string", format: "date-time" },
  time: { type: "string", format: "time" },
};
for (const name of ["integer", "int", "long", "short", "byte", "nonNegativeInteger", "positiveInteger", "nonPositiveInteger", "negativeInteger", "unsignedLong", "unsignedInt", "unsignedShort", "unsignedByte"]) {
  BUILT_IN[name] = { type: "integer" };
}

const local = (qualified: string | undefined) => qualified?.slice(qualified.indexOf(":") + 1);
const xs = (node: XmlElement, ...names: string[]) => node.namespace === XS && names.includes(node.local);
const kids = (node: XmlElement) => node.children.filter((child): child is XmlElement => typeof child !== "string");
const attr = (node: XmlElement, name: string) => node.attributes.find((a) => a.local === name && a.namespace === undefined)?.value;

/**
 * The schemas an XSD describes: one for each element it declares at the top
 * level, in the shape `xmlToJson` reads that element into. Named complex
 * types become `$defs`, so recursive types work. It reads sequences, choices
 * (whose elements are all optional), `all`, attributes and attribute groups,
 * groups, extensions of other types, simple content (as a `#text` field),
 * `minOccurs`/`maxOccurs` (more than one makes an array) and the built-in
 * types. `xs:include` and `xs:import` aren't followed.
 */
export function xsdSchemas(xsd: string): XsdSchema[] {
  const root = parseXml(xsd);
  if (!xs(root, "schema")) throw new Error("This isn't an XSD: its root isn't xs:schema");
  const targetNamespace = attr(root, "targetNamespace");
  const top = kids(root);
  const named = (kind: string) => new Map(top.filter((n) => xs(n, kind) && attr(n, "name")).map((n) => [attr(n, "name")!, n]));
  const complexTypes = named("complexType");
  const simpleTypes = named("simpleType");
  const elements = named("element");
  const groups = named("group");
  const attributeGroups = named("attributeGroup");
  const defs: Record<string, Schema> = {};
  const building = new Set<string>();

  const documentation = (node: XmlElement) => {
    const docs = kids(node).find((n) => xs(n, "annotation"))?.children.find((n): n is XmlElement => typeof n !== "string" && xs(n, "documentation"));
    const text = docs?.children.filter((c): c is string => typeof c === "string").join("").trim();
    return text ? { description: text } : {};
  };

  /** A simple type: built in, named, or a restriction, list or union written in place. */
  const simple = (typeName: string | undefined, inline?: XmlElement): Schema => {
    if (inline) {
      const restriction = kids(inline).find((n) => xs(n, "restriction"));
      if (restriction) {
        const base = simple(local(attr(restriction, "base")), kids(restriction).find((n) => xs(n, "simpleType")));
        const values = kids(restriction).filter((n) => xs(n, "enumeration")).map((n) => attr(n, "value")!);
        return values.length > 0 && base.type === "string" ? { ...base, enum: values } : base;
      }
      return { type: "string" };
    }
    const name = local(typeName);
    if (name && Object.hasOwn(BUILT_IN, name)) return { ...BUILT_IN[name]! };
    if (name && simpleTypes.has(name)) return simple(undefined, simpleTypes.get(name));
    return { type: "string" };
  };

  /** A type by name: a reference to its $defs entry for a complex type, otherwise a simple type. */
  const typeRef = (typeName: string | undefined): Schema => {
    const name = local(typeName);
    if (name && complexTypes.has(name)) {
      if (!Object.hasOwn(defs, name) && !building.has(name)) {
        building.add(name);
        defs[name] = complex(complexTypes.get(name)!);
      }
      return { $ref: `#/$defs/${name}` };
    }
    return simple(typeName);
  };

  /** An element's own schema, before whether it repeats. */
  const elementType = (node: XmlElement): Schema => {
    if (attr(node, "ref")) {
      const target = elements.get(local(attr(node, "ref"))!);
      return target ? elementType(target) : { type: "string" };
    }
    const inline = kids(node).find((n) => xs(n, "complexType", "simpleType"));
    if (inline) return inline.local === "complexType" ? complex(inline) : simple(undefined, inline);
    // No type at all is anything; read it as text.
    return attr(node, "type") ? typeRef(attr(node, "type")) : { type: "string" };
  };

  /** The fields a sequence, choice, all or group holds, with the elements that repeat as arrays. */
  const particles = (node: XmlElement, into: Schema, optional: boolean, repeats: boolean) => {
    const properties = (into.properties ??= {});
    const required = (into.required ??= []);
    const choice = xs(node, "choice");
    const groupRepeats = repeats || attr(node, "maxOccurs") === "unbounded" || Number(attr(node, "maxOccurs") ?? 1) > 1;
    const groupOptional = optional || choice || attr(node, "minOccurs") === "0";
    for (const child of kids(node)) {
      if (xs(child, "sequence", "choice", "all")) particles(child, into, groupOptional, groupRepeats);
      else if (xs(child, "group") && attr(child, "ref")) {
        const group = groups.get(local(attr(child, "ref"))!);
        const inner = group && kids(group).find((n) => xs(n, "sequence", "choice", "all"));
        if (inner) particles(inner, into, groupOptional || attr(child, "minOccurs") === "0", groupRepeats);
      } else if (xs(child, "element")) {
        const name = attr(child, "name") ?? local(attr(child, "ref"));
        if (!name) continue;
        const max = attr(child, "maxOccurs");
        const many = groupRepeats || max === "unbounded" || Number(max ?? 1) > 1;
        const shape = { ...elementType(child), ...documentation(child) };
        Object.defineProperty(properties, name, { value: many ? { type: "array", items: shape } : shape, enumerable: true, writable: true, configurable: true });
        if (!groupOptional && attr(child, "minOccurs") !== "0" && attr(child, "nillable") !== "true") required.push(name);
      }
    }
  };

  /** Attributes, and attribute groups, as fields. */
  const attributes = (node: XmlElement, into: Schema) => {
    for (const child of kids(node)) {
      if (xs(child, "attributeGroup") && attr(child, "ref")) {
        const group = attributeGroups.get(local(attr(child, "ref"))!);
        if (group) attributes(group, into);
      } else if (xs(child, "attribute")) {
        const name = attr(child, "name") ?? local(attr(child, "ref"));
        if (!name || attr(child, "use") === "prohibited") continue;
        const inline = kids(child).find((n) => xs(n, "simpleType"));
        const shape = { ...simple(attr(child, "type"), inline), xml: { attribute: true }, ...documentation(child) };
        Object.defineProperty((into.properties ??= {}), name, { value: shape, enumerable: true, writable: true, configurable: true });
        if (attr(child, "use") === "required") (into.required ??= []).push(name);
      }
    }
  };

  /** A complex type: its attributes and elements, or text with attributes, or what it extends. */
  const complex = (node: XmlElement): Schema => {
    const schema: Schema = { type: "object", ...documentation(node) };
    for (const child of kids(node)) {
      if (xs(child, "sequence", "choice", "all", "group")) particles(xs(child, "group") ? { ...node, children: [child] } : child, schema, false, false);
      else if (xs(child, "complexContent", "simpleContent")) {
        const how = kids(child).find((n) => xs(n, "extension", "restriction"));
        if (!how) continue;
        if (xs(child, "simpleContent")) {
          // Text with attributes: the text is a field of its own.
          const text = simple(attr(how, "base"));
          schema.properties = { "#text": { ...text, xml: { nodeType: "text" } } };
          attributes(how, schema);
          continue;
        }
        const own: Schema = { type: "object" };
        for (const part of kids(how)) if (xs(part, "sequence", "choice", "all", "group")) particles(xs(part, "group") ? { ...how, children: [part] } : part, own, false, false);
        attributes(how, own);
        // An extension adds to its base; a restriction is read as the base it restricts.
        if (xs(how, "extension")) schema.allOf = [typeRef(attr(how, "base")), own];
        else Object.assign(schema, typeRef(attr(how, "base")));
      }
    }
    attributes(node, schema);
    if (schema.required?.length === 0) delete schema.required;
    return schema;
  };

  const found: XsdSchema[] = [];
  for (const [name, node] of elements) {
    const shape = elementType(node);
    const xml = { name, ...(targetNamespace ? { namespace: targetNamespace } : {}) };
    // An element of a named type is that type; the rest is the element's own schema.
    found.push({ name, ...documentation(node), schema: { ...shape, xml } });
  }
  // $defs last, once every type an element uses has been built.
  return found.map((entry) => ({ ...entry, schema: Object.keys(defs).length > 0 ? { ...entry.schema, $defs: { ...defs } } : entry.schema }));
}
