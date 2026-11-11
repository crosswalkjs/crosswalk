import { describe, expect, it } from "vitest";
import { listFields, openApiSchemas, unresolvedRefs, type Schema } from "../src/index.js";

const order = {
  type: "object",
  required: ["id"],
  properties: {
    id: { type: "string" },
    customer: { $ref: "#/components/schemas/Customer" },
    lines: { type: "array", items: { $ref: "#/components/schemas/Line" } },
    note: { type: ["string", "null"] },
  },
};

const api31 = {
  openapi: "3.1.0",
  paths: {
    "/orders": {
      post: {
        summary: "Place an order",
        requestBody: { $ref: "#/components/requestBodies/NewOrder" },
        responses: { "201": { content: { "application/json": { schema: { $ref: "#/components/schemas/Order" } } } }, "400": { description: "Bad request" } },
      },
    },
    "/orders/{id}": {
      get: { responses: { "200": { content: { "application/vnd.shop+json": { schema: { $ref: "#/components/schemas/Order" } } } } } },
    },
  },
  components: {
    requestBodies: { NewOrder: { content: { "application/json": { schema: { allOf: [{ $ref: "#/components/schemas/Order" }, { properties: { coupon: { type: "string" } } }] } } } } },
    schemas: {
      Order: order,
      Customer: { type: "object", description: "Who ordered", properties: { name: { type: "string" }, email: { type: "string" } } },
      Line: { type: "object", properties: { sku: { type: "string" }, qty: { type: "integer" } } },
    },
  },
};

const paths = (schema: Schema) => listFields(schema).map((field) => field.path);

describe("OpenAPI documents", () => {
  it("lists each operation's request and response bodies, then the component schemas", () => {
    expect(openApiSchemas(api31).map((s) => s.name)).toEqual([
      "POST /orders request",
      "POST /orders response 201",
      "GET /orders/{id} response 200",
      "Order",
      "Customer",
      "Line",
    ]);
    expect(openApiSchemas(api31)[0]!.description).toBe("Place an order");
  });

  it("gives schemas that stand alone, references and all", () => {
    const request = openApiSchemas(api31).find((s) => s.name === "POST /orders request")!.schema;
    expect(unresolvedRefs(request)).toEqual([]);
    expect(paths(request)).toEqual(["id", "customer", "customer.name", "customer.email", "lines[]", "lines[].sku", "lines[].qty", "note", "coupon"]);
    expect(paths(openApiSchemas(api31).find((s) => s.name === "Customer")!.schema)).toEqual(["name", "email"]);
  });

  it("reads OpenAPI 3.0 and Swagger 2.0 too", () => {
    const api30 = { ...api31, openapi: "3.0.3" };
    expect(openApiSchemas(api30)).toHaveLength(6);
    const swagger = {
      swagger: "2.0",
      paths: {
        "/orders": {
          post: {
            parameters: [{ in: "body", name: "order", schema: { $ref: "#/definitions/Order" } }],
            responses: { "200": { schema: { $ref: "#/definitions/Order" } } },
          },
        },
      },
      definitions: { Order: { type: "object", properties: { id: { type: "string" }, customer: { $ref: "#/definitions/Customer" } } }, Customer: { type: "object", properties: { name: { type: "string" } } } },
    };
    const found = openApiSchemas(swagger);
    expect(found.map((s) => s.name)).toEqual(["POST /orders request", "POST /orders response 200", "Order", "Customer"]);
    expect(paths(found[0]!.schema)).toEqual(["id", "customer", "customer.name"]);
  });

  it("says when it isn't given an OpenAPI document", () => {
    expect(() => openApiSchemas({ type: "object" })).toThrow("This isn't an OpenAPI document");
  });
});
