import { describe, expect, it } from "vitest";
import type { MapDocument, Schema } from "@crosswalkjs/core";
import { recordMappings } from "../src/records.js";

const record = (...fields: string[]): Schema => ({ type: "object", properties: Object.fromEntries(fields.map((f) => [f, { type: "string" }])) });
const list = (item: Schema): Schema => ({ type: "array", items: item });

const map: MapDocument = {
  version: 1,
  source: { type: "object", properties: { Billing: record("Street", "City", "Postcode"), Addresses: list(record("Street", "City")) } },
  target: { type: "object", properties: { BillTo: record("Line1", "Town", "Postcode"), Labels: list(record("Line1", "Town")), Raw: record("Street", "Town") } },
  nodes: [],
  links: [],
  submaps: {
    Address: {
      source: record("Street", "City", "Postcode"),
      target: record("Line1", "Town", "Postcode"),
      nodes: [{ id: "upper", operator: "text.upper" }],
      links: [
        { from: { source: "Street" }, to: { target: "Line1" } },
        { from: { source: "City" }, to: { target: "Town" } },
        { from: { source: "Postcode" }, to: { node: "upper", input: 0 } },
        { from: { node: "upper" }, to: { target: "Postcode" } },
      ],
    },
    Loops: {
      source: record("Street"),
      target: record("Line1"),
      nodes: [],
      links: [{ from: { source: "Street" }, to: { target: "Line1" } }, { from: { source: "Street" }, to: { target: "Line1" }, submap: "Loops" }],
    },
  },
};

describe("what a record link maps", () => {
  it("follows the sub-map, through its operators, in the map's own paths", () => {
    expect(recordMappings(map, { from: { source: "Billing" }, to: { target: "BillTo" }, submap: "Address" })).toEqual([
      { source: "Billing.Street", target: "BillTo.Line1", through: false },
      { source: "Billing.City", target: "BillTo.Town", through: false },
      { source: "Billing.Postcode", target: "BillTo.Postcode", through: true },
    ]);
  });

  it("maps a loop's items", () => {
    expect(recordMappings(map, { from: { source: "Addresses[]" }, to: { target: "Labels[]" }, submap: "Address" }).map((m) => `${m.source} → ${m.target}`)).toEqual([
      "Addresses[].Street → Labels[].Line1",
      "Addresses[].City → Labels[].Town",
    ]);
  });

  it("pairs fields of the same name for a copy", () => {
    expect(recordMappings(map, { from: { source: "Billing" }, to: { target: "Raw" } })).toEqual([{ source: "Billing.Street", target: "Raw.Street", through: false }]);
  });

  it("isn't thrown by a sub-map that uses itself, or by links between values", () => {
    expect(() => recordMappings(map, { from: { source: "Billing" }, to: { target: "BillTo" }, submap: "Loops" })).not.toThrow();
    expect(recordMappings(map, { from: { source: "Billing.Street" }, to: { target: "BillTo.Line1" } })).toEqual([]);
  });
});
