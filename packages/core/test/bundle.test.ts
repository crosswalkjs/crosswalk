import { describe, expect, it } from "vitest";
import { bundleSchema, listFields, unresolvedRefs, type Schema } from "../src/index.js";

// A tiny file system: an order that refers to files beside it, which refer on.
const files: Record<string, unknown> = {
  "https://example.com/schemas/customer.json": {
    type: "object",
    properties: { name: { type: "string" }, address: { $ref: "common.json#/$defs/Address" } },
  },
  "https://example.com/schemas/common.json": {
    $defs: {
      Address: { type: "object", properties: { street: { type: "string" }, country: { $ref: "#/$defs/Country" } } },
      Country: { type: "string" },
    },
  },
  "https://example.com/schemas/lines/line.json": { type: "object", properties: { sku: { type: "string" } } },
};

const order: Schema = {
  type: "object",
  $defs: { Money: { type: "number" } },
  properties: {
    customer: { $ref: "customer.json" },
    lines: { type: "array", items: { $ref: "lines/line.json" } },
    total: { $ref: "#/$defs/Money" },
  },
};

describe("bundling a schema split across files", () => {
  it("brings what other files' references point at into $defs, so it stands alone", async () => {
    const loaded: string[] = [];
    const bundled = await bundleSchema(order, (url) => (loaded.push(url), files[url]), "https://example.com/schemas/order.json");
    expect(unresolvedRefs(bundled)).toEqual([]);
    expect(listFields(bundled).map((f) => f.path)).toEqual([
      "customer",
      "customer.name",
      "customer.address",
      "customer.address.street",
      "customer.address.country",
      "lines[]",
      "lines[].sku",
      "total",
    ]);
    expect(Object.keys(bundled.$defs!)).toEqual(["Money", "customer", "Address", "Country", "line"]);
    // Each document once, however many references reach it.
    expect(loaded.sort()).toEqual(Object.keys(files).sort());
  });

  it("leaves a schema with only its own references as it is", async () => {
    const plain: Schema = { type: "object", $defs: { A: { type: "string" } }, properties: { a: { $ref: "#/$defs/A" } } };
    expect(await bundleSchema(plain, () => undefined)).toEqual(plain);
  });

  it("says which reference points at nothing", async () => {
    await expect(bundleSchema({ type: "object", properties: { x: { $ref: "missing.json#/$defs/X" } } }, () => ({}), "file:///schemas/a.json")).rejects.toThrow(
      '"missing.json#/$defs/X" points at nothing in file:///schemas/missing.json',
    );
  });
});
