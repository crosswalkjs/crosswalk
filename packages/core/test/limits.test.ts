import { describe, expect, it } from "vitest";
import {
  createAsyncTransform,
  createRegistry,
  createTransform,
  defineOperator,
  handlePreview,
  limitsForUserMaps,
  MapLimitError,
  type MapDocument,
} from "../src/index.js";
import personMap from "../../../conformance/maps/person-profile/map.json";
import personInput from "../../../conformance/maps/person-profile/input.json";

// An operator that takes a while: spinning for sync runs, waiting for async ones.
let aborted = 0;
const slow = defineOperator({
  kind: "value",
  id: "test.slow",
  label: "Slow",
  category: "custom",
  inputs: { min: 1, max: 1 },
  run: ([value]) => {
    const until = Date.now() + 5;
    while (Date.now() < until) {
      // Spin: a synchronous operator can't be interrupted, only stopped between steps.
    }
    return value ?? null;
  },
});
const wait = defineOperator({
  kind: "value",
  async: true,
  id: "test.wait",
  label: "Wait",
  category: "custom",
  inputs: { min: 1, max: 1 },
  run: ([value], { signal }) =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(() => resolve(value ?? null), 1000);
      signal?.addEventListener("abort", () => {
        aborted++;
        clearTimeout(timer);
        reject(signal.reason);
      });
    }),
});
const registry = createRegistry({ operators: [slow, wait] });

const loopOver = (operator: string): MapDocument => ({
  version: 1,
  source: { type: "object", properties: { Items: { type: "array", items: { type: "object", properties: { V: { type: "string" } } } } } },
  target: { type: "object", properties: { Out: { type: "array", items: { type: "object", properties: { V: { type: "string" } } } } } },
  loops: [{ source: "Items[]", target: "Out[]" }],
  nodes: [{ id: "op", operator }],
  links: [
    { from: { source: "Items[].V" }, to: { node: "op", input: 0 } },
    { from: { node: "op" }, to: { target: "Out[].V" } },
  ],
});
const items = (count: number) => ({ Items: Array.from({ length: count }, (_, i) => ({ V: `v${i}` })) });

describe("timeouts", () => {
  it("stop a synchronous run between steps", () => {
    const run = createTransform(loopOver("test.slow"), { registry, limits: { timeout: 30 } });
    expect(() => run(items(40))).toThrow(MapLimitError);
    try {
      run(items(40));
    } catch (error) {
      expect((error as MapLimitError).limit).toBe("timeout");
    }
  });

  it("cancel the operators an async run is waiting on", async () => {
    aborted = 0;
    const run = createAsyncTransform(loopOver("test.wait"), { registry, limits: { timeout: 30 } });
    const error = await run(items(3)).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(MapLimitError);
    expect((error as MapLimitError).limit).toBe("timeout");
    expect(aborted).toBe(3);
  });

  it("leave your own cancellation as a cancellation", async () => {
    const run = createAsyncTransform(loopOver("test.wait"), { registry, limits: { timeout: 5000 } });
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 20);
    await expect(run(items(2), { signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });
  });
});

describe("limitsForUserMaps", () => {
  it("is generous for real maps and can't be changed by accident", () => {
    expect(limitsForUserMaps).toEqual({ maxNodes: 500, maxLinks: 2000, maxOperatorRuns: 1_000_000, maxOutputValues: 1_000_000, maxTextLength: 1_000_000, timeout: 5000 });
    expect(Object.isFrozen(limitsForUserMaps)).toBe(true);
    expect(createTransform(personMap as MapDocument, { limits: limitsForUserMaps })).toBeTypeOf("function");
  });
});

describe("handlePreview's limits", () => {
  it("apply by default, and report the limit", async () => {
    const response = await handlePreview({ map: personMap as MapDocument, input: personInput }, { limits: { maxOperatorRuns: 3 } });
    expect(response).toMatchObject({ error: { limit: "maxOperatorRuns" } });
  });

  it("refuse an oversized map before analysing it", async () => {
    const response = await handlePreview({ map: personMap as MapDocument, input: personInput }, { limits: { maxNodes: 2 } });
    expect(response).toMatchObject({ error: { limit: "maxNodes", message: expect.stringMatching(/10 operators/) as string } });
  });
});
