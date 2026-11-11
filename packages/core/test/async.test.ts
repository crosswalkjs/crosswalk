import { describe, expect, it } from "vitest";
import {
  createAsyncTransform,
  createRegistry,
  createTransform,
  defineOperator,
  MapRuntimeError,
  toText,
  type MapDocument,
} from "../src/index.js";

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// A lookup that has to wait, such as a call to another service.
const tiers: Record<string, string> = { ana: "gold", bo: "silver" };
let inFlight = 0;
let mostInFlight = 0;
let calls = 0;
const tier = defineOperator({
  kind: "value",
  async: true,
  id: "acme.tier",
  label: "Customer tier",
  category: "custom",
  inputs: { min: 1, max: 1 },
  run: async ([id], { signal }) => {
    calls++;
    inFlight++;
    mostInFlight = Math.max(mostInFlight, inFlight);
    try {
      await wait(5);
      signal?.throwIfAborted();
      const found = tiers[toText(id ?? null)];
      if (!found) throw new Error(`No customer "${toText(id ?? null)}"`);
      return found;
    } finally {
      inFlight--;
    }
  },
});

const registry = createRegistry({ operators: [tier] });

const customers = (count: number) => ({ Customers: Array.from({ length: count }, (_, i) => ({ Id: i % 2 === 0 ? "ana" : "bo", Name: `C${i}` })) });

const map: MapDocument = {
  version: 1,
  source: {
    type: "object",
    properties: {
      Customers: { type: "array", items: { type: "object", properties: { Id: { type: "string" }, Name: { type: "string" } } } },
    },
  },
  target: {
    type: "object",
    properties: {
      Rows: { type: "array", items: { type: "object", properties: { Name: { type: "string" }, Tier: { type: "string" }, Shout: { type: "string" } } } },
    },
  },
  loops: [{ source: "Customers[]", target: "Rows[]" }],
  nodes: [
    { id: "tier", operator: "acme.tier" },
    { id: "shout", operator: "text.upper" },
  ],
  links: [
    { from: { source: "Customers[].Name" }, to: { target: "Rows[].Name" } },
    { from: { source: "Customers[].Id" }, to: { node: "tier", input: 0 } },
    { from: { node: "tier" }, to: { target: "Rows[].Tier" } },
    // A sync operator fed by the async one.
    { from: { node: "tier" }, to: { node: "shout", input: 0 } },
    { from: { node: "shout" }, to: { target: "Rows[].Shout" } },
  ],
};

describe("async operators", () => {
  it("run inside loops, alongside sync operators, keeping the order", async () => {
    const run = createAsyncTransform(map, { registry });
    expect(await run(customers(3))).toEqual({
      Rows: [
        { Name: "C0", Tier: "gold", Shout: "GOLD" },
        { Name: "C1", Tier: "silver", Shout: "SILVER" },
        { Name: "C2", Tier: "gold", Shout: "GOLD" },
      ],
    });
  });

  it("run once per item, even when they feed several fields", async () => {
    // "tier" feeds Rows[].Tier directly and Rows[].Shout through Uppercase.
    calls = 0;
    await createAsyncTransform(map, { registry })(customers(24));
    expect(calls).toBe(24);
  });

  it("can't run through createTransform, which says why", () => {
    expect(() => createTransform(map, { registry })).toThrow(/createAsyncTransform: "tier" \(Customer tier\)/);
  });

  it("don't stop createTransform for maps that don't use them", () => {
    const syncMap: MapDocument = { ...map, nodes: [], links: [{ from: { source: "Customers[].Name" }, to: { target: "Rows[].Name" } }] };
    expect(createTransform(syncMap, { registry })(customers(1))).toEqual({ Rows: [{ Name: "C0" }] });
  });

  it("are limited to a number of calls at once", async () => {
    mostInFlight = 0;
    await createAsyncTransform(map, { registry, concurrency: 3 })(customers(20));
    expect(mostInFlight).toBe(3);
    mostInFlight = 0;
    await createAsyncTransform(map, { registry })(customers(20));
    expect(mostInFlight).toBe(8);
  });

  it("report a failure against the node", async () => {
    const run = createAsyncTransform(map, { registry });
    const error = await run({ Customers: [{ Id: "nobody", Name: "X" }] }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(MapRuntimeError);
    expect((error as MapRuntimeError).node).toBe("tier");
    expect((error as Error).message).toMatch(/No customer "nobody"/);
  });

  it("stop when the run is cancelled, with the signal's reason", async () => {
    const run = createAsyncTransform(map, { registry });
    const controller = new AbortController();
    const running = run(customers(40), { signal: controller.signal });
    setTimeout(() => controller.abort(), 8);
    await expect(running).rejects.toMatchObject({ name: "AbortError" });
  });

  it("don't start when the signal is already aborted", async () => {
    mostInFlight = 0;
    const run = createAsyncTransform(map, { registry });
    await expect(run(customers(2), { signal: AbortSignal.abort() })).rejects.toMatchObject({ name: "AbortError" });
    expect(mostInFlight).toBe(0);
  });

  it("time out with AbortSignal.timeout", async () => {
    const run = createAsyncTransform(map, { registry, concurrency: 1 });
    await expect(run(customers(20), { signal: AbortSignal.timeout(20) })).rejects.toMatchObject({ name: "TimeoutError" });
  });

  it("need a sensible concurrency", () => {
    expect(() => createAsyncTransform(map, { registry, concurrency: 0 })).toThrow(RangeError);
  });
});
