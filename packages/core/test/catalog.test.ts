import { describe, expect, it } from "vitest";
import { analyseMap, createAsyncTransform, createRegistry, createTransform, defineOperator, registryFromCatalog, type MapDocument, type OperatorCatalog } from "../src/index.js";

// What a server's catalogue looks like: the built-ins plus a server-only lookup.
const serverCatalog: OperatorCatalog = {
  categories: [...createRegistry().toCatalog().categories, { id: "acme", label: "Acme", color: "#ff3366" }],
  operators: [
    ...createRegistry().toCatalog().operators,
    { id: "acme.tier", kind: "value", label: "Customer tier", category: "acme", inputs: { min: 1, max: 1 }, async: true },
    { id: "acme.weightedTotal", kind: "aggregate", label: "Weighted total", category: "acme", inputs: { min: 1, max: 1 } },
  ],
};

const map = (operator: string): MapDocument => ({
  version: 1,
  source: { type: "object", properties: { Id: { type: "string" } } },
  target: { type: "object", properties: { Out: { type: "string" } } },
  nodes: [{ id: "op", operator }],
  links: [
    { from: { source: "Id" }, to: { node: "op", input: 0 } },
    { from: { node: "op" }, to: { target: "Out" } },
  ],
});

describe("registryFromCatalog", () => {
  const registry = registryFromCatalog(serverCatalog);

  it("offers every operator and category the server has", () => {
    expect(registry.list()).toHaveLength(serverCatalog.operators.length);
    expect(registry.getCategory("acme")).toEqual({ id: "acme", label: "Acme", color: "#ff3366" });
  });

  it("keeps built-ins running here", () => {
    expect(registry.get("text.upper")?.remote).toBeUndefined();
    expect(createTransform(map("text.upper"), { registry })({ Id: "ana" })).toEqual({ Out: "ANA" });
  });

  it("checks maps that use server-only operators, but won't run them here", async () => {
    expect(registry.get("acme.tier")?.remote).toBe(true);
    expect(analyseMap(map("acme.tier"), registry).issues).toEqual([]);
    expect(() => createTransform(map("acme.tier"), { registry })).toThrow(/createAsyncTransform/);
    await expect(createAsyncTransform(map("acme.tier"), { registry })({ Id: "ana" })).rejects.toThrow(/runs on the server/);
  });

  it("uses local implementations you pass for operators the server describes", () => {
    const tier = defineOperator({ kind: "value", async: true, id: "acme.tier", label: "Tier", category: "acme", inputs: { min: 1, max: 1 }, run: async () => "gold" });
    const withLocal = registryFromCatalog(serverCatalog, { local: [tier] });
    expect(withLocal.get("acme.tier")?.remote).toBeUndefined();
    expect(withLocal.get("acme.tier")?.label).toBe("Customer tier");
  });

  it("round-trips through toCatalog", () => {
    expect(registry.toCatalog()).toEqual(serverCatalog);
  });
});
