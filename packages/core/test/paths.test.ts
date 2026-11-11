import { describe, expect, it } from "vitest";
import { arrayScopes, escapeKey, inferSchema, listFields, parsePath, schemaAt, type Schema } from "../src/index.js";
import personInput from "./fixtures/person.input.json";

describe("paths", () => {
  it("lists the arrays a path passes through", () => {
    expect(arrayScopes("Orders[].Lines[].Amount")).toEqual(["Orders[]", "Orders[].Lines[]"]);
    expect(arrayScopes("FirstName")).toEqual([]);
  });

  it("infers a schema from a sample and lists it as tree rows", () => {
    const schema = inferSchema(personInput);
    expect(schemaAt(schema, "PhoneCalls[].Cost")).toEqual({ type: "number" });
    expect(schemaAt(schema, "PhoneCalls.Cost")).toBeUndefined();
    expect(listFields(schema).map((field) => `${"  ".repeat(field.depth)}${field.path}`)).toEqual([
      "FirstName",
      "LastName",
      "DateOfBirth",
      "Address",
      "ZipCode",
      "PhoneCalls[]",
      "  PhoneCalls[].PhoneNumber",
      "  PhoneCalls[].Cost",
    ]);
  });

  it("doesn't treat inherited properties as fields", () => {
    expect(schemaAt(inferSchema({ a: 1 }), "constructor")).toBeUndefined();
  });
});

describe("keys with . or [] in them", () => {
  it("are escaped with a backslash", () => {
    expect(escapeKey("unit.price")).toBe("unit\\.price");
    expect(escapeKey("tags[]")).toBe("tags\\[\\]");
    expect(escapeKey("back\\slash")).toBe("back\\\\slash");
    expect(parsePath("order\\.lines[].unit\\.price")).toEqual([
      { key: "order.lines", array: true },
      { key: "unit.price", array: false },
    ]);
    expect(parsePath("tags\\[\\]")).toEqual([{ key: "tags[]", array: false }]);
    expect(parsePath("tags\\[\\][]")).toEqual([{ key: "tags[]", array: true }]);
  });

  it("round-trip through the paths the editor builds", () => {
    const schema: Schema = { type: "object", properties: { "a.b": { type: "array", items: { type: "object", properties: { "c[]": { type: "string" } } } } } };
    const paths = listFields(schema).map((field) => field.path);
    expect(paths).toEqual(["a\\.b[]", "a\\.b[].c\\[\\]"]);
    expect(schemaAt(schema, paths[1]!)).toEqual({ type: "string" });
    expect(arrayScopes(paths[1]!)).toEqual(["a\\.b[]"]);
  });

  it("refuses paths that can't be read", () => {
    for (const bad of ["a..b", ".a", "a.", "a[]b", "a[x]", "a]", "a\\"]) expect(() => parsePath(bad), bad).toThrow();
  });
});

describe("schemas written with allOf, oneOf, anyOf and type lists", () => {
  const address = { type: "object", properties: { Street: { type: "string" }, City: { type: "string" } }, required: ["Street"] } as const;
  const root: Schema = {
    type: "object",
    $defs: { Address: address as unknown as Schema },
    properties: {
      // Inheritance: an address with a country added.
      Home: { allOf: [{ $ref: "#/$defs/Address" }, { properties: { Country: { type: "string" } }, required: ["Country"] }] } as unknown as Schema,
      // Either a card or a bank transfer.
      Payment: {
        oneOf: [
          { type: "object", properties: { Method: { type: "string" }, Card: { type: "string" } }, required: ["Method", "Card"] },
          { type: "object", properties: { Method: { type: "string" }, Iban: { type: "string" } }, required: ["Method"] },
        ],
      } as unknown as Schema,
      Nickname: { type: ["string", "null"] } as unknown as Schema,
      Discount: { anyOf: [{ type: "number" }, { type: "null" }] } as unknown as Schema,
      Lines: { type: "array", items: { allOf: [{ properties: { Sku: { type: "string" } } }, { properties: { Qty: { type: "integer" } } }] } } as unknown as Schema,
    },
  };

  it("merges allOf, following $refs", () => {
    const home = schemaAt(root, "Home")!;
    expect(home.type).toBe("object");
    expect(Object.keys(home.properties!)).toEqual(["Street", "City", "Country"]);
    expect(home.required).toEqual(["Street", "Country"]);
  });

  it("reads oneOf as one record with every alternative's fields, required only where all require them", () => {
    const payment = schemaAt(root, "Payment")!;
    expect(Object.keys(payment.properties!)).toEqual(["Method", "Card", "Iban"]);
    expect(payment.required).toEqual(["Method"]);
  });

  it("takes a type list, or an anyOf with null, as the type that isn't null", () => {
    expect(schemaAt(root, "Nickname")!.type).toBe("string");
    expect(schemaAt(root, "Discount")!.type).toBe("number");
  });

  it("lists the fields as the editor shows them", () => {
    expect(listFields(root).map((f) => f.path)).toEqual([
      "Home",
      "Home.Street",
      "Home.City",
      "Home.Country",
      "Payment",
      "Payment.Method",
      "Payment.Card",
      "Payment.Iban",
      "Nickname",
      "Discount",
      "Lines[]",
      "Lines[].Sku",
      "Lines[].Qty",
    ]);
  });
});
