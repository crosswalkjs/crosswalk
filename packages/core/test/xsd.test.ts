import { describe, expect, it } from "vitest";
import { listFields, resolveSchema, unresolvedRefs, xmlToJson, xsdSchemas } from "../src/index.js";

const xsd = `<?xml version="1.0"?>
<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema" targetNamespace="urn:example:orders" elementFormDefault="qualified">
  <xs:element name="Order" type="OrderType">
    <xs:annotation><xs:documentation>An order from the shop.</xs:documentation></xs:annotation>
  </xs:element>
  <xs:complexType name="PartyType">
    <xs:sequence>
      <xs:element name="Name" type="xs:string"/>
    </xs:sequence>
  </xs:complexType>
  <xs:complexType name="CustomerType">
    <xs:complexContent>
      <xs:extension base="PartyType">
        <xs:sequence><xs:element name="Email" type="xs:string" minOccurs="0"/></xs:sequence>
        <xs:attribute name="vip" type="xs:boolean"/>
      </xs:extension>
    </xs:complexContent>
  </xs:complexType>
  <xs:complexType name="OrderType">
    <xs:sequence>
      <xs:element name="Customer" type="CustomerType"/>
      <xs:element name="Line" maxOccurs="unbounded">
        <xs:complexType>
          <xs:sequence>
            <xs:element name="Sku" type="xs:string"/>
            <xs:element name="Qty" type="xs:int"/>
            <xs:element name="Price" type="MoneyType"/>
          </xs:sequence>
        </xs:complexType>
      </xs:element>
      <xs:choice>
        <xs:element name="Card" type="xs:string"/>
        <xs:element name="Invoice" type="xs:string"/>
      </xs:choice>
      <xs:element name="PlacedAt" type="xs:dateTime"/>
      <xs:element name="Status" type="StatusType"/>
      <xs:element name="Parent" type="OrderType" minOccurs="0"/>
    </xs:sequence>
    <xs:attribute name="number" type="xs:string" use="required"/>
  </xs:complexType>
  <xs:complexType name="MoneyType">
    <xs:simpleContent>
      <xs:extension base="xs:decimal"><xs:attribute name="currency" type="xs:string"/></xs:extension>
    </xs:simpleContent>
  </xs:complexType>
  <xs:simpleType name="StatusType">
    <xs:restriction base="xs:string"><xs:enumeration value="placed"/><xs:enumeration value="shipped"/></xs:restriction>
  </xs:simpleType>
</xs:schema>`;

describe("XSD", () => {
  const [order] = xsdSchemas(xsd);

  it("gives a schema for each top-level element, standing alone", () => {
    expect(xsdSchemas(xsd).map((s) => s.name)).toEqual(["Order"]);
    expect(order!.description).toBe("An order from the shop.");
    expect(order!.schema.xml).toEqual({ name: "Order", namespace: "urn:example:orders" });
    expect(unresolvedRefs(order!.schema)).toEqual([]);
  });

  it("reads types, extensions, choices, repeats, simple content and recursion", () => {
    expect(listFields(order!.schema).map((f) => `${f.path}:${f.schema.type}`)).toEqual([
      "Customer:object",
      "Customer.Name:string",
      "Customer.Email:string",
      "Customer.vip:boolean",
      "Line[]:object",
      "Line[].Sku:string",
      "Line[].Qty:integer",
      "Line[].Price:object",
      "Line[].Price.#text:number",
      "Line[].Price.currency:string",
      "Card:string",
      "Invoice:string",
      "PlacedAt:string",
      "Status:string",
      "Parent:object",
      "number:string",
    ]);
    const resolved = resolveSchema(order!.schema);
    // A choice's elements are optional; an attribute with use="required" isn't.
    expect(resolved.required).toEqual(["Customer", "Line", "PlacedAt", "Status", "number"]);
    expect(resolved.properties!.Status!.enum).toEqual(["placed", "shipped"]);
    expect(resolved.properties!.PlacedAt!.format).toBe("date-time");
  });

  it("reads a document of that element by the schema", () => {
    const xml = `<Order xmlns="urn:example:orders" number="SO-9"><Customer vip="true"><Name>Ana</Name></Customer>
      <Line><Sku>TEA</Sku><Qty>2</Qty><Price currency="GBP">4.50</Price></Line><Invoice>INV-1</Invoice>
      <PlacedAt>2026-03-04T10:22:00Z</PlacedAt><Status>placed</Status></Order>`;
    expect(xmlToJson(xml, order!.schema)).toEqual({
      Customer: { Name: "Ana", vip: true },
      Line: [{ Sku: "TEA", Qty: 2, Price: { "#text": 4.5, currency: "GBP" } }],
      Invoice: "INV-1",
      PlacedAt: "2026-03-04T10:22:00Z",
      Status: "placed",
      number: "SO-9",
    });
  });

  it("says when it isn't given an XSD", () => {
    expect(() => xsdSchemas("<a/>")).toThrow("This isn't an XSD");
  });
});
