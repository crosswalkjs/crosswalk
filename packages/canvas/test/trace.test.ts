import { describe, expect, it } from "vitest";
import type { MapDocument } from "@crosswalkjs/core";
import { traceChain, traceFields, type Chain } from "../src/trace.js";
import personMap from "../../core/test/fixtures/person.map.json";
import { buildMap } from "../../../website/src/examples/bigmap.js";

const person = personMap as MapDocument;
const sorted = (set: Set<string>) => [...set].sort();

describe("tracing a chain", () => {
  it("follows a target field back through its operators to the source fields", () => {
    const chain = traceChain(person, { kind: "target", path: "PhoneBilling.TotalNational" });
    expect(sorted(chain.nodes)).toEqual(["isNational", "nationalCost", "prefix", "totalNational"]);
    expect(sorted(chain.sources)).toEqual(["PhoneCalls[]", "PhoneCalls[].Cost", "PhoneCalls[].PhoneNumber"]);
    expect(sorted(chain.targets)).toEqual(["PhoneBilling.TotalNational"]);
  });

  it("follows a source field forward to every target field it ends up in", () => {
    const chain = traceChain(person, { kind: "source", path: "PhoneCalls[].PhoneNumber" });
    expect(sorted(chain.targets)).toEqual(["PhoneBilling.TotalInternational", "PhoneBilling.TotalNational"]);
    expect(chain.nodes.has("prefix") && chain.nodes.has("totalInternational")).toBe(true);
    expect(chain.nodes.has("fullName")).toBe(false);
  });

  it("goes both ways through an operator", () => {
    const chain = traceChain(person, { kind: "node", id: "isNational" });
    expect(chain.sources.has("PhoneCalls[].PhoneNumber")).toBe(true);
    expect(sorted(chain.targets)).toEqual(["PhoneBilling.TotalInternational", "PhoneBilling.TotalNational"]);
  });

  it("includes the record link or loop a field is inside, across pages", () => {
    const map = buildMap();
    const street = traceChain(map, { kind: "target", path: "Partners.ShipTo.Address.Street" });
    expect(street.sources.has("ShippingAddress")).toBe(true);
    expect(street.targets.has("Partners.ShipTo.Address")).toBe(true);

    const material = traceChain(map, { kind: "target", path: "Items[].Material" });
    expect(material.sources.has("Lines[]")).toBe(true);
    expect(material.sources.has("Lines[].Sku")).toBe(true);

    // The grand total's check reads fields from the Items and Pricing pages' sources.
    const balanced = traceChain(map, { kind: "target", path: "Pricing.Balanced" });
    expect(balanced.sources.has("Totals.Grand")).toBe(true);
    expect(balanced.nodes.size).toBe(8);
  });
});

describe("tracing many fields at once", () => {
  const union = (chains: Chain[]) => ({
    nodes: sorted(new Set(chains.flatMap((c) => [...c.nodes]))),
    sources: sorted(new Set(chains.flatMap((c) => [...c.sources]))),
    targets: sorted(new Set(chains.flatMap((c) => [...c.targets]))),
  });
  const plain = (c: Chain) => ({ nodes: sorted(c.nodes), sources: sorted(c.sources), targets: sorted(c.targets) });

  it.each([
    ["source", ["Order2.OrderNumber", "Order5.OrderNumber"]],
    ["source", ["Order1.Lines[].Qty", "Order1.BillingAddress.City"]],
    ["target", ["SalesOrder3.Pricing.Balanced", "SalesOrder3.Items[].Material"]],
  ] as const)("matches tracing each %s field on its own", (side, paths) => {
    const map = buildMap(8);
    expect(plain(traceFields(map, side, paths))).toEqual(union(paths.map((path) => traceChain(map, { kind: side, path }))));
  });
});
