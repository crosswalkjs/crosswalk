import type {JsonValue, MapDocument} from "@crosswalkjs/core";

// Grouping, a lookup table, a sub-map used twice and a note.
const address = (...fields: string[]) => ({ type: "object" as const, properties: Object.fromEntries(fields.map((f) => [f, { type: "string" as const }])) });
export const orderMap: MapDocument = {
  version: 1,
  source: {
    type: "object",
    title: "Order",
    properties: {
      Number: { type: "string" },
      Status: { type: "string" },
      Billing: address("Street", "City", "Postcode"),
      Shipping: address("Street", "City", "Postcode"),
      Lines: {
        type: "array",
        items: { type: "object", properties: { Sku: { type: "string" }, Date: { type: "string" }, Qty: { type: "number" } } },
      },
    },
  },
  target: {
    type: "object",
    title: "Invoice",
    properties: {
      Reference: { type: "string" },
      Status: { type: "string" },
      BillTo: address("Line1", "Town", "Postcode"),
      ShipTo: address("Line1", "Town", "Postcode"),
      Products: {
        type: "array",
        items: { type: "object", properties: { Sku: { type: "string" }, Units: { type: "number" }, FirstOrdered: { type: "string" } } },
      },
    },
  },
  loops: [{ source: "Lines[]", target: "Products[]", sortBy: [{ path: "Lines[].Date" }], groupBy: "Lines[].Sku" }],
  nodes: [
    { id: "status", operator: "convert.lookup", constants: { 1: { P: "Paid", S: "Shipped", C: "Cancelled" }, 2: "Unknown" }, position: { x: 150, y: 50 } },
    { id: "units", operator: "aggregate.sum", scope: "Lines[]", position: { x: 150, y: 290 } },
  ],
  links: [
    { from: { source: "Number" }, to: { target: "Reference" } },
    { from: { source: "Status" }, to: { node: "status", input: 0 } },
    { from: { node: "status" }, to: { target: "Status" } },
    { from: { source: "Billing" }, to: { target: "BillTo" }, submap: "Address" },
    { from: { source: "Shipping" }, to: { target: "ShipTo" }, submap: "Address" },
    { from: { source: "Lines[].Sku" }, to: { target: "Products[].Sku" } },
    { from: { source: "Lines[].Qty" }, to: { node: "units", input: 0 } },
    { from: { node: "units" }, to: { target: "Products[].Units" } },
    { from: { source: "Lines[].Date" }, to: { target: "Products[].FirstOrdered" } },
  ],
  notes: [
    {
      id: "note1",
      text: "One product per SKU, earliest order first. Units add up across the SKU's lines.",
      position: { x: 24, y: 22 },
      on: { node: "units" },
    },
  ],
  submaps: {
    Address: {
      source: { ...address("Street", "City", "Postcode"), title: "Address" },
      target: { ...address("Line1", "Town", "Postcode"), title: "Address" },
      nodes: [{ id: "postcode", operator: "text.upper", position: { x: 160, y: 90 } }],
      links: [
        { from: { source: "Street" }, to: { target: "Line1" } },
        { from: { source: "City" }, to: { target: "Town" } },
        { from: { source: "Postcode" }, to: { node: "postcode", input: 0 } },
        { from: { node: "postcode" }, to: { target: "Postcode" } },
      ],
      notes: [{ id: "note1", text: "Both addresses on the order use this.", position: { x: 120, y: 190 } }],
    },
  },
};

export const orderInput: JsonValue = {
  Number: "SO-1042",
  Status: "S",
  Billing: { Street: "4 Mill Lane", City: "Leeds", Postcode: "ls1 4ab" },
  Shipping: { Street: "Unit 9, Canal Wharf", City: "Leeds", Postcode: "ls11 5pq" },
  Lines: [
    { Sku: "MUG-01", Date: "2026-03-04", Qty: 2 },
    { Sku: "TEA-12", Date: "2026-03-01", Qty: 1 },
    { Sku: "MUG-01", Date: "2026-03-02", Qty: 4 },
  ],
};
