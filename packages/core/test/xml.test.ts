import { describe, expect, it } from "vitest";
import { createTransform, inferXmlSchema, jsonToXml, listFields, parseXml, xmlToJson, type MapDocument, type Schema } from "../src/index.js";

const order = `<?xml version="1.0" encoding="UTF-8"?>
<!-- An order from the old system -->
<ord:Order xmlns:ord="urn:example:orders" number="SO-1042" priority="2">
  <ord:Customer vip="true">Ana &amp; Co</ord:Customer>
  <ord:Line><ord:Sku>TEA-12</ord:Sku><ord:Qty>2</ord:Qty><ord:Price>4.5</ord:Price></ord:Line>
  <ord:Line><ord:Sku>MUG-01</ord:Sku><ord:Qty>1</ord:Qty><ord:Price>8</ord:Price></ord:Line>
  <ord:Note><![CDATA[Leave at <reception>]]></ord:Note>
  <ord:Discount xsi:nil="true" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"/>
</ord:Order>`;

const schema: Schema = {
  type: "object",
  xml: { name: "Order", namespace: "urn:example:orders" },
  properties: {
    number: { type: "string", xml: { attribute: true } },
    priority: { type: "integer", xml: { attribute: true } },
    Customer: {
      type: "object",
      properties: { vip: { type: "boolean", xml: { attribute: true } }, name: { type: "string", xml: { nodeType: "text" } } },
    },
    Line: { type: "array", items: { type: "object", properties: { Sku: { type: "string" }, Qty: { type: "integer" }, Price: { type: "number" } } } },
    Note: { type: "string" },
    Discount: { type: "number" },
  },
};

describe("XML", () => {
  it("parses elements, attributes, text, CDATA and namespaces", () => {
    const root = parseXml(order);
    expect(root.local).toBe("Order");
    expect(root.namespace).toBe("urn:example:orders");
    expect(root.attributes.map((a) => a.local)).toEqual(["number", "priority"]);
  });

  it("reads XML into JSON by the schema: attributes, repeats, types and nil", () => {
    expect(xmlToJson(order, schema)).toEqual({
      number: "SO-1042",
      priority: 2,
      Customer: { vip: true, name: "Ana & Co" },
      Line: [
        { Sku: "TEA-12", Qty: 2, Price: 4.5 },
        { Sku: "MUG-01", Qty: 1, Price: 8 },
      ],
      Note: "Leave at <reception>",
      Discount: null,
    });
  });

  it("reads XML without a schema: text, and arrays where elements repeat", () => {
    expect(xmlToJson("<a x='1'><b>one</b><b>two</b><c>three</c></a>")).toEqual({ x: "1", b: ["one", "two"], c: "three" });
  });

  it("writes JSON as XML by the schema, in its order, with the root's name and namespace", () => {
    const xml = jsonToXml({ Line: [{ Qty: 2, Sku: "TEA" }], number: "SO-1", Customer: { name: "Ana <& Co>", vip: false }, Discount: null }, schema);
    expect(xml).toBe(
      [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<Order xmlns="urn:example:orders" number="SO-1">',
        '  <Customer vip="false">Ana &lt;&amp; Co&gt;</Customer>',
        "  <Line>",
        "    <Sku>TEA</Sku>",
        "    <Qty>2</Qty>",
        "  </Line>",
        "</Order>",
        "",
      ].join("\n"),
    );
    // And reads back as it was written.
    expect(xmlToJson(xml, schema)).toEqual({ number: "SO-1", Customer: { vip: false, name: "Ana <& Co>" }, Line: [{ Sku: "TEA", Qty: 2 }] });
  });

  it("writes wrapped arrays inside an element of their own", () => {
    const wrapped: Schema = { type: "object", xml: { name: "Basket" }, properties: { items: { type: "array", xml: { wrapped: true }, items: { type: "string", xml: { name: "item" } } } } };
    const xml = jsonToXml({ items: ["a", "b"] }, wrapped, { declaration: false, indent: 0 });
    expect(xml).toBe("<Basket><items><item>a</item><item>b</item></items></Basket>");
    expect(xmlToJson(xml, wrapped)).toEqual({ items: ["a", "b"] });
  });

  it("makes a schema from a sample XML document", () => {
    const inferred = inferXmlSchema(order);
    expect(inferred.xml).toEqual({ name: "Order", namespace: "urn:example:orders" });
    expect(listFields(inferred).map((f) => f.path)).toEqual(["number", "priority", "Customer", "Customer.vip", "Customer.#text", "Line[]", "Line[].Sku", "Line[].Qty", "Line[].Price", "Note", "Discount"]);
  });

  it("maps XML to XML through an ordinary map", () => {
    const target: Schema = { type: "object", xml: { name: "Invoice" }, properties: { ref: { type: "string", xml: { attribute: true } }, Item: { type: "array", items: { type: "object", properties: { Code: { type: "string" }, Units: { type: "integer" } } } } } };
    const map: MapDocument = {
      version: 1,
      source: schema,
      target,
      nodes: [],
      links: [
        { from: { source: "number" }, to: { target: "ref" } },
        { from: { source: "Line[].Sku" }, to: { target: "Item[].Code" } },
        { from: { source: "Line[].Qty" }, to: { target: "Item[].Units" } },
      ],
      loops: [{ source: "Line[]", target: "Item[]" }],
    };
    const out = createTransform(map)(xmlToJson(order, schema));
    expect(jsonToXml(out, target, { indent: 0, declaration: false })).toBe('<Invoice ref="SO-1042"><Item><Code>TEA-12</Code><Units>2</Units></Item><Item><Code>MUG-01</Code><Units>1</Units></Item></Invoice>');
  });

  it("never expands a DOCTYPE's entities, and says where a document is broken", () => {
    const attack = `<!DOCTYPE a [<!ENTITY x SYSTEM "file:///etc/passwd">]><a>&x;</a>`;
    expect(() => xmlToJson(attack)).toThrow("Unknown entity &x;");
    expect(() => parseXml("<a><b></a>")).toThrow("Expected </b> but found </a> (line 1)");
  });
});
