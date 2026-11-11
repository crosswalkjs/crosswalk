import { describe, expect, it } from "vitest";
import { createTransform, type MapDocument, type Schema } from "../src/index.js";
import personMap from "./fixtures/person.map.json";
import personInput from "./fixtures/person.input.json";

const source = (personMap as MapDocument).source;

const callsTarget: Schema = {
  type: "object",
  properties: {
    Calls: {
      type: "array",
      items: {
        type: "object",
        properties: {
          Number: { type: "string" },
          Cost: { type: "number" },
          Kind: { type: "string" },
        },
      },
    },
  },
};

describe("loops", () => {
  it("repeats a target array once per source item", () => {
    const map: MapDocument = {
      version: 1,
      source,
      target: callsTarget,
      loops: [{ source: "PhoneCalls[]", target: "Calls[]" }],
      nodes: [
        { id: "prefix", operator: "text.left", constants: { 1: 4 } },
        { id: "isNational", operator: "logic.equal", constants: { 1: "+351" } },
        { id: "kind", operator: "flow.ifElse", constants: { 1: "national", 2: "international" } },
      ],
      links: [
        { from: { source: "PhoneCalls[].PhoneNumber" }, to: { target: "Calls[].Number" } },
        { from: { source: "PhoneCalls[].Cost" }, to: { target: "Calls[].Cost" } },
        { from: { source: "PhoneCalls[].PhoneNumber" }, to: { node: "prefix", input: 0 } },
        { from: { node: "prefix" }, to: { node: "isNational", input: 0 } },
        { from: { node: "isNational" }, to: { node: "kind", input: 0 } },
        { from: { node: "kind" }, to: { target: "Calls[].Kind" } },
      ],
    };

    expect(createTransform(map)(personInput)).toEqual({
      Calls: [
        { Number: "+351917777777", Cost: 2.5, Kind: "national" },
        { Number: "+441234567890", Cost: 4, Kind: "international" },
        { Number: "+351225555555", Cost: 1.25, Kind: "national" },
        { Number: "+15550001111", Cost: 3.1, Kind: "international" },
      ],
    });
  });

  it("drops an item when every field is gated off", () => {
    const map: MapDocument = {
      version: 1,
      source,
      target: callsTarget,
      loops: [{ source: "PhoneCalls[]", target: "Calls[]" }],
      nodes: [
        { id: "isExpensive", operator: "logic.greaterThan", constants: { 1: 3 } },
        { id: "numberGate", operator: "flow.onlyIf" },
        { id: "costGate", operator: "flow.onlyIf" },
      ],
      links: [
        { from: { source: "PhoneCalls[].Cost" }, to: { node: "isExpensive", input: 0 } },
        { from: { node: "isExpensive" }, to: { node: "numberGate", input: 0 } },
        { from: { source: "PhoneCalls[].PhoneNumber" }, to: { node: "numberGate", input: 1 } },
        { from: { node: "numberGate" }, to: { target: "Calls[].Number" } },
        { from: { node: "isExpensive" }, to: { node: "costGate", input: 0 } },
        { from: { source: "PhoneCalls[].Cost" }, to: { node: "costGate", input: 1 } },
        { from: { node: "costGate" }, to: { target: "Calls[].Cost" } },
      ],
    };

    expect(createTransform(map)(personInput)).toEqual({
      Calls: [
        { Number: "+441234567890", Cost: 4 },
        { Number: "+15550001111", Cost: 3.1 },
      ],
    });
  });

  it("aggregates the inner array of a nested loop per outer item", () => {
    const map: MapDocument = {
      version: 1,
      source: {
        type: "object",
        properties: {
          Orders: {
            type: "array",
            items: {
              type: "object",
              properties: {
                Id: { type: "string" },
                Lines: { type: "array", items: { type: "object", properties: { Amount: { type: "number" } } } },
              },
            },
          },
        },
      },
      target: {
        type: "object",
        properties: {
          Totals: { type: "array", items: { type: "object", properties: { Id: { type: "string" }, Total: { type: "number" } } } },
        },
      },
      loops: [{ source: "Orders[]", target: "Totals[]" }],
      nodes: [{ id: "total", operator: "aggregate.sum", scope: "Orders[].Lines[]" }],
      links: [
        { from: { source: "Orders[].Id" }, to: { target: "Totals[].Id" } },
        { from: { source: "Orders[].Lines[].Amount" }, to: { node: "total", input: 0 } },
        { from: { node: "total" }, to: { target: "Totals[].Total" } },
      ],
    };

    const input = {
      Orders: [
        { Id: "A", Lines: [{ Amount: 1 }, { Amount: 2 }] },
        { Id: "B", Lines: [{ Amount: 10 }] },
      ],
    };
    expect(createTransform(map)(input)).toEqual({ Totals: [{ Id: "A", Total: 3 }, { Id: "B", Total: 10 }] });
  });
});
