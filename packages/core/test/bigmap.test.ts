import { describe, expect, it } from "vitest";
import { analyseMap, createRegistry, createTransform } from "../src/index.js";
import { setToday } from "../src/operators/dates.js";
import { buildInput, buildMap } from "../../../website/src/examples/bigmap.js";

// The docs' big map, made by code: it has to be a valid map that runs, at every size.
describe("the big order-to-ERP map", () => {
  it.each([1, 2])("is valid with %i cop(ies)", (copies) => {
    const map = buildMap(copies);
    const errors = analyseMap(map, createRegistry()).issues.filter((i) => i.severity === "error");
    expect(errors).toEqual([]);
  });

  it("maps the sample order", () => {
    setToday("2026-03-10");
    const out = createTransform(buildMap())(buildInput()) as Record<string, any>;
    setToday(undefined);
    expect(out.Header).toMatchObject({ DocumentType: "ZOR", DocumentDate: "20260304", RequestedDelivery: "20260306", Currency: "GBP", OrderReason: "PRM" });
    expect(out.Partners.SoldTo).toMatchObject({ CustomerNumber: "C0000048213", Name: "Ana Silva", Email: "ana.silva@example.com", Age: 37 });
    expect(out.Partners.ShipTo.Address).toMatchObject({ PostalCode: "LS14AP", CountryName: "United Kingdom" });
    expect(out.Items.map((i: any) => i.ItemNumber)).toEqual([10, 20]);
    expect(out.Items[0].Components).toEqual([{ Material: "TEA-EARL-50", Quantity: 2 }, { Material: "MUG-TEAL", Quantity: 1 }]);
    expect(out.Pricing).toMatchObject({ Subtotal: 70.5, ItemCount: 2, Balanced: true });
    expect(out.Delivery.Deliveries[0]).toMatchObject({ PackageCount: 2, TotalWeight: 2.19 });
  });

  it("places no operator on top of another on the same page", () => {
    const { nodes } = buildMap(2);
    const clashes = nodes.flatMap((a, i) =>
      nodes.slice(i + 1).filter((b) => a.page === b.page && Math.abs(a.position!.x - b.position!.x) < 40 && Math.abs(a.position!.y - b.position!.y) < 40).map((b) => `${a.id} and ${b.id}`),
    );
    expect(clashes).toEqual([]);
  });

  it("has a few hundred operators per order", () => {
    const one = buildMap(1).nodes.length;
    expect(one).toBeGreaterThan(150);
    expect(buildMap(8).nodes.length).toBe(one * 8);
  });
});
